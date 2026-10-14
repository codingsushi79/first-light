// Persistent game state + IndexedDB storage + event bus
import { LOC } from './gear.js';

// ---- tiny IndexedDB key/value store ----
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('astrophoto-sim', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
export async function idbGet(key) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction('kv').objectStore('kv').get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
}
export async function idbSet(key, val) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
export async function idbDel(key) {
  const d = await db();
  return new Promise((res) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(key); t.oncomplete = () => res(); });
}

// ---- event bus ----
const listeners = {};
export function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return () => off(ev, fn); }
export function off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); }
export function emit(ev, data) { for (const f of listeners[ev] || []) { try { f(data); } catch (e) { console.error(e); } } }

// ---- local-time helpers ----
// Sim time is stored as UTC ms. "Local" uses the location's fixed UTC offset.
export function localParts(ms, tz) {
  const d = new Date(ms + tz * 3600000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() };
}
export function localMs(y, mo, d, h, mi, tz) { return Date.UTC(y, mo, d, h, mi) - tz * 3600000; }
export function dayIndexOf(ms, tz) { return Math.floor((ms + tz * 3600000 - 12 * 3600000) / 86400000); } // evening date index
export function fmtTime(ms, tz, sec = false) {
  const p = localParts(ms, tz);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}${sec ? ':' + String(p.s).padStart(2, '0') : ''}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDate(ms, tz) { const p = localParts(ms, tz); return `${DOW[p.dow]} ${MONTHS[p.mo]} ${p.d}`; }
export function fmtDateLong(ms, tz) { const p = localParts(ms, tz); return `${DOW[p.dow]}, ${MONTHS[p.mo]} ${p.d} ${p.y}`; }
export function fmtDur(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
}

// ---- the game state ----
export function newGame() {
  const tz = LOC.backyard.tz;
  return {
    version: 3,
    money: 300,
    rep: 0,
    time: localMs(2026, 9, 13, 13, 0, tz), // Oct 13 2026, 1pm local
    mode: 'day',                            // 'day' | 'night'
    location: 'backyard',
    inventory: ['tripod', 'dslr_stock', 'lens_kit'],
    rig: { mount: 'tripod', optic: 'lens_kit', camera: 'dslr_stock', corrector: null, filter: null, wheel: [], acc: [], zoom: 18, fstop: 3.5 },
    camSerial: Math.floor(Math.random() * 1e6),
    dustSeed: Math.floor(Math.random() * 1e6),
    sessions: [],   // {id, date, location, start}
    frames: [],     // frame metadata (recipes) — pixel data is re-rendered deterministically
    stacks: [],     // stacked masters metadata; data in IDB
    finals: [],     // processed images metadata; jpeg in IDB
    posts: [],      // StarShare uploads
    mail: [],
    quests: {},
    stats: { nights: 0, frames: 0, integration: 0, uploads: 0 },
    settings: { nightMode: false, quality: 1024, linked: false, sound: true },
    night: null,
    tutorialDone: false,
  };
}

export const G = { s: null };
export async function loadGame() {
  try {
    const s = await idbGet('save');
    if (s && s.version === 3) { G.s = s; return true; }
  } catch (e) { console.warn(e); }
  G.s = newGame();
  return false;
}
let saveTimer = null;
export function save(immediate = false) {
  if (!G.s) return;
  clearTimeout(saveTimer);
  const doIt = () => idbSet('save', JSON.parse(JSON.stringify(G.s))).catch((e) => console.warn('save failed', e));
  if (immediate) return doIt();
  saveTimer = setTimeout(doIt, 1500);
}
export function addMoney(n, why) {
  G.s.money += n;
  emit('money', { delta: n, why });
  save();
}
export function owns(id) { return G.s.inventory.includes(id); }
export function loc() { return LOC[G.s.location]; }
