// Field view — you are standing outside in the 3D world next to your rig.
// The 3D scene lives in world3d.js; this module wires interactions and the physical-controls panel.
import { h, toast, dialog, select } from './wm.js';
import * as A from './astro.js';
import { G, on, off, emit, save } from './state.js';
import { GEAR, FILTERS, ACCESSORIES, rigInfo, lensFMin } from './gear.js';
import * as S from './session.js';
import { canvasFromRGBA } from './components.js';
import { cat } from './catalog.js';
import { World } from './world3d.js';
import { createHud } from './hud.js';
import { MP } from './mp.js';

let root = null, panel = null, worldEl = null, hud = null, visible = false, world = null, panelOpen = false, hudTimer = null;
const unsub = [];
const draw = () => {};

export function initField(container, cb) {
  root = h('div', { class: 'field-root', style: { display: 'none' } });
  worldEl = h('div', { class: 'world' });
  panel = h('div', { class: 'field-panel', style: { display: 'none' } });
  root.append(worldEl, panel);
  container.append(root);
  hud = createHud(root, cb);
  hud.setPrompt('');
  window.addEventListener('keydown', (e) => {
    if (!visible || (e.target.matches && e.target.matches('input,select,textarea'))) return;
    if (e.key === 'Enter') { e.preventDefault(); hud.openChat(); }
    if (e.key === 'F2') { e.preventDefault(); document.body.classList.toggle('hud-off'); }
    if (e.key === ',' || e.key === '<') cb.onWarp(-1);
    if (e.key === '.' || e.key === '>') cb.onWarp(1);
  });
}
export function getPose() {
  if (!world) return null;
  const P = world.player;
  return { pos: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)], yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3), at: visible ? 'outside' : 'laptop', lamp: !!world.flashlight };
}
function ensureWorld() {
  if (world) return world;
  world = new World(worldEl); window.__world = world;
  if (MP.role === 'client') { world.player.pos.set(-1.4 - Math.random(), 1.65, 1.2 + Math.random()); world.player.yaw = -0.4; } // don't spawn inside the host
  world.on('hover', (a) => hud.setPrompt(hoverText(a)));
  world.on('action', (a) => doAction(a));
  world.on('panel', () => togglePanel());
  world.on('grab', (g) => { hud.setPrompt(g ? 'AIMING BY HAND — LOOK WHERE THE RIG SHOULD POINT · E / CLICK TO LOCK' : ''); hud.setGrab(g); root.classList.toggle('grabbing', g); });
  on('mpplayers', (pl) => world.setRemotePlayers(Object.values(pl).filter((p) => p.id !== MP.myId)));
  return world;
}
function manualMount() { const m = GEAR[G.s.rig.mount]; return !m.goto; }
function hoverText(a) {
  const n = G.s.night; if (!a || !n) return '';
  switch (a) {
    case 'laptop': return 'E  SIT DOWN AT THE LAPTOP';
    case 'cap': return 'E  REMOVE THE LENS CAP';
    case 'bahtinov': return 'E  TAKE OFF THE BAHTINOV MASK';
    case 'dew': return n.dew > 0.05 || (n.smudge || 0) > 0.05 ? 'E  DEAL WITH THE DEW ON THE OPTICS' : rigInfo(G.s.rig).hasDew ? `E  TURN DEW HEATER ${n.dewHeater ? 'OFF' : 'ON'}` : 'DEW STRAP';
    case 'focus': return 'E  FOCUS BY HAND';
    case 'polar': return GEAR[G.s.rig.mount].polarScope ? 'E  POLAR SCOPE / ALIGNMENT BOLTS' : 'E  POLAR ALIGNMENT BOLTS';
    case 'camera': return 'E  CAMERA (ROTATE)';
    default: return manualMount() ? (GEAR[G.s.rig.mount].type === 'fixed' ? 'E  LOOSEN THE BALL HEAD AND AIM' : 'E  UNLOCK THE CLUTCH AND AIM BY HAND') : 'E  HAND CONTROLLER';
  }
}
function doAction(a) {
  const n = G.s.night; if (!n) return;
  const ri = rigInfo(G.s.rig);
  if (a === 'laptop') return sitDown();
  if (a === 'cap') { S.setProp('capOn', false); toast('Lens cap removed. (Keep it handy for dark frames!)', 'info', 2500); save(); return; }
  if (a === 'bahtinov') { S.setProp('bahtinov', false); toast('Bahtinov mask removed.', 'info', 2000); return; }
  if (a === 'dew') { if (n.dew > 0.05 || (n.smudge || 0) > 0.05 || !ri.hasDew) return openPanel('optics'); if (ri.hasDew) { S.setProp('dewHeater', !n.dewHeater); toast(`Dew heater ${n.dewHeater ? 'on' : 'off'}.`, 'info', 1800); } return; }
  if (a === 'focus') return openPanel('focus');
  if (a === 'polar') return openPanel('polar');
  if (a === 'camera') return openPanel('rotation');
  if (manualMount()) {
    if (GEAR[G.s.rig.mount].type === 'eq' && n.mount.tracking) toast('Tip: aiming by hand while tracking is fine — the tracker keeps running.', 'info', 2500);
    if (document.pointerLockElement !== world.renderer.domElement) { try { world.renderer.domElement.requestPointerLock(); } catch (_) {} }
    world.setGrab(true);
    return;
  }
  openPanel('aim');
}
function togglePanel() { panelOpen ? closePanel() : openPanel(); }
function openPanel(section) {
  panelOpen = true; panel.style.display = ''; root.classList.add('panel-open'); buildPanel();
  if (document.pointerLockElement) document.exitPointerLock();
  if (section) { const el = panel.querySelector(`[data-sec="${section}"]`); if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900); } }
}
function closePanel() { panelOpen = false; panel.style.display = 'none'; root.classList.remove('panel-open'); }

let sitting = false;
function sitDown() {
  if (sitting) return; sitting = true;
  world.setGrab(false);
  if (document.pointerLockElement) document.exitPointerLock();
  // walk/turn to the laptop, then look down at the screen
  const P = world.player; const scr = new world.camera.position.constructor();
  world.laptopScreen.getWorldPosition(scr);
  const from = { pos: P.pos.clone(), yaw: P.yaw, pitch: P.pitch };
  const toPos = scr.clone().add(new scr.constructor(0.15, 0, 0.5).applyAxisAngle(new scr.constructor(0, 1, 0), world.table.rotation.y)); toPos.y = 1.15;
  const d = scr.clone().sub(toPos); const toYaw = Math.atan2(-d.x, -d.z), toPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  let dy = toYaw - from.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
  const t0 = performance.now(), dur = 900;
  const step = () => {
    const f = Math.min(1, (performance.now() - t0) / dur), e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
    P.pos.lerpVectors(from.pos, toPos, e); P.yaw = from.yaw + dy * e; P.pitch = from.pitch + (toPitch - from.pitch) * e;
    if (f < 1) requestAnimationFrame(step);
    else { root.classList.add('fade'); setTimeout(() => { hideField(); root.classList.remove('fade'); sitting = false; P.pos.copy(from.pos).lerp(toPos, 0.5); P.pitch = 0.1; }, 350); }
  };
  requestAnimationFrame(step);
}

export function isFieldVisible() { return visible; }
export function showField() {
  if (!G.s.night) { toast('You are at home. Use the Weather app to head out for a night of imaging.', 'info'); return; }
  visible = true; root.style.display = '';
  ensureWorld(); world.resize(); world.start();
  clearInterval(hudTimer); const hu = () => { try { hud.update(); } catch (e) { (window.__reportError || console.error)(e); } }; hu(); hudTimer = setInterval(hu, 250);
  document.body.classList.add('in-field');
  const t = () => { if (visible && panelOpen) refreshLive(); };
  let last = 0; const tick = () => { const n = performance.now(); if (n - last > 250) { last = n; t(); } };
  const rb = () => { if (panelOpen) buildPanel(); };
  on('tick', tick); on('frame', t); on('focus', t); on('rig', rb);
  unsub.push(() => off('tick', tick), () => off('frame', t), () => off('focus', t), () => off('rig', rb));
  emit('fieldshown', true);
}
export function hideField() {
  visible = false; if (root) root.style.display = 'none'; clearInterval(hudTimer);
  if (world) { world.stop(); world.setGrab(false); }
  unsub.splice(0).forEach((u) => u());
  document.body.classList.remove('in-field');
  emit('fieldshown', false);
}

// ---------------- control panel ----------------
let live = {};
function buildPanel() {
  panel.innerHTML = ''; live = {};
  const n = G.s.night; const ri = S.rig(); const mount = GEAR[G.s.rig.mount];
  const sec = (title, ...kids) => h('div', { class: 'fsec' }, h('div', { class: 'fsec-t' }, title), ...kids);
  const tagSec = (el, k) => { el.dataset.sec = k; return el; };
  panel.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, 'Rig controls'), h('button', { class: 'btn small', onclick: () => closePanel() }, 'Close (R)')));
  // rig
  const rigSec = sec('Your rig',
    h('div', { class: 'small' }, `${mount.name}`), h('div', { class: 'small' }, `${ri.opt ? ri.opt.name : '—'}${ri.corr ? ' + ' + ri.corr.name : ''}`), h('div', { class: 'small' }, `${ri.cam ? ri.cam.name : '—'}`),
    ...ri.warnings.map((w) => h('div', { class: 'warnline small' }, '⚠ ' + w)),
    h('button', { class: 'btn small', onclick: () => changeGear() }, 'Change gear…'));
  if (ri.isLens) {
    if (ri.opt.zoom) rigSec.append(h('div', { class: 'row' }, h('span', { class: 'small' }, 'Zoom ring'), h('input', { type: 'range', min: ri.opt.zoom[0], max: ri.opt.zoom[1], step: 1, value: Math.round(ri.focal), oninput: (e) => { zl.textContent = `${e.target.value}mm`; }, onchange: (e) => { S.setRig({ ...G.s.rig, zoom: +e.target.value }); buildPanel(); } }), (zl => zl)(h('b', { class: 'small' }, `${Math.round(ri.focal)}mm`))));
    rigSec.append(h('div', { class: 'row' }, h('span', { class: 'small' }, 'Aperture ring'), select(ri.opt.stops.filter((s) => s >= lensFMin(ri.opt, ri.focal) - 0.01).map((s) => [s, 'f/' + s]), ri.fstop, (v) => { S.setRig({ ...G.s.rig, fstop: +v }); buildPanel(); })));
  }
  const zl = rigSec.querySelector('b.small');
  panel.append(rigSec);
  // covers & accessories
  const capBtn = h('button', { class: 'btn ' + (n.capOn ? 'danger' : ''), onclick: () => { S.setProp('capOn', !n.capOn); toast(n.capOn ? 'Lens cap on.' : 'Lens cap removed.', 'info', 1500); buildPanel(); draw(); } }, n.capOn ? '🔴 Lens cap is ON — remove' : 'Put lens cap on');
  const acc = [capBtn];
  if (ri.hasBahtinov) acc.push(h('button', { class: 'btn' + (n.bahtinov ? ' on' : ''), onclick: () => { S.setProp('bahtinov', !n.bahtinov); buildPanel(); draw(); } }, n.bahtinov ? 'Remove Bahtinov mask' : 'Put on Bahtinov mask'));
  if (ri.hasDew) acc.push(h('button', { class: 'btn' + (n.dewHeater ? ' on' : ''), onclick: () => { S.setProp('dewHeater', !n.dewHeater); buildPanel(); draw(); } }, n.dewHeater ? 'Dew heater: ON' : 'Dew heater: off'));
  if (ri.hasPanel) acc.push(h('button', { class: 'btn' + (n.panelOn ? ' on' : ''), onclick: () => { S.setProp('panelOn', !n.panelOn); buildPanel(); } }, n.panelOn ? 'Flat panel ON (on aperture)' : 'Flat panel off'));
  const hasDryer = G.s.inventory.includes('hairdryer');
  live.dryBtn = h('button', { class: 'btn', disabled: !hasDryer, title: hasDryer ? '' : 'Buy one in AstroMart → Accessories', onclick: async () => { const r = await S.useHairDryer(); if (r.error) toast(r.error, 'warn'); else { toast(`Blowing warm air on the optics… (~${Math.round(r.secs)}s)${S.T.exposure ? ' — careful, that shakes the rig mid-exposure!' : ''}`, 'info', 3500); } refreshLive(); } }, hasDryer ? '🌬 Blow hair dryer on the optics' : '🌬 Hair dryer (not owned)');
  const wipeBtn = h('button', { class: 'btn', onclick: async () => { const r = await S.wipeOptics(); if (r.error) { toast(r.error, 'warn'); return; } toast(`Wiped with your sleeve. Dew gone — but you left a smudge (${Math.round(r.smudge * 100)}%): expect glowing halos around bright stars until you clean the lens at home.`, 'warn', 6000); refreshLive(); draw(); } }, '🧥 Wipe with your sleeve');
  acc.push(live.dryBtn, wipeBtn);
  live.dew = h('div', { class: 'small muted' });
  panel.append(tagSec(sec('On the optics', h('div', { class: 'col' }, ...acc), live.dew), 'optics'));
  // aiming
  const aimSec = sec(mount.type === 'fixed' ? 'Ball head (aim by hand)' : mount.goto ? 'Hand controller' : 'Tracker (clutch / aim by hand)');
  const steps = mount.goto ? [['Slew rate 9 (3°)', 3 * 3600], ['Rate 6 (20′)', 1200], ['Rate 3 (1′)', 60], ['Rate 1 (5″)', 5]] : [['Big (5°)', 5 * 3600], ['Medium (1°)', 3600], ['Small (10′)', 600], ['Tiny (1′)', 60]];
  let step = steps[1][1];
  const stepSel = select(steps.map(([l, v]) => [v, l]), step, (v) => { step = +v; });
  const lab = mount.type === 'eq' ? ['N', 'S', 'E', 'W'] : ['Up', 'Down', 'Left', 'Right'];
  const mv = (dx, dy) => () => {
    if (mount.goto && n.mount.parked) { toast('Mount is parked — unpark it first.', 'warn'); return; }
    if (mount.goto) { const dt = Math.hypot(dx, dy) / 3600 / mount.slew + 0.5; S.nudge(dx * step, dy * step); void dt; }
    else S.nudge(dx * step, dy * step);
    draw(); refreshLive();
  };
  const pad = h('div', { class: 'dpad' },
    h('span', {}), h('button', { class: 'btn', onclick: mv(0, 1) }, lab[0]), h('span', {}),
    h('button', { class: 'btn', onclick: mv(mount.type === 'eq' ? 1 : -1, 0) }, lab[mount.type === 'eq' ? 2 : 2]), h('span', { class: 'dpad-c' }, '✣'), h('button', { class: 'btn', onclick: mv(mount.type === 'eq' ? -1 : 1, 0) }, lab[3]),
    h('span', {}), h('button', { class: 'btn', onclick: mv(0, -1) }, lab[1]), h('span', {}));
  aimSec.append(h('div', { class: 'row' }, stepSel), pad);
  if (mount.type !== 'fixed') {
    aimSec.append(h('button', { class: 'btn' + (n.mount.tracking ? ' on' : ''), onclick: async () => { if (mount.goto && n.mount.parked) { toast('Unpark first.', 'warn'); return; } await S.setTracking(!n.mount.tracking); buildPanel(); } }, n.mount.tracking ? '⏺ Tracking ON (sidereal)' : 'Tracking OFF — switch on'));
    if (mount.goto) aimSec.append(h('button', { class: 'btn', onclick: async () => { await (n.mount.parked ? S.unpark() : S.park()); buildPanel(); } }, n.mount.parked ? 'Unpark mount' : 'Park mount'));
  }
  aimSec.append(h('div', { class: 'small muted' }, mount.goto ? 'Use the laptop (SkyChart / AstroCap) for GoTo and plate-solve centering.' : 'Walk to the rig and press E to grab it, then look where it should point. Fine-tune here while looping exposures on the laptop.'));
  live.aim = h('div', { class: 'small' }); aimSec.append(live.aim);
  panel.append(tagSec(aimSec, 'aim'));
  // focus
  const f = n.focus;
  const focSec = sec(ri.isLens ? 'Focus ring' : ri.hasAF ? 'Focuser (motorized)' : 'Focuser knobs');
  const fbtn = (d, l) => h('button', { class: 'btn small', onclick: () => { S.moveFocus(d); refreshLive(); } }, l);
  if (ri.isLens) focSec.append(h('div', { class: 'row wrap' }, fbtn(-10, '⟲ 10°'), fbtn(-2, '⟲ 2°'), fbtn(-0.3, '⟲ fine'), fbtn(0.3, 'fine ⟳'), fbtn(2, '2° ⟳'), fbtn(10, '10° ⟳')), h('div', { class: 'small muted' }, 'Turning toward ⟳ goes to the ∞ hard stop. Note: lenses focus *past* infinity — the ∞ mark is rarely exact.'));
  else focSec.append(h('div', { class: 'row wrap' }, fbtn(-300, '⟲ coarse'), fbtn(-40, '⟲'), fbtn(-5, '⟲ micro'), fbtn(5, 'micro ⟳'), fbtn(40, '⟳'), fbtn(300, 'coarse ⟳')), h('div', { class: 'small muted' }, 'Focus shifts as the temperature drops during the night — re-check every hour or so.'));
  live.focus = h('canvas', { class: 'focus-ring', width: 260, height: 70 });
  focSec.append(live.focus);
  panel.append(tagSec(focSec, 'focus'));
  // camera rotation
  panel.append(tagSec(sec('Camera rotation', h('div', { class: 'row wrap' }, ...[[-10, '⟲10°'], [-1, '⟲1°'], [1, '1°⟳'], [10, '10°⟳'], [90, '90°']].map(([d, l]) => h('button', { class: 'btn small', onclick: () => { S.rotateCamera(d); refreshLive(); draw(); } }, l))), (live.rot = h('div', { class: 'small' }))), 'rotation'));
  // polar alignment
  if (mount.type === 'eq') {
    const psec = sec('Polar alignment');
    if (mount.polarScope) {
      live.polar = h('canvas', { class: 'polarscope', width: 230, height: 230 });
      live.clock = h('div', { class: 'small' });
      psec.append(h('div', { class: 'small muted' }, 'Look through the polar scope. Put the pole star on the circle at the clock position the PolarClock app shows.'), live.polar, live.clock);
    } else psec.append(h('div', { class: 'small muted' }, 'No polar scope on this mount. Rough-align by pointing the mount north, then use AstroCap → Polar Align.'));
    const knob = (label, fn) => h('div', { class: 'row' }, h('span', { class: 'small', style: { width: '74px' } }, label), ...[[-10, '⟲⟲'], [-1, '⟲'], [1, '⟳'], [10, '⟳⟳']].map(([d, s]) => h('button', { class: 'btn small', onclick: () => { fn(d); refreshLive(); } }, s)));
    psec.append(knob('Alt bolt', (d) => S.adjustPolar(-d, 0)), knob('Az bolts', (d) => S.adjustPolar(0, -d)));
    panel.append(tagSec(psec, 'polar'));
  }
  // laptop mirror
  live.mirror = h('canvas', { class: 'mirror' });
  panel.append(sec('Laptop screen (latest image)', live.mirror, (live.mirrorInfo = h('div', { class: 'small muted' }))));
  if (ri.cam && ri.cam.cooled) panel.append(sec('Camera', (live.cam = h('div', { class: 'small' }))));
  if ((G.s.rig.acc || []).includes('sqm')) panel.append(sec('Sky Quality Meter', h('button', { class: 'btn small', onclick: () => { const env = S.envAt(G.s.time); const loc = S.locNow(); const nl = A.magToNL(loc.sqm) + A.moonSkyNL(env.moonPhase, env.moonAlt, 90, 90 - env.moonAlt) + A.twilightNL(env.sunAlt, 90 - env.sunAlt) + env.clouds * A.magToNL(loc.sqm) * 1.5; n.sqm = A.nlToMag(nl) + (Math.random() - 0.5) * 0.06; refreshLive(); } }, 'Take reading'), (live.sqm = h('div', { class: 'small' }))));
  refreshLive();
}

function refreshLive() {
  const n = G.s.night; if (!n || !visible) return;
  const ri = S.rig(); const pt = S.pointing(); const mount = GEAR[G.s.rig.mount];
  if (live.dew) {
    const drying = n.dryUntil && G.s.time < n.dryUntil;
    const parts = [drying ? `Drying… ${Math.ceil((n.dryUntil - G.s.time) / 1000)}s left` : n.dew > 0.02 ? `Dew on optics: ${(n.dew * 100).toFixed(0)}%${n.dew > 0.3 ? ' — everything looks soft and glowing!' : ''}` : 'Optics are dry.'];
    if (!drying && n.warmUntil && G.s.time < n.warmUntil && !n.dewHeater) parts.push(`Glass still warm (${Math.ceil((n.warmUntil - G.s.time) / 60000)} min).`);
    if ((n.smudge || 0) > 0.02) parts.push(`Smudged: ${Math.round(n.smudge * 100)}% (halos until cleaned at home).`);
    live.dew.textContent = parts.join(' ');
    if (live.dryBtn) live.dryBtn.disabled = !G.s.inventory.includes('hairdryer') || drying;
  }
  if (live.aim && pt) live.aim.textContent = `Pointing alt ${pt.alt.toFixed(2)}°, az ${pt.az.toFixed(2)}° ${n.mount.slew ? '· slewing…' : ''}`;
  if (live.rot && pt) live.rot.textContent = mount.type === 'eq' ? `Frame "up" points ${pt.pa.toFixed(1)}° east of north` : `Camera roll ${n.mount.roll.toFixed(1)}° from level (frame PA now ${pt.pa.toFixed(1)}°)`;
  if (live.focus) drawFocusRing(live.focus, n, ri);
  if (live.polar) drawPolarScope(live.polar, live.clock, n);
  if (live.mirror && S.T.lastFrame) {
    const pv = S.T.lastFrame.res.preview; const c = canvasFromRGBA(pv);
    live.mirror.width = 260; live.mirror.height = Math.round(260 * pv.h / pv.w);
    live.mirror.getContext('2d').drawImage(c, 0, 0, live.mirror.width, live.mirror.height);
    const st = S.T.lastFrame.res.stats; live.mirrorInfo.textContent = `${S.T.lastFrame.meta.exp}s · HFR ${st.hfr.toFixed(2)} · ${st.stars} stars`;
  } else if (live.mirrorInfo) live.mirrorInfo.textContent = S.T.exposure ? 'Exposing…' : 'No image yet.';
  if (live.cam) live.cam.textContent = `Sensor ${n.cam.temp.toFixed(1)}°C · cooler ${n.cam.coolerOn ? 'on ' + n.cam.power.toFixed(0) + '%' : 'off'}`;
  if (live.sqm) live.sqm.textContent = n.sqm ? `${n.sqm.toFixed(2)} mag/arcsec²` : '';
}

function drawFocusRing(c, n, ri) {
  const ctx = c.getContext('2d'); const W = c.width, H = c.height; ctx.clearRect(0, 0, W, H);
  const f = n.focus;
  ctx.fillStyle = '#16191f'; ctx.fillRect(0, 10, W, 44);
  ctx.strokeStyle = '#2c323c'; for (let x = 0; x < W; x += 6) { ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, 52); ctx.stroke(); }
  ctx.fillStyle = '#ccc'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  if (f.unit === 'deg') {
    const span = 60; const x0 = W / 2 - (f.pos - 0) * 0;
    for (let d = -40; d <= 40; d += 10) { const ang = f.pos + d; if (ang < 0 || ang > 270) continue; const x = W / 2 + d * (W / span); ctx.fillText(ang >= 268 ? '∞' : ang > 240 ? `${Math.round(30 + (270 - ang) * 0.4)}m` : `${Math.max(0.3, (ang / 270) * 10).toFixed(1)}m`, x, 66); ctx.fillRect(x - 0.5, 50, 1, 6); }
    void x0;
  } else {
    for (let d = -400; d <= 400; d += 100) { const p = Math.round(f.pos / 100) * 100 + d; const x = W / 2 + (p - f.pos) * (W / 1000); ctx.fillText(String(p), x, 66); ctx.fillRect(x - 0.5, 50, 1, 6); }
  }
  ctx.fillStyle = '#ff5050'; ctx.beginPath(); ctx.moveTo(W / 2 - 5, 0); ctx.lineTo(W / 2 + 5, 0); ctx.lineTo(W / 2, 9); ctx.fill();
  void ri;
}

function drawPolarScope(c, clockEl, n) {
  const ctx = c.getContext('2d'); const W = c.width, H = c.height, cx = W / 2, cy = H / 2;
  const loc = S.locNow(); const env = S.envAt(G.s.time); const L = A.lst(G.s.time, loc.lon); const sgn = loc.lat >= 0 ? 1 : -1;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, 7); ctx.clip();
  const sky = Math.max(0, Math.min(1, (env.sunAlt + 14) / 10));
  ctx.fillStyle = `rgb(${10 + 50 * sky},${12 + 60 * sky},${20 + 90 * sky})`; ctx.fillRect(0, 0, W, H);
  const scale = (W / 2) / 3.2; // px per degree (6.4° field)
  const pa = n.mount.pa;
  const offX = -sgn * pa.az / 60, offY = -pa.alt / 60; // pole offset relative to axis
  const lim = Math.max(0, (loc.sqm - 15.5) * 0.95 + 0.6 - (env.sunAlt > -10 ? (env.sunAlt + 10) * 0.6 : 0));
  const mountRA = 0; void mountRA;
  if (cat.loaded) for (const s of cat.stars) {
    if (s.mag > lim + 1.5) break;
    const pd = sgn > 0 ? 90 - s.dec : 90 + s.dec; if (pd > 4.5) continue;
    const ha = (L - s.ra) * A.D2R;
    const x = -sgn * Math.sin(ha) * pd + offX, y = Math.cos(ha) * pd + offY;
    const px = cx + x * scale, py = cy - y * scale;
    const a = Math.max(0.15, Math.min(1, (lim + 1.5 - s.mag) / 2));
    ctx.fillStyle = `rgba(255,255,240,${a})`; ctx.beginPath(); ctx.arc(px, py, Math.max(0.8, 3 - s.mag * 0.4), 0, 7); ctx.fill();
  }
  ctx.restore();
  // reticle (illuminated red)
  ctx.strokeStyle = 'rgba(255,60,60,.8)'; ctx.lineWidth = 1;
  const polaris = sgn > 0 ? { ra: 37.95456, dec: 89.26411 } : { ra: 317.19526, dec: -88.95650 };
  const rr = (90 - Math.abs(polaris.dec)) * scale;
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12); ctx.stroke();
  ctx.fillStyle = 'rgba(255,80,80,.8)'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; ctx.fillRect(cx + Math.sin(a) * rr - 0.5, cy - Math.cos(a) * rr - 0.5, 1.5, 1.5); ctx.fillText(String(k === 0 ? 12 : k), cx + Math.sin(a) * (rr + 11), cy - Math.cos(a) * (rr + 11) + 3); }
  ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, 7); ctx.stroke();
  // PolarClock (phone app) — where the pole star SHOULD be on the reticle
  const ha = A.norm360(L - polaris.ra) / 15; // hours
  let clock = (12 - (ha / 2) * sgn) % 12; if (clock <= 0) clock += 12;
  const hh = Math.floor(clock), mm = Math.round((clock - hh) * 60);
  if (clockEl) clockEl.innerHTML = `📱 PolarClock: ${sgn > 0 ? 'Polaris' : 'σ Octantis'} should be at <b>${hh}:${String(mm).padStart(2, '0')}</b> on the reticle circle.` + (lim < 5.6 && sgn < 0 ? ' <span class="warn">(σ Oct is too faint to see here — use software polar alignment)</span>' : '') + (env.sunAlt > -6 ? ' <span class="warn">(sky too bright to see stars yet)</span>' : '');
}

async function changeGear() {
  const inv = G.s.inventory; const rig = JSON.parse(JSON.stringify(G.s.rig));
  const own = (kind) => inv.filter((id) => GEAR[id] && GEAR[id].kind === kind);
  const box = h('div', { class: 'gearform' });
  const row = (label, el) => box.append(h('div', { class: 'gf-row' }, h('label', {}, label), el));
  row('Mount', select(own('mount').map((id) => [id, GEAR[id].name]), rig.mount, (v) => { rig.mount = v; }));
  row('Optics', select(own('optic').map((id) => [id, GEAR[id].name]), rig.optic, (v) => { rig.optic = v; const o = GEAR[v]; if (o.zoom) rig.zoom = o.zoom[0]; rig.fstop = o.fMin || (o.fMinAt && o.fMinAt[0]); }));
  row('Camera', select(own('camera').filter((id) => !GEAR[id].guideOnly).map((id) => [id, GEAR[id].name]), rig.camera, (v) => { rig.camera = v; if (typeof wheelNote === 'function') wheelNote(); }));
  row('Corrector', select([['', 'none'], ...own('corrector').map((id) => [id, GEAR[id].name])], rig.corrector || '', (v) => { rig.corrector = v || null; }));
  row('Filter (in camera/drawer)', select([['', 'none'], ...own('filter').map((id) => [id, GEAR[id].name])], rig.filter || '', (v) => { rig.filter = v || null; }));
  // The filter wheel is attached right here with its slots, so filling slots can't silently leave it off.
  const setWheel = (on) => { rig.acc = (rig.acc || []).filter((x) => x !== 'wheel'); if (on) rig.acc.push('wheel'); wheelChk.checked = on; wheelNote(); };
  const wheelChk = h('input', { type: 'checkbox', checked: (rig.acc || []).includes('wheel'), onchange: (e) => setWheel(e.target.checked) });
  const wheelHint = h('div', { class: 'small warn' });
  const wheelNote = () => { const mono = GEAR[rig.camera] && GEAR[rig.camera].mono; wheelHint.textContent = wheelChk.checked && !mono ? 'Filter wheels only work with mono cameras — pick a mono camera, or use the single filter slot above.' : ''; };
  const wheelBox = h('div', { class: 'col' }, h('label', { class: 'chk' }, wheelChk, '7-position electronic filter wheel attached'), wheelHint);
  for (let i = 0; i < 7; i++) wheelBox.append(select([['', `slot ${i + 1}: empty`], ...own('filter').map((id) => [id, `slot ${i + 1}: ${GEAR[id].name}`])], (rig.wheel || [])[i] || '', (v) => { rig.wheel = rig.wheel || []; rig.wheel[i] = v || null; if (v) setWheel(true); }));
  if (inv.includes('wheel')) { row('Filter wheel', wheelBox); wheelNote(); }
  const accBox = h('div', { class: 'col' });
  for (const a of ACCESSORIES) if (inv.includes(a.id) && !a.handheld && a.id !== 'wheel') accBox.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: (rig.acc || []).includes(a.id), onchange: (e) => { rig.acc = (rig.acc || []).filter((x) => x !== a.id); if (e.target.checked) rig.acc.push(a.id); } }), a.name));
  row('Accessories', accBox);
  const ok = await dialog({ title: 'Change gear', body: box, width: 520, buttons: [{ label: 'Cancel', value: false }, { label: 'Assemble', value: true, primary: true }] });
  if (!ok) return;
  applyRig(rig);
  const warns = rigInfo(rig).warnings;
  toast(warns.length ? `Rig assembled — ${warns.length} note${warns.length > 1 ? 's' : ''}: ${warns.join(' ')}` : 'Rig assembled. Reconnect devices in AstroCap → Equipment.', warns.length ? 'warn' : 'good', warns.length ? 9000 : 4000);
}
export function applyRig(rig) {
  S.setRig(rig);
  if (visible) { buildPanel(); draw(); }
}
void FILTERS; void dialog;
