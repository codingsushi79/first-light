// The observing night: time flow, mount physics, camera, focus, dew, exposures.
import * as A from './astro.js';
import { G, emit, save, addMoney, localParts, localMs, dayIndexOf, idbSet } from './state.js';
import { GEAR, LOC, rigInfo, sensorAt, horizonAlt, FILTERS } from './gear.js';
import { actualWeather, wxAt, NIGHT_START_HOUR } from './weather.js';
import { mulberry32, gaussFactory, hashStr, uid } from './util.js';
import { renderRecipe, makeThumb } from './imaging.js';

export const WARPS = [1, 5, 20, 60, 200, 600];
export const T = { warp: 1, busy: false, waiters: [], exposure: null, lastFrame: null, guideHist: [], lastGuideT: 0 };
const rng = mulberry32((Math.random() * 1e9) | 0), gauss = gaussFactory(rng);

export const night = () => G.s.night;
export const now = () => G.s.time;
export const rig = () => rigInfo(G.s.rig);
export function locNow() { return LOC[G.s.location]; }

// ------------------------------------------------------------------ night lifecycle
function _startNight(locId) {
  const loc = LOC[locId];
  if (G.s.money < loc.travel) return { error: `You need $${loc.travel} for travel.` };
  if (loc.travel) addMoney(-loc.travel, `Travel to ${loc.name}`);
  G.s.location = locId;
  const tz = loc.tz;
  const p = localParts(G.s.time, tz);
  const noon = localMs(p.y, p.mo, p.d, 12, 0, tz);
  const ev = A.nightEvents(noon, loc.lat, loc.lon);
  const dayIndex = dayIndexOf(noon + 6 * 3600000, tz);
  const start = (ev.sunStart || noon + 6 * 3600000) - 25 * 60000;
  G.s.time = Math.max(G.s.time, start);
  const wx = actualWeather(locId, dayIndex);
  if (G.s.gameMode === 'sandbox' && G.s.sandbox && G.s.sandbox.clearSkies) { wx.clouds = wx.clouds.map(() => 0); wx.transp = wx.transp.map((t) => Math.max(t, 0.85)); }
  else if (G.s.stats.nights === 0) { wx.clouds = wx.clouds.map((c) => +(c * 0.08).toFixed(2)); wx.transp = wx.transp.map((t) => Math.max(t, 0.8)); } // a kind first night
  const r = mulberry32(hashStr('setup' + dayIndex + locId + G.s.stats.nights));
  const ri = rig();
  const mount = GEAR[G.s.rig.mount];
  const n = {
    id: uid(), loc: locId, dayIndex, noon, events: ev, wx, started: G.s.time,
    capOn: true, bahtinov: false, dewHeater: false, panelOn: false,
    mount: {
      tracking: false, frame: 'altaz', alt: 35, az: 180, ha: 0, ra: 0, dec: 0, roll: 0, flipped: false,
      pa: mount.type === 'eq' ? { alt: (r() - 0.5) * 140, az: (r() - 0.5) * 260 } : { alt: 0, az: 0 },
      modelErr: { e: (r() - 0.5) * 2.4 * 3600, n: (r() - 0.5) * 1.8 * 3600 }, synced: false, parked: mount.goto, slew: null,
      peSeed: r() * 1000, lastMove: 0,
    },
    focus: initialFocus(ri, r),
    cam: { temp: wx.temp[0] + 1, coolerOn: false, setpoint: -10, power: 0, duty: 0 },
    connected: { camera: false, mount: false, focuser: false, wheel: false, guider: false },
    guider: { calibrated: false, guiding: false, looping: false, rms: 0, lost: false, settleUntil: 0 },
    wheelPos: 0, dew: 0, battery: 100, lastSolve: null, sqm: null, log: [],
  };
  // point roughly north-ish & up for EQ mounts in home position, south for others
  if (mount.type === 'eq') { n.mount.frame = 'hadec'; n.mount.ha = -90; n.mount.dec = 89.9 * Math.sign(loc.lat); n.mount.roll = 0; }
  else { n.mount.frame = 'altaz'; n.mount.alt = 30; n.mount.az = loc.lat > 0 ? 160 : 20; }
  G.s.night = n; G.s.mode = 'night'; G.s.stats.nights++;
  G.s.sessions.push({ id: n.id, date: dayIndex, location: locId, start: G.s.time, frames: 0 });
  log(`Arrived at ${loc.name}. Sunset ${fmtLocal(ev.sunStart)}, astronomical darkness ${fmtLocal(ev.astroStart)}–${fmtLocal(ev.astroEnd)}.`);
  emit('night', n); save(true);
  return { ok: true };
}
function fmtLocal(ms) { if (!ms) return '—'; const p = localParts(ms, locNow().tz); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; }

function initialFocus(ri, r) {
  if (!ri.opt) return { pos: 0, best0: 0, unit: 'deg' };
  if (ri.isLens) return { pos: 270, best0: 259 + r() * 6, unit: 'deg', min: 0, max: 270 };
  const best0 = 5000 + (r() - 0.5) * 600;
  return { pos: Math.round(best0 + (r() - 0.5) * 500), best0, unit: 'steps', min: 0, max: 10000 }; // drawtube roughly where you left it
}

function _endNight(reason = '') {
  const n = night(); if (!n) return;
  abortExposure();
  const loc = locNow();
  T.exposure = null; T.waiters.forEach((w) => w.reject(new Error('Night ended'))); T.waiters = [];
  const p = localParts(G.s.time, loc.tz);
  let next = localMs(p.y, p.mo, p.d, 11, 0, loc.tz);
  if (next <= G.s.time) next += 86400000;
  const home = LOC.backyard;
  G.s.time = next + (loc.tz - home.tz) * 0; // keep same instant
  G.s.night = null; G.s.mode = 'day'; G.s.location = 'backyard';
  emit('night', null);
  emit('newday', { reason });
  save(true);
}

function _skipDay() {
  if (G.s.mode !== 'day') return;
  G.s.time += 86400000;
  emit('newday', {}); emit('tick', 0); save();
}

// Sandbox: jump to any date (you are at home in the daytime). Moon phase, sky and weather follow.
function _setDate(y, mo, d) {
  if (G.s.gameMode !== 'sandbox') return { error: 'Choosing the date is a sandbox feature.' };
  if (G.s.mode !== 'day') return { error: 'Pack up and go home first.' };
  const home = LOC.backyard;
  G.s.time = localMs(y, mo, d, 13, 0, home.tz);
  emit('newday', {}); emit('tick', 0); save();
  return { ok: true };
}

export function log(msg) {
  const n = night(); if (!n) return;
  n.log.push({ t: G.s.time, msg }); if (n.log.length > 300) n.log.shift();
  emit('log', msg);
}

// ------------------------------------------------------------------ environment
export function envAt(ms) {
  const n = night(); const loc = locNow();
  const lat = loc.lat, lon = loc.lon;
  const sun = A.sunAltAz(ms, lat, lon), moon = A.moonAltAz(ms, lat, lon), ph = A.moonPhase(ms);
  const hOff = n ? hoursSinceNightStart(ms) : 4;
  const wx = n ? n.wx : actualWeather(G.s.location, dayIndexOf(ms, loc.tz));
  return {
    lat, lon, loc, sunAlt: sun.alt, sunAz: sun.az, moonAlt: moon.alt, moonAz: moon.az, moonRa: moon.ra, moonDec: moon.dec,
    moonPhase: ph.phaseAngle, moonIllum: ph.illum,
    clouds: wxAt(wx.clouds, hOff), transp: wxAt(wx.transp, hOff), seeing: wxAt(wx.seeing, hOff), temp: wxAt(wx.temp, hOff),
    dewPoint: wxAt(wx.dew, hOff), hum: wxAt(wx.hum, hOff), wind: wxAt(wx.wind, hOff),
    cloudSeed: wx.seed, cloudDrift: hOff * (0.6 + wxAt(wx.wind, hOff) / 18), windDir: (wx.seed % 360),
    dew: n ? n.dew : 0, smudge: n ? n.smudge || 0 : 0,
  };
}
function hoursSinceNightStart(ms) {
  const n = night(); const loc = locNow();
  const p = localParts(n.noon, loc.tz);
  const start = localMs(p.y, p.mo, p.d, NIGHT_START_HOUR, 0, loc.tz);
  return (ms - start) / 3600000;
}

// ------------------------------------------------------------------ pointing
export function pointing(ms = G.s.time) {
  const n = night(); if (!n) return null;
  const m = n.mount, loc = locNow(), L = A.lst(ms, loc.lon);
  let ra, dec;
  if (m.slew) {
    const f = Math.min(1, (ms - m.slew.t0) / (m.slew.dur * 1000));
    const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
    ra = m.slew.from.ra + A.norm180(m.slew.to.ra - m.slew.from.ra) * e; dec = m.slew.from.dec + (m.slew.to.dec - m.slew.from.dec) * e;
    ra = A.norm360(ra);
  } else if (m.frame === 'radec') { ra = m.ra; dec = m.dec; }
  else if (m.frame === 'hadec') { ra = A.norm360(L - m.ha); dec = m.dec; }
  else { const p = A.altaz2radec(m.alt, m.az, L, loc.lat); ra = p.ra; dec = p.dec; }
  // periodic error (unguided, tracking)
  const mount = GEAR[G.s.rig.mount];
  if (m.tracking && !(n.guider.guiding && !n.guider.lost) && mount.pe) {
    const pe = peOffset(ms);
    const pt = A.offsetPA(ra, dec, Math.abs(pe) / 3600, pe >= 0 ? 90 : 270); ra = pt.ra; dec = pt.dec;
  }
  const aa = A.radec2altaz(ra, dec, L, loc.lat);
  return { ra, dec, alt: aa.alt, az: aa.az, pa: paOf(ra, dec, ms), lst: L };
}
function peOffset(ms) {
  const n = night(); const mount = GEAR[G.s.rig.mount]; const ri = rig();
  const over = Math.max(1, ri.load || 0);
  const t = ms / 1000;
  return mount.pe * over * (Math.sin((2 * Math.PI * t) / mount.pePeriod + n.mount.peSeed) * 0.8 + Math.sin((4 * Math.PI * t) / mount.pePeriod + n.mount.peSeed * 2) * 0.2);
}
// position angle of the frame's "up" direction
function paOf(ra, dec, ms) {
  const n = night(), m = n.mount, mount = GEAR[G.s.rig.mount], loc = locNow();
  if (mount.type === 'eq') return A.norm360(m.roll + (m.flipped ? 180 : 0));
  // alt-az / fixed: up = toward zenith, plus camera roll
  const L = A.lst(ms, loc.lon);
  const zen = { ra: L, dec: loc.lat };
  const pz = A.sep(ra, dec, zen.ra, zen.dec) < 0.01 ? 0 : A.posAngle(ra, dec, zen.ra, zen.dec);
  return A.norm360(pz + m.roll);
}

// set the mount's true optical axis to an ra/dec (keeping the current frame type)
function setRaDec(ra, dec, ms = G.s.time) {
  const n = night(), m = n.mount, loc = locNow(), L = A.lst(ms, loc.lon);
  if (m.frame === 'radec') { m.ra = A.norm360(ra); m.dec = dec; }
  else if (m.frame === 'hadec') { m.ha = A.norm180(L - ra); m.dec = dec; }
  else { const aa = A.radec2altaz(ra, dec, L, loc.lat); m.alt = aa.alt; m.az = aa.az; }
}

function _setTracking(on) {
  const n = night(); if (!n) return;
  const m = n.mount, mount = GEAR[G.s.rig.mount];
  if (mount.type === 'fixed') { m.tracking = false; return; }
  const p = pointing();
  m.tracking = !!on;
  if (m.slew) return;
  if (on) { m.frame = 'radec'; m.ra = p.ra; m.dec = p.dec; if (mount.type === 'altaz') { /* roll stays relative to zenith */ } }
  else { m.frame = mount.type === 'eq' ? 'hadec' : 'altaz'; setRaDec(p.ra, p.dec); if (n.guider.guiding) stopGuiding('Tracking stopped'); }
  disturb(0, 0);
  emit('mount');
}

// manual nudge (hand controller / clutch) in arcsec along the mount's axes
function _nudge(dx, dy) {
  const n = night(); if (!n) return;
  const m = n.mount, mount = GEAR[G.s.rig.mount], loc = locNow();
  if (m.slew) return;
  if (mount.type === 'eq') {
    const p = pointing(); const ra = p.ra, dec = p.dec;
    // dx = RA axis (east +), dy = Dec axis (north +)
    let ndec = dec + dy / 3600; let nra = ra + dx / 3600 / Math.max(0.05, Math.cos(dec * A.D2R));
    if (ndec > 90) { ndec = 180 - ndec; nra += 180; } if (ndec < -90) { ndec = -180 - ndec; nra += 180; }
    setRaDec(nra, ndec);
  } else {
    const p = pointing(); const L = A.lst(G.s.time, loc.lon);
    const aa = A.radec2altaz(p.ra, p.dec, L, loc.lat);
    const nalt = A.clamp(aa.alt + dy / 3600, -10, 90), naz = A.norm360(aa.az + dx / 3600 / Math.max(0.05, Math.cos(aa.alt * A.D2R)));
    const rd = A.altaz2radec(nalt, naz, L, loc.lat);
    setRaDec(rd.ra, rd.dec);
  }
  disturb(dx, dy);
  m.lastMove = G.s.time;
  emit('mount');
}
// aim directly (physical, by hand) at alt/az
function _aimAltAz(alt, az) {
  const n = night(); if (!n) return;
  const loc = locNow(), L = A.lst(G.s.time, loc.lon);
  const before = pointing();
  const rd = A.altaz2radec(A.clamp(alt, -5, 90), A.norm360(az), L, loc.lat);
  if (n.mount.slew) return;
  setRaDec(rd.ra, rd.dec);
  const after = pointing();
  disturb(A.sep(before.ra, before.dec, after.ra, after.dec) * 3600, 0);
  emit('mount');
}
// ---- dealing with dew ----
function _useHairDryer() {
  const n = night(); if (!n) return { error: 'Not observing.' };
  if (!G.s.inventory.includes('hairdryer')) return { error: 'You don’t own a hair dryer (AstroMart → Accessories).' };
  if (n.dryUntil && G.s.time < n.dryUntil) return { error: 'Already drying.' };
  const secs = 35 + n.dew * 60;
  n.dryUntil = G.s.time + secs * 1000;
  n.warmUntil = n.dryUntil + 15 * 60000; // warm glass resists dew for a while
  if (!rig().hasPower) n.battery = Math.max(0, n.battery - 3);
  // blowing air on the tube shakes the rig
  for (let i = 0; i < 4; i++) disturb((rng() - 0.5) * 12, (rng() - 0.5) * 12);
  log(`Blowing warm air on the optics (~${Math.round(secs)}s).`);
  emit('mount');
  return { ok: true, secs };
}
function _wipeOptics() {
  const n = night(); if (!n) return { error: 'Not observing.' };
  const had = n.dew;
  n.dew = 0;
  n.smudge = Math.min(1, (n.smudge || 0) + 0.3 + had * 0.25);
  // you bump the rig while wiping
  const mount = GEAR[G.s.rig.mount];
  const bump = (mount.type === 'fixed' ? 120 : 40) * (0.5 + rng());
  nudge((rng() - 0.5) * bump, (rng() - 0.5) * bump);
  log(`Wiped the optics with a sleeve. Smudge level now ${Math.round(n.smudge * 100)}%.`);
  return { ok: true, smudge: n.smudge };
}

function _rotateCamera(deg) {
  const n = night(); if (!n) return;
  n.mount.roll = A.norm360(n.mount.roll + deg); disturb(0, 0, deg); emit('mount');
}

export function canGoto() { const m = GEAR[G.s.rig.mount]; return m.goto && night() && night().connected.mount; }
export function reportedPointing() {
  const n = night(); if (!n) return null;
  const mount = GEAR[G.s.rig.mount];
  if (!mount.goto || !n.connected.mount) return null;
  const p = pointing(); const e = n.mount.modelErr;
  const q = A.offsetPA(p.ra, p.dec, Math.hypot(e.e, e.n) / 3600, Math.atan2(e.e, e.n) * A.R2D);
  return { ra: q.ra, dec: q.dec };
}

function _gotoRaDec(ra, dec, label = '') {
  const n = night(); if (!n) return { error: 'Not observing.' };
  const mount = GEAR[G.s.rig.mount], m = n.mount, loc = locNow();
  if (!mount.goto) return { error: 'This mount has no GoTo — aim it by hand.' };
  if (!n.connected.mount) return { error: 'Mount not connected.' };
  if (m.parked) { m.parked = false; log('Mount unparked for GoTo.'); }
  const L = A.lst(G.s.time, loc.lon);
  const aa = A.radec2altaz(ra, dec, L, loc.lat);
  if (aa.alt < 0) return { error: `${label || 'Target'} is below the horizon (alt ${aa.alt.toFixed(1)}°).` };
  // the mount's model error: commanded position lands off by modelErr
  const e = m.modelErr;
  const trueT = A.offsetPA(ra, dec, Math.hypot(e.e, e.n) / 3600, Math.atan2(-e.e, -e.n) * A.R2D);
  const from = pointing();
  const dist = A.sep(from.ra, from.dec, trueT.ra, trueT.dec);
  const dur = dist / mount.slew + 4;
  m.slew = { from: { ra: from.ra, dec: from.dec }, to: trueT, t0: G.s.time, dur };
  disturb(dist * 3600, 0);
  if (mount.type === 'eq') {
    const ha = A.norm180(L - ra);
    const flip = ha > 0; // target west of meridian => counterweight-down on the other side
    if (flip !== m.flipped) { m.flipped = flip; }
  }
  // model error grows a little with slew distance after sync
  if (m.synced) { m.modelErr.e += gauss() * dist * 8; m.modelErr.n += gauss() * dist * 8; }
  log(`Slewing to ${label || A.fmtRA(ra)} (${dist.toFixed(1)}°, ~${Math.ceil(dur)}s)`);
  emit('mount');
  return { ok: true, dur };
}
function _syncTo(ra, dec) {
  const n = night(); const p = pointing();
  // after sync, reported == solved position, i.e. modelErr = reported - true = (solved - true) ~ 0
  const dE = A.tanProject(p.ra, p.dec, ra, dec);
  n.mount.modelErr = { e: dE.xi * A.R2D * 3600 + gauss() * 4, n: dE.eta * A.R2D * 3600 + gauss() * 4 };
  n.mount.synced = true;
  log(`Mount synced to ${A.fmtRA(ra)} ${A.fmtDec(dec)}`);
  emit('mount');
}
function _park() {
  const n = night(); const mount = GEAR[G.s.rig.mount];
  if (!mount.goto) return;
  setTracking(false);
  const loc = locNow();
  if (mount.type === 'eq') { const L = A.lst(G.s.time, loc.lon); const p = pointing(); n.mount.slew = { from: { ra: p.ra, dec: p.dec }, to: { ra: A.norm360(L + 90), dec: 89.9 * Math.sign(loc.lat) }, t0: G.s.time, dur: 25 }; }
  n.mount.parked = true; n.mount.flipped = false; log('Mount parked.'); emit('mount');
}
function _unpark() { const n = night(); n.mount.parked = false; log('Mount unparked.'); emit('mount'); }

// polar alignment knob adjustment (arcmin). Moves the pointing too.
function _adjustPolar(dAlt, dAz) {
  const n = night(); const m = n.mount;
  m.pa.alt += dAlt; m.pa.az += dAz;
  // moving the polar axis moves the whole sky in the field
  const p = pointing();
  const q = A.offsetPA(p.ra, p.dec, Math.hypot(dAlt, dAz) / 60, Math.atan2(dAz, dAlt) * A.R2D);
  if (m.frame === 'radec') { m.ra = q.ra; m.dec = q.dec; } else setRaDec(q.ra, q.dec);
  disturb(Math.hypot(dAlt, dAz) * 60, 0);
  emit('mount');
}
// drift velocity (arcsec/s, east & north) due to polar misalignment for EQ tracking
function paDrift(ra, dec, ms) {
  const n = night(); const loc = locNow();
  const e = n.mount.pa; // arcmin; alt = axis too high (+), az = axis too far east (+)
  const H = (A.lst(ms, loc.lon) - ra) * A.D2R, d = dec * A.D2R;
  const ex = (e.alt / 60) * A.D2R * Math.sign(loc.lat || 1), ey = (e.az / 60) * A.D2R * Math.cos(loc.lat * A.D2R);
  // star position in HA-Dec cartesian (x: HA=0, y: east (HA=-6h), z: pole)
  const s = [Math.cos(d) * Math.cos(H), -Math.cos(d) * Math.sin(H), Math.sin(d)];
  // v = -w e x s
  const v = [-(ey * s[2]) * A.OMEGA, (ex * s[2]) * A.OMEGA, -(ex * s[1] - ey * s[0]) * A.OMEGA];
  // local unit vectors: east (direction of increasing RA = decreasing HA), north
  const east = [Math.sin(H), Math.cos(H), 0];
  const north = [-Math.sin(d) * Math.cos(H), Math.sin(d) * Math.sin(H), Math.cos(d)];
  const toAs = 206265;
  return { e: (v[0] * east[0] + v[1] * east[1] + v[2] * east[2]) * toAs, n: (v[0] * north[0] + v[1] * north[1] + v[2] * north[2]) * toAs };
}
export function polarErrorTotal() { const p = night().mount.pa; return Math.hypot(p.alt, p.az); }

// ------------------------------------------------------------------ guiding
export function guideRms() {
  const n = night(); const mount = GEAR[G.s.rig.mount]; const ri = rig(); const env = envAt(G.s.time);
  const over = 1 + 2.5 * Math.max(0, (ri.load || 0) - 0.8);
  return mount.guideRms * Math.sqrt(env.seeing / 2.2) * over * (1 + env.wind / 40) * (1 + polarErrorTotal() / 600);
}
function _startGuiding() {
  const n = night(); const ri = rig();
  if (!ri.hasGuide) return { error: 'No guide scope/camera in your rig.' };
  if (!n.mount.tracking) return { error: 'Mount is not tracking.' };
  if (!n.guider.calibrated) return { error: 'Calibrate first.' };
  n.guider.guiding = true; n.guider.lost = false; n.guider.settleUntil = G.s.time + 8000;
  // guiding locks the current position (stop PE wander from here)
  const p = pointing(); if (n.mount.frame === 'radec') { n.mount.ra = p.ra; n.mount.dec = p.dec; }
  log('Guiding started.'); emit('guider'); return { ok: true };
}
function _stopGuiding(reason = '') {
  const n = night(); if (!n || !n.guider.guiding) return;
  n.guider.guiding = false; log('Guiding stopped' + (reason ? ': ' + reason : '')); emit('guider');
}
function _dither(px = 6) {
  const n = night(); const ri = rig();
  const as = px * ri.scale * (0.5 + rng());
  const th = rng() * Math.PI * 2;
  const p = pointing();
  const q = A.offsetPA(p.ra, p.dec, as / 3600, th * A.R2D);
  if (n.mount.frame === 'radec') { n.mount.ra = q.ra; n.mount.dec = q.dec; }
  n.guider.settleUntil = G.s.time + 10000;
  emit('guider');
}

// ------------------------------------------------------------------ focus
export function focusBest() {
  const n = night(); const ri = rig(); const env = envAt(G.s.time);
  const f = n.focus; const T0 = n.wx.temp[0];
  if (!ri.opt) return f.pos;
  if (G.s.gameMode === 'sandbox' && G.s.sandbox && G.s.sandbox.noFocusDrift) return f.best0; // sandbox: optics don't shift with temperature
  if (f.unit === 'deg') return f.best0 - (env.temp - T0) * (ri.opt.tempCoeff || 1) / (ri.opt.focusUmPerDeg || 10) * 2;
  return f.best0 - (env.temp - T0) * (ri.opt.tempCoeff || 3) / (ri.opt.focusUmPerStep || 4) * 2;
}
export function focusDeltaUm() {
  const n = night(); const ri = rig(); if (!ri.opt) return 0;
  const f = n.focus, d = f.pos - focusBest();
  return d * (f.unit === 'deg' ? ri.opt.focusUmPerDeg || 10 : ri.opt.focusUmPerStep || 4);
}
function _moveFocus(delta) {
  const n = night(); const f = n.focus;
  f.pos = Math.max(f.min ?? 0, Math.min(f.max ?? 10000, f.pos + delta));
  emit('focus');
}
function _setFocus(pos) { const n = night(); const f = n.focus; f.pos = Math.max(f.min ?? 0, Math.min(f.max ?? 10000, pos)); emit('focus'); }

// ------------------------------------------------------------------ exposures
function disturb(dE, dN, dRot = 0) {
  const ex = T.exposure; if (!ex) return;
  ex.disturb.push({ tau: (G.s.time - ex.t0) / 1000, dE, dN, dRot });
}

export function currentFilter() {
  const ri = rig();
  const n = night();
  if (ri.cam && ri.cam.mono && ri.hasWheel) { const id = ri.filters[n ? n.wheelPos : 0]; return id ? FILTERS.find((f) => f.id === id) : null; }
  return G.s.rig.filter ? FILTERS.find((f) => f.id === G.s.rig.filter) : null;
}

// Build the tracking path for an exposure of `exp` seconds starting now.
function makePath(exp, startPt) {
  const n = night(), m = n.mount, mount = GEAR[G.s.rig.mount], loc = locNow(), ri = rig();
  const steps = Math.max(2, Math.min(64, Math.ceil(exp / 2) + 1));
  const path = [];
  const t0 = G.s.time;
  const guided = n.guider.guiding && !n.guider.lost && m.tracking;
  const over = Math.max(0, (ri.load || 0) - 1);
  const env = envAt(t0);
  // wind gusts
  const gusts = [];
  const gustRate = (env.wind / 25) * exp / 40 * (mount.type === 'fixed' ? 0.6 : 1) * (1 + over * 3);
  let ng = 0; { const L = Math.exp(-gustRate); let p = 1; do { ng++; p *= rng(); } while (p > L); ng--; }
  for (let i = 0; i < ng; i++) gusts.push({ tau: rng() * exp, amp: (env.wind / 8) * (0.5 + rng()) * (0.4 + (ri.load || 0.3)) * (guided ? 0.6 : 1) * (ri.focal > 300 ? 1 : 0.6), th: rng() * Math.PI * 2 });
  // slow random walk (mount irregularities)
  let rwE = 0, rwN = 0;
  const rwSigma = guided ? 0 : (mount.jitter || 0.3) * 0.25 * (1 + over * 4);
  const upPt = A.offsetPA(startPt.ra, startPt.dec, 0.05, startPt.pa);
  const L0 = A.lst(t0, loc.lon);
  const aa0 = A.radec2altaz(startPt.ra, startPt.dec, L0, loc.lat), aaU = A.radec2altaz(upPt.ra, upPt.dec, L0, loc.lat);
  const pe0 = m.tracking && !guided && mount.pe ? peOffset(t0) : 0;
  for (let i = 0; i < steps; i++) {
    const tau = (exp * i) / (steps - 1), ms = t0 + tau * 1000, Lt = A.lst(ms, loc.lon);
    let c, pa;
    if (!m.tracking || mount.type === 'fixed') {
      if (m.frame === 'hadec') { // EQ not tracking: HA fixed => ra increases
        c = { ra: A.norm360(startPt.ra + (Lt - L0)), dec: startPt.dec }; pa = startPt.pa;
      } else { // alt-az fixed: center and "up" fixed in alt/az
        c = A.altaz2radec(aa0.alt, aa0.az, Lt, loc.lat); const u = A.altaz2radec(aaU.alt, aaU.az, Lt, loc.lat);
        pa = A.posAngle(c.ra, c.dec, u.ra, u.dec);
      }
    } else if (mount.type === 'altaz') { // tracking center, but frame stays fixed to alt-az: field rotation
      c = { ra: startPt.ra, dec: startPt.dec };
      const zen = { ra: Lt, dec: loc.lat };
      pa = A.posAngle(c.ra, c.dec, zen.ra, zen.dec) + m.roll;
    } else { c = { ra: startPt.ra, dec: startPt.dec }; pa = startPt.pa; }
    const p = A.tanProject(startPt.ra, startPt.dec, c.ra, c.dec);
    let dE = p.xi * A.R2D * 3600, dN = p.eta * A.R2D * 3600;
    if (m.tracking && mount.type !== 'fixed') {
      const dr = paDrift(startPt.ra, startPt.dec, ms);
      if (!guided) { dE += dr.e * tau; dN += dr.n * tau; }
      else if (mount.guideAxes === 'ra') { dN += dr.n * tau; }
      if (!guided && mount.pe) dE += peOffset(ms) - pe0;
      if (over > 0 && !guided) { dE += Math.sin(tau / 7) * over * 25; }
    }
    if (i > 0 && rwSigma) { const dt = exp / (steps - 1); rwE += gauss() * rwSigma * Math.sqrt(dt / 10); rwN += gauss() * rwSigma * Math.sqrt(dt / 10); }
    dE += rwE; dN += rwN;
    for (const g of gusts) if (tau >= g.tau) { const k = Math.exp(-(tau - g.tau) / 2.5); dE += Math.cos(g.th) * g.amp * k; dN += Math.sin(g.th) * g.amp * k; }
    path.push([dE, dN, A.norm180(pa - startPt.pa)]);
  }
  // jitter (rms arcsec), folded into the PSF
  let jitter;
  if (guided) jitter = guideRms();
  else if (mount.type === 'fixed') jitter = 0.25 + env.wind / 30;
  else jitter = (mount.jitter || 0.4) * (1 + over * 3) * (1 + env.wind / 30);
  return { path, jitter };
}

export function isExposing() { return !!T.exposure; }

// params: {type, exp, gain, offset, bin, roi, target, save, preview, panelLevel}
function _expose(params) {
  const n = night();
  if (!n) return Promise.reject(new Error('You are not out observing.'));
  if (T.exposure) return Promise.reject(new Error('Camera busy.'));
  if (!n.connected.camera) return Promise.reject(new Error('Camera not connected.'));
  const ri = rig();
  if (!ri.opt) return Promise.reject(new Error('No optics attached.'));
  const cam = ri.cam;
  const exp = Math.max(cam.type === 'dslr' ? 1 / 4000 : 0.00003, params.exp);
  const pt = pointing();
  const env = envAt(G.s.time + exp * 500);
  const { path, jitter } = makePath(exp, pt);
  const sens = sensorAt(cam, params.gain);
  const filt = currentFilter();
  const id = params.save === false ? null : uid();
  const recipe = {
    id, type: params.type || 'light', t0: G.s.time, exp, ra: pt.ra, dec: pt.dec, rot: pt.pa, path, jitter,
    cam: { ...cam }, camSerial: G.s.camSerial, dustSeed: G.s.dustSeed, gain: params.gain, offset: params.offset, bin: params.bin || 1,
    sensor: { ...sens, offsetADU: 0 }, sensorTemp: n.cam.temp,
    opt: { id: ri.opt.id, type: ri.opt.type, focal: ri.focal, D: ri.D, obstruction: ri.obstruction, vig: ri.vig, ab: ri.ab, edgeAb: ri.edgeAb, ca: ri.ca, spikes: ri.spikes, blades: ri.blades },
    filter: filt ? { id: filt.id, cont: filt.cont, skyCont: filt.skyCont, ha: filt.ha, oiii: filt.oiii, sii: filt.sii } : null,
    focusDelta: focusDeltaUm(), capOn: n.capOn, bahtinov: n.bahtinov,
    env: { ...env, loc: { ...env.loc } },
    flatSrc: n.panelOn ? 'panel' : 'sky', panelLevel: params.panelLevel || 1,
    roi: params.roi || null, quality: G.s.settings.quality,
    seed: hashStr(id || uid()),
    target: params.target || '', label: params.label || '',
  };
  if (recipe.type === 'flat' && n.panelOn) recipe.flatSrc = 'panel';
  else if (n.panelOn) recipe.capOn = true; // panel covers the aperture
  const download = cam.type === 'dslr' ? 1.6 : 0.9 * (params.roi ? 0.3 : 1);
  return new Promise((resolve, reject) => {
    T.exposure = { recipe, t0: G.s.time, end: G.s.time + (exp + download) * 1000, exp, resolve, reject, disturb: [], params, rendering: false };
    n.cam.duty = Math.min(1, n.cam.duty + 0.05);
    emit('exposure', T.exposure);
  });
}
function _abortExposure() {
  if (!T.exposure) return;
  const ex = T.exposure; T.exposure = null; T.busy = false;
  ex.reject(new Error('Exposure aborted'));
  emit('exposure', null);
}

async function finishExposure() {
  const ex = T.exposure; if (!ex || ex.rendering) return;
  ex.rendering = true; T.busy = true;
  const r = ex.recipe;
  // apply disturbances that happened during the exposure
  for (const d of ex.disturb) {
    const fracStart = d.tau / r.exp;
    for (let i = 0; i < r.path.length; i++) {
      const f = i / (r.path.length - 1);
      if (f >= fracStart) { r.path[i][0] += d.dE; r.path[i][1] += d.dN; r.path[i][2] += d.dRot; }
    }
  }
  try {
    const res = await renderRecipe(r, { thumb: !!r.id, linked: G.s.settings.linked });
    T.busy = false; // always release the clock, even if the exposure was aborted meanwhile
    if (T.exposure !== ex || !night()) return; // aborted / night ended meanwhile
    T.exposure = null;
    const meta = {
      id: r.id, session: night().id, type: r.type, target: r.target, label: r.label, exp: r.exp, gain: r.gain, offset: r.offset, bin: r.bin,
      filter: r.filter ? r.filter.id : null, temp: +r.sensorTemp.toFixed(1), t0: r.t0, loc: G.s.location,
      cam: r.cam.id, optic: r.opt.id, focal: Math.round(r.opt.focal), fstop: +(r.opt.focal / r.opt.D).toFixed(1), quality: r.quality,
      stats: { hfr: +res.stats.hfr.toFixed(2), stars: res.stats.stars, median: Math.round(res.stats.median), ecc: +res.stats.ecc.toFixed(2), sat: res.stats.saturated, trail: +res.trailPx.toFixed(1) },
      recipe: r, scale: res.scale,
    };
    T.lastFrame = { meta, res };
    if (r.id && !r.roi) {
      G.s.frames.push(meta); G.s.stats.frames++;
      if (r.type === 'light') G.s.stats.integration += r.exp;
      const sess = G.s.sessions.find((s) => s.id === meta.session); if (sess) sess.frames++;
      if (res.thumb) makeThumb(res.thumb).then((url) => idbSet('thumb:' + r.id, url));
      save();
    }
    emit('frame', T.lastFrame);
    ex.resolve(T.lastFrame);
  } catch (e) {
    console.error(e);
    if (T.exposure === ex) T.exposure = null;
    ex.reject(e);
    emit('toast', { msg: 'Could not develop that frame: ' + (e.message || e), kind: 'bad' });
  } finally {
    T.busy = false;
  }
  emit('exposure', null);
}

// wait for sim time to advance by `sec`
export function waitSim(sec) {
  if (!Number.isFinite(sec)) sec = 1; // a NaN wait would freeze the clock
  return new Promise((resolve, reject) => { T.waiters.push({ until: G.s.time + sec * 1000, resolve, reject }); });
}

// ------------------------------------------------------------------ main tick
export function tick(realDtSec) {
  const s = G.s; if (!s) return;
  if (s.mode !== 'night' || !s.night) return;
  const n = s.night;
  if (T.busy) return;
  let dt = realDtSec * T.warp;
  // don't overshoot exposure end or waiters
  if (T.exposure && !T.exposure.rendering) dt = Math.min(dt, Math.max(0, (T.exposure.end - s.time) / 1000));
  for (const w of T.waiters) dt = Math.min(dt, Math.max(0, (w.until - s.time) / 1000));
  if (n.mount.slew) dt = Math.min(dt, Math.max(0.05, (n.mount.slew.t0 + n.mount.slew.dur * 1000 - s.time) / 1000));
  dt = Math.max(0, Math.min(dt, 600));
  const prev = s.time;
  s.time += dt * 1000;
  const env = envAt(s.time);
  const ri = rig(); const mount = GEAR[s.rig.mount];

  // slew completion
  const m = n.mount;
  if (m.slew && s.time >= m.slew.t0 + m.slew.dur * 1000) {
    const to = m.slew.to; m.slew = null;
    m.tracking = mount.type !== 'fixed'; m.frame = 'radec'; m.ra = to.ra; m.dec = to.dec;
    log('Slew complete.'); emit('mount');
  }
  // polar misalignment drift while tracking
  if (m.tracking && m.frame === 'radec' && !m.slew && mount.type === 'eq') {
    const guided = n.guider.guiding && !n.guider.lost;
    const dr = paDrift(m.ra, m.dec, s.time);
    let dE = dr.e * dt, dN = dr.n * dt;
    if (guided) { dE = 0; if (mount.guideAxes !== 'ra') dN = 0; }
    if (dE || dN) { const q = A.offsetPA(m.ra, m.dec, Math.hypot(dE, dN) / 3600, Math.atan2(dE, dN) * A.R2D); m.ra = q.ra; m.dec = q.dec; }
  }
  // meridian limit
  if (m.tracking && mount.meridian && !m.slew) {
    const ha = A.norm180(A.lst(s.time, env.lon) - m.ra) / 15;
    if (!m.flipped && ha > 0.25) { m.tracking = false; m.frame = 'hadec'; m.ha = ha * 15; log('⚠️ Meridian limit reached — mount stopped tracking. Perform a meridian flip.'); emit('meridian'); emit('mount'); stopGuiding('meridian'); }
    if (m.flipped && ha < -0.5) { /* fine */ }
  }
  // altitude: hitting the horizon/trees doesn't stop anything, it just blocks light.
  // camera temperature
  const ambient = env.temp;
  if (ri.cam) {
    if (ri.cam.cooled && n.cam.coolerOn) {
      const target = Math.max(n.cam.setpoint, ambient - ri.cam.deltaT);
      n.cam.temp += (target - n.cam.temp) * Math.min(1, dt / 90);
      n.cam.power = Math.min(100, Math.max(5, ((ambient - n.cam.temp) / ri.cam.deltaT) * 100));
    } else {
      const target = ambient + (ri.cam.type === 'dslr' ? 2 + 7 * n.cam.duty : 1.5);
      n.cam.temp += (target - n.cam.temp) * Math.min(1, dt / 600);
      n.cam.power = 0;
    }
    n.cam.duty = Math.max(0, n.cam.duty - dt / 1800 * (T.exposure ? 0 : 1));
    if (T.exposure) n.cam.duty = Math.min(1, n.cam.duty + dt / 1200);
  }
  // dew
  const opticTemp = ambient - 1.6 - (env.clouds < 0.3 ? 0.8 : 0);
  if (n.dryUntil && s.time < n.dryUntil) n.dew = Math.max(0, n.dew - dt / 22); // hair dryer blowing
  else if (n.dryUntil) { n.dryUntil = 0; log('Optics dried.'); emit('dried'); }
  if (n.dewHeater && ri.hasDew) n.dew = Math.max(0, n.dew - dt / 300);
  else if (n.warmUntil && s.time < n.warmUntil) n.dew = Math.max(0, n.dew - dt / 900); // still warm from the dryer
  else {
    const rate = ri.opt ? ({ lens: 0.7, refractor: 0.5, newtonian: 0.35, sct: 1.4, rasa: 1.6, rc: 0.6 })[ri.opt.type] || 1 : 1;
    if (opticTemp < env.dewPoint + 0.3) n.dew = Math.min(1, n.dew + (dt / 1500) * rate * (1 + (env.dewPoint - opticTemp)));
    else n.dew = Math.max(0, n.dew - dt / 900);
  }
  if (n.dew > 0.25 && !n._dewWarned) { n._dewWarned = true; emit('toast', { msg: 'Your optics are dewing up! Stars look bloated and soft. Outside, press R → On the optics to dry or wipe them (a dew heater prevents it).', kind: 'warn' }); }
  if (n.dew < 0.05) n._dewWarned = false;
  // battery
  if (ri.hasPower) n.battery = Math.min(100, n.battery + dt / 3600 * 30);
  else {
    n.battery -= dt / 3600 * (19 + (n.cam.coolerOn ? 6 : 0) + (n.dewHeater ? 4 : 0));
    if (n.battery < 15 && !n._battWarned) { n._battWarned = true; emit('toast', { msg: 'Laptop battery low (15%). A power station would fix this.', kind: 'warn' }); }
    if (n.battery <= 0) { n.battery = 0; emit('toast', { msg: 'Laptop battery died. Packing up for the night.', kind: 'bad' }); endNight('battery'); return; }
  }
  // guiding: star lost under clouds
  if (n.guider.guiding) {
    const lost = env.clouds > 0.75 || !m.tracking;
    if (lost !== n.guider.lost) { n.guider.lost = lost; log(lost ? 'Guide star lost!' : 'Guide star re-acquired.'); emit('guider'); }
    // guiding graph samples (every 2s sim, at most 40 per tick)
    const rms = guideRms();
    let k = 0;
    for (let t = Math.max(T.lastGuideT, prev); t + 2000 <= s.time && k < 40; t += 2000, k++) {
      const settle = t < n.guider.settleUntil ? 3 : 1;
      T.guideHist.push({ t, ra: lost ? (rng() - 0.5) * 12 : gauss() * rms * 0.7 * settle, dec: lost ? (rng() - 0.5) * 12 : gauss() * rms * 0.7 * settle });
      T.lastGuideT = t + 2000;
    }
    if (k === 40) T.lastGuideT = s.time;
    while (T.guideHist.length > 300) T.guideHist.shift();
    n.guider.rms = rms;
  }
  // waiters
  const ready = T.waiters.filter((w) => s.time >= w.until - 1);
  T.waiters = T.waiters.filter((w) => s.time < w.until - 1);
  ready.forEach((w) => w.resolve());
  // exposure end
  if (T.exposure && !T.exposure.rendering && s.time >= T.exposure.end - 1) finishExposure();
  // dawn
  if (env.sunAlt > -3 && G.s.time > n.started + 4 * 3600000 && !n._dawnWarned) { n._dawnWarned = true; emit('toast', { msg: 'The sun is rising. Time to pack up!', kind: 'warn' }); }
  if (env.sunAlt > 8 && G.s.time > n.started + 4 * 3600000) { endNight('dawn'); return; }
  emit('tick', dt);
}

function _setWarp(w) { T.warp = w; emit('warp', w); }

// ------------------------------------------------------------------ generic state edits (routed in multiplayer)
function _setProp(path, value) {
  const n = night(); if (!n) return;
  const keys = path.split('.'); let o = n;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
  if (path === 'wheelPos') emit('wheel');
  if (path.startsWith('connected.')) emit('devices');
  emit('mount');
  save();
}
function _setTarget(t) { G.s.target = t ? { id: t.id, name: t.name || t.id, ra: t.ra, dec: t.dec, size: t.size || 0, type: t.type || '' } : null; save(); emit('target', G.s.target); }
function _setRig(rig) {
  const old = G.s.rig; G.s.rig = rig;
  const n = night();
  if (n) {
    const ri = rigInfo(rig);
    if (old.mount !== rig.mount) {
      const m = GEAR[rig.mount];
      n.mount.tracking = false; n.mount.parked = m.goto; n.mount.slew = null; n.mount.flipped = false; n.mount.synced = false;
      n.mount.pa = m.type === 'eq' ? { alt: (rng() - 0.5) * 140, az: (rng() - 0.5) * 260 } : { alt: 0, az: 0 };
      const p = pointing();
      if (m.type === 'eq') { n.mount.frame = 'hadec'; n.mount.ha = -90; n.mount.dec = 89.9 * Math.sign(locNow().lat); }
      else { n.mount.frame = 'altaz'; n.mount.alt = p ? p.alt : 30; n.mount.az = p ? p.az : 180; }
      n.mount.roll = 0; n.connected.mount = false; n.connected.guider = false; n.guider = { calibrated: false, guiding: false, looping: false, rms: 0, lost: false, settleUntil: 0 };
    }
    if (old.optic !== rig.optic || old.corrector !== rig.corrector || old.camera !== rig.camera) {
      n.focus = initialFocus(ri, rng);
      n.connected.camera = false; n.connected.focuser = false; n.connected.wheel = false;
    }
    if (!ri.hasGuide) n.connected.guider = false;
    log('Rig changed — reconnect devices in AstroCap.');
  }
  save(); emit('rig', rig); emit('devices');
}
function _calibrateGuider() { const n = night(); if (!n) return; n.guider.calibrated = true; log('Guider calibrated.'); emit('guider'); }

// ------------------------------------------------------------------ multiplayer routing
// On a guest, actions are sent to the host (which runs the simulation); otherwise run locally.
export const NET = { role: 'solo', rpc: null };
const OPTIMISTIC = new Set(['setProp', 'setTarget']); // pure state edits: apply locally right away too
const net = (name, fn) => (...args) => { if (NET.role !== 'client') return fn(...args); if (OPTIMISTIC.has(name)) fn(...args); return NET.rpc(name, args); };
export const LOCAL = {
  startNight: _startNight, endNight: _endNight, skipDay: _skipDay, setDate: _setDate, setTracking: _setTracking, nudge: _nudge, aimAltAz: _aimAltAz, rotateCamera: _rotateCamera,
  gotoRaDec: _gotoRaDec, syncTo: _syncTo, park: _park, unpark: _unpark, adjustPolar: _adjustPolar, startGuiding: _startGuiding, stopGuiding: _stopGuiding,
  dither: _dither, moveFocus: _moveFocus, setFocus: _setFocus, useHairDryer: _useHairDryer, wipeOptics: _wipeOptics, expose: _expose, abortExposure: _abortExposure,
  setWarp: _setWarp, setProp: _setProp, setTarget: _setTarget, setRig: _setRig, calibrateGuider: _calibrateGuider,
};
export const startNight = net('startNight', _startNight);
export const endNight = net('endNight', _endNight);
export const skipDay = net('skipDay', _skipDay);
export const setDate = net('setDate', _setDate);
export const setTracking = net('setTracking', _setTracking);
export const nudge = net('nudge', _nudge);
export const aimAltAz = net('aimAltAz', _aimAltAz);
export const rotateCamera = net('rotateCamera', _rotateCamera);
export const gotoRaDec = net('gotoRaDec', _gotoRaDec);
export const syncTo = net('syncTo', _syncTo);
export const park = net('park', _park);
export const unpark = net('unpark', _unpark);
export const adjustPolar = net('adjustPolar', _adjustPolar);
export const startGuiding = net('startGuiding', _startGuiding);
export const stopGuiding = net('stopGuiding', _stopGuiding);
export const dither = net('dither', _dither);
export const moveFocus = net('moveFocus', _moveFocus);
export const setFocus = net('setFocus', _setFocus);
export const useHairDryer = net('useHairDryer', _useHairDryer);
export const wipeOptics = net('wipeOptics', _wipeOptics);
export const expose = net('expose', _expose);
export const abortExposure = net('abortExposure', _abortExposure);
export const setWarp = net('setWarp', _setWarp);
export const setProp = net('setProp', _setProp);
export const setTarget = net('setTarget', _setTarget);
export const setRig = net('setRig', _setRig);
export const calibrateGuider = net('calibrateGuider', _calibrateGuider);
