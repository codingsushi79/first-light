// Shared UI components: zoom/pan image viewer, histogram and simple line charts.
import { h } from './wm.js';

export class Viewer {
  constructor(opts = {}) {
    this.el = h('div', { class: 'viewer' });
    this.canvas = h('canvas', { class: 'viewer-canvas' });
    this.overlay = h('canvas', { class: 'viewer-overlay' });
    this.info = h('div', { class: 'viewer-info' });
    this.el.append(this.canvas, this.overlay, this.info);
    this.src = null; // offscreen canvas holding the image
    this.zoom = 0; this.cx = 0.5; this.cy = 0.5; // zoom 0 = fit
    this.drawOverlay = opts.drawOverlay || null;
    this.onClickImg = opts.onClick || null;
    this.placeholder = opts.placeholder || 'No image';
    const ro = new ResizeObserver(() => this.draw()); ro.observe(this.el);
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault(); if (!this.src) return;
      const f = this.fitScale();
      const cur = this.zoom || f;
      const nz = Math.max(f, Math.min(16, cur * (e.deltaY < 0 ? 1.25 : 0.8)));
      // zoom about the cursor
      const r = this.el.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      const [ix, iy] = this.toImg(mx, my);
      this.zoom = nz <= f * 1.001 ? 0 : nz;
      if (this.zoom) { const s = this.zoom; this.cx = (ix - (mx - r.width / 2) / s) / this.src.width; this.cy = (iy - (my - r.height / 2) / s) / this.src.height; }
      this.clampCenter(); this.draw();
    }, { passive: false });
    let drag = null;
    this.el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: false }; this.el.setPointerCapture(e.pointerId); });
    this.el.addEventListener('pointermove', (e) => {
      if (!drag || !this.src) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (!this.zoom) return;
      this.cx = drag.cx - dx / this.zoom / this.src.width; this.cy = drag.cy - dy / this.zoom / this.src.height; this.clampCenter(); this.draw();
    });
    this.el.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved && this.onClickImg && this.src) { const r = this.el.getBoundingClientRect(); this.onClickImg(...this.toImg(e.clientX - r.left, e.clientY - r.top)); }
      drag = null;
    });
    this.el.addEventListener('dblclick', () => { this.zoom = this.zoom ? 0 : 1; this.cx = this.cy = 0.5; this.draw(); });
  }
  zoomScale() { return this.zoom || this.fitScale(); }
  centerOn(x, y, zoom) { if (!this.src) return; this.zoom = Math.max(this.fitScale(), zoom || this.zoomScale()); this.cx = x / this.src.width; this.cy = y / this.src.height; this.clampCenter(); this.draw(); }
  fitScale() { const r = this.el.getBoundingClientRect(); return this.src ? Math.min(r.width / this.src.width, r.height / this.src.height) : 1; }
  clampCenter() { this.cx = Math.max(0, Math.min(1, this.cx)); this.cy = Math.max(0, Math.min(1, this.cy)); }
  setImage(source) { // canvas or ImageBitmap
    const keep = this.src && source && this.src.width === source.width && this.src.height === source.height;
    this.src = source; if (!keep) { this.zoom = 0; this.cx = this.cy = 0.5; }
    this.draw();
  }
  toImg(mx, my) {
    const r = this.el.getBoundingClientRect(); const s = this.zoom || this.fitScale();
    const ox = r.width / 2 - (this.zoom ? this.cx * this.src.width : this.src.width / 2) * s;
    const oy = r.height / 2 - (this.zoom ? this.cy * this.src.height : this.src.height / 2) * s;
    return [(mx - ox) / s, (my - oy) / s];
  }
  draw() {
    const r = this.el.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.overlay]) { c.width = Math.max(1, r.width * dpr); c.height = Math.max(1, r.height * dpr); c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; }
    const ctx = this.canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, r.width, r.height);
    const o = this.overlay.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0); o.clearRect(0, 0, r.width, r.height);
    if (!this.src) { ctx.fillStyle = '#3a4656'; ctx.font = '13px system-ui'; ctx.textAlign = 'center'; ctx.fillText(this.placeholder, r.width / 2, r.height / 2); this.info.textContent = ''; return; }
    const s = this.zoom || this.fitScale();
    const ox = r.width / 2 - (this.zoom ? this.cx * this.src.width : this.src.width / 2) * s;
    const oy = r.height / 2 - (this.zoom ? this.cy * this.src.height : this.src.height / 2) * s;
    ctx.imageSmoothingEnabled = s < 1.5; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.src, ox, oy, this.src.width * s, this.src.height * s);
    this.info.textContent = `${Math.round(s * 100)}%`;
    if (this.drawOverlay) { o.save(); this.drawOverlay(o, { s, ox, oy, w: r.width, h: r.height, iw: this.src.width, ih: this.src.height }); o.restore(); }
  }
}

export function drawHistogram(canvas, hist, opts = {}) {
  const dpr = window.devicePixelRatio || 1; const W = canvas.clientWidth || 300, H = canvas.clientHeight || 70;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0f15'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1c2633'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo((W * i) / 4, 0); ctx.lineTo((W * i) / 4, H); ctx.stroke(); }
  if (!hist) return;
  const cols = hist.length === 1 ? ['rgba(220,220,220,0.85)'] : ['rgba(255,80,80,0.7)', 'rgba(80,255,120,0.6)', 'rgba(90,140,255,0.7)'];
  let max = 1; for (const hc of hist) for (const v of hc) max = Math.max(max, v);
  const log = opts.log !== false;
  hist.forEach((hc, c) => {
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let i = 0; i < hc.length; i++) { const v = log ? Math.log1p(hc[i]) / Math.log1p(max) : hc[i] / max; ctx.lineTo((i / (hc.length - 1)) * W, H - v * (H - 4)); }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fillStyle = cols[c]; ctx.globalCompositeOperation = 'lighter'; ctx.fill(); ctx.globalCompositeOperation = 'source-over';
  });
  if (opts.markers) for (const [x, col] of opts.markers) { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x * W, 0); ctx.lineTo(x * W, H); ctx.stroke(); }
}

// series: [{data:[[x,y],...], color, label, dots}]
export function lineChart(canvas, series, opts = {}) {
  const dpr = window.devicePixelRatio || 1; const W = canvas.clientWidth || 300, H = canvas.clientHeight || 120;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = opts.bg || '#0b0f15'; ctx.fillRect(0, 0, W, H);
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  let xs = [], ys = [];
  for (const s of series) for (const [x, y] of s.data) { xs.push(x); ys.push(y); }
  if (opts.xmin !== undefined) xs.push(opts.xmin); if (opts.xmax !== undefined) xs.push(opts.xmax);
  if (opts.ymin !== undefined) ys.push(opts.ymin); if (opts.ymax !== undefined) ys.push(opts.ymax);
  if (!xs.length) { ctx.fillStyle = '#445'; ctx.font = '11px system-ui'; ctx.fillText(opts.empty || 'No data', W / 2 - 25, H / 2); return; }
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = opts.ymin ?? Math.min(...ys), y1 = opts.ymax ?? Math.max(...ys);
  if (opts.symmetric) { const m = Math.max(Math.abs(y0), Math.abs(y1), 0.5); y0 = -m; y1 = m; }
  if (x1 === x0) x1 = x0 + 1; if (y1 === y0) { y1 += 1; y0 -= 1; }
  const X = (x) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  if (opts.bands) for (const b of opts.bands) { ctx.fillStyle = b.color; ctx.fillRect(X(b.x0), pad.t, X(b.x1) - X(b.x0), H - pad.t - pad.b); }
  ctx.strokeStyle = '#1f2a38'; ctx.fillStyle = '#6b7a8c'; ctx.font = '10px system-ui'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = y0 + ((y1 - y0) * i) / 4; ctx.beginPath(); ctx.moveTo(pad.l, Y(y)); ctx.lineTo(W - pad.r, Y(y)); ctx.stroke();
    ctx.fillText((opts.yfmt || ((v) => v.toFixed(Math.abs(y1 - y0) < 5 ? 1 : 0)))(y), 2, Y(y) + 3);
  }
  if (opts.xticks) for (const [x, lab] of opts.xticks) { ctx.fillText(lab, X(x) - 10, H - 4); ctx.beginPath(); ctx.moveTo(X(x), pad.t); ctx.lineTo(X(x), H - pad.b); ctx.stroke(); }
  if (opts.zero) { ctx.strokeStyle = '#3b4a5e'; ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(W - pad.r, Y(0)); ctx.stroke(); }
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width || 1.5;
    if (!s.dots) { ctx.beginPath(); s.data.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke(); }
    else for (const [x, y] of s.data) { ctx.beginPath(); ctx.arc(X(x), Y(y), s.r || 2.5, 0, 7); ctx.fill(); }
  }
  if (opts.vlines) for (const v of opts.vlines) { ctx.strokeStyle = v.color; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(v.x), pad.t); ctx.lineTo(X(v.x), H - pad.b); ctx.stroke(); ctx.setLineDash([]); if (v.label) { ctx.fillStyle = v.color; ctx.fillText(v.label, X(v.x) + 3, pad.t + 10); } }
  if (opts.legend) { let lx = pad.l + 6; for (const s of series) if (s.label) { ctx.fillStyle = s.color; ctx.fillRect(lx, pad.t + 2, 8, 8); ctx.fillStyle = '#9fb0c4'; ctx.fillText(s.label, lx + 11, pad.t + 10); lx += ctx.measureText(s.label).width + 24; } }
}

export function canvasFromRGBA(pv) {
  const c = document.createElement('canvas'); c.width = pv.w; c.height = pv.h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pv.rgba.buffer || pv.rgba), pv.w, pv.h), 0, 0);
  return c;
}
export function bar(frac, cls = '') { const b = h('div', { class: 'pbar ' + cls }, h('div', { class: 'pbar-fill', style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%' } })); return b; }
