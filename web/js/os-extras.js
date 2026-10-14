// AstroOS extras: Spotlight search (⌘K / Ctrl+Space) and the Notification Center (click the clock).
import { h, openApp, appDefs, NOTES, toast } from './wm.js';
import * as A from './astro.js';
import { G, save, fmtTime } from './state.js';
import { findLocal, TYPE_LABEL } from './catalog.js';
import { LOC } from './gear.js';
import * as S from './session.js';

// ---------------------------------------------------------------- Spotlight
let spot = null;
export function toggleSpotlight(actions = []) {
  if (spot) { closeSpot(); return; }
  const input = h('input', { class: 'spot-in', placeholder: 'Spotlight — apps, sky objects, actions…', spellcheck: false });
  const list = h('div', { class: 'spot-list' });
  const box = h('div', { class: 'spot' }, h('div', { class: 'spot-bar' }, h('span', { class: 'spot-glass', html: '<svg viewBox="0 0 20 20" width="18" height="18"><circle cx="8.5" cy="8.5" r="5.8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' }), input), list);
  const ov = h('div', { class: 'spot-ov', onmousedown: (e) => { if (e.target === ov) closeSpot(); } }, box);
  document.body.append(ov); spot = ov;
  let items = [], sel = 0;
  const loc = () => (G.s.night ? S.locNow() : LOC[G.s.location] || LOC.backyard);
  function search() {
    const q = input.value.trim().toLowerCase();
    items = [];
    const apps = Object.values(appDefs()).filter((a) => !a.hidden);
    for (const a of apps) if (!q || a.title.toLowerCase().includes(q)) items.push({ kind: 'App', icon: a.icon, title: a.title, sub: 'Application', run: () => openApp(a.id) });
    for (const ac of actions) if (q && (ac.title.toLowerCase().includes(q) || (ac.keys || '').includes(q)) && (!ac.when || ac.when())) items.push({ kind: 'Action', title: ac.title, sub: ac.sub || 'Action', run: ac.run, glyph: '⚡' });
    if (q.length >= 2) {
      const L = A.lst(G.s.time, loc().lon);
      for (const o of findLocal(q).slice(0, 8)) {
        const alt = A.radec2altaz(o.ra, o.dec, L, loc().lat).alt;
        items.push({ kind: 'Sky', title: o.id !== o.name ? `${o.id} — ${o.name}` : o.name, sub: `${TYPE_LABEL[o.type] || o.type || ''} · ${alt > 0 ? `${alt.toFixed(0)}° up` : 'below horizon'}`, glyph: o.body ? '🪐' : o.kind === 'star' ? '✦' : '✺',
          run: () => { S.setTarget(o); openApp('planetarium', o); toast(`Target set: ${o.name}`, 'info', 2200); } });
      }
    }
    if (!q) items = items.slice(0, 9);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    draw();
  }
  function draw() {
    list.innerHTML = '';
    let lastKind = null;
    items.forEach((it, i) => {
      if (it.kind !== lastKind) { list.append(h('div', { class: 'spot-sec' }, it.kind === 'App' ? 'Applications' : it.kind === 'Sky' ? 'Sky objects' : 'Actions')); lastKind = it.kind; }
      list.append(h('div', { class: 'spot-item' + (i === sel ? ' on' : ''), onmouseenter: () => { sel = i; draw(); }, onclick: () => go(i) },
        it.icon ? h('span', { class: 'spot-ico', html: it.icon }) : h('span', { class: 'spot-ico glyph' }, it.glyph || '•'),
        h('div', { class: 'spot-t' }, h('b', {}, it.title), h('span', {}, it.sub))));
    });
    if (!items.length) list.append(h('div', { class: 'spot-empty' }, 'No results'));
  }
  function go(i) { const it = items[i]; closeSpot(); if (it) setTimeout(() => it.run(), 10); }
  input.addEventListener('input', () => { sel = 0; search(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter') go(sel);
    if (e.key === 'Escape') closeSpot();
  });
  search(); setTimeout(() => input.focus(), 0);
}
function closeSpot() { if (spot) { spot.remove(); spot = null; } }
export const spotlightOpen = () => !!spot;

// ---------------------------------------------------------------- Notification Center
let nc = null;
export function toggleNotifications() {
  if (nc) { nc.classList.add('out'); const x = nc; nc = null; setTimeout(() => x.remove(), 220); return; }
  nc = h('div', { class: 'nc' });
  render();
  document.body.append(nc);
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (nc && !nc.contains(e.target) && !e.target.closest('.mb-clock')) { toggleNotifications(); } if (!nc) document.removeEventListener('mousedown', off); }), 0);
  document.addEventListener('notes', render);
}
function render() {
  if (!nc) return;
  nc.innerHTML = '';
  const s = G.s; const loc = s.night ? S.locNow() : LOC[s.location] || LOC.backyard;
  // widgets
  const e = s.night ? S.envAt(s.time) : null;
  const ph = A.moonPhase(s.time);
  const w1 = h('div', { class: 'nc-w' }, h('div', { class: 'nc-wt' }, 'Sky now'),
    h('div', { class: 'nc-big' }, `${Math.round(ph.illum * 100)}%`, h('span', {}, ` Moon · ${ph.waxing ? 'waxing' : 'waning'}`)),
    e ? h('div', { class: 'small' }, `${e.sunAlt < -18 ? 'Dark' : e.sunAlt < -0.8 ? 'Twilight' : 'Daylight'} · ☁ ${Math.round(e.clouds * 100)}% · seeing ${e.seeing.toFixed(1)}″ · Kp ${e.kp.toFixed(1)}${e.aurora && e.aurora.strength > 0.05 ? ' · aurora!' : ''}`) : h('div', { class: 'small' }, `${loc.name} · Bortle ${loc.bortle}`));
  const L = A.lst(s.time, loc.lon);
  const up = ['Venus', 'Mars', 'Jupiter', 'Saturn'].map((nm) => ({ nm, alt: A.radec2altaz(S.bodyInfo(nm).ra, S.bodyInfo(nm).dec, L, loc.lat).alt })).filter((x) => x.alt > 5);
  const w2 = h('div', { class: 'nc-w' }, h('div', { class: 'nc-wt' }, 'Planets up'), up.length ? h('div', { class: 'nc-chips' }, ...up.map((x) => h('span', { class: 'nc-chip', onclick: () => openApp('planetarium', { id: x.nm, name: x.nm, ...S.bodyInfo(x.nm), body: x.nm }) }, `${x.nm} ${x.alt.toFixed(0)}°`))) : h('div', { class: 'small muted' }, 'None above the horizon right now.'));
  nc.append(h('div', { class: 'nc-head' }, h('b', {}, 'Notifications'), h('button', { class: 'nc-clear', onclick: () => { NOTES.length = 0; render(); } }, 'Clear')), w1, w2);
  if (!NOTES.length) nc.append(h('div', { class: 'nc-empty' }, 'No notifications'));
  const tz = loc.tz;
  for (const n of NOTES.slice(0, 40)) nc.append(h('div', { class: 'nc-n ' + n.kind }, h('div', { class: 'nc-n-t' }, n.msg), h('div', { class: 'nc-n-at' }, ago(n.at))));
  void tz; void fmtTime; void save;
}
function ago(t) { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`; }
