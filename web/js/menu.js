// Main menu, pause menu, saves browser, multiplayer lobby, settings and credits.
import { h, confirmDlg } from './wm.js';
import * as A from './astro.js';
import { listSlots, deleteSlot, G } from './state.js';
import { cat, bvToRGB } from './catalog.js';
import { money } from './gear.js';
import { MP, hasLan, LAN_PORT } from './mp.js';

export const PREFS = loadPrefs();
// v0.2 renders at 2048 px by default; lift saves still on the old 1024 default once
if (!PREFS.resV2) { if ((PREFS.quality || 0) < 2048) PREFS.quality = 2048; PREFS.resV2 = true; try { localStorage.setItem('fl-prefs', JSON.stringify(PREFS)); } catch { /* ignore */ } }
function loadPrefs() { try { return { quality: 2048, nightMode: false, sens: 1, hudScale: 1, name: '', volMaster: 0.8, volAmb: 0.7, volSfx: 0.8, ...JSON.parse(localStorage.getItem('fl-prefs') || '{}') }; } catch { return { quality: 2048, nightMode: false, sens: 1, hudScale: 1, name: '' }; } }
export function savePrefs() { try { localStorage.setItem('fl-prefs', JSON.stringify(PREFS)); } catch { /* ignore */ } applyPrefs(); window.dispatchEvent(new Event('fl-prefs')); }
export function applyPrefs() { document.documentElement.style.setProperty('--hud-scale', PREFS.hudScale); }

export function quitApp() {
  try { const t = window.__TAURI__; if (t && t.window) { t.window.getCurrentWindow().close(); return; } } catch { /* ignore */ }
  window.close();
}

// ---------------------------------------------------------------- star field backdrop
function starfield(canvas) {
  let raf = 0, t0 = performance.now();
  const draw = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1); const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const lat = 38, L = ((performance.now() - t0) / 1000 * 0.25 + 300) % 360; // slow sidereal drift
    const R = Math.max(W, H) * 0.62, cx = W * 0.62, cy = H * 0.98;
    const P = (ra, dec) => { const aa = A.radec2altaz(ra, dec, L, lat); if (aa.alt < -2) return null; const r = R * Math.tan((90 - aa.alt) * A.D2R / 2) * 1.2; const az = (aa.az - 160) * A.D2R; return [cx + r * Math.sin(az), cy - r * Math.cos(az)]; };
    if (cat.loaded) {
      g.globalCompositeOperation = 'lighter';
      for (const poly of cat.mw) { if (poly.lvl < 2) continue; g.beginPath(); let ok = true, st = false; for (const [ra, dec] of poly.pts) { const p = P(ra, dec); if (!p) { ok = false; break; } st ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); st = true; } if (ok) { g.fillStyle = 'rgba(140,160,210,0.022)'; g.fill(); } }
      for (const s of cat.stars) { if (s.mag > 6) break; const p = P(s.ra, s.dec); if (!p || p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) continue; const [r, gg, b] = bvToRGB(s.bv); const a = Math.min(1, 0.25 + (6 - s.mag) * 0.2); g.fillStyle = `rgba(${r * 255 | 0},${gg * 255 | 0},${b * 255 | 0},${a})`; g.beginPath(); g.arc(p[0], p[1], Math.max(0.5, (6.2 - s.mag) * 0.42), 0, 7); g.fill(); }
      g.globalCompositeOperation = 'source-over';
    }
    // horizon silhouette
    g.fillStyle = '#020304'; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) g.lineTo(x, H - 36 - 14 * Math.sin(x * 0.006) - 9 * Math.sin(x * 0.021 + 1) - (Math.sin(x * 0.13) > 0.7 ? 18 : 0));
    g.lineTo(W, H); g.fill();
    raf = requestAnimationFrame(draw);
  };
  draw();
  return () => cancelAnimationFrame(raf);
}

// ---------------------------------------------------------------- main menu
let root = null, stopStars = null;
export function hideMainMenu() { if (root) { root.remove(); root = null; } if (stopStars) stopStars(); }

export async function showMainMenu(cb) {
  hideMainMenu();
  const canvas = h('canvas', { class: 'menu-stars' });
  const side = h('div', { class: 'menu-side' });
  const btns = h('div', { class: 'menu-buttons' });
  root = h('div', { class: 'menu-root ui-av' }, canvas, h('div', { class: 'menu-shade' }),
    h('div', { class: 'menu-panel main' }, h('div', { class: 'title' }, 'First Light'), h('div', { class: 'subtitle' }, 'Astrophotography simulator'), btns, h('div', { class: 'version' }, 'v0.3.0 · real sky data: CDS · NASA GIBS · Hipparcos')), side);
  document.body.append(root);
  stopStars = starfield(canvas);
  const slots = await listSlots();
  const showPanel = (el) => { side.innerHTML = ''; if (el) side.append(el); };
  const add = (label, fn, dis) => btns.append(h('button', { disabled: !!dis, onclick: fn }, label));
  if (slots.length) add(`Continue — ${slots[0].name}`, () => cb.onStart(slots[0].id));
  add('New game', () => showPanel(newGamePanel(cb)));
  add('Load game', () => showPanel(loadPanel(cb, slots)), !slots.length);
  add('Multiplayer', () => showPanel(mpPanel(cb, slots)));
  add('Settings', () => showPanel(settingsPanel()));
  add('Credits', () => showPanel(creditsPanel()));
  add('Quit', () => quitApp());
}

const panel = (title, ...kids) => h('div', { class: 'menu-panel' }, h('h2', {}, title), ...kids);

function newGamePanel(cb) {
  let mode = 'career';
  const name = h('input', { class: 'av-in', value: 'Career 1', maxlength: 40 });
  const card = (m, t, desc) => h('button', { class: 'mission' + (mode === m ? ' on' : ''), onclick: (e) => { mode = m; name.value = m === 'career' ? 'Career 1' : 'Sandbox'; e.currentTarget.parentElement.querySelectorAll('.mission').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } },
    h('div', { class: 'mission-name' }, t), h('div', { class: 'mission-desc' }, desc));
  return panel('New game',
    h('div', { class: 'mission-list' },
      card('career', 'Career', 'Start in your backyard with an old DSLR, a kit lens, a photo tripod and $300. Sell images and complete challenges to afford trackers, telescopes, cooled cameras and trips to the darkest places on Earth.'),
      card('sandbox', 'Sandbox', 'Unlimited money. Every camera, lens, telescope, mount, filter and accessory unlocked. Travel anywhere for free and optionally switch on always-clear skies.')),
    h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Save name'), name),
    h('div', { class: 'menu-footer' }, h('button', { class: 'primary', onclick: () => cb.onNew(name.value.trim() || 'Untitled', mode) }, 'Start')));
}

function slotRow(s, actions) {
  const when = new Date(s.updated);
  return h('div', { class: 'save-row' },
    h('div', { class: 'mission' }, h('div', { class: 'mission-name' }, s.name), h('div', { class: 'mission-epoch' }, s.gameMode === 'sandbox' ? 'SANDBOX' : 'CAREER'),
      h('div', { class: 'mission-desc mono' }, `${s.gameMode === 'sandbox' ? '∞' : money(s.money)} · ${s.nights || 0} nights · ${s.frames || 0} frames · saved ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)),
    h('div', { class: 'save-actions' }, ...actions));
}
function loadPanel(cb, slots) {
  const list = h('div', { class: 'mission-list' });
  for (const s of slots) list.append(slotRow(s, [
    h('button', { class: 'primary', onclick: () => cb.onStart(s.id) }, 'Load'),
    h('button', { onclick: async () => { if (await confirmDlg('Delete save', `Delete “${s.name}” permanently?`, 'Delete')) { await deleteSlot(s.id); list.querySelector(`[data-id="${s.id}"]`); cb.onRefresh(); } } }, 'Delete')]));
  return panel('Load game', slots.length ? list : h('div', { class: 'note' }, 'No saves yet.'));
}

function mpPanel(cb, slots) {
  const name = h('input', { class: 'av-in', value: PREFS.name || '', placeholder: 'Your name', maxlength: 24 });
  const code = h('input', { class: 'av-in mono', placeholder: 'ROOM CODE  or  192.168.1.20', maxlength: 40, style: { letterSpacing: '0.12em' } });
  const status = h('div', { class: 'note' });
  const remember = () => { PREFS.name = name.value.trim(); savePrefs(); return PREFS.name || 'Observer'; };
  let hostSlot = slots[0] ? slots[0].id : null;
  const hostList = h('div', { class: 'mission-list compact' });
  for (const s of slots) hostList.append(h('button', { class: 'mission' + (s.id === hostSlot ? ' on' : ''), onclick: (e) => { hostSlot = s.id; hostList.querySelectorAll('.mission').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, h('div', { class: 'mission-name' }, s.name), h('div', { class: 'mission-epoch' }, s.gameMode.toUpperCase())));
  return panel('Multiplayer',
    h('div', { class: 'note' }, 'Co-op: friends join the host’s night. Everyone stands at the same rig under the same sky — one of you can turn the focus knob outside while another loops exposures on the laptop. The host’s save keeps the gear, money and frames; guests can stack and process the shared frames during the session.'),
    h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Your name'), name),
    h('h2', { style: { marginTop: '22px' } }, 'Host a game'),
    slots.length ? hostList : h('div', { class: 'note' }, 'Create a save first (New game), then host it.'),
    h('div', { class: 'menu-footer' },
      h('button', { disabled: !slots.length || !hasLan(), title: hasLan() ? `Friends on your Wi-Fi/network join with your IP address (port ${LAN_PORT})` : 'LAN play needs the desktop app', onclick: () => cb.onHost(hostSlot, remember(), true) }, 'Host on LAN'),
      h('button', { class: 'primary', disabled: !slots.length, onclick: () => cb.onHost(hostSlot, remember(), false) }, 'Host online')),
    h('h2', { style: { marginTop: '22px' } }, 'Join a game'),
    h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Room code or host IP'), code, h('span', { class: 'setting-hint' }, 'Online: the 6-letter code. LAN: the host’s address shown in their HUD, e.g. 192.168.1.20 (port optional).')),
    h('div', { class: 'menu-footer' }, h('button', { class: 'primary', onclick: async () => { status.textContent = 'Connecting…'; try { const v = code.value.trim(); await cb.onJoin(/[.:]/.test(v) ? v : v.toUpperCase(), remember()); } catch (e) { status.textContent = '⚠ ' + e.message; } } }, 'Join')),
    status,
    h('div', { class: 'setting-hint', style: { marginTop: '10px' } }, `Online: peer-to-peer (WebRTC); the free PeerJS service only introduces players. LAN: direct connection on port ${LAN_PORT} — the host’s computer may ask to allow incoming connections (macOS firewall); click Allow.`));
}

export function settingsPanel(onChange) {
  const sl = (label, key, min, max, step, fmt = (v) => v) => {
    const val = h('span', { class: 'slider-value' }, fmt(PREFS[key]));
    return h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, label), h('div', { class: 'slider' }, h('input', { type: 'range', min, max, step, value: PREFS[key], oninput: (e) => { PREFS[key] = +e.target.value; val.textContent = fmt(PREFS[key]); savePrefs(); onChange && onChange(); } }), val));
  };
  const sel = h('select', { onchange: (e) => { PREFS.quality = +e.target.value; savePrefs(); if (G.s) G.s.settings.quality = PREFS.quality; } }, ...[[1024, '1024 px (fast)'], [1600, '1600 px'], [2048, '2048 px (default)'], [3072, '3072 px (ultra, slower)'], [4096, '4096 px (extreme: slow, needs lots of RAM)']].map(([v, l]) => { const o = h('option', { value: v }, l); if (v === PREFS.quality) o.selected = true; return o; }));
  const red = h('input', { type: 'checkbox', checked: PREFS.nightMode, onchange: (e) => { PREFS.nightMode = e.target.checked; savePrefs(); document.body.classList.toggle('nightmode', PREFS.nightMode); if (G.s) G.s.settings.nightMode = PREFS.nightMode; } });
  return panel('Settings',
    h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Simulation resolution'), sel, h('span', { class: 'setting-hint' }, 'Long side of every simulated frame. Higher = more detail, slower.')),
    h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Red night-vision mode'), h('label', {}, red)),
    sl('Mouse sensitivity', 'sens', 0.3, 2.5, 0.05, (v) => v.toFixed(2) + '×'),
    sl('HUD scale', 'hudScale', 0.8, 1.4, 0.05, (v) => Math.round(v * 100) + '%'),
    sl('Master volume', 'volMaster', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'),
    sl('Ambience (wind, crickets, traffic)', 'volAmb', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'),
    sl('Effects (shutter, motors, UI)', 'volSfx', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'),
    h('table', { class: 'keys' }, ...[['Click / drag', 'Look around (Esc frees the mouse)'], ['W A S D', 'Walk (Shift to hurry)'], ['E', 'Interact'], ['R', 'Rig controls'], ['F', 'Red headlamp'], [', .', 'Time warp down / up'], ['Tab', 'Laptop ↔ outside'], ['Enter', 'Chat (multiplayer)'], ['F2', 'Hide HUD'], ['Esc', 'Pause menu']].map(([k, v]) => h('tr', {}, h('td', { class: 'key' }, k), h('td', {}, v)))));
}
function creditsPanel() {
  const c = (what, who) => h('div', {}, h('div', { class: 'credit-what' }, what), h('div', { class: 'credit-who' }, who));
  return panel('Credits', h('div', { class: 'credits' },
    c('Sky imagery — DSS2 colour & Mellinger all-sky HiPS via hips2fits', 'CDS, Université de Strasbourg / CNRS · STScI Digitized Sky Survey · Axel Mellinger'),
    c('Object name resolver — Sesame (SIMBAD, NED, VizieR)', 'CDS, Université de Strasbourg / CNRS'),
    c('Night lights & land cover — VIIRS Black Marble, Blue Marble', 'NASA Global Imagery Browse Services (GIBS), EOSDIS'),
    c('Star catalogue, constellations, Milky Way outline', 'd3-celestial data (Olaf Frohn), Hipparcos / Yale BSC derived'),
    c('Sky brightness model', 'Krisciunas & Schaefer (1991), Walker’s law'),
    c('3D engine', 'three.js'), c('Networking', 'PeerJS / WebRTC'), c('Typeface', 'IBM Plex (SIL Open Font License)')));
}

// ---------------------------------------------------------------- pause menu
let pauseEl = null;
export function isPaused() { return !!pauseEl; }
export function hidePause() { if (pauseEl) { pauseEl.remove(); pauseEl = null; } }
export function showPause(cb) {
  if (pauseEl) return hidePause();
  const side = h('div', { class: 'menu-side' });
  const btns = h('div', { class: 'menu-buttons' });
  const add = (label, fn, dis) => btns.append(h('button', { disabled: !!dis, onclick: fn }, label));
  add('Resume', () => hidePause());
  if (MP.role !== 'client') add('Save game', async () => { await cb.onSave(); flash('Saved.'); });
  if (MP.role === 'solo') { add('Invite friends online', () => cb.onHost(false)); add('Host on LAN (same network)', () => cb.onHost(true), !hasLan()); }
  if (MP.role !== 'solo') add(MP.role === 'host' ? 'Stop hosting & main menu' : 'Leave game', () => cb.onLeave());
  add('Settings', () => { side.innerHTML = ''; side.append(settingsPanel(cb.onPrefs)); });
  add('Save & exit to main menu', () => cb.onMain());
  add('Quit to desktop', () => cb.onQuit());
  const flashEl = h('div', { class: 'note', style: { marginTop: '14px', minHeight: '1.5em' } });
  const flash = (t) => { flashEl.textContent = t; setTimeout(() => (flashEl.textContent = ''), 1800); };
  const info = G.s ? h('div', { class: 'subtitle' }, `${G.s.saveName || 'Guest session'} · ${G.s.gameMode === 'sandbox' ? 'Sandbox' : 'Career'}${MP.role !== 'solo' ? ` · co-op ${MP.code}` : ''}`) : null;
  const mpBox = MP.role !== 'solo' ? panel('Co-op', h('div', { class: 'note' }, MP.role === 'host' ? (MP.lan ? 'Friends on the same network join from Main menu → Multiplayer → Join with this address:' : 'Friends join from Main menu → Multiplayer → Join with this code:') : 'Connected to the host’s game.'), h('div', { class: 'room-code mono' }, MP.code || ''),
    ...Object.values(MP.players).map((p) => h('div', { class: 'row' }, h('span', { style: { color: p.color } }, `● ${p.name}${p.host ? ' (host)' : ''}`)))) : null;
  if (mpBox) side.append(mpBox);
  pauseEl = h('div', { class: 'menu-root pause ui-av' }, h('div', { class: 'menu-shade solid' }), h('div', { class: 'menu-panel main' }, h('div', { class: 'title small' }, 'Paused'), info, btns, flashEl), side);
  document.body.append(pauseEl);
}
