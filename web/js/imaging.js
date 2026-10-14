// Main-thread interface to the imaging worker.
let worker = null, seq = 0, initArgs = null, crashes = [];
const pending = new Map();
// Generous per-command time limits: a stuck request must never freeze the game clock.
const LIMIT = { render: 120e3, view: 120e3, framing: 60e3, status: 10e3, init: 30e3, stack: 10 * 60e3 };

function spawn() {
  worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, ok, res, err, progress, msg, f } = e.data;
    const p = pending.get(id); if (!p) return;
    if (progress) { p.onProgress && p.onProgress(msg, f); p.arm(); return; }
    pending.delete(id); clearTimeout(p.timer);
    ok ? p.resolve(res) : p.reject(new Error(err));
  };
  // A crashed worker (e.g. out of memory) fails everything in flight and is restarted.
  worker.onerror = (e) => {
    console.error('imaging worker crashed', e);
    // a worker that dies immediately (e.g. a load error) must not restart in a tight loop
    const t = Date.now(); crashes = crashes.filter((c) => t - c < 20000); crashes.push(t);
    if (crashes.length > 4) { for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('The imaging engine failed to start')); } pending.clear(); return; }
    restart('The imaging engine crashed and was restarted');
  };
}
function restart(reason) {
  try { worker && worker.terminate(); } catch { /* ignore */ }
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); }
  pending.clear();
  spawn();
  if (initArgs) worker.postMessage({ id: ++seq, cmd: 'init', args: initArgs });
}
export function initWorker(stars) {
  initArgs = { stars: stars.map((s) => ({ ra: s.ra, dec: s.dec, mag: s.mag, c: s.c })), budget: 900e6 };
  spawn();
  return call('init', initArgs);
}
export function call(cmd, args, onProgress, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const limit = LIMIT[cmd] || 120e3;
    const p = { resolve, reject, onProgress, timer: null };
    // (stacking re-arms the timer on every progress message, so long stacks are fine)
    p.arm = () => { clearTimeout(p.timer); p.timer = setTimeout(() => { if (pending.has(id)) restart(`The imaging engine stopped responding (${cmd}) and was restarted`); }, limit); };
    pending.set(id, p); p.arm();
    worker.postMessage({ id, cmd, args }, transfer);
  });
}
export const renderRecipe = (recipe, opts = {}) => call('render', { recipe, thumb: opts.thumb, linked: opts.linked, wantData: opts.wantData, opts: opts.opts, live: opts.live });
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
