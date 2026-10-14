// Aurora model: a global Kp index per night (occasional geomagnetic storms), the auroral oval
// in geomagnetic latitude (IGRF dipole pole), and the curtain's brightness/structure on the sky.
import { makeNoise, mulberry32, hashStr, smoothstep } from './util.js';

const D2R = Math.PI / 180;
const POLE = [80.65, -72.68]; // north geomagnetic pole (dipole), IGRF ~2020s
const kpNoise = makeNoise(hashStr('kp'));

// Kp for every hour of a night (global — the same storm is seen everywhere). Mostly quiet (1–3), storms ~8% of nights.
export function kpSeries(dayIndex, slots = 16) {
  const r = mulberry32(hashStr('storm:' + dayIndex));
  const storm = r() < 0.08 ? 3 + r() * 3.5 : r() < 0.25 ? 1.2 + r() * 1.5 : 0;
  const peakH = r() * slots;
  const out = [];
  for (let h = 0; h < slots; h++) {
    const base = 1 + 2.2 * kpNoise.fbm(dayIndex * 0.45 + h / 30, 2.3, 3);
    const bump = storm * Math.exp(-(((h - peakH) / 4.5) ** 2));
    out.push(+Math.min(9, base + bump).toFixed(1));
  }
  return out;
}

export function geomagLat(lat, lon) {
  const p = POLE[0] * D2R, l = lat * D2R;
  return Math.asin(Math.sin(l) * Math.sin(p) + Math.cos(l) * Math.cos(p) * Math.cos((lon - POLE[1]) * D2R)) / D2R;
}
function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  return ((Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D2R) + 360) % 360;
}

// What the observer sees: strength 0..1, the arc's altitude toward the pole, and that direction's azimuth.
export function auroraState(lat, lon, kp, sunAlt) {
  const south = lat < 0;
  const mlat = Math.abs(south ? -geomagLat(-lat, lon + 180) : geomagLat(lat, lon)); // crude conjugate for the south
  const boundary = 66.5 - 2.2 * kp; // equatorward edge of the oval
  const d = mlat - boundary;
  const vis = smoothstep(-13, -3, d);
  const strength = vis * Math.min(1, 0.25 + kp / 7) * smoothstep(-8, -16, sunAlt);
  const arcAlt = Math.max(3, Math.min(150, 8 + (d + 13) * 4.2)); // 0 = pole-side horizon, 90 = zenith, >90 = past the zenith
  const poleAz = south ? bearing(lat, lon, -POLE[0], POLE[1] + 180) : bearing(lat, lon, POLE[0], POLE[1]);
  return { kp, mlat, strength: strength < 0.02 ? 0 : strength, arcAlt, poleAz };
}

// Surface brightness (in nL-ish units for green, red) of the aurora in direction (alt, az) at time ms.
const rays = makeNoise(hashStr('aurora-rays'));
export function auroraAt(st, alt, az, ms, out = [0, 0]) {
  out[0] = out[1] = 0;
  if (!st || !st.strength || alt < -2) return out;
  const t = ms / 1000;
  const da = ((((az - st.poleAz) % 360) + 540) % 360 - 180) * D2R, al = Math.max(0, alt) * D2R;
  // coordinates around the geomagnetic pole axis: q along the meridian (0 pole horizon → 90 zenith → 180), s along the arc
  const q = Math.atan2(Math.sin(al), Math.cos(al) * Math.cos(da)) / D2R;
  const sA = Math.asin(Math.max(-1, Math.min(1, Math.cos(al) * Math.sin(da)))) / D2R;
  const side = Math.exp(-((sA / 80) ** 2));
  let g = 0, r = 0;
  const arcs = st.strength > 0.6 && st.arcAlt > 40 ? [[st.arcAlt, 1], [st.arcAlt - 28, 0.55]] : [[st.arcAlt, 1]];
  for (const [qa, w] of arcs) {
    const up = qa < 90 ? 1 : -1;
    const x = (q - qa) * up + (rays.fbm(sA * 0.04 + t / 900, 1.7 + qa, 3) - 0.5) * 9; // lower edge wanders
    if (x < -4) continue;
    const lower = smoothstep(-4, 1.2, x);
    const ray = 0.3 + 0.7 * Math.pow(rays.fbm(sA * 0.45 + t / 240, 7.1 + qa + t / 1800, 4), 1.5) * 1.7;
    g += w * lower * Math.exp(-Math.max(0, x) / 10) * ray;
    r += w * lower * smoothstep(7, 20, x) * Math.exp(-Math.max(0, x - 16) / 24) * (0.4 + ray * 0.5);
  }
  const pulse = 0.55 + 0.45 * rays.fbm(t / 600, 3.3, 2);
  const S = st.strength * side * pulse * 2600;
  out[0] = g * S; out[1] = r * S * 0.35;
  return out;
}
