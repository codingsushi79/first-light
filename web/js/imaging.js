// Main-thread interface to the imaging worker.
let worker = null, seq = 0;
const pending = new Map();

export function initWorker(stars) {
  worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, ok, res, err, progress, msg, f } = e.data;
    const p = pending.get(id); if (!p) return;
    if (progress) { p.onProgress && p.onProgress(msg, f); return; }
    pending.delete(id);
    ok ? p.resolve(res) : p.reject(new Error(err));
  };
  worker.onerror = (e) => console.error('worker error', e);
  return call('init', { stars: stars.map((s) => ({ ra: s.ra, dec: s.dec, mag: s.mag, c: s.c })), budget: 260e6 });
}
export function call(cmd, args, onProgress, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, cmd, args }, transfer);
  });
}
export const renderRecipe = (recipe, opts = {}) => call('render', { recipe, thumb: opts.thumb, linked: opts.linked, wantData: opts.wantData, opts: opts.opts });
export const viewRecipe = (recipe, linked) => call('view', { recipe, linked });
export const stackJob = (job, onProgress) => call('stack', job, onProgress);
export const framingImage = (ra, dec, fov, size) => call('framing', { ra, dec, fov, size });
export const workerStatus = () => call('status', {});

export function rgbaToCanvas(pv, canvas) {
  canvas.width = pv.w; canvas.height = pv.h;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pv.rgba.buffer || pv.rgba), pv.w, pv.h), 0, 0);
  return canvas;
}
export async function makeThumb(pv) {
  const c = document.createElement('canvas');
  rgbaToCanvas(pv, c);
  return c.toDataURL('image/jpeg', 0.82);
}
