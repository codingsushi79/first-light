// Co-op multiplayer over WebRTC (PeerJS). The host runs the simulation; guests get a live
// replica of the host's world and send their actions (focus, aim, capture…) as RPCs.
import Peer from 'peerjs';
import { G, emit, on, idbSet } from './state.js';
import * as S from './session.js';

const PREFIX = 'firstlight-coop-';
const COLORS = ['#8fd3ff', '#ffb547', '#9fe3a8', '#ff7a9c', '#c39bff', '#ffe066'];
const HOST_ONLY = new Set(['startNight', 'endNight', 'skipDay']);

export const MP = {
  role: 'solo', code: null, peer: null, conns: new Map(), hostConn: null,
  myId: null, name: 'Observer', players: {}, chat: [],
  pending: new Map(), frameWait: new Map(), frameSeen: new Map(), seq: 0, frameSeq: 0,
  onStatus: null,
};
const status = (msg, kind = 'info') => { emit('mpstatus', { msg, kind }); };

// No 'L' in real codes: local test rooms start with L.
function makeCode() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 6; i++) c += a[Math.floor(Math.random() * a.length)]; return c; }

// ------------------------------------------------------------------ local test transport
// Same-computer rooms over BroadcastChannel (dev/testing). Mimics the PeerJS API surface we use.
class Emitter { constructor() { this.h = {}; } on(e, f) { (this.h[e] = this.h[e] || []).push(f); return this; } fire(e, ...a) { for (const f of this.h[e] || []) f(...a); } }
class LocalConn extends Emitter {
  constructor(ch, self, other, metadata) { super(); this.ch = ch; this.self = self; this.peer = other; this.metadata = metadata; this.open = false; }
  send(data) { this.ch.postMessage({ to: this.peer, from: this.self, data }); }
  close() { this.ch.postMessage({ to: this.peer, from: this.self, bye: true }); this.open = false; }
}
class LocalPeer extends Emitter {
  constructor(id) { super(); this.id = id; this.open = false; this.conns = new Map(); this.ch = null; }
  listen(room) {
    this.ch = new BroadcastChannel('fl-room-' + room);
    this.ch.onmessage = (ev) => {
      const m = ev.data; if (m.to !== this.id) return;
      let c = this.conns.get(m.from);
      if (m.hello) { c = new LocalConn(this.ch, this.id, m.from, m.metadata); this.conns.set(m.from, c); this.fire('connection', c); this.ch.postMessage({ to: m.from, from: this.id, ack: true }); c.open = true; setTimeout(() => c.fire('open'), 0); return; }
      if (m.ack && c) { c.open = true; c.fire('open'); return; }
      if (m.bye && c) { c.open = false; c.fire('close'); this.conns.delete(m.from); return; }
      if (c) c.fire('data', m.data);
    };
    this.open = true; setTimeout(() => this.fire('open', this.id), 0);
  }
  connect(room, hostId, opts) { const c = new LocalConn(this.ch, this.id, hostId, opts.metadata); this.conns.set(hostId, c); this.ch.postMessage({ to: hostId, from: this.id, hello: true, metadata: opts.metadata }); return c; }
  destroy() { for (const c of this.conns.values()) c.close(); this.ch && this.ch.close(); }
}
export const isLocalCode = (code) => /^L[A-Z0-9]{5}$/.test(code);

// ------------------------------------------------------------------ host
export function host(name) {
  return new Promise((resolve, reject) => {
    MP.name = name || 'Host';
    const local = (() => { try { return localStorage.getItem('fl-mp-local') === '1'; } catch { return false; } })();
    const code = local ? 'L' + makeCode().slice(1) : makeCode();
    let peer;
    if (local) { peer = new LocalPeer(PREFIX + code); peer.listen(code); } else peer = new Peer(PREFIX + code, { debug: 0 });
    MP.peer = peer;
    peer.on('open', (id) => {
      MP.role = 'host'; MP.code = code; MP.myId = id;
      S.NET.role = 'host';
      MP.players = { [id]: { id, name: MP.name, color: COLORS[0], pose: null, host: true } };
      status(`Hosting — room code ${code}`, 'good');
      startHostLoops();
      resolve(code);
    });
    peer.on('error', (e) => { status('Network error: ' + (e.type || e.message), 'bad'); if (MP.role !== 'host') reject(e); });
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const color = COLORS[Object.keys(MP.players).length % COLORS.length];
        MP.conns.set(conn.peer, conn);
        MP.players[conn.peer] = { id: conn.peer, name: (conn.metadata && conn.metadata.name || 'Guest').slice(0, 24), color, pose: null };
        conn.send({ t: 'welcome', you: conn.peer, color, code: MP.code, state: fullState(), players: playersOut() });
        broadcast({ t: 'chat', from: '•', text: `${MP.players[conn.peer].name} joined.` });
        addChat('•', `${MP.players[conn.peer].name} joined.`);
        emit('mpplayers', MP.players);
      });
      conn.on('data', (msg) => hostHandle(conn, msg));
      conn.on('close', () => dropPeer(conn.peer));
      conn.on('error', () => dropPeer(conn.peer));
    });
  });
}
function dropPeer(id) {
  if (!MP.players[id]) return;
  const nm = MP.players[id].name;
  delete MP.players[id]; MP.conns.delete(id);
  addChat('•', `${nm} left.`); broadcast({ t: 'chat', from: '•', text: `${nm} left.` });
  emit('mpplayers', MP.players);
}
function broadcast(msg) { for (const c of MP.conns.values()) if (c.open) c.send(msg); }
function playersOut() { return Object.values(MP.players).map((p) => ({ id: p.id, name: p.name, color: p.color, pose: p.pose, host: !!p.host })); }

function fullState() {
  const s = JSON.parse(JSON.stringify(G.s));
  delete s.capture; delete s.chartOpts; delete s.chartView; delete s.settings;
  return s;
}
function snapshot() {
  const n = G.s.night ? { ...G.s.night, log: G.s.night.log.slice(-25) } : null;
  const ex = S.T.exposure;
  return {
    t: 'snap', time: G.s.time, mode: G.s.mode, location: G.s.location, night: n, rig: G.s.rig, target: G.s.target || null,
    money: G.s.money, inventory: G.s.inventory, warp: S.T.warp,
    exposure: ex ? { t0: ex.t0, end: ex.end, exp: ex.exp, rendering: ex.rendering, recipe: { roi: ex.recipe.roi, type: ex.recipe.type, target: ex.recipe.target } } : null,
    guideHist: S.T.guideHist.slice(-80), players: playersOut(),
  };
}
let hostTimer = null;
function startHostLoops() {
  clearInterval(hostTimer);
  hostTimer = setInterval(() => {
    const me = MP.players[MP.myId]; if (me) me.pose = myPose();
    if (MP.conns.size) broadcast(snapshot());
    emit('mpplayers', MP.players);
  }, 150);
  // every captured frame (from anyone) goes to everyone
  on('frame', (fr) => { if (MP.role === 'host' && MP.conns.size) sendFrame(fr); });
  on('night', () => { if (MP.role === 'host') broadcast({ t: 'full', state: fullState() }); });
}
async function sendFrame(fr) {
  const seq = ++MP.frameSeq; fr._seq = seq;
  const res = await serializeRes(fr.res);
  broadcast({ t: 'frame', seq, meta: fr.meta, res });
}
async function hostHandle(conn, msg) {
  if (msg.t === 'pose') { const p = MP.players[conn.peer]; if (p) p.pose = msg.pose; return; }
  if (msg.t === 'chat') { const p = MP.players[conn.peer]; const text = String(msg.text).slice(0, 300); addChat(p ? p.name : '?', text, p && p.color); broadcast({ t: 'chat', from: p ? p.name : '?', color: p && p.color, text }); return; }
  if (msg.t === 'rpc') {
    const reply = (ok, value) => conn.open && conn.send({ t: 'res', id: msg.id, ok, value });
    try {
      if (HOST_ONLY.has(msg.fn)) throw new Error('Only the host can do that.');
      const fn = S.LOCAL[msg.fn]; if (!fn) throw new Error('Unknown action ' + msg.fn);
      const who = MP.players[conn.peer];
      if (msg.fn === 'expose') {
        const fr = await fn(...msg.args);
        reply(true, { frameSeq: fr._seq || null, frameId: fr.meta.id });
        return;
      }
      const v = await fn(...msg.args);
      if (who && ['setProp', 'moveFocus', 'useHairDryer', 'wipeOptics', 'gotoRaDec', 'setTracking'].includes(msg.fn)) S.log(`[${who.name}] ${msg.fn}`);
      reply(true, v === undefined ? null : JSON.parse(JSON.stringify(v)));
    } catch (e) { reply(false, e.message || String(e)); }
  }
}

// ------------------------------------------------------------------ guest
export function join(code, name) {
  return new Promise((resolve, reject) => {
    MP.name = name || 'Guest';
    const local = isLocalCode(code.trim().toUpperCase());
    let peer;
    if (local) { peer = new LocalPeer('guest-' + Math.random().toString(36).slice(2, 9)); peer.listen(code.trim().toUpperCase()); }
    else peer = new Peer({ debug: 0 });
    MP.peer = peer;
    let done = false;
    const fail = (e) => { if (!done) { done = true; reject(e); } else { status('Disconnected from host.', 'bad'); emit('mpdisconnect'); } };
    peer.on('error', (e) => fail(new Error(e.type === 'peer-unavailable' ? 'No game with that code (is the host still hosting?)' : (e.message || e.type))));
    peer.on('open', () => {
      const conn = local ? peer.connect(code.trim().toUpperCase(), PREFIX + code.trim().toUpperCase(), { metadata: { name: MP.name } }) : peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true, metadata: { name: MP.name } });
      MP.hostConn = conn;
      const to = setTimeout(() => fail(new Error('Timed out connecting to host.')), 15000);
      conn.on('data', (msg) => {
        if (msg.t === 'welcome') {
          clearTimeout(to);
          MP.role = 'client'; MP.code = msg.code; MP.myId = msg.you; S.NET.role = 'client'; S.NET.rpc = rpc;
          applyFull(msg.state); setPlayers(msg.players);
          done = true; resolve(msg.state);
          setInterval(() => { if (conn.open) conn.send({ t: 'pose', pose: myPose() }); }, 120);
          return;
        }
        clientHandle(msg);
      });
      conn.on('close', () => fail(new Error('Host closed the connection.')));
      conn.on('error', (e) => fail(e));
    });
  });
}
function rpc(fn, args) {
  if (HOST_ONLY.has(fn)) return Promise.resolve({ error: 'Only the host can do that.' });
  const id = ++MP.seq;
  const p = new Promise((resolve, reject) => MP.pending.set(id, { resolve, reject, fn }));
  MP.hostConn.send({ t: 'rpc', id, fn, args: JSON.parse(JSON.stringify(args)) });
  if (fn === 'expose') return p.then((v) => waitFrame(v));
  return p;
}
function waitFrame(v) {
  const seq = v.frameSeq;
  if (seq && MP.frameSeen.has(seq)) return Promise.resolve(MP.frameSeen.get(seq));
  return new Promise((resolve) => MP.frameWait.set(seq || v.frameId, resolve));
}
async function clientHandle(msg) {
  if (msg.t === 'snap') return applySnap(msg);
  if (msg.t === 'full') return applyFull(msg.state);
  if (msg.t === 'chat') return addChat(msg.from, msg.text, msg.color);
  if (msg.t === 'res') {
    const p = MP.pending.get(msg.id); if (!p) return; MP.pending.delete(msg.id);
    msg.ok ? p.resolve(msg.value) : (p.fn === 'expose' ? p.reject(new Error(msg.value)) : p.resolve({ error: msg.value }));
    return;
  }
  if (msg.t === 'frame') {
    const res = await deserializeRes(msg.res);
    const fr = { meta: msg.meta, res };
    S.T.lastFrame = fr;
    if (msg.meta.id && !msg.meta.recipe.roi && !G.s.frames.some((f) => f.id === msg.meta.id)) {
      G.s.frames.push(msg.meta);
      const c = document.createElement('canvas'); const tw = 240; c.width = tw; c.height = Math.round(tw * res.preview.h / res.preview.w);
      c.getContext('2d').drawImage(res._img, 0, 0, c.width, c.height); idbSet('thumb:' + msg.meta.id, c.toDataURL('image/jpeg', 0.8));
    }
    MP.frameSeen.set(msg.seq, fr); if (MP.frameSeen.size > 30) MP.frameSeen.delete(MP.frameSeen.keys().next().value);
    const w = MP.frameWait.get(msg.seq) || MP.frameWait.get(msg.meta.id);
    if (w) { MP.frameWait.delete(msg.seq); MP.frameWait.delete(msg.meta.id); w(fr); }
    emit('frame', fr);
  }
}
function applyFull(state) {
  const keep = G.s ? { capture: G.s.capture, chartOpts: G.s.chartOpts, chartView: G.s.chartView, settings: G.s.settings } : {};
  const hadNight = !!(G.s && G.s.night);
  G.s = { ...state, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v)) };
  if (!G.s.settings) G.s.settings = { nightMode: false, quality: 1024, linked: false, sound: true };
  G.guest = true;
  if (hadNight !== !!G.s.night) emit('night', G.s.night);
}
function deepAssign(dst, src) {
  for (const k of Object.keys(dst)) if (!(k in src)) delete dst[k];
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) deepAssign(dst[k], v);
    else dst[k] = v;
  }
  return dst;
}
function applySnap(m) {
  const hadNight = !!G.s.night;
  G.s.time = m.time; G.s.mode = m.mode; G.s.location = m.location; G.s.money = m.money; G.s.inventory = m.inventory;
  G.s.target = m.target;
  if (JSON.stringify(G.s.rig) !== JSON.stringify(m.rig)) { G.s.rig = m.rig; emit('rig', m.rig); }
  if (m.night) { if (G.s.night && G.s.night.id === m.night.id) deepAssign(G.s.night, m.night); else G.s.night = m.night; }
  else G.s.night = null;
  if (hadNight !== !!G.s.night) emit('night', G.s.night);
  if (S.T.warp !== m.warp) { S.T.warp = m.warp; emit('warp', m.warp); }
  const had = !!S.T.exposure;
  S.T.exposure = m.exposure; if (had !== !!m.exposure) emit('exposure', m.exposure);
  S.T.guideHist = m.guideHist;
  setPlayers(m.players);
  // resolve local waits (sequencer, autofocus…) against the host's clock
  const ready = S.T.waiters.filter((w) => G.s.time >= w.until - 1);
  S.T.waiters = S.T.waiters.filter((w) => G.s.time < w.until - 1);
  ready.forEach((w) => w.resolve());
  emit('tick', 0);
}
function setPlayers(list) {
  const out = {}; for (const p of list) out[p.id] = p; MP.players = out; emit('mpplayers', out);
}

// ------------------------------------------------------------------ shared helpers
let poseFn = () => null;
export function setPoseProvider(fn) { poseFn = fn; }
function myPose() { return poseFn(); }
export function sendChat(text) {
  text = String(text || '').trim(); if (!text) return;
  if (MP.role === 'host') { addChat(MP.name, text, COLORS[0]); broadcast({ t: 'chat', from: MP.name, color: COLORS[0], text }); }
  else if (MP.role === 'client' && MP.hostConn) MP.hostConn.send({ t: 'chat', text });
}
function addChat(from, text, color) { MP.chat.push({ from, text, color, t: Date.now() }); if (MP.chat.length > 50) MP.chat.shift(); emit('mpchat', MP.chat); }
export function leave() { try { MP.peer && MP.peer.destroy(); } catch (_) { /* ignore */ } MP.role = 'solo'; S.NET.role = 'solo'; clearInterval(hostTimer); }

async function serializeRes(res) {
  const pv = res.preview; const c = document.createElement('canvas'); c.width = pv.w; c.height = pv.h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pv.rgba.buffer || pv.rgba), pv.w, pv.h), 0, 0);
  return { W: res.W, H: res.H, nc: res.nc, stats: res.stats, hist: res.hist.map((h) => Array.from(h)), maxADU: res.maxADU, trailPx: res.trailPx, warnings: res.warnings, scale: res.scale, jpeg: c.toDataURL('image/jpeg', 0.85), pw: pv.w, ph: pv.h };
}
async function deserializeRes(r) {
  const img = new Image(); img.src = r.jpeg; await img.decode();
  const c = document.createElement('canvas'); c.width = r.pw; c.height = r.ph; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const rgba = g.getImageData(0, 0, r.pw, r.ph).data;
  return { ...r, hist: r.hist.map((h) => Uint32Array.from(h)), preview: { rgba, w: r.pw, h: r.ph }, _img: img };
}
