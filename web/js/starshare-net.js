// Global StarShare client: posts final images to the shared server, browses everyone's images,
// likes, comments, print purchases, and collects earnings (likes & print sales) into your balance.
import { G, save, addMoney, isSandbox, idbGet } from './state.js';
import { GEAR, LOC } from './gear.js';
import { PREFS } from './menu.js';

export const API = 'https://first-light-starshare.vercel.app/api';
const KEY = 'fl-starshare-account';

export function account() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
async function req(method, path, body, needAuth = true) {
  let acc = account();
  if (needAuth && !acc) acc = await register();
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(acc ? { Authorization: 'Bearer ' + acc.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `StarShare server error (${r.status})`);
  return j;
}
export async function register() {
  const name = (PREFS.name || '').trim() || `Observer${Math.floor(Math.random() * 9000 + 1000)}`;
  const r = await fetch(API + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not create a StarShare account');
  localStorage.setItem(KEY, JSON.stringify(j)); return j;
}
export async function rename(name) { const j = await req('POST', '/rename', { name }); const a = account(); a.name = j.name; localStorage.setItem(KEY, JSON.stringify(a)); return j.name; }

function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
function jpegOf(img, maxSide, q) {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height)); const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
export async function uploadFinal(f) {
  const url = await idbGet('final:' + f.id); if (!url) throw new Error('Image file missing');
  const img = await loadImg(url);
  let image = jpegOf(img, 1600, 0.86); if (image.length > 2_000_000) image = jpegOf(img, 1280, 0.8);
  const thumb = jpegOf(img, 360, 0.8);
  const loc = LOC[f.loc];
  const meta = { camera: GEAR[f.cam]?.name, optic: GEAR[f.optic]?.name, focal: f.focal, integration: Math.round(f.integration || 0), subs: f.n, site: loc ? loc.name : '', filters: (f.filter || []).filter(Boolean), feedback: (f.score?.feedback || []).slice(0, 3) };
  const r = await req('POST', '/posts', { title: f.title, target: f.target, image, thumb, score: f.score?.total || 0, meta });
  f.globalId = r.id; save();
  return r;
}
export const feed = (sort = 'new', before = null) => req('GET', `/posts?sort=${sort}&limit=24${before ? '&before=' + encodeURIComponent(before) : ''}`, null, !!account());
export const detail = (id) => req('GET', `/posts/${id}`, null, !!account());
export const like = (id) => req('POST', `/posts/${id}/like`, {});
export const comment = (id, text) => req('POST', `/posts/${id}/comment`, { text });
export const report = (id) => req('POST', `/posts/${id}/report`, {});
export const deletePost = (id) => req('POST', `/posts/${id}/delete`, {});
export async function buyPrint(id, size, price) {
  if (isSandbox()) throw new Error('Sandbox money can’t buy prints from other players — switch to a career save.');
  if (G.guest) throw new Error('Buy prints from your own save.');
  if (G.s.money < price) throw new Error('Not enough money.');
  await req('POST', `/posts/${id}/print`, { size });
  addMoney(-price, `Print (${size}) from StarShare`); save(true);
}
export const imageUrl = (id) => `${API}/image/${id}`;
export const thumbUrl = (id) => `${API}/thumb/${id}`;

// Collect likes & print sales other players paid for (career saves get the money)
let lastSync = 0;
export async function syncEarnings(force = false) {
  if (!account() || !G.s || G.guest) return null;
  if (!force && Date.now() - lastSync < 120000) return null;
  lastSync = Date.now();
  const me = await req('GET', '/me');
  if (me.unclaimed > 0 && !isSandbox()) {
    const c = await req('POST', '/claim', {});
    if (c.amount > 0) { addMoney(c.amount, 'StarShare community: likes & print sales'); save(); return { amount: c.amount, items: c.items, me }; }
  }
  return { amount: 0, me };
}
