// Observing scripts: a small line-based language that automates a whole imaging project —
// travel, gear, framing, focus, sequences, calibration, stacking, processing and posting.
import * as A from './astro.js';
import { G, emit, save, localParts, localMs } from './state.js';
import { GEAR, LOC, rigInfo } from './gear.js';
import * as S from './session.js';
import * as RT from './routines.js';
import { findLocal, sesame } from './catalog.js';
import { autoStack, autoProcess, luckyStackVideo } from './apps/darkroom.js';
import { publish } from './apps/social.js';
import { uploadFinal } from './starshare-net.js';
import { PREFS } from './menu.js';

export const FILTER_NAMES = { L: 'f_L', R: 'f_R', G: 'f_G', B: 'f_B', HA: 'f_ha', OIII: 'f_oiii', SII: 'f_sii', HA3: 'f_ha3', OIII3: 'f_oiii3', SII3: 'f_sii3', LP: 'f_lp', DUAL: 'f_dual', ENHANCE: 'f_lenhance', ULTIMATE: 'f_ultimate', NONE: null };
const filterId = (n) => { const k = String(n).toUpperCase(); if (k in FILTER_NAMES) return FILTER_NAMES[k]; if (GEAR[n] && GEAR[n].kind === 'filter') return n; throw new Error(`Unknown filter “${n}” (use L R G B Ha OIII SII Ha3 OIII3 SII3 LP Dual Enhance Ultimate)`); };
const filterName = (id) => (Object.entries(FILTER_NAMES).find(([, v]) => v === id) || [id || 'none'])[0].replace('HA', 'Ha');

export const HELP = [
  ['site <id>', 'Travel there tonight (packs up first if you are elsewhere). Ids are listed in Atlas.'],
  ['date 2026-12-09', 'Sandbox: jump to a date (packs up first).'],
  ['gear mount=… optic=… camera=… corrector=… filter=…', 'Assemble the rig (gear ids; also zoom= fstop= for lenses).'],
  ['wheel L R G B Ha3 OIII3 SII3', 'Fill the filter wheel (attaches it). Ha/OIII/SII = ZWO 7nm, Ha3/OIII3/SII3 = Antlia 3nm.'],
  ['accessories guidekit autofocus dew panel power', 'Accessories mounted on the rig.'],
  ['connect', 'Connect every device the rig has; take the lens cap off.'],
  ['cap on|off · panel on|off · dew-heater on|off', 'Physical things on the optics.'],
  ['cooler -15', 'Cool the camera and wait until it is at temperature.'],
  ['wait dark | wait nautical | wait 15m | wait until 22:30 | wait altitude 30', 'Wait (time is fast-forwarded).'],
  ['warp 200', 'Time warp for exposures.'],
  ['polar-align [0.5]', 'Three-point polar alignment; turns the bolts until under N′.'],
  ['target M42 | target "Name" ra=84.5 dec=-3.9', 'Set the target (any catalog/SIMBAD name or coordinates).'],
  ['rotation 116', 'Rotate the camera so the frame top points this many ° east of north.'],
  ['center', 'GoTo + plate solve + re-center (planets: find the disk and center it).'],
  ['video x3 exp=8ms gain=300 frames=2000 roi=640', 'Planetary videos for lucky imaging (roi 320 | 640 | 1024 | full).'],
  ['lucky keep=10%', 'Lucky-stack the newest video of the target (then process + publish as usual).'],
  ['focus [auto|manual]', 'Autofocus (motor) or careful hand focus.'],
  ['guide', 'Calibrate and start guiding.'],
  ['options dither=4 focus=comp aftemp=1.5 minalt=30 flip=on', 'Sequence automation (focus: lock|start|temp|comp).'],
  ['light L 20s x120 gain=0 offset=50', 'Light frames (consecutive light lines run as one sequence).'],
  ['flat L R G B x20 adu=30000', 'Auto-exposed flats (flat panel, or twilight sky).'],
  ['dark 20s x30 gain=0 · bias x30', 'Calibration frames (the cap goes on automatically).'],
  ['pack-up', 'Drive home.'],
  ['stack [method=kappa]', 'Stack every filter of the current target.'],
  ['process preset=LRGB sat=0.7 nr=0.3 sharpen=0.2 stars=0.2 hdr=0.9 title="…"', 'Combine & process (presets: auto color mono LRGB RGB HOO SHO; hdr protects bright cores).'],
  ['publish', 'Post the last processed image on StarShare.'],
  ['log "text"', 'Write to the log.'],
];

// ---------------------------------------------------------------- parsing
function tokenize(line) {
  const out = []; const re = /(\w[\w.-]*)=("([^"]*)"|\S+)|"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(line))) out.push(m[1] ? { k: m[1].toLowerCase(), v: m[3] !== undefined ? m[3] : m[2] } : { v: m[4] !== undefined ? m[4] : m[5] });
  return out;
}
export function parse(text) {
  const cmds = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/(^|\s)#.*$/, '').trim(); if (!line) return;
    const toks = tokenize(line); const cmd = toks.shift().v.toLowerCase();
    const args = toks.filter((t) => !t.k).map((t) => t.v); const kv = Object.fromEntries(toks.filter((t) => t.k).map((t) => [t.k, t.v]));
    cmds.push({ line: i + 1, cmd, args, kv, raw: raw.trim() });
  });
  return cmds;
}
const secs = (s) => { const m = /^([\d.]+)\s*(ms|s|m|min|h)?$/i.exec(String(s)); if (!m) throw new Error(`Bad duration “${s}”`); const v = parseFloat(m[1]); const u = (m[2] || 's').toLowerCase(); return u === 'ms' ? v / 1000 : u === 'm' || u === 'min' ? v * 60 : u === 'h' ? v * 3600 : v; };
const count = (s) => { const m = /^x?(\d+)$/i.exec(String(s)); if (!m) throw new Error(`Bad count “${s}” (use x20)`); return +m[1]; };
const onOff = (v) => /^(on|yes|true|1)$/i.test(String(v));

// ---------------------------------------------------------------- runner
export const SR = { running: false, abort: false, line: 0, log: [], text: '' };
const say = (m) => { SR.log.push(m); if (SR.log.length > 400) SR.log.shift(); emit('scriptlog', m); };
const night = () => { const n = S.night(); if (!n) throw new Error('Not out observing — add a “site …” line first.'); return n; };
const cs = () => RT.cameraSettings();

async function fastWait(cond, maxSec, label) {
  const old = S.T.warp; S.setWarp(600);
  try {
    const t0 = G.s.time;
    while (!cond()) {
      if (SR.abort) throw new Error('Stopped');
      if ((G.s.time - t0) / 1000 > maxSec) throw new Error(`Timed out waiting (${label})`);
      await S.waitSim(30);
    }
  } finally { S.setWarp(old); }
}
async function shootRows(rows, opts) {
  if (!rows.length) return;
  const seq = RT.newSequence();
  seq.target = G.s.target ? { ...G.s.target } : null;
  seq.rows = rows.map((r) => ({ ...r, done: 0 }));
  seq.opts = { ...seq.opts, center: false, guide: false, ditherEvery: 0, cool: false, stopDawn: true, ...opts, skipInitialAF: true };
  RT.R.seq = seq;
  await RT.runSequence(seq, (m) => say('  ' + m));
  if (/^⚠|Stopped/.test(seq.state.status)) throw new Error(seq.state.status.replace(/^⚠\s*/, ''));
  const shot = seq.rows.reduce((a, r) => a + r.done, 0), want = seq.rows.reduce((a, r) => a + r.count, 0);
  say(`  ${shot}/${want} frames — ${seq.state.status}`);
}
async function autoFlats(filters, n, adu) {
  const nn = night(); const ri = S.rig();
  const usePanel = ri.hasPanel;
  if (usePanel) await S.setProp('panelOn', true);
  else if (S.envAt(G.s.time).sunAlt < -10 || S.envAt(G.s.time).sunAlt > 0) say('  No flat panel — sky flats need bright twilight; results may be poor.');
  await S.setProp('capOn', false);
  try {
    for (const f of filters) {
      if (ri.hasWheel && f) { const idx = ri.filters.indexOf(f); if (idx < 0) throw new Error(`Filter ${filterName(f)} is not in the wheel`); await S.setProp('wheelPos', idx); }
      // find the exposure that puts the flat near the requested level
      let exp = 1; const ped = ri.cam.type === 'dslr' ? ri.cam.offset : (cs().offset ?? ri.cam.offset) * 16;
      for (let i = 0; i < 4; i++) {
        const fr = await S.expose({ type: 'flat', exp, gain: cs().gain, offset: cs().offset, save: false, target: 'flat-test' });
        const sig = Math.max(1, fr.res.stats.median - ped);
        const next = Math.min(300, Math.max(0.001, exp * (adu - ped) / sig));
        if (Math.abs(next / exp - 1) < 0.1) break; exp = +next.toPrecision(3);
      }
      say(`  Flats ${filterName(f)}: ${exp}s × ${n}`);
      await shootRows([{ type: 'flat', filter: f, exp, gain: cs().gain, offset: cs().offset, bin: 1, count: n }], { focusMode: 'lock' });
    }
  } finally { if (usePanel) await S.setProp('panelOn', false); }
  void nn;
}
async function shootDarks(rows) {
  const n = night(); const wasOn = n.capOn;
  await S.setProp('capOn', true);
  try { await shootRows(rows, { focusMode: 'lock', stopDawn: false }); }
  finally { await S.setProp('capOn', wasOn); }
}

const CMDS = {
  async site(c) {
    const id = c.args[0]; if (!LOC[id]) throw new Error(`Unknown site “${id}” (see Atlas)`);
    if (G.s.mode === 'night' && G.s.location === id) { say(`  Already at ${LOC[id].name}.`); return; }
    if (G.s.mode === 'night') { say('  Packing up first…'); await S.endNight('user'); }
    const r = await S.startNight(id); if (r && r.error) throw new Error(r.error);
    emit('wentOut'); say(`  Arrived at ${LOC[id].name}.`);
  },
  async date(c) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.args[0] || ''); if (!m) throw new Error('Use date YYYY-MM-DD');
    if (G.s.mode === 'night') await S.endNight('user');
    const r = await S.setDate(+m[1], +m[2] - 1, +m[3]); if (r && r.error) throw new Error(r.error);
  },
  async gear(c) {
    const rig = JSON.parse(JSON.stringify(G.s.rig));
    for (const [k, v] of Object.entries(c.kv)) {
      if (['mount', 'optic', 'camera', 'corrector', 'filter'].includes(k)) {
        const id = v === 'none' ? null : k === 'filter' ? filterId(v) : v;
        if (id && !GEAR[id]) throw new Error(`Unknown gear id “${v}”`);
        if (id && !G.s.inventory.includes(id)) throw new Error(`You don’t own ${GEAR[id].name}`);
        rig[k] = id;
      } else if (k === 'zoom' || k === 'fstop') rig[k] = +v;
      else throw new Error(`gear: unknown key ${k}`);
    }
    await S.setRig(rig); const w = rigInfo(rig).warnings; w.forEach((x) => say('  note: ' + x));
  },
  async wheel(c) {
    if (!G.s.inventory.includes('wheel')) throw new Error('You don’t own a filter wheel');
    const ids = c.args.map(filterId); for (const id of ids) if (id && !G.s.inventory.includes(id)) throw new Error(`You don’t own ${GEAR[id].name}`);
    const rig = { ...G.s.rig, wheel: ids.slice(0, 7), acc: [...new Set([...(G.s.rig.acc || []), 'wheel'])] }; await S.setRig(rig);
  },
  async accessories(c) {
    for (const a of c.args) if (!G.s.inventory.includes(a)) throw new Error(`You don’t own accessory “${a}”`);
    const keepWheel = (G.s.rig.acc || []).includes('wheel') && !c.args.includes('wheel') ? ['wheel'] : [];
    await S.setRig({ ...G.s.rig, acc: [...new Set([...c.args, ...keepWheel])] });
  },
  async connect() {
    const n = night(); const ri = S.rig(); const m = GEAR[G.s.rig.mount];
    await S.setProp('connected.camera', true);
    if (m.computer) await S.setProp('connected.mount', true);
    if (ri.hasAF) await S.setProp('connected.focuser', true);
    if (ri.hasWheel) await S.setProp('connected.wheel', true);
    if (ri.hasGuide && (m.computer || m.guideAxes)) await S.setProp('connected.guider', true);
    if (n.capOn) await S.setProp('capOn', false);
    if (m.goto && n.mount.parked) await S.unpark();
    if (m.type !== 'fixed' && !n.mount.tracking) await S.setTracking(true);
  },
  async cap(c) { night(); await S.setProp('capOn', !/off/i.test(c.args[0])); },
  async panel(c) { night(); await S.setProp('panelOn', onOff(c.args[0])); },
  async 'dew-heater'(c) { night(); await S.setProp('dewHeater', onOff(c.args[0])); },
  async warp(c) { S.setWarp(S.WARPS.reduce((b, w) => (Math.abs(w - +c.args[0]) < Math.abs(b - +c.args[0]) ? w : b), 1)); },
  async cooler(c) {
    const n = night(); const ri = S.rig(); if (!ri.cam.cooled) { say('  (camera is not cooled — skipping)'); return; }
    await S.setProp('cam.setpoint', +c.args[0]); await S.setProp('cam.coolerOn', true);
    await fastWait(() => Math.abs(n.cam.temp - Math.max(n.cam.setpoint, S.envAt(G.s.time).temp - ri.cam.deltaT)) < 0.6, 1200, 'cooling');
    say(`  Sensor at ${n.cam.temp.toFixed(1)} °C`);
  },
  async wait(c) {
    night(); const a = (c.args[0] || '').toLowerCase();
    if (a === 'dark') await fastWait(() => S.envAt(G.s.time).sunAlt < -18, 24 * 3600, 'darkness');
    else if (a === 'nautical') await fastWait(() => S.envAt(G.s.time).sunAlt < -12, 24 * 3600, 'nautical twilight');
    else if (a === 'until') {
      const [hh, mm] = (c.args[1] || '').split(':').map(Number); const loc = S.locNow(); const p = localParts(G.s.time, loc.tz);
      let t = localMs(p.y, p.mo, p.d, hh, mm || 0, loc.tz); if (t < G.s.time) t += 86400000; await fastWait(() => G.s.time >= t, 24 * 3600, 'clock');
    } else if (a === 'altitude') {
      const alt = +c.args[1]; if (!G.s.target) throw new Error('No target set'); const loc = S.locNow();
      await fastWait(() => A.radec2altaz(G.s.target.ra, G.s.target.dec, A.lst(G.s.time, loc.lon), loc.lat).alt >= alt, 24 * 3600, 'target altitude');
    } else { const t = G.s.time + secs(a) * 1000; await fastWait(() => G.s.time >= t, secs(a) + 60, 'timer'); }
  },
  async 'polar-align'(c) {
    const n = night(); const m = GEAR[G.s.rig.mount]; if (m.type !== 'eq') { say('  (not an equatorial mount — skipping)'); return; }
    const goal = +(c.args[0] || 1);
    for (let i = 0; i < 3; i++) await RT.captureAndSolve(); // three-point measurement
    for (let it = 0; it < 5; it++) {
      const e = n.mount.pa, tot = Math.hypot(e.alt, e.az);
      say(`  Polar error ${tot.toFixed(1)}′ (alt ${e.alt.toFixed(1)}′, az ${e.az.toFixed(1)}′)`);
      if (tot <= goal) return;
      await S.adjustPolar(-e.alt * (0.85 + Math.random() * 0.2), -e.az * (0.85 + Math.random() * 0.2)); // turning the bolts by hand
      await S.waitSim(40); await RT.captureAndSolve();
    }
  },
  async target(c) {
    let t;
    if (c.kv.ra !== undefined) t = { id: c.args[0] || c.kv.name || 'Custom', name: c.kv.name || c.args[0] || 'Custom', ra: +c.kv.ra, dec: +c.kv.dec, size: +(c.kv.size || 30) };
    else { const q = c.args.join(' '); t = findLocal(q)[0]; if (!t || t.score > 1) t = (await sesame(q).catch(() => null)) || t; if (!t) throw new Error(`Could not find “${q}”`); t = { ...t, name: c.kv.name || t.name }; }
    await S.setTarget(t); say(`  Target: ${t.name} (${A.fmtRA(t.ra)} ${A.fmtDec(t.dec)})`);
  },
  async rotation(c) {
    night(); const want = A.norm360(+c.args[0]); const cur = S.pointing().pa;
    let d = A.norm180(want - cur); if (d > 90) d -= 180; if (d < -90) d += 180; // a 180° flip gives the same framing
    if (Math.abs(d) > 0.2) { await S.rotateCamera(d); await S.waitSim(30); }
    say(`  Camera rotated to ${S.pointing().pa.toFixed(1)}°`);
  },
  async center() { if (!G.s.target) throw new Error('No target set'); RT.R.abort = false; if (G.s.target.body) await RT.centerBody(G.s.target.body, (m) => say('  ' + m)); else await RT.centerOn(G.s.target, (m) => say('  ' + m)); },
  async video(c) {
    night(); const cam = S.rig().cam; const n = count(c.args[0] || 'x1');
    const key = String(c.kv.roi || '640'); const dims = { 320: [320, 240], 640: [640, 480], 1024: [1024, 768] }[key] || [640, 480];
    const roi = key === 'full' ? null : { cx: Math.floor(cam.w / 2), cy: Math.floor(cam.h / 2), w: Math.min(dims[0], cam.w), h: Math.min(dims[1], cam.h) };
    for (let i = 0; i < n; i++) {
      const fr = await S.expose({ type: 'video', exp: secs(c.kv.exp || '8ms'), gain: c.kv.gain !== undefined ? +c.kv.gain : cs().gain, offset: cs().offset, bin: 1, roi, frames: +(c.kv.frames || 2000), target: G.s.target ? G.s.target.name : 'Planet' });
      say(`  Video ${i + 1}/${n}: ${fr.meta.frames} frames at ${fr.meta.fps} fps${(fr.res.bodies || []).length ? '' : ' — no planet in the field!'} · peak ${Math.round((fr.res.peakFrac || 0) * 100)}%`);
    }
  },
  async lucky(c) {
    if (!G.s.target) throw new Error('No target set');
    const name = G.s.target.name.toLowerCase(); const keep = parseFloat(c.kv.keep || '10') / 100;
    const vids = G.s.frames.filter((f) => f.type === 'video' && String(f.target).toLowerCase() === name);
    if (!vids.length) throw new Error(`No videos of ${G.s.target.name}`);
    const v = vids[vids.length - 1];
    const m = await luckyStackVideo(v, keep, (msg) => { SR.progress = msg; emit('scriptprogress', msg); });
    say(`  Lucky stack: best ${m.n} of ${v.frames} frames`);
  },
  async focus(c) {
    const n = night(); const ri = S.rig(); const mode = (c.args[0] || 'auto').toLowerCase();
    if (mode === 'auto' && ri.hasAF && n.connected.focuser) { RT.R.abort = false; await RT.autofocus(() => {}, (m) => say('  ' + m)); return; }
    // careful hand focus with a Bahtinov mask / HFR: within a third of the critical focus zone
    const cfz = 4.88 * 0.55 * (ri.fstop || 5) ** 2; const um = ri.isLens ? ri.opt.focusUmPerDeg || 10 : ri.opt.focusUmPerStep || 4;
    await S.setFocus(S.focusBest() + ((Math.random() - 0.5) * cfz * 0.6) / um); await S.waitSim(180);
    say(`  Focused by hand (Δ ${S.focusDeltaUm().toFixed(0)} µm)`);
  },
  async guide() {
    const n = night(); const ri = S.rig(); if (!ri.hasGuide) { say('  (no guide kit — unguided)'); return; }
    if (!n.connected.guider) await S.setProp('connected.guider', true);
    if (!n.mount.tracking) await S.setTracking(true);
    if (!n.guider.calibrated) { await S.waitSim(60); await S.calibrateGuider(); }
    const r = await S.startGuiding(); if (r && r.error) throw new Error(r.error); await S.waitSim(10);
  },
  async options(c, st) {
    const o = st.opts;
    for (const [k, v] of Object.entries(c.kv)) {
      if (k === 'dither') o.ditherEvery = +v; else if (k === 'focus') o.focusMode = v; else if (k === 'aftemp') o.afTemp = +v;
      else if (k === 'minalt') o.minAlt = +v; else if (k === 'flip') o.flip = onOff(v); else if (k === 'stopdawn') o.stopDawn = onOff(v);
      else if (k === 'guide') o.guide = onOff(v); else throw new Error(`options: unknown key ${k}`);
    }
  },
  async light(c, st) {
    const [f, e, n] = c.args; st.lights.push({ type: 'light', filter: filterId(f), exp: secs(e), count: count(n), gain: c.kv.gain !== undefined ? +c.kv.gain : cs().gain, offset: c.kv.offset !== undefined ? +c.kv.offset : cs().offset, bin: +(c.kv.bin || 1) });
  },
  async flat(c) { night(); const n = count(c.args[c.args.length - 1]); const fs = c.args.slice(0, -1).map(filterId); await autoFlats(fs.length ? fs : [null], n, +(c.kv.adu || 30000)); },
  async dark(c) { night(); await shootDarks([{ type: 'dark', filter: null, exp: secs(c.args[0]), count: count(c.args[1]), gain: c.kv.gain !== undefined ? +c.kv.gain : cs().gain, offset: c.kv.offset !== undefined ? +c.kv.offset : cs().offset, bin: 1 }]); },
  async bias(c) { night(); const cam = S.rig().cam; await shootDarks([{ type: 'bias', filter: null, exp: cam.type === 'dslr' ? 1 / 4000 : 0.0001, count: count(c.args[0]), gain: c.kv.gain !== undefined ? +c.kv.gain : cs().gain, offset: c.kv.offset !== undefined ? +c.kv.offset : cs().offset, bin: 1 }]); },
  async 'pack-up'() { if (G.s.mode === 'night') await S.endNight('user'); },
  async stack(c) {
    if (!G.s.target) throw new Error('No target set');
    const name = G.s.target.name;
    const filters = [...new Set(G.s.frames.filter((f) => f.type === 'light' && String(f.target).toLowerCase() === name.toLowerCase()).map((f) => f.filter || null))];
    if (!filters.length) throw new Error(`No light frames of ${name}`);
    for (const f of filters) { say(`  Stacking ${filterName(f)}…`); const m = await autoStack({ target: name, filter: f, method: c.kv.method || 'kappa', onProgress: (msg) => { SR.progress = msg; emit('scriptprogress', msg); } }); say(`  ${filterName(f)}: ${m.n} subs, ${Math.round(m.integration / 60)} min, ${m.darks} darks, ${m.flats} flats`); }
  },
  async process(c) {
    if (!G.s.target) throw new Error('No target set');
    const p = {}; const map = { sat: 'sat', nr: 'nr', sharpen: 'sharp', stars: 'starRed', contrast: 'contrast', crop: 'crop', midscale: 'midScale', bg: 'beStr', hdr: 'hdr' };
    for (const [k, v] of Object.entries(c.kv)) if (map[k]) p[map[k]] = +v;
    const id = await autoProcess({ target: G.s.target.name, preset: c.kv.preset || 'auto', title: c.kv.title, params: p });
    const f = G.s.finals.find((x) => x.id === id); f.script = SR.text; SR.lastFinal = id;
    say(`  Saved “${f.title}” — self-assessed score ${f.score.total}/100`); f.score.feedback.slice(0, 3).forEach((x) => say('   · ' + x));
  },
  async publish() { const id = SR.lastFinal || (G.s.finals[G.s.finals.length - 1] || {}).id; if (!id) throw new Error('Nothing to publish'); if (!publish(id)) { say('  (already published)'); return; } say('  Published on StarShare.'); if (PREFS.globalShare !== false) { try { await uploadFinal(G.s.finals.find((f) => f.id === id)); say('  Also posted to the StarShare community.'); } catch (e) { say('  (community upload failed: ' + e.message + ')'); } } },
  async log(c) { say('  ' + c.args.join(' ')); },
};

export async function runScript(text) {
  if (SR.running) throw new Error('A script is already running.');
  const cmds = parse(text);
  for (const c of cmds) if (!CMDS[c.cmd]) throw new Error(`Line ${c.line}: unknown command “${c.cmd}”`);
  SR.running = true; SR.abort = false; SR.text = text; SR.log = []; RT.R.abort = false;
  emit('scriptstate', SR);
  const st = { lights: [], opts: { focusMode: 'lock', ditherEvery: 0, minAlt: 15, flip: true, stopDawn: true } };
  const flush = async () => { if (st.lights.length) { const rows = st.lights; st.lights = []; say(`▶ ${rows.length} light row(s): ${rows.map((r) => `${filterName(r.filter)} ${r.exp}s×${r.count}`).join(', ')}`); await shootRows(rows, { ...st.opts }); } };
  try {
    for (const c of cmds) {
      if (SR.abort) throw new Error('Stopped');
      if (c.cmd !== 'light') await flush();
      SR.line = c.line; emit('scriptstate', SR);
      if (c.cmd !== 'light') say(`${String(c.line).padStart(3)}  ${c.raw}`);
      await CMDS[c.cmd](c, st);
    }
    await flush();
    say('✓ Script finished.'); emit('toast', { msg: 'Script finished ✓', kind: 'good' });
  } catch (e) {
    say(`✗ Line ${SR.line}: ${e.message}`); emit('toast', { msg: `Script stopped at line ${SR.line}: ${e.message}`, kind: e.message === 'Stopped' ? 'info' : 'bad' });
  } finally {
    SR.running = false; SR.line = 0; emit('scriptstate', SR); save();
  }
}
export function stopScript() { SR.abort = true; RT.stopSequence(); }

// ---------------------------------------------------------------- "save current setup"
export function scriptFromCurrent() {
  const r = G.s.rig; const ri = rigInfo(r); const t = G.s.target; const c = cs(); const n = S.night();
  const L = [];
  L.push(`# ${t ? t.name : 'My setup'} — saved ${new Date().toLocaleDateString()}`);
  if (G.s.gameMode === 'sandbox') { const p = localParts(G.s.time, LOC.backyard.tz); L.push(`date ${p.y}-${String(p.mo + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`); }
  L.push(`site ${n ? n.loc : G.s.location}`);
  L.push(`gear mount=${r.mount} optic=${r.optic} camera=${r.camera} corrector=${r.corrector || 'none'} filter=${r.filter ? filterName(r.filter) : 'none'}${ri.isLens ? ` zoom=${Math.round(ri.focal)} fstop=${ri.fstop}` : ''}`);
  if ((r.acc || []).includes('wheel')) L.push(`wheel ${(r.wheel || []).filter(Boolean).map(filterName).join(' ')}`);
  if ((r.acc || []).filter((a) => a !== 'wheel').length) L.push(`accessories ${(r.acc || []).filter((a) => a !== 'wheel').join(' ')}`);
  L.push('wait nautical', 'connect');
  if (ri.cam && ri.cam.cooled) L.push(`cooler ${n ? n.cam.setpoint : -10}`);
  if (GEAR[r.mount].type === 'eq') L.push('polar-align 1');
  if (t) L.push(`target "${t.name}" ra=${t.ra.toFixed(4)} dec=${t.dec.toFixed(4)}`);
  if (n && t) L.push(`rotation ${S.pointing().pa.toFixed(0)}`);
  L.push('wait dark');
  if (t && GEAR[r.mount].goto) L.push('center');
  L.push(`focus ${ri.hasAF ? 'auto' : 'manual'}`);
  if (ri.hasGuide) L.push('guide');
  const seq = RT.R.seq;
  const o = seq ? seq.opts : {};
  L.push(`options focus=${o.focusMode || (ri.hasAF ? 'comp' : 'lock')} dither=${o.ditherEvery ?? (ri.hasGuide ? 3 : 0)} minalt=${o.minAlt ?? 20} flip=${o.flip === false ? 'off' : 'on'}`);
  const rows = seq && seq.rows.length ? seq.rows : [{ type: 'light', filter: ri.filters[0] || null, exp: c.exp, count: 30, gain: c.gain, offset: c.offset }];
  const lights = rows.filter((x) => x.type === 'light');
  for (const x of lights) L.push(`light ${filterName(x.filter)} ${x.exp}s x${x.count} gain=${x.gain}${ri.cam.type === 'dslr' ? '' : ` offset=${x.offset}`}`);
  const fl = [...new Set(lights.map((x) => filterName(x.filter)))];
  L.push(`flat ${fl.join(' ')} x20`);
  for (const e of [...new Set(lights.map((x) => x.exp))]) L.push(`dark ${e}s x20`);
  L.push('bias x30', 'pack-up', 'stack', `process title="${t ? t.name : 'My image'}"`);
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------- built-in examples
export const EXAMPLES = [
  { name: 'Jupiter at f/20 (sandbox)', text: `# Jupiter with an 8-inch SCT, 2x Barlow and a planetary camera: lucky imaging.
# Mauna Kea's steady air; Jupiter is high before dawn in Oct 2026.
site maunakea
gear mount=eq6 optic=sct_8 corrector=barlow2 camera=planet_462
accessories autofocus adc dew power
connect
target Jupiter
wait altitude 45
center
focus auto
video exp=8ms gain=320 frames=3000 roi=640
lucky keep=10%
process title="Jupiter from Mauna Kea" sat=0.5
publish` },
  { name: 'Orion’s Sword — M42 to the Horsehead (sandbox)', text: `# Orion's Sword: M42, the Running Man, the Flame and the Horsehead in one frame.
# Best: Atacama, 9 Dec 2026 (new moon, Orion 72° up at 1:54 am). Needs the sandbox gear.
date 2026-12-09
site atacama
gear mount=observatory optic=petz_100 corrector=reducer08 camera=mono_6200 filter=none
wheel L R G B Ha OIII SII
accessories guidekit autofocus dew panel power
wait nautical
connect
dew-heater on
cooler -15
polar-align 0.5
target "Orion's Sword" ra=84.537 dec=-3.946 size=200
wait dark
center
rotation 116
focus auto
guide
options focus=comp dither=4 minalt=30 flip=on
light L 20s x120 gain=0 offset=50
light R 60s x80 gain=0 offset=50
light G 60s x80 gain=0 offset=50
light B 60s x80 gain=0 offset=50
flat L R G B x20 adu=30000
dark 20s x30 gain=0 offset=50
dark 60s x30 gain=0 offset=50
bias x30 gain=0 offset=50
pack-up
stack
process preset=LRGB sat=0.45 nr=0.3 sharpen=0.2 stars=0.2 hdr=0.9 title="Orion's Sword: M42 to the Horsehead"
publish
` },
  { name: 'Quick look — M42 with the starter kit', text: `# Works with the starting DSLR, kit lens and tripod (no tracking: short exposures).
site backyard
gear mount=tripod optic=lens_kit camera=dslr_stock zoom=55 fstop=5.6
wait dark
connect
target M42
wait altitude 25
focus manual
log "Aim the camera at M42 by hand first if it is not in the frame!"
light none 2s x40 gain=1600
dark 2s x20 gain=1600
pack-up
stack
process sat=0.6 title="Orion Nebula — first try"
` },
  { name: 'M51 Whirlpool in spring (sandbox)', text: `# The Whirlpool Galaxy with the 8" RC. New moon, M51 high all evening.
date 2027-04-07
site backyard
gear mount=observatory optic=rc_8 corrector=flattener camera=mono_2600 filter=none
wheel L R G B Ha OIII SII
accessories guidekit autofocus dew panel power
wait nautical
connect
cooler -10
polar-align 1
target M51
wait dark
center
focus auto
guide
options focus=temp aftemp=1 dither=3 minalt=25
light L 120s x60 gain=100 offset=50
light R 180s x20 gain=100 offset=50
light G 180s x20 gain=100 offset=50
light B 180s x20 gain=100 offset=50
flat L R G B x20
dark 120s x20 gain=100 offset=50
dark 180s x20 gain=100 offset=50
bias x30 gain=100 offset=50
pack-up
stack
process preset=LRGB sat=0.6 nr=0.3 sharpen=0.3 title="M51 — The Whirlpool"
` },
];
