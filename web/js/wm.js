// "AstroOS" — window manager, dock, dialogs, toasts and a tiny DOM helper.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

const apps = {};
const wins = {};
let zTop = 10;
let desktopEl, dockEl;

export function registerApp(id, def) { apps[id] = { id, ...def }; }
export function appDefs() { return apps; }
export function isOpen(id) { return !!wins[id]; }
export { closeApp as closeWindow };
export function getWin(id) { return wins[id]; }

export function initWM(desktop, dock) {
  desktopEl = desktop; dockEl = dock;
  renderDock();
}

export function renderDock() {
  dockEl.innerHTML = '';
  for (const a of Object.values(apps)) {
    if (a.hidden) continue;
    const item = h('div', { class: 'dock-item' + (wins[a.id] ? ' running' : ''), title: a.title, onclick: () => openApp(a.id) },
      h('div', { class: 'dock-icon', html: a.icon }), h('div', { class: 'dock-label' }, a.title));
    if (a.badge) { const b = a.badge(); if (b) item.append(h('div', { class: 'dock-badge' }, String(b))); }
    dockEl.append(item);
  }
}

export function openApp(id, arg) {
  const a = apps[id]; if (!a) return;
  if (!wins[id]) window.dispatchEvent(new CustomEvent('fl-sfx', { detail: { name: 'open' } }));
  if (wins[id]) { const w = wins[id]; w.el.style.display = ''; focus(w); w.minimized = false; if (w.api && w.api.onArg && arg !== undefined) w.api.onArg(arg); renderDock(); return w; }
  const W = Math.min(a.width || 800, desktopEl.clientWidth - 20), H = Math.min(a.height || 560, desktopEl.clientHeight - 20);
  const n = Object.keys(wins).length;
  const x = a.x ?? Math.max(10, Math.min(desktopEl.clientWidth - W - 10, 60 + n * 28 + Math.random() * 40));
  const y = a.y ?? Math.max(10, Math.min(desktopEl.clientHeight - H - 10, 30 + n * 24));
  const body = h('div', { class: 'win-body' + (a.bodyClass ? ' ' + a.bodyClass : '') });
  const title = h('div', { class: 'win-title' },
    h('div', { class: 'win-btns' },
      h('span', { class: 'wb close', title: 'Close', onclick: (e) => { e.stopPropagation(); closeApp(id); } }),
      h('span', { class: 'wb min', title: 'Minimize', onclick: (e) => { e.stopPropagation(); minimize(id); } }),
      h('span', { class: 'wb max', title: 'Zoom', onclick: (e) => { e.stopPropagation(); toggleMax(id); } })),
    h('div', { class: 'win-title-text' }, h('span', { class: 'win-ico', html: a.icon }), a.title));
  const grip = h('div', { class: 'win-grip' });
  const el = h('div', { class: 'win', style: { left: x + 'px', top: y + 'px', width: W + 'px', height: H + 'px' } }, title, body, grip);
  desktopEl.append(el);
  const w = { id, el, body, title, api: null, minimized: false };
  wins[id] = w;
  el.addEventListener('mousedown', () => focus(w));
  dragify(title, el, w);
  resizify(grip, el, w, a);
  title.addEventListener('dblclick', () => toggleMax(id));
  focus(w);
  try { w.api = a.open(body, w, arg) || {}; } catch (e) { console.error(e); body.append(h('pre', { class: 'err' }, String(e.stack || e))); }
  renderDock();
  return w;
}
export function closeApp(id) {
  const w = wins[id]; if (!w) return;
  try { w.api && w.api.onClose && w.api.onClose(); } catch (e) { console.error(e); }
  w.el.remove(); delete wins[id]; renderDock();
}
function minimize(id) { const w = wins[id]; if (!w) return; w.el.style.display = 'none'; w.minimized = true; renderDock(); }
function toggleMax(id) {
  const w = wins[id]; if (!w) return;
  w.el.classList.add('snapping');
  if (w.prev) { Object.assign(w.el.style, w.prev); w.prev = null; }
  else { w.prev = { left: w.el.style.left, top: w.el.style.top, width: w.el.style.width, height: w.el.style.height }; Object.assign(w.el.style, { left: '0px', top: '0px', width: desktopEl.clientWidth + 'px', height: desktopEl.clientHeight + 'px' }); }
  setTimeout(() => { w.el.classList.remove('snapping'); w.api && w.api.onResize && w.api.onResize(); }, 220);
}
function focus(w) {
  w.el.style.zIndex = ++zTop;
  for (const o of Object.values(wins)) o.el.classList.toggle('focused', o === w);
  document.dispatchEvent(new CustomEvent('appfocus', { detail: w.id }));
}
// Drag windows by the title bar. Like macOS: drag to the top edge to fill the screen, to the left/right edge
// to tile into that half; dragging a tiled window restores its previous size.
let snapGhost = null;
function snapZone(x, y) {
  const r = desktopEl.getBoundingClientRect();
  if (y - r.top < 6) return 'max';
  if (x - r.left < 8) return 'left';
  if (r.right - x < 8) return 'right';
  return null;
}
function zoneRect(z) {
  const W = desktopEl.clientWidth, H = desktopEl.clientHeight, g = 6;
  if (z === 'max') return { left: 0, top: 0, width: W, height: H };
  if (z === 'left') return { left: g, top: g, width: W / 2 - g * 1.5, height: H - 2 * g };
  return { left: W / 2 + g / 2, top: g, width: W / 2 - g * 1.5, height: H - 2 * g };
}
function dragify(handle, el, w) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('wb') || e.button !== 0) return;
    let sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop, zone = null, moved = false;
    handle.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      if (!moved && w.prev) { // un-tile: restore size, keep the grab point under the cursor
        const f = (ev.clientX - el.getBoundingClientRect().left) / el.offsetWidth;
        Object.assign(el.style, { width: w.prev.width, height: w.prev.height }); w.prev = null; w.api && w.api.onResize && w.api.onResize();
        ox = ev.clientX - desktopEl.getBoundingClientRect().left - f * el.offsetWidth; oy = 0; sx = ev.clientX; sy = ev.clientY;
      }
      moved = true; el.classList.add('dragging');
      el.style.left = Math.max(-el.offsetWidth + 80, Math.min(desktopEl.clientWidth - 80, ox + ev.clientX - sx)) + 'px'; el.style.top = Math.max(0, Math.min(desktopEl.clientHeight - 30, oy + ev.clientY - sy)) + 'px';
      const z = snapZone(ev.clientX, ev.clientY);
      if (z !== zone) {
        zone = z;
        if (!snapGhost) { snapGhost = h('div', { class: 'snap-ghost' }); desktopEl.append(snapGhost); }
        if (z) { const R = zoneRect(z); Object.assign(snapGhost.style, { left: R.left + 'px', top: R.top + 'px', width: R.width + 'px', height: R.height + 'px', zIndex: zTop - 1 }); snapGhost.classList.add('on'); }
        else snapGhost.classList.remove('on');
      }
    };
    const up = () => {
      handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); el.classList.remove('dragging');
      if (snapGhost) snapGhost.classList.remove('on');
      if (zone) {
        w.prev = w.prev || { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
        const R = zoneRect(zone); el.classList.add('snapping'); Object.assign(el.style, { left: R.left + 'px', top: R.top + 'px', width: R.width + 'px', height: R.height + 'px' });
        setTimeout(() => { el.classList.remove('snapping'); w.api && w.api.onResize && w.api.onResize(); }, 220);
      }
    };
    handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
  });
}
function resizify(grip, el, w, a) {
  grip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = el.offsetWidth, oh = el.offsetHeight;
    grip.setPointerCapture(e.pointerId);
    const mv = (ev) => { el.style.width = Math.max(a.minW || 320, ow + ev.clientX - sx) + 'px'; el.style.height = Math.max(a.minH || 200, oh + ev.clientY - sy) + 'px'; w.api && w.api.onResize && w.api.onResize(); };
    const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); w.api && w.api.onResize && w.api.onResize(); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
  });
}

// ---------- toasts ----------
let toastArea;
export const NOTES = []; // notification history (for the Notification Center)
export function toast(msg, kind = 'info', ms = 4500) {
  NOTES.unshift({ msg: String(msg), kind, at: Date.now() }); if (NOTES.length > 60) NOTES.pop();
  document.dispatchEvent(new CustomEvent('notes'));
  if (!toastArea) { toastArea = h('div', { class: 'toasts' }); document.body.append(toastArea); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  window.dispatchEvent(new CustomEvent('fl-sfx', { detail: { name: 'toast', kind } }));
  toastArea.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// ---------- dialogs ----------
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], width = 420 }) {
  return new Promise((resolve) => {
    const ov = h('div', { class: 'modal-ov' });
    const box = h('div', { class: 'modal', style: { width: width + 'px' } }, h('div', { class: 'modal-title' }, title || ''));
    const content = h('div', { class: 'modal-body' }); if (typeof body === 'string') content.innerHTML = body; else if (body) content.append(body);
    box.append(content);
    const btns = h('div', { class: 'modal-btns' });
    for (const b of buttons) btns.append(h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => { ov.remove(); resolve(typeof b.value === 'function' ? b.value() : b.value); } }, b.label));
    box.append(btns); ov.append(box); document.body.append(ov);
    const first = box.querySelector('input,select'); if (first) first.focus();
  });
}
export const confirmDlg = (title, text, ok = 'OK') => dialog({ title, body: text, buttons: [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: true }] });
export async function promptDlg(title, label, def = '') {
  const inp = h('input', { class: 'inp', value: def, style: { width: '100%' } });
  const r = await dialog({ title, body: h('div', {}, h('div', { class: 'muted', style: { marginBottom: '6px' } }, label), inp), buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: () => inp.value, primary: true }] });
  return r;
}

// ---------- small widgets ----------
export function field(label, input, hint) { return h('label', { class: 'field' }, h('span', { class: 'field-l' }, label), input, hint ? h('span', { class: 'field-h' }, hint) : null); }
export function select(options, value, onchange, attrs = {}) {
  const s = h('select', { class: 'inp', ...attrs, onchange: (e) => onchange(e.target.value) });
  for (const o of options) { const [v, l] = Array.isArray(o) ? o : [o, o]; const op = h('option', { value: v }, l); if (String(v) === String(value)) op.selected = true; s.append(op); }
  return s;
}
export function num(value, onchange, attrs = {}) {
  return h('input', { class: 'inp num', type: 'number', value, ...attrs, onchange: (e) => onchange(parseFloat(e.target.value)) });
}
export function tabs(defs, onChange) {
  const bar = h('div', { class: 'tabs' }); const body = h('div', { class: 'tab-body' });
  let cur = null;
  const show = (id) => {
    cur = id; bar.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.id === id));
    body.innerHTML = ''; const d = defs.find((x) => x.id === id); d.render(body); onChange && onChange(id);
  };
  for (const d of defs) bar.append(h('div', { class: 'tab', 'data-id': d.id, onclick: () => show(d.id) }, d.label));
  return { bar, body, show, get current() { return cur; } };
}
