// Laptop storage: every saved file takes realistic space (raw frames by sensor size and bit depth,
// SER videos, 32-bit stacks, exported images). Full disk = no more saving until you delete or upgrade.
import { G, emit } from './state.js';
import { GEAR } from './gear.js';

export const BASE_DISK = 128e9; // the laptop’s internal SSD (a budget machine)
const GB = 1e9;

export function frameBytes(f) {
  const cam = GEAR[f.cam] || (f.recipe && f.recipe.cam); if (!cam) return 25e6;
  const r = f.recipe || {}; const bin = f.bin || r.bin || 1;
  if (f.type === 'video') { const px = r.roi ? r.roi.w * r.roi.h : cam.w * cam.h; return (f.frames || r.frames || 1000) * px + 4096; } // 8-bit SER
  const px = (cam.w / bin) * (cam.h / bin);
  return cam.type === 'dslr' ? px * 1.35 + 2e6 /* compressed 14-bit raw */ : px * 2 + 11520; /* 16-bit FITS */
}
export function stackBytes(s) {
  if (s.planetary) return s.W * s.H * s.nc * 4 + 8192;
  const cam = GEAR[s.cam]; const px = cam ? cam.w * cam.h : s.W * s.H;
  return px * s.nc * 4 + 11520; // 32-bit float FITS at full sensor resolution
}
export function finalBytes(f) { const cam = GEAR[f.cam]; return cam ? cam.w * cam.h * 3 * 2 * 0.55 : 40e6; } // 16-bit TIFF, compressed
export function capacity() {
  let c = BASE_DISK;
  for (const id of G.s.inventory || []) { const g = GEAR[id]; if (g && g.kind === 'storage') c += g.bytes; }
  return c;
}
export function usage() {
  const s = G.s; let frames = 0, videos = 0, stacks = 0, finals = 0;
  for (const f of s.frames) { const b = f.bytes || (f.bytes = frameBytes(f)); if (f.type === 'video') videos += b; else frames += b; }
  for (const st of s.stacks) stacks += st.bytes || (st.bytes = stackBytes(st));
  for (const f of s.finals) finals += finalBytes(f);
  const system = 38 * GB; // OS + apps
  const used = frames + videos + stacks + finals + system;
  return { used, frames, videos, stacks, finals, system, cap: capacity(), free: capacity() - used };
}
export function fmtBytes(b) { const a = Math.abs(b); return a >= 1e12 ? `${(b / 1e12).toFixed(2)} TB` : a >= 1e9 ? `${(b / 1e9).toFixed(a >= 1e11 ? 0 : 1)} GB` : a >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`; }
// Throw if `bytes` more would not fit
export function ensureSpace(bytes, what = 'this file') {
  const u = usage();
  if (u.used + bytes > u.cap) {
    emit('diskfull', u);
    throw new Error(`Disk full — no room for ${what} (${fmtBytes(bytes)}, ${fmtBytes(Math.max(0, u.free))} free). Delete files in Files or buy more storage in AstroMart.`);
  }
  const after = (u.used + bytes) / u.cap;
  if (after > 0.9 && u.used / u.cap <= 0.9) emit('toast', { msg: `💾 Disk is ${Math.round(after * 100)}% full (${fmtBytes(u.cap - u.used - bytes)} left).`, kind: 'warn' });
}
