// Automated routines used by the capture software: plate solving, centering,
// autofocus, three-point polar alignment and the imaging sequencer.
import * as A from './astro.js';
import { G, emit, save } from './state.js';
import { GEAR } from './gear.js';
import * as S from './session.js';
import { mulberry32, gaussFactory } from './util.js';

const rng = mulberry32(12345), gauss = gaussFactory(rng);
export const R = { seq: null, busy: null, abort: false, solveResult: null, afCurve: [], tppa: null, activity: '' };
export function setActivity(text) { R.activity = text || ''; emit('activity', R.activity); }

export function cameraSettings() {
  // persisted capture settings
  const s = G.s.capture || (G.s.capture = { exp: 30, gain: null, offset: null, bin: 1, type: 'light', target: '', solveExp: 5, afExp: 4, afStep: 0, afPoints: 9 });
  const cam = GEAR[G.s.rig.camera];
  if (cam.type === 'dslr') { if (!cam.isos.includes(s.gain)) s.gain = 800; s.offset = cam.offset; }
  else { if (s.gain == null || s.gain > cam.gainMax) s.gain = 100; if (s.offset == null || s.offset > 500) s.offset = cam.offset; }
  return s;
}

// ---------------- plate solving ----------------
export async function solveFrame(frame) {
  if (!frame) throw new Error('No image to solve.');
  const st = frame.meta.stats; const r = frame.meta.recipe;
  await S.waitSim(1.5 + rng() * 3);
  if (r.capOn) throw new Error('Solve failed: image is black (lens cap on?).');
  if (st.stars < 12) throw new Error(`Solve failed: only ${st.stars} stars detected. Try a longer exposure, check focus/clouds.`);
  if (st.hfr > 9 && st.stars < 60) throw new Error('Solve failed: stars too bloated (out of focus?).');
  // the true pointing at mid-exposure
  const m = r.path[Math.floor(r.path.length / 2)];
  const c = A.offsetPA(r.ra, r.dec, Math.hypot(m[0], m[1]) / 3600, Math.atan2(m[0], m[1]) * A.R2D);
  const scale = frame.meta.scale / (r.roi ? 1 : 1);
  const err = (frame.res.scale || 10) * 0.3;
  const res = { ra: A.norm360(c.ra + gauss() * err / 3600 / Math.cos(c.dec * A.D2R)), dec: c.dec + gauss() * err / 3600, pa: A.norm360(r.rot + m[2] + gauss() * 0.05), scale, t: G.s.time, stars: st.stars };
  const ri = S.rig(); res.fovW = ri.fovW; res.fovH = ri.fovH;
  R.solveResult = res; S.night().lastSolve = res;
  S.log(`Plate solved: ${A.fmtRA(res.ra)} ${A.fmtDec(res.dec)}, rotation ${res.pa.toFixed(1)}°, ${st.stars} stars`);
  emit('solve', res);
  return res;
}

export async function captureAndSolve(exp) {
  const cs = cameraSettings();
  const fr = await S.expose({ type: 'light', exp: exp || cs.solveExp, gain: cs.gain, offset: cs.offset, bin: 1, save: false, target: 'platesolve' });
  return solveFrame(fr);
}

export async function centerOn(target, log = () => {}, tolArcsec = 60) {
  try { return await centerOnInner(target, log, tolArcsec); } finally { setActivity(''); }
}
async function centerOnInner(target, log, tolArcsec) {
  const mount = GEAR[G.s.rig.mount];
  const n = S.night();
  if (!n) throw new Error('You are not out observing.');
  if (mount.goto && !n.connected.mount) throw new Error('Connect the mount first: AstroCap → Equipment → Mount → Connect.');
  if (!n.connected.camera) throw new Error('Connect the camera first: AstroCap → Equipment → Camera → Connect (plate solving needs images).');
  if (n.capOn) throw new Error('The lens cap is on — plate solving needs to see stars.');
  for (let it = 0; it < 6; it++) {
    if (R.abort) throw new Error('Aborted');
    if (mount.goto) {
      const r = await S.gotoRaDec(target.ra, target.dec, target.name);
      if (r && r.error) throw new Error(r.error);
      const dur = r && Number.isFinite(r.dur) ? r.dur : 5;
      setActivity(`Slewing to ${target.name || 'target'}… (~${Math.ceil(dur)}s)`);
      await S.waitSim(dur + 1);
    }
    setActivity(`Plate solving (attempt ${it + 1})…`);
    log(`Capturing plate-solve image (attempt ${it + 1})…`);
    const sol = await captureAndSolve();
    const d = A.sep(sol.ra, sol.dec, target.ra, target.dec) * 3600;
    log(`Off target by ${A.fmtAngle(d)}`);
    if (d < tolArcsec) { log('Target centered ✓'); emit('toast', { msg: `Centered on ${target.name || 'target'} ✓ (within ${A.fmtAngle(d)})`, kind: 'good' }); return sol; }
    setActivity(`Off by ${A.fmtAngle(d)} — syncing and re-slewing…`);
    if (!(mount.goto && S.night().connected.mount)) throw new Error(`Off by ${A.fmtAngle(d)} — this mount has no GoTo; nudge it by hand (Field view) and solve again.`);
    S.syncTo(sol.ra, sol.dec);
  }
  throw new Error('Could not center within tolerance.');
}

// ---------------- autofocus ----------------
export async function autofocus(onPoint = () => {}, log = () => {}) {
  const n = S.night(); const ri = S.rig(); const cs = cameraSettings();
  if (!ri.hasAF || !n.connected.focuser) throw new Error('No electronic focuser connected.');
  const fr = ri.focal / ri.D;
  const cfz = 4.88 * 0.55 * fr * fr; // critical focus zone (µm)
  const um = ri.opt.focusUmPerStep || 4;
  const step = cs.afStep || Math.max(5, Math.round((cfz * 2.2) / um));
  const pts = cs.afPoints || 9;
  const start = n.focus.pos;
  R.afCurve = [];
  log(`Autofocus: ${pts} points, step ${step}, starting at ${start}`);
  const positions = []; for (let i = 0; i < pts; i++) positions.push(Math.round(start + (i - (pts - 1) / 2) * step));
  // backlash compensation: overshoot outward then come in
  for (const pos of positions) {
    if (R.abort) throw new Error('Aborted');
    const dt = Math.abs(pos - n.focus.pos) / 800 + 0.5;
    S.setFocus(pos); await S.waitSim(dt);
    const f = await S.expose({ type: 'light', exp: cs.afExp, gain: cs.gain, offset: cs.offset, bin: 1, save: false, target: 'autofocus' });
    const hfr = f.meta.stats.hfr, stars = f.meta.stats.stars;
    const p = { pos, hfr, stars }; R.afCurve.push(p); onPoint(p);
    log(`  pos ${pos}: HFR ${hfr.toFixed(2)} (${stars} stars)`);
  }
  // fit parabola to points with enough stars
  const good = R.afCurve.filter((p) => p.stars >= 8 && p.hfr > 0);
  if (good.length < 5) { S.setFocus(start); throw new Error('Autofocus failed: not enough stars. Is it cloudy or way out of focus?'); }
  const fit = fitParabola(good.map((p) => [p.pos, p.hfr]));
  let best = fit && fit.a > 0 ? -fit.b / (2 * fit.a) : good.reduce((a, b) => (b.hfr < a.hfr ? b : a)).pos;
  const lo = Math.min(...positions), hi = Math.max(...positions);
  if (best < lo || best > hi) { log('Minimum is outside the sampled range — re-run autofocus from the new position.'); best = Math.max(lo, Math.min(hi, best)); }
  S.setFocus(Math.round(best)); await S.waitSim(1);
  log(`Autofocus complete → position ${Math.round(best)}`);
  R.afFit = fit; R.afBest = Math.round(best); R.afTemp = S.envAt(G.s.time).temp;
  emit('autofocus', { curve: R.afCurve, fit, best });
  return best;
}
function fitParabola(pts) {
  // least squares y = a x^2 + b x + c
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  const xm = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  for (const [x0, y] of pts) { const x = x0 - xm; s0++; s1 += x; s2 += x * x; s3 += x ** 3; s4 += x ** 4; t0 += y; t1 += x * y; t2 += x * x * y; }
  const M = [[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]], v = [t2, t1, t0];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M); if (Math.abs(D) < 1e-12) return null;
  const rep = (i) => M.map((row, r) => row.map((c, k) => (k === i ? v[r] : c)));
  const a = det(rep(0)) / D, b1 = det(rep(1)) / D, c1 = det(rep(2)) / D;
  // convert back from centered x
  return { a, b: b1 - 2 * a * xm, c: c1 - b1 * xm + a * xm * xm };
}

// ---------------- three-point polar alignment ----------------
export async function tppaStart(onUpdate, log = () => {}) {
  const n = S.night(); const mount = GEAR[G.s.rig.mount];
  if (mount.type !== 'eq') throw new Error('Polar alignment only applies to equatorial mounts/trackers.');
  if (!n.mount.tracking && mount.type === 'eq') await S.setTracking(true);
  const pts = [];
  for (let i = 0; i < 3; i++) {
    if (R.abort) throw new Error('Aborted');
    log(`Point ${i + 1}/3: capturing & solving…`);
    const sol = await captureAndSolve();
    pts.push(sol);
    if (i < 2) {
      log('Rotating RA axis 25°…');
      if (mount.goto && n.connected.mount) { S.nudge(25 * 3600, 0); await S.waitSim(25 / mount.slew + 3); }
      else { S.nudge(25 * 3600, 0); await S.waitSim(15); }
    }
  }
  log('Polar axis computed. Now adjust the Alt/Az knobs; the error refreshes continuously.');
  R.tppa = { running: true };
  while (R.tppa && R.tppa.running && !R.abort) {
    const e = n.mount.pa;
    const meas = { alt: e.alt + gauss() * 0.25, az: e.az + gauss() * 0.25 };
    meas.total = Math.hypot(meas.alt, meas.az);
    onUpdate(meas);
    try { await captureAndSolve(); } catch (err) { log(err.message); await S.waitSim(2); }
  }
}
export function tppaStop() { if (R.tppa) R.tppa.running = false; }

// ---------------- sequencer ----------------
export function newSequence() {
  const cs = cameraSettings(); const cam = GEAR[G.s.rig.camera];
  return {
    target: G.s.target ? { ...G.s.target } : null,
    rows: [{ type: 'light', filter: null, exp: cam.type === 'dslr' ? 60 : 120, gain: cs.gain, offset: cs.offset, bin: 1, count: 30, done: 0 }],
    opts: { center: true, guide: true, ditherEvery: 3, focusMode: 'temp', afEvery: 0, afTemp: 2, flip: true, minAlt: 15, cool: true, stopDawn: true },
    state: { running: false, status: 'Idle', row: 0 },
  };
}

export async function runSequence(seq, log = () => {}) {
  const st = seq.state; const n = S.night(); const ri = S.rig(); const mount = GEAR[G.s.rig.mount];
  if (st.running) return;
  R.abort = false; st.running = true; st.status = 'Starting…'; emit('seq', seq);
  const set = (s) => { st.status = s; emit('seq', seq); };
  try {
    if (!n.connected.camera) throw new Error('Connect the camera first.');
    const tgt = seq.target;
    // cooling
    if (seq.opts.cool && ri.cam.cooled && !n.cam.coolerOn) { await S.setProp('cam.coolerOn', true); set('Cooling camera…'); }
    if (ri.cam.cooled && n.cam.coolerOn) {
      const t0 = G.s.time;
      while (Math.abs(n.cam.temp - Math.max(n.cam.setpoint, S.envAt(G.s.time).temp - ri.cam.deltaT)) > 0.6 && G.s.time - t0 < 900000) { if (R.abort) throw new Error('Aborted'); await S.waitSim(10); set(`Cooling camera… ${n.cam.temp.toFixed(1)}°C`); }
    }
    const lightsLeft = seq.rows.some((r) => r.type === 'light' && r.done < r.count);
    if (tgt && lightsLeft && seq.opts.center) { set(`Centering ${tgt.name}…`); await centerOn(tgt, (m) => { log(m); set(m); }); }
    // Focus modes: lock = never touch the focuser; start = autofocus once; temp = autofocus again when it cools;
    // comp = autofocus once, then the focuser follows temperature (temperature compensation).
    const fmode = seq.opts.focusMode || (seq.opts.afStart === false ? 'lock' : 'temp');
    const canAF = ri.hasAF && n.connected.focuser;
    if (fmode === 'lock') log(`Focus locked at ${Math.round(n.focus.pos)} for the whole sequence.`);
    if (lightsLeft && fmode !== 'lock' && canAF) { set('Autofocus…'); await autofocus(() => {}, log); }
    const compBase = { pos: n.focus.pos, best: S.focusBest() };
    if (lightsLeft && seq.opts.guide && ri.hasGuide && n.connected.guider && !n.guider.guiding) {
      if (!n.guider.calibrated) { set('Calibrating guider…'); await S.waitSim(60); await S.calibrateGuider(); }
      const g = await S.startGuiding(); if (g && g.error) log('Guiding: ' + g.error); else { set('Guiding settling…'); await S.waitSim(10); }
    }
    let sinceDither = 0, sinceAF = 0, afTemp = S.envAt(G.s.time).temp;
    for (let ri2 = 0; ri2 < seq.rows.length; ri2++) {
      const row = seq.rows[ri2]; st.row = ri2;
      while (row.done < row.count) {
        if (R.abort) throw new Error('Aborted');
        const env = S.envAt(G.s.time);
        if (row.type === 'light') {
          if (seq.opts.stopDawn && env.sunAlt > -12) throw new Error('Astronomical twilight is over — sequence finished.');
          if (tgt) {
            const p = S.pointing();
            if (p.alt < seq.opts.minAlt) { set(`Target below ${seq.opts.minAlt}° — waiting…`); await S.waitSim(300); continue; }
          }
          // meridian flip
          if (!n.mount.tracking && mount.meridian && n.connected.mount && tgt) {
            if (!seq.opts.flip) throw new Error('Mount stopped at the meridian.');
            set('Meridian flip…'); log('Performing meridian flip');
            S.stopGuiding('flip');
            await centerOn(tgt, log);
            if (seq.opts.guide && ri.hasGuide && n.connected.guider) { await S.startGuiding(); await S.waitSim(10); }
          }
          if (fmode === 'comp' && canAF) { const target = Math.round(compBase.pos + (S.focusBest() - compBase.best)); if (target !== Math.round(n.focus.pos)) await S.setFocus(target); }
          if (fmode === 'temp' && canAF && ((seq.opts.afEvery && sinceAF >= seq.opts.afEvery) || (seq.opts.afTemp && Math.abs(env.temp - afTemp) >= seq.opts.afTemp))) {
            set('Autofocus (temperature/interval)…'); await autofocus(() => {}, log); sinceAF = 0; afTemp = S.envAt(G.s.time).temp;
          }
          if (seq.opts.ditherEvery && n.guider.guiding && sinceDither >= seq.opts.ditherEvery) { set('Dithering…'); S.dither(8); await S.waitSim(10); sinceDither = 0; }
        }
        // filter
        if (ri.hasWheel && row.filter) {
          const idx = ri.filters.indexOf(row.filter);
          if (idx >= 0 && idx !== n.wheelPos) { set('Changing filter…'); await S.setProp('wheelPos', idx); await S.waitSim(3); }
        }
        set(`${row.type} ${row.done + 1}/${row.count} · ${row.exp}s`);
        const fr = await S.expose({ type: row.type, exp: row.exp, gain: row.gain, offset: row.offset, bin: row.bin, target: tgt ? tgt.name : (row.type === 'light' ? 'Untitled' : ''), save: true });
        row.done++; sinceDither++; sinceAF++;
        save();
        emit('seq', seq);
        void fr;
      }
    }
    set('Sequence complete ✓'); log('Sequence complete.');
  } catch (e) {
    set(e.message === 'Aborted' || e.message === 'Exposure aborted' ? 'Stopped' : '⚠️ ' + e.message); log('Sequence: ' + e.message);
  } finally {
    st.running = false; emit('seq', seq);
  }
}
export function stopSequence() { R.abort = true; S.abortExposure(); }
