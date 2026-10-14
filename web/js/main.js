// Boot, main menu, game start (solo / host / guest), AstroOS menubar, game loop.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../css/hud.css';
import { h, initWM, registerApp, openApp, toast, renderDock, $ } from './wm.js';
import { G, save, on, emit, fmtTime, fmtDate, listSlots, loadSlot, createSlot, setAllGearIds, applySandbox, isSandbox } from './state.js';
import { loadCatalogs, cat, bvToRGB, setBodyLookup } from './catalog.js';
import * as IM from './imaging.js';
const { initWorker } = IM;
import * as S from './session.js';
import * as A from './astro.js';
import { LOC, money, ALL_GEAR, registerLocation } from './gear.js';
import { initField, showField, hideField, isFieldVisible, getPose } from './field.js';
import { captureApp } from './apps/capture.js';
import { planetariumApp } from './apps/planetarium.js';
import { guideApp, framingApp, tonightApp, weatherApp } from './apps/misc.js';
import { filesApp, stackerApp, pixellabApp } from './apps/darkroom.js';
import { shareApp, shopApp, mailApp, settingsApp, checkQuests, updatePosts } from './apps/social.js';
import { atlasApp } from './apps/atlas.js';
import { scriptsApp } from './apps/scripts.js';
import { logbookApp } from './apps/logbook.js';
import { initAchievements } from './achievements.js';
import { toggleSpotlight, toggleNotifications } from './os-extras.js';
import { usage, fmtBytes } from './storage.js';
import { syncEarnings } from './starshare-net.js';
import * as RT from './routines.js';
import { armAudio, updateAudio, applyVolumes } from './sound.js';
import { startTutorial } from './tutorial.js';
import { MP, host as mpHost, join as mpJoin, leave as mpLeave, setPoseProvider } from './mp.js';
import { showMainMenu, hideMainMenu, showPause, hidePause, isPaused, PREFS, applyPrefs, quitApp } from './menu.js';

const boot = $('#boot'), bootMsg = $('#boot-msg');
const say = (m) => { bootMsg.textContent = m; };

async function main() {
  say('Reading saves…');
  await listSlots();
  say('Downloading star catalogs…');
  try { await loadCatalogs(say); } catch (e) { console.warn(e); say('Star catalog unavailable (offline?) — continuing.'); await new Promise((r) => setTimeout(r, 900)); }
  say('Starting imaging engine…');
  await initWorker(cat.stars.slice(0, 5000).map((s) => ({ ...s, c: bvToRGB(s.bv) })));
  setAllGearIds(ALL_GEAR.map((g) => g.id));
  applyPrefs(); window.__flSens = PREFS.sens;
  document.body.classList.toggle('nightmode', !!PREFS.nightMode);
  boot.classList.add('out'); setTimeout(() => boot.remove(), 700);
  openMenu();
}

function openMenu() {
  showMainMenu({
    onStart: (id) => startSolo(id),
    onNew: async (name, mode) => { await createSlot(name, mode); if (mode === 'sandbox') { applySandbox(G.s); await save(true); } hideMainMenu(); startGameUI(true); },
    onHost: async (id, name, lan) => { await startSolo(id); await startHosting(name, lan); },
    onJoin: async (code, name) => { if (!code) throw new Error('Enter a room code.'); await mpJoin(code, name); hideMainMenu(); startGameUI(false); toast(`Joined ${code}. You're in the host's night.`, 'good'); },
    onRefresh: () => openMenu(),
  });
}
async function startSolo(slotId) {
  if (!(await loadSlot(slotId))) { toast('Could not load that save.', 'bad'); return; }
  hideMainMenu(); startGameUI(false);
}
async function startHosting(name, lan = false) {
  try {
    const code = await mpHost(name || PREFS.name || 'Host', { lan });
    toast(lan ? `LAN game open at ${code} — friends on your network join via Main menu → Multiplayer with that address. (Allow incoming connections if macOS asks.)` : `Co-op open! Room code: ${code} — friends join via Main menu → Multiplayer.`, 'good', 14000);
  } catch (e) { toast('Could not start hosting: ' + (e.message || e.type), 'bad'); }
}

let started = false;
function startGameUI(isNew) {
  if (started) return; started = true;
  G.s.settings = { ...(G.s.settings || {}), quality: PREFS.quality, nightMode: PREFS.nightMode };
  for (const c of G.s.customSites || []) registerLocation(c);
  $('#laptop').style.display = '';
  buildOS();
  setPoseProvider(getPose);
  if (isNew && G.s.gameMode === 'career' && MP.role === 'solo') startTutorial(true);
  else if (G.s.tutorial && !G.s.tutorial.done && MP.role === 'solo') startTutorial(false);
  else if (isNew) setTimeout(() => openApp('mail'), 900);
  checkQuests();
  if (G.s.mode === 'night' && G.s.night) { if (!isNew && MP.role === 'solo') toast(`Resumed your session at ${LOC[G.s.night.loc].name}.`); showField(); }
  loop();
}

function pauseMenu() {
  showPause({
    onSave: () => save(true),
    onHost: async (lan) => { hidePause(); await startHosting(PREFS.name, lan); },
    onLeave: async () => { if (MP.role === 'host') await save(true); mpLeave(); location.reload(); },
    onMain: async () => { await save(true); mpLeave(); location.reload(); },
    onQuit: async () => { await save(true); quitApp(); },
    onPrefs: () => { window.__flSens = PREFS.sens; },
  });
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
  registerApp('scripts', scriptsApp);
  registerApp('logbook', logbookApp);
  registerApp('mail', mailApp);
  registerApp('settings', settingsApp);
  renderDock();
  buildMenubar(menubar);
  buildWidget(desktop);
  initField(document.body, {
    onMenu: () => pauseMenu(),
    onWarp: (d) => { const i = S.WARPS.indexOf(S.T.warp); S.setWarp(S.WARPS[Math.max(0, Math.min(S.WARPS.length - 1, i + d))]); },
    onFF: () => fastForward(),
    ffOn: () => ffActive,
  });

  on('toast', (t) => toast(t.msg, t.kind || 'info'));
  initAchievements();
  on('frame', () => checkQuests());
  on('stacked', () => checkQuests());
  on('posted', () => checkQuests());
  on('final', () => checkQuests());
  on('award', () => checkQuests());
  on('night', (n) => { checkQuests(); if (!n) { hideField(); RT.R.seq && (RT.R.seq.state.running = false); } else if (MP.role === 'client' && !isFieldVisible()) showField(); renderDock(); });
  on('newday', (d) => { updatePosts(); checkQuests(); if (d && d.reason === 'dawn') toast('Dawn. You packed up and drove home to sleep.', 'info', 6000); if (d && d.reason === 'user') toast('Back home. Time to process your data!', 'info'); });
  on('mail', renderDock); on('mailread', renderDock);
  on('meridian', () => toast('Mount stopped at the meridian! Re-center the target (AstroCap → Plate Solve) to flip.', 'warn', 7000));
  on('wentOut', () => { showField(); setTimeout(() => toast('You are outside next to your rig. Walk up to it (WASD), take the lens cap off (E), then sit at the laptop (E on the laptop).', 'info', 9000), 800); });
  on('mpstatus', (s) => toast(s.msg, s.kind));
  on('mpdisconnect', () => { toast('Lost connection to the host. Returning to the main menu…', 'bad'); setTimeout(() => location.reload(), 2500); });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input,select,textarea')) return;
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.code === 'Space' && e.ctrlKey)) { e.preventDefault(); if (!isFieldVisible()) toggleSpotlight(spotActions()); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (G.s.mode === 'night') isFieldVisible() ? hideField() : showField(); }
    if (e.key === 'Escape') {
      if (document.querySelector('.modal-ov')) return;
      if (document.pointerLockElement) return;
      pauseMenu();
    }
  });
}

// ---------------- Spotlight actions ----------------
function spotActions() {
  const night = () => G.s.mode === 'night';
  return [
    { title: 'Go outside to the rig', keys: 'stand walk field', when: () => night() && !isFieldVisible(), run: () => showField() },
    { title: 'Pack up & go home', keys: 'end night home', when: night, run: () => S.endNight('user') },
    { title: 'Plan tonight (Weather)', keys: 'head out forecast', when: () => !night(), run: () => openApp('weather') },
    { title: 'Save game', keys: 'save', when: () => !G.guest, run: () => save(true).then(() => toast('Saved.', 'good')) },
    { title: 'Time warp 60×', keys: 'warp fast speed', when: () => night() && MP.role !== 'client', run: () => S.setWarp(60) },
    { title: 'Time warp 1× (real time)', keys: 'warp normal real', when: () => night() && MP.role !== 'client', run: () => S.setWarp(1) },
    { title: 'Park the mount', keys: 'park mount', when: () => night() && S.canGoto(), run: () => S.park() },
    { title: 'Red night-vision mode', keys: 'red night vision', run: () => { PREFS.nightMode = !PREFS.nightMode; G.s.settings.nightMode = PREFS.nightMode; document.body.classList.toggle('nightmode', PREFS.nightMode); } },
    { title: 'Pause menu', keys: 'pause menu quit', run: () => pauseMenu() },
  ];
}

// ---------------- menubar (macOS-style) ----------------
let mb = {};
function menuDrop(anchor, items) {
  document.querySelectorAll('.mb-drop').forEach((d) => d.remove());
  const r = anchor.getBoundingClientRect();
  const d = h('div', { class: 'mb-drop', style: { left: r.left + 'px', top: r.bottom + 4 + 'px' } },
    ...items.map((it) => (it === '-' ? h('div', { class: 'mb-sep' }) : h('div', { class: 'mb-item' + (it.dis ? ' dis' : ''), onclick: () => { if (it.dis) return; d.remove(); it.fn(); } }, h('span', {}, it.label), it.key ? h('span', { class: 'mb-key' }, it.key) : null))));
  document.body.append(d);
  setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!d.contains(ev.target)) { d.remove(); document.removeEventListener('mousedown', off); } }), 0);
}
function buildMenubar(el) {
  mb.logo = h('div', { class: 'mb-logo', onclick: () => menuDrop(mb.logo, [
    { label: 'About AstroOS', fn: () => toast('AstroOS 26 — the observing laptop of First Light.', 'info') },
    '-', { label: 'Settings…', fn: () => openApp('settings') },
    { label: 'Pause menu', key: 'esc', fn: () => pauseMenu() },
    { label: 'Save game', fn: () => save(true).then(() => toast('Saved.', 'good')), dis: G.guest },
    '-', { label: 'Main menu…', fn: async () => { await save(true); mpLeave(); location.reload(); } },
    { label: 'Quit First Light', key: '⌘Q', fn: async () => { await save(true); quitApp(); } }]) }, h('span', { class: 'mb-glyph', html: '<svg viewBox="0 0 20 20" width="15" height="15"><circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="2.6" fill="currentColor"/><path d="M10 1.8v3M10 15.2v3M1.8 10h3M15.2 10h3" stroke="currentColor" stroke-width="1.4"/></svg>' }));
  mb.app = h('div', { class: 'mb-app' }, 'Finder');
  mb.menus = h('div', { class: 'mb-menus' }, ...['File', 'Edit', 'View', 'Window', 'Help'].map((m) => h('span', {}, m)));
  mb.look = h('button', { class: 'mb-pill look', onclick: () => (isFieldVisible() ? hideField() : showField()), title: 'Stand up / sit down at the laptop (Tab)' }, 'Stand up');
  mb.status = h('div', { class: 'mb-status' });
  mb.warp = h('div', { class: 'mb-warp' });
  for (const w of S.WARPS) mb.warp.append(h('button', { class: 'mb-w' + (S.T.warp === w ? ' on' : ''), 'data-w': w, onclick: () => S.setWarp(w), title: `Time runs ${w}× faster` }, `${w}×`));
  mb.ff = h('button', { class: 'mb-w ff', title: 'Fast-forward: skip to end of current exposure / wait', onclick: () => fastForward() }, '⏭');
  mb.warp.append(mb.ff);
  mb.money = h('div', { class: 'mb-money' });
  mb.coop = h('div', { class: 'mb-coop' });
  mb.batt = h('div', { class: 'mb-batt' });
  mb.clock = h('div', { class: 'mb-clock', title: 'Notification Center', onclick: () => toggleNotifications() });
  mb.search = h('button', { class: 'mb-icon', title: 'Spotlight (⌘K)', onclick: () => toggleSpotlight(spotActions()), html: '<svg viewBox="0 0 20 20" width="13" height="13"><circle cx="8.5" cy="8.5" r="5.8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' });
  mb.night = h('button', { class: 'mb-icon', title: 'Red night-vision mode', onclick: () => { PREFS.nightMode = !PREFS.nightMode; G.s.settings.nightMode = PREFS.nightMode; document.body.classList.toggle('nightmode', PREFS.nightMode); } }, h('span', { class: 'red-dot' }));
  el.append(mb.logo, mb.app, mb.menus, mb.look, mb.status, h('div', { class: 'mb-spacer' }), mb.warp, mb.coop, mb.money, mb.night, mb.batt, mb.search, mb.clock);
  on('warp', (w) => mb.warp.querySelectorAll('.mb-w[data-w]').forEach((b) => b.classList.toggle('on', +b.dataset.w === w)));
  on('money', (m) => { updateMenubar(); if (m && Math.abs(m.delta) >= 1) { const f = h('div', { class: 'money-float ' + (m.delta > 0 ? 'pos' : 'neg') }, (m.delta > 0 ? '+' : '−') + money(Math.abs(m.delta))); mb.money.append(f); setTimeout(() => f.remove(), 1600); } });
  document.addEventListener('appfocus', (e) => { const def = { capture: 'AstroCap', planetarium: 'SkyChart', framing: 'Framing', guide: 'GuideMaster', tonight: 'Tonight', weather: 'Weather', atlas: 'Atlas', files: 'Files', stacker: 'DeepStack', pixellab: 'PixelLab', share: 'StarShare', shop: 'AstroMart', mail: 'Mail', settings: 'Settings', scripts: 'Scripts', logbook: 'Logbook' }; mb.app.textContent = def[e.detail] || 'Finder'; });
  updateMenubar();
}
let ffActive = false;
function fastForward() {
  if (G.s.mode !== 'night' || MP.role === 'client') return;
  ffActive = !ffActive;
  mb.ff.classList.toggle('on', ffActive);
}
function updateMenubar() {
  const s = G.s; if (!s) return;
  const loc = s.night ? LOC[s.night.loc] : LOC.backyard;
  const n = s.night;
  mb.clock.textContent = `${fmtDate(s.time, loc.tz)}  ${fmtTime(s.time, loc.tz, !!n)}`;
  const mtxt = isSandbox() ? '∞' : money(s.money);
  mb.money.firstChild ? (mb.money.firstChild.nodeType === 3 ? (mb.money.firstChild.textContent = mtxt) : mb.money.prepend(mtxt)) : mb.money.append(mtxt);
  mb.warp.style.display = s.mode === 'night' && MP.role !== 'client' ? '' : 'none';
  mb.look.style.display = s.mode === 'night' ? '' : 'none';
  mb.coop.textContent = MP.role === 'solo' ? '' : `● ${Object.keys(MP.players).length} · ${MP.code}`;
  const lt = isFieldVisible() ? 'Use laptop' : 'Stand up'; if (mb.look.textContent !== lt) mb.look.textContent = lt;
  if (n) {
    const b = Math.round(n.battery);
    mb.batt.textContent = `${b}%`; mb.batt.classList.toggle('low', b < 20);
    const env = S.envAt(s.time);
    const sunTxt = env.sunAlt > -0.8 ? 'Day' : env.sunAlt > -6 ? 'Civil twilight' : env.sunAlt > -12 ? 'Nautical twilight' : env.sunAlt > -18 ? 'Astro twilight' : 'Dark';
    const ex = S.T.exposure;
    const exTxt = ex ? `● ${ex.rendering ? 'Downloading' : `Exposing ${Math.min(ex.exp, (s.time - ex.t0) / 1000).toFixed(0)}/${ex.exp >= 1 ? ex.exp.toFixed(0) : ex.exp}s`}` : '';
    mb.status.innerHTML = '';
    mb.status.append(h('span', { class: 'chip' }, loc.name.split(' (')[0]), h('span', { class: 'chip' }, sunTxt), h('span', { class: 'chip' }, `${env.temp.toFixed(0)}°C`), h('span', { class: 'chip' + (env.clouds > 0.4 ? ' warn' : '') }, `☁ ${(env.clouds * 100).toFixed(0)}%`), h('span', { class: 'chip' }, `☾ ${(env.moonIllum * 100).toFixed(0)}% ${env.moonAlt > 0 ? '↑' : '↓'}`));
    if (n.mount.slew) mb.status.append(h('span', { class: 'chip act' }, '● Slewing…'));
    if (RT.R.activity && !n.mount.slew) mb.status.append(h('span', { class: 'chip act' }, '● ' + RT.R.activity));
    if (exTxt) mb.status.append(h('span', { class: 'chip rec' }, exTxt));
    if (n.capOn) mb.status.append(h('span', { class: 'chip warn', title: 'Lens cap is on!' }, 'cap on'));
    if (n.dew > 0.2) mb.status.append(h('span', { class: 'chip warn' }, 'dew!'));
    diskChip();
  } else {
    mb.batt.textContent = '100%'; mb.batt.classList.remove('low');
    mb.status.innerHTML = ''; mb.status.append(h('span', { class: 'chip' }, 'Home · daytime'), h('span', { class: 'chip' }, isSandbox() ? 'Sandbox' : 'Open Weather to plan tonight'));
    diskChip();
  }
}

let diskT = 0, diskU = null;
function diskChip() {
  if (!diskU || performance.now() - diskT > 3000) { diskT = performance.now(); diskU = usage(); }
  const f = diskU.used / diskU.cap;
  if (f > 0.8) mb.status.append(h('span', { class: 'chip' + (f > 0.95 ? ' warn' : ''), title: 'Open Files to free up space', onclick: () => openApp('files') }, `💾 ${fmtBytes(Math.max(0, diskU.free))} free`));
}
// ---------------- desktop widget ----------------
let widget;
function buildWidget(desktop) { widget = h('div', { class: 'widget' }); desktop.append(widget); updateWidget(); }
function updateWidget() {
  const s = G.s; if (!widget || !s) return;
  widget.innerHTML = '';
  const n = s.night; const ri = S.rig();
  if (!n) {
    widget.append(h('div', { class: 'w-title' }, isSandbox() ? 'Sandbox' : 'Tonight'), h('div', { class: 'small' }, isSandbox() ? 'All gear unlocked · unlimited money' : `Money: ${money(s.money)} · Reputation ${Math.round(s.rep)}`),
      h('div', { class: 'small muted' }, `${ri.mount ? ri.mount.name : ''}`), h('div', { class: 'small muted' }, `${ri.opt ? ri.opt.name : ''}`), h('div', { class: 'small muted' }, `${ri.cam ? ri.cam.name : ''}`),
      h('button', { class: 'btn primary small', style: { marginTop: '8px' }, onclick: () => openApp('weather') }, 'Plan tonight →'));
    return;
  }
  const loc = LOC[n.loc]; const ev = n.events; const p = S.pointing();
  widget.append(...[h('div', { class: 'w-title' }, 'Session'),
    h('div', { class: 'small' }, `Sunset ${ev.sunStart ? fmtTime(ev.sunStart, loc.tz) : '—'} · Dark ${ev.astroStart ? fmtTime(ev.astroStart, loc.tz) : '—'}–${ev.astroEnd ? fmtTime(ev.astroEnd, loc.tz) : '—'}`),
    h('div', { class: 'small' }, `Target: ${s.target ? s.target.name : '—'}`),
    p ? h('div', { class: 'small muted' }, `Rig → alt ${p.alt.toFixed(1)}° az ${p.az.toFixed(1)}° ${n.mount.tracking ? '· tracking' : '· not tracking'}${n.mount.slew ? ' · slewing' : ''}`) : null,
    h('div', { class: 'small muted' }, `Frames tonight: ${s.frames.filter((f) => f.session === n.id).length}`),
    RT.R.seq && RT.R.seq.state.running ? h('div', { class: 'small' }, `Sequencer: ${RT.R.seq.state.status}`) : null,
    n.guider.guiding ? h('div', { class: 'small' }, `Guiding RMS ${n.guider.rms.toFixed(2)}″`) : null].filter(Boolean));
}

// ---------------- loop ----------------
let last = performance.now(), lastUI = 0, lastErr = 0;
// Never let one error freeze the clock: log it, tell the player once in a while, keep going.
function reportError(e) { console.error(e); if (Date.now() - lastErr > 15000) { lastErr = Date.now(); toast(`Something went wrong (the game keeps running): ${e && e.message ? e.message : e}`, 'bad', 9000); } }
window.__reportError = reportError;
function loop() {
  const now = performance.now();
  let dt = Math.min(1, (now - last) / 1000); last = now;
  if (G.s.mode === 'night' && MP.role !== 'client' && !(isPaused() && MP.role === 'solo')) {
    if (ffActive) {
      const ex = S.T.exposure;
      if (ex && !ex.rendering) dt = Math.max(dt, (ex.end - G.s.time) / 1000 / S.T.warp);
      else if (S.T.waiters.length) dt = Math.max(dt, Math.min(...S.T.waiters.map((w) => w.until - G.s.time)) / 1000 / S.T.warp);
      else if (!(RT.R.seq && RT.R.seq.state.running)) { ffActive = false; mb.ff.classList.remove('on'); }
    }
    try { S.tick(dt); } catch (e) { reportError(e); }
  }
  if (now - lastUI > 250) { lastUI = now; try { updateMenubar(); updateWidget(); S.refreshBodyTarget(); updateAudio(); } catch (e) { reportError(e); } }
  setTimeout(loop, 33);
}
setInterval(() => save(), 20000);
// earnings from the global StarShare community (likes & print sales by other players)
setInterval(() => { if (G.s && G.s.mode) syncEarnings().then((r) => { if (r && r.amount) toast(`🌍 StarShare community: +${money(r.amount)} from likes & print sales`, 'good', 7000); }).catch(() => {}); }, 300000);
window.addEventListener('beforeunload', () => save(true));

armAudio();
window.addEventListener('fl-prefs', () => applyVolumes());
setBodyLookup((name) => (G.s && G.s.location ? S.bodyInfo(name) : null));
window.__dbg = { S, G, RT, A, MP, IM, openApp };
main().catch((e) => { console.error(e); say('Failed to start: ' + e.message); });
void emit;
