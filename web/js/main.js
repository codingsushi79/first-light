// Boot, menubar, game loop.
import { h, initWM, registerApp, openApp, toast, renderDock, $ } from './wm.js';
import { G, loadGame, save, on, emit, fmtTime, fmtDate, localParts } from './state.js';
import { loadCatalogs, cat, bvToRGB } from './catalog.js';
import { initWorker } from './imaging.js';
import * as S from './session.js';
import * as A from './astro.js';
import { LOC, money, GEAR } from './gear.js';
import { initField, showField, hideField, isFieldVisible } from './field.js';
import { captureApp } from './apps/capture.js';
import { planetariumApp } from './apps/planetarium.js';
import { guideApp, framingApp, tonightApp, weatherApp } from './apps/misc.js';
import { filesApp, stackerApp, pixellabApp } from './apps/darkroom.js';
import { shareApp, shopApp, mailApp, settingsApp, checkQuests, updatePosts } from './apps/social.js';
import * as RT from './routines.js';
import { atlasApp } from './apps/atlas.js';
import { registerLocation } from './gear.js';

const boot = $('#boot'), bootMsg = $('#boot-msg');
const say = (m) => { bootMsg.textContent = m; };

async function main() {
  say('Loading save…');
  const existing = await loadGame();
  for (const c of G.s.customSites || []) registerLocation(c);
  say('Downloading star catalogs…');
  try { await loadCatalogs(say); } catch (e) { console.warn(e); say('Star catalog unavailable (offline?) — continuing.'); await new Promise((r) => setTimeout(r, 900)); }
  say('Starting imaging engine…');
  await initWorker(cat.stars.slice(0, 5000).map((s) => ({ ...s, c: bvToRGB(s.bv) })));
  buildOS();
  boot.classList.add('out'); setTimeout(() => boot.remove(), 700);
  document.body.classList.toggle('nightmode', !!G.s.settings.nightMode);
  if (!existing) setTimeout(() => openApp('mail'), 900);
  checkQuests();
  if (G.s.mode === 'night' && G.s.night) { toast(`Resumed your session at ${LOC[G.s.night.loc].name}.`); showField(); }
  loop();
}

function buildOS() {
  const os = $('#os');
  const menubar = h('div', { class: 'menubar' });
  const desktop = h('div', { class: 'desktop' });
  const dock = h('div', { class: 'dock' });
  os.append(menubar, desktop, dock);
  initWM(desktop, dock);
  registerApp('capture', captureApp);
  registerApp('planetarium', planetariumApp);
  registerApp('framing', framingApp);
  registerApp('guide', guideApp);
  registerApp('tonight', tonightApp);
  registerApp('weather', weatherApp);
  registerApp('atlas', atlasApp);
  registerApp('files', filesApp);
  registerApp('stacker', stackerApp);
  registerApp('pixellab', pixellabApp);
  registerApp('share', shareApp);
  registerApp('shop', shopApp);
  registerApp('mail', mailApp);
  registerApp('settings', settingsApp);
  renderDock();
  buildMenubar(menubar);
  buildWidget(desktop);
  initField(document.body);

  on('toast', (t) => toast(t.msg, t.kind || 'info'));
  on('money', (m) => { if (m.delta < 0) return; });
  on('frame', () => checkQuests());
  on('stacked', () => checkQuests());
  on('posted', () => checkQuests());
  on('final', () => checkQuests());
  on('award', () => checkQuests());
  on('night', (n) => { checkQuests(); if (!n) { hideField(); RT.R.seq && (RT.R.seq.state.running = false); } renderDock(); });
  on('newday', (d) => { updatePosts(); checkQuests(); if (d && d.reason === 'dawn') toast('Dawn. You packed up and drove home to sleep.', 'info', 6000); if (d && d.reason === 'user') toast('Back home. Time to process your data!', 'info'); });
  on('mail', renderDock); on('mailread', renderDock);
  on('meridian', () => toast('Mount stopped at the meridian! Re-center the target (AstroCap → Plate Solve) to flip.', 'warn', 7000));
  on('wentOut', () => { showField(); setTimeout(() => toast('You are outside next to your rig. Walk up to it (WASD), take the lens cap off (E), then sit at the laptop (E on the laptop).', 'info', 9000), 800); });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,select,textarea')) return;
    if (e.key === 'Tab') { e.preventDefault(); isFieldVisible() ? hideField() : showField(); }
  });
}

// ---------------- menubar ----------------
let mb = {};
function buildMenubar(el) {
  mb.logo = h('div', { class: 'mb-logo' }, h('span', { class: 'mb-dot' }), 'AstroOS');
  mb.look = h('button', { class: 'mb-btn look', onclick: () => (isFieldVisible() ? hideField() : showField()), title: 'Stand up / sit down at the laptop (Tab)' }, '🚶 Stand up');
  mb.status = h('div', { class: 'mb-status' });
  mb.warp = h('div', { class: 'mb-warp' });
  for (const w of S.WARPS) mb.warp.append(h('button', { class: 'mb-w' + (S.T.warp === w ? ' on' : ''), 'data-w': w, onclick: () => S.setWarp(w), title: `Time runs ${w}× faster` }, `${w}×`));
  mb.ff = h('button', { class: 'mb-w ff', title: 'Fast-forward: skip to end of current exposure / wait', onclick: () => fastForward() }, '⏭');
  mb.warp.append(mb.ff);
  mb.money = h('div', { class: 'mb-money' });
  mb.batt = h('div', { class: 'mb-batt' });
  mb.clock = h('div', { class: 'mb-clock' });
  mb.night = h('button', { class: 'mb-btn', title: 'Red night-vision mode', onclick: () => { G.s.settings.nightMode = !G.s.settings.nightMode; document.body.classList.toggle('nightmode', G.s.settings.nightMode); save(); } }, '🔴');
  el.append(mb.logo, mb.look, mb.status, h('div', { class: 'mb-spacer' }), mb.warp, mb.money, mb.night, mb.batt, mb.clock);
  on('warp', (w) => mb.warp.querySelectorAll('.mb-w[data-w]').forEach((b) => b.classList.toggle('on', +b.dataset.w === w)));
  on('money', (m) => { updateMenubar(); if (m && Math.abs(m.delta) >= 1) { const f = h('div', { class: 'money-float ' + (m.delta > 0 ? 'pos' : 'neg') }, (m.delta > 0 ? '+' : '−') + money(Math.abs(m.delta))); mb.money.append(f); setTimeout(() => f.remove(), 1600); } });
  updateMenubar();
}
let ffActive = false;
function fastForward() {
  if (G.s.mode !== 'night') return;
  ffActive = !ffActive;
  mb.ff.classList.toggle('on', ffActive);
}
function updateMenubar() {
  const s = G.s; if (!s) return;
  const loc = s.night ? LOC[s.night.loc] : LOC.backyard;
  const n = s.night;
  mb.clock.textContent = `${fmtDate(s.time, loc.tz)}  ${fmtTime(s.time, loc.tz)}`;
  mb.money.firstChild ? (mb.money.firstChild.nodeType === 3 ? (mb.money.firstChild.textContent = money(s.money)) : mb.money.prepend(money(s.money))) : mb.money.append(money(s.money));
  mb.warp.style.display = s.mode === 'night' ? '' : 'none';
  mb.look.style.display = s.mode === 'night' ? '' : 'none';
  const lt = isFieldVisible() ? '💻 Use laptop' : '🚶 Stand up'; if (mb.look.textContent !== lt) mb.look.textContent = lt;
  if (n) {
    const b = Math.round(n.battery);
    mb.batt.textContent = `${b >= 20 ? '🔋' : '🪫'} ${b}%`; mb.batt.classList.toggle('low', b < 20);
    const env = S.envAt(s.time);
    const sunTxt = env.sunAlt > -0.8 ? '☀️ Day' : env.sunAlt > -6 ? 'Civil twilight' : env.sunAlt > -12 ? 'Nautical twilight' : env.sunAlt > -18 ? 'Astro twilight' : '🌌 Dark';
    const ex = S.T.exposure;
    const exTxt = ex ? `● ${ex.rendering ? 'Downloading' : `Exposing ${Math.min(ex.exp, (s.time - ex.t0) / 1000).toFixed(0)}/${ex.exp >= 1 ? ex.exp.toFixed(0) : ex.exp}s`}` : '';
    mb.status.innerHTML = '';
    mb.status.append(h('span', { class: 'chip' }, loc.name.split(' (')[0]), h('span', { class: 'chip' }, sunTxt), h('span', { class: 'chip' }, `${env.temp.toFixed(0)}°C`), h('span', { class: 'chip' + (env.clouds > 0.4 ? ' warn' : '') }, `☁ ${(env.clouds * 100).toFixed(0)}%`), h('span', { class: 'chip' }, `🌙 ${(env.moonIllum * 100).toFixed(0)}% ${env.moonAlt > 0 ? '↑' : '↓'}`));
    if (exTxt) mb.status.append(h('span', { class: 'chip rec' }, exTxt));
    if (n.capOn) mb.status.append(h('span', { class: 'chip warn', title: 'Lens cap is on!' }, 'cap on'));
    if (n.dew > 0.2) mb.status.append(h('span', { class: 'chip warn' }, 'dew!'));
  } else {
    mb.batt.textContent = '🔌 100%'; mb.batt.classList.remove('low');
    mb.status.innerHTML = ''; mb.status.append(h('span', { class: 'chip' }, '🏠 Home · daytime'), h('span', { class: 'chip' }, 'Open Weather to plan tonight'));
  }
}

// ---------------- desktop widget ----------------
let widget;
function buildWidget(desktop) {
  widget = h('div', { class: 'widget' });
  desktop.append(widget);
  updateWidget();
}
function updateWidget() {
  const s = G.s; if (!widget || !s) return;
  widget.innerHTML = '';
  const n = s.night;
  const ri = S.rig();
  if (!n) {
    widget.append(h('div', { class: 'w-title' }, 'Tonight'), h('div', { class: 'small' }, `Money: ${money(s.money)} · Reputation ${Math.round(s.rep)}`),
      h('div', { class: 'small muted' }, `${ri.mount ? ri.mount.name : ''}`), h('div', { class: 'small muted' }, `${ri.opt ? ri.opt.name : ''}`), h('div', { class: 'small muted' }, `${ri.cam ? ri.cam.name : ''}`),
      h('button', { class: 'btn primary small', style: { marginTop: '8px' }, onclick: () => openApp('weather') }, 'Plan tonight →'));
    return;
  }
  const loc = LOC[n.loc]; const ev = n.events;
  const p = S.pointing();
  widget.append(...[h('div', { class: 'w-title' }, 'Session'),
    h('div', { class: 'small' }, `🌇 Sunset ${ev.sunStart ? fmtTime(ev.sunStart, loc.tz) : '—'} · 🌌 Dark ${ev.astroStart ? fmtTime(ev.astroStart, loc.tz) : '—'}–${ev.astroEnd ? fmtTime(ev.astroEnd, loc.tz) : '—'}`),
    h('div', { class: 'small' }, `Target: ${s.target ? s.target.name : '—'}`),
    p ? h('div', { class: 'small muted' }, `Rig → alt ${p.alt.toFixed(1)}° az ${p.az.toFixed(1)}° ${n.mount.tracking ? '· tracking' : '· not tracking'}${n.mount.slew ? ' · slewing' : ''}`) : null,
    h('div', { class: 'small muted' }, `Frames tonight: ${s.frames.filter((f) => f.session === n.id).length}`),
    RT.R.seq && RT.R.seq.state.running ? h('div', { class: 'small' }, `Sequencer: ${RT.R.seq.state.status}`) : null,
    n.guider.guiding ? h('div', { class: 'small' }, `Guiding RMS ${n.guider.rms.toFixed(2)}″`) : null].filter(Boolean));
}

// ---------------- loop ----------------
let last = performance.now(), lastUI = 0;
function loop() {
  const now = performance.now();
  let dt = Math.min(1, (now - last) / 1000); last = now;
  if (G.s.mode === 'night') {
    if (ffActive) {
      const ex = S.T.exposure;
      if (ex && !ex.rendering) dt = Math.max(dt, (ex.end - G.s.time) / 1000 / S.T.warp);
      else if (S.T.waiters.length) dt = Math.max(dt, Math.min(...S.T.waiters.map((w) => w.until - G.s.time)) / 1000 / S.T.warp);
      else if (!(RT.R.seq && RT.R.seq.state.running)) { ffActive = false; mb.ff.classList.remove('on'); }
    }
    S.tick(dt);
  }
  if (now - lastUI > 250) { lastUI = now; updateMenubar(); updateWidget(); }
  setTimeout(loop, 33);
}
setInterval(() => save(), 20000);
window.addEventListener('beforeunload', () => save(true));

window.__dbg = { S, G, RT, A };
main().catch((e) => { console.error(e); say('Failed to start: ' + e.message); });
void A; void GEAR; void localParts; void emit;
