// Meteors: the annual showers (real radiants, peak dates, ZHR) plus sporadics. One shared stream of
// meteor events is generated as sim time passes; the 3D sky draws them and exposures record them.
import * as A from './astro.js';
import { mulberry32 } from './util.js';

// name, peak month, day, ZHR, radiant RA, Dec, half-width (days), speed km/s
export const SHOWERS = [
  ['Quadrantids', 1, 3, 110, 230, 49, 0.6, 41], ['Lyrids', 4, 22, 18, 271, 34, 1.5, 49], ['Eta Aquariids', 5, 6, 50, 338, -1, 4, 66],
  ['Southern Delta Aquariids', 7, 30, 25, 340, -16, 6, 41], ['Perseids', 8, 12, 100, 48, 58, 2.5, 59], ['Draconids', 10, 8, 10, 262, 54, 0.5, 20],
  ['Orionids', 10, 21, 20, 95, 16, 3, 66], ['Southern Taurids', 11, 5, 5, 52, 15, 10, 27], ['Leonids', 11, 17, 15, 152, 22, 1, 71],
  ['Geminids', 12, 14, 150, 112, 33, 1.5, 35], ['Ursids', 12, 22, 10, 217, 76, 0.7, 33],
];
const SPORADIC = 8; // per hour, whole sky

function dayDiff(ms, mo, d) {
  const dt = new Date(ms); const y = dt.getUTCFullYear();
  let best = 1e9; for (const yy of [y - 1, y, y + 1]) { const p = Date.UTC(yy, mo - 1, d, 12); const dd = (ms - p) / 86400000; if (Math.abs(dd) < Math.abs(best)) best = dd; }
  return best;
}
// Active showers at time ms: [{name, zhr (current), peakZhr, ra, dec, days to peak}]
export function activeShowers(ms) {
  const out = [];
  for (const [name, mo, d, zhr, ra, dec, w, v] of SHOWERS) {
    const dd = dayDiff(ms, mo, d); const z = zhr * Math.exp(-Math.abs(dd) / w);
    if (z >= 0.8) out.push({ name, zhr: z, peakZhr: zhr, ra, dec, v, daysToPeak: -dd });
  }
  return out.sort((a, b) => b.zhr - a.zhr);
}
// Visible hourly rate for an observer (radiant altitude, limiting magnitude)
export function hourlyRate(ms, lat, lon, limMag = 6.5) {
  const L = A.lst(ms, lon); let r = SPORADIC * Math.pow(2.2, limMag - 6.5);
  for (const s of activeShowers(ms)) { const alt = A.radec2altaz(s.ra, s.dec, L, lat).alt; if (alt > 0) r += s.zhr * Math.sin(alt * A.D2R) * Math.pow(2.2, limMag - 6.5); }
  return r;
}

const POP = 2.2; // population index
const rng = mulberry32(0x5eed);
let events = [], lastGen = null;
// Advance the meteor stream to time ms for an observer; returns all events (pruned to the last hour)
export function advance(ms, lat, lon, skyLim = 6.5) {
  if (lastGen === null || ms < lastGen || ms - lastGen > 6 * 3600e3) { lastGen = ms; events = []; return events; }
  const dtH = (ms - lastGen) / 3600e3; if (dtH <= 0) return events;
  const L = A.lst(ms, lon), showers = activeShowers(ms);
  const sources = [{ name: 'Sporadic', rate: SPORADIC, ra: null }, ...showers.map((s) => ({ name: s.name, rate: s.zhr, ra: s.ra, dec: s.dec, v: s.v }))];
  for (const src of sources) {
    // Poisson count over the whole visible sky (all meteors down to mag 6.5 at zenith rates)
    let radAlt = 90;
    if (src.ra !== null) { radAlt = A.radec2altaz(src.ra, src.dec, L, lat).alt; if (radAlt < -5) continue; }
    const lam = src.rate * dtH * (src.ra === null ? 1 : Math.max(0.05, Math.sin(Math.max(0, radAlt) * A.D2R)));
    let n = 0; if (lam > 30) n = Math.round(lam + Math.sqrt(lam) * (rng() + rng() + rng() - 1.5) * 2); else { const Lx = Math.exp(-lam); let p = 1; do { n++; p *= rng(); } while (p > Lx); n--; }
    for (let i = 0; i < Math.min(n, 400); i++) {
      const t = lastGen + rng() * (ms - lastGen);
      const alt = 12 + Math.asin(rng()) / A.D2R * (78 / 90), az = rng() * 360; // more of them near the horizon by area
      const p0 = A.altaz2radec(alt, az, A.lst(t, lon), lat);
      const rad = src.ra !== null ? { ra: src.ra, dec: src.dec } : A.altaz2radec(-10 + rng() * 80, rng() * 360, A.lst(t, lon), lat);
      const dist = A.sep(rad.ra, rad.dec, p0.ra, p0.dec);
      const pa = A.posAngle(p0.ra, p0.dec, rad.ra, rad.dec) + 180; // heading away from the radiant
      const len = (3 + rng() * 18) * Math.max(0.25, Math.sin(Math.min(90, dist) * A.D2R));
      const p1 = A.offsetPA(p0.ra, p0.dec, len, pa);
      const mag = 6.5 + Math.log(Math.max(1e-6, rng())) / Math.log(POP);
      if (mag > skyLim + 1.5) continue; // too faint to ever register
      const v = src.v || 30 + rng() * 40;
      events.push({ t, ra: p0.ra, dec: p0.dec, ra2: p1.ra, dec2: p1.dec, mag, dur: Math.min(2.5, Math.max(0.15, len / (v / 9))), shower: src.name, col: v > 55 ? [0.75, 1, 0.8] : [1, 0.9, 0.7] });
    }
  }
  lastGen = ms;
  events.sort((a, b) => a.t - b.t);
  const cut = ms - 3600e3; if (events.length > 600 || (events[0] && events[0].t < cut)) events = events.filter((e) => e.t >= cut).slice(-600);
  return events;
}
export function between(t0, t1) { return events.filter((e) => e.t + e.dur * 1000 >= t0 && e.t <= t1); }
export function current(ms) { return events.filter((e) => ms >= e.t && ms <= e.t + Math.max(e.dur, 0.4) * 1000); }
