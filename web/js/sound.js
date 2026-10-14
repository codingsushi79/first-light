// Procedural sound: night ambience that follows the site & weather (wind, crickets, distant
// traffic, owls, snow-quiet), plus gear and UI effects (shutter, mount motors, focuser, footsteps).
// Everything is synthesized with WebAudio — no audio files.
import { G, on } from './state.js';
import { PREFS } from './menu.js';

let ctx = null, master = null, ambBus = null, sfxBus = null;
const amb = {};
let started = false;

function noiseBuffer(kind) {
  const len = ctx.sampleRate * 2.5, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}
function loopNoise(kind) { const s = ctx.createBufferSource(); s.buffer = kind === 'brown' ? amb.brownBuf : amb.whiteBuf; s.loop = true; s.start(ctx.currentTime + Math.random()); return s; }

export function initAudio() {
  if (started) return; started = true;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.connect(ctx.destination);
  ambBus = ctx.createGain(); ambBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  amb.whiteBuf = noiseBuffer('white'); amb.brownBuf = noiseBuffer('brown');
  // wind: brown noise through a wandering band-pass
  amb.windF = ctx.createBiquadFilter(); amb.windF.type = 'bandpass'; amb.windF.Q.value = 0.6; amb.windF.frequency.value = 400;
  amb.windG = ctx.createGain(); amb.windG.gain.value = 0;
  loopNoise('brown').connect(amb.windF); amb.windF.connect(amb.windG); amb.windG.connect(ambBus);
  // distant traffic / city hum
  amb.cityF = ctx.createBiquadFilter(); amb.cityF.type = 'lowpass'; amb.cityF.frequency.value = 160;
  amb.cityG = ctx.createGain(); amb.cityG.gain.value = 0;
  loopNoise('brown').connect(amb.cityF); amb.cityF.connect(amb.cityG); amb.cityG.connect(ambBus);
  // fan hum (cooled cameras)
  amb.fan = ctx.createOscillator(); amb.fan.type = 'sawtooth'; amb.fan.frequency.value = 118;
  amb.fanF = ctx.createBiquadFilter(); amb.fanF.type = 'lowpass'; amb.fanF.frequency.value = 400;
  amb.fanG = ctx.createGain(); amb.fanG.gain.value = 0;
  amb.fan.connect(amb.fanF); amb.fanF.connect(amb.fanG); amb.fanG.connect(sfxBus); amb.fan.start();
  // mount motor whine
  amb.motor = ctx.createOscillator(); amb.motor.type = 'sawtooth'; amb.motor.frequency.value = 300;
  amb.motorF = ctx.createBiquadFilter(); amb.motorF.type = 'bandpass'; amb.motorF.Q.value = 4; amb.motorF.frequency.value = 900;
  amb.motorG = ctx.createGain(); amb.motorG.gain.value = 0;
  amb.motor.connect(amb.motorF); amb.motorF.connect(amb.motorG); amb.motorG.connect(sfxBus); amb.motor.start();
  // hair dryer
  amb.dryF = ctx.createBiquadFilter(); amb.dryF.type = 'bandpass'; amb.dryF.frequency.value = 1400; amb.dryF.Q.value = 0.4;
  amb.dryG = ctx.createGain(); amb.dryG.gain.value = 0;
  loopNoise('white').connect(amb.dryF); amb.dryF.connect(amb.dryG); amb.dryG.connect(sfxBus);
  applyVolumes();
  on('exposure', (ex) => { if (ex && ex.recipe && ex.recipe.type !== 'video' && ex.exp >= 0.05) shutter(true, ex.recipe.cam.type); else if (!ex && lastExp) shutter(false, lastExp); lastExp = ex && ex.recipe ? ex.recipe.cam.type : null; });
  on('focus', () => { const t = performance.now(); if (t - lastFocus > 90) { lastFocus = t; buzz(); } });
  window.addEventListener('fl-sfx', (e) => play(e.detail.name, e.detail));
}
let lastExp = null, lastFocus = 0;
const vol = (k, d) => (PREFS[k] ?? d);
export function applyVolumes() {
  if (!ctx) return;
  master.gain.value = vol('volMaster', 0.8);
  ambBus.gain.value = vol('volAmb', 0.7);
  sfxBus.gain.value = vol('volSfx', 0.8);
}
// Unlock audio on the first user gesture (browsers block autoplay)
export function armAudio() {
  const go = () => { initAudio(); if (ctx && ctx.state === 'suspended') ctx.resume(); };
  window.addEventListener('pointerdown', go, { once: false, capture: true });
  window.addEventListener('keydown', go, { once: false, capture: true });
}

function env(g, t0, a, d, peak) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
function burst({ freq = 2000, q = 1, type = 'bandpass', dur = 0.05, peak = 0.3, at = 0, kind = 'white' }) {
  const t0 = ctx.currentTime + at, s = ctx.createBufferSource(); s.buffer = kind === 'brown' ? amb.brownBuf : amb.whiteBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t0, 0.002, dur, peak);
  s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t0, Math.random() * 2); s.stop(t0 + dur + 0.05);
}
function tone({ freq, to, dur = 0.15, peak = 0.15, type = 'sine', at = 0, bus = sfxBus, attack = 0.01 }) {
  const t0 = ctx.currentTime + at, o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain(); env(g, t0, attack, dur, peak); o.connect(g); g.connect(bus); o.start(t0); o.stop(t0 + attack + dur + 0.05);
}
function shutter(open, camType) {
  if (!ctx) return;
  if (camType === 'dslr') { burst({ freq: 3200, q: 0.8, dur: open ? 0.035 : 0.03, peak: 0.35 }); burst({ freq: 180, q: 1.2, type: 'lowpass', dur: 0.06, peak: 0.5, kind: 'brown', at: 0.008 }); if (open) burst({ freq: 2500, dur: 0.02, peak: 0.15, at: 0.05 }); }
  else if (open) tone({ freq: 2400, dur: 0.03, peak: 0.02 }); // astro cams are silent: a faint relay tick
}
function buzz() { if (!ctx) return; tone({ freq: 210, dur: 0.06, peak: 0.05, type: 'square' }); }
function play(name, d = {}) {
  if (!ctx || ctx.state !== 'running') return;
  switch (name) {
    case 'toast': if (d.kind === 'good') { tone({ freq: 880, dur: 0.12, peak: 0.06 }); tone({ freq: 1320, dur: 0.18, peak: 0.05, at: 0.09 }); } else if (d.kind === 'bad' || d.kind === 'warn') tone({ freq: 330, to: 260, dur: 0.18, peak: 0.05, type: 'triangle' }); break;
    case 'click': tone({ freq: 1800, dur: 0.012, peak: 0.03, type: 'square' }); break;
    case 'open': tone({ freq: 520, to: 780, dur: 0.09, peak: 0.035 }); break;
    case 'step': {
      const snow = d.surface === 'snow', sand = d.surface === 'desert' || d.surface === 'rock';
      burst({ freq: snow ? 1600 : sand ? 900 : 500, q: snow ? 0.7 : 1.2, dur: snow ? 0.12 : 0.07, peak: (snow ? 0.18 : 0.12) * (0.7 + Math.random() * 0.5), kind: snow ? 'white' : 'brown' });
      if (snow) burst({ freq: 3500, q: 1, dur: 0.05, peak: 0.05, at: 0.03 });
      break;
    }
    case 'cap': burst({ freq: 1200, dur: 0.03, peak: 0.2 }); burst({ freq: 300, dur: 0.05, peak: 0.15, kind: 'brown', at: 0.02 }); break;
    case 'clutch': burst({ freq: 700, q: 3, dur: 0.06, peak: 0.25 }); break;
    case 'chime': [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.35, peak: 0.05, at: i * 0.1 })); break;
    default: break;
  }
}
export const sfx = (name, d) => { if (ctx) play(name, d); };

// ambience — called a few times per second
let nextCricket = 0, nextOwl = 0, nextCar = 0, gust = 0;
export function updateAudio() {
  if (!ctx || ctx.state !== 'running') return;
  const s = G.s, t = ctx.currentTime;
  const n = s && s.night;
  const outside = !!n && s.mode === 'night';
  let wind = 0, city = 0, cricket = 0, owl = 0;
  if (outside && window.__dbg) {
    const S = window.__dbg.S; const e = S.envAt(s.time), loc = S.locNow();
    gust += (Math.random() - 0.5) * 0.25; gust *= 0.94;
    wind = Math.min(1, (e.wind / 35) ** 1.1) * (0.7 + gust);
    city = Math.max(0, (loc.bortle - 3) / 6);
    const warm = e.temp > 11 && !/snow|mountain|observatory/.test(loc.biome || '');
    cricket = warm ? Math.min(1, (e.temp - 11) / 10) * (e.sunAlt < -4 ? 1 : 0.3) * (1 - wind * 0.7) : 0;
    owl = /forest|field|suburb/.test(loc.biome || '') ? 1 : 0.15;
    // mount, cooler, dryer
    const slewing = !!n.mount.slew, tracking = n.mount.tracking;
    amb.motorG.gain.setTargetAtTime(slewing ? 0.05 : tracking ? 0.0025 : 0, t, slewing ? 0.08 : 0.3);
    amb.motor.frequency.setTargetAtTime(slewing ? 340 + Math.random() * 20 : 60, t, 0.2);
    amb.motorF.frequency.setTargetAtTime(slewing ? 1100 : 300, t, 0.2);
    const cooled = n.cam && n.cam.coolerOn && window.__dbg.S.rig().cam?.cooled;
    amb.fanG.gain.setTargetAtTime(cooled ? 0.006 : 0, t, 0.5);
    amb.dryG.gain.setTargetAtTime(n.dryUntil && s.time < n.dryUntil ? 0.12 : 0, t, 0.1);
  } else {
    amb.motorG.gain.setTargetAtTime(0, t, 0.2); amb.fanG.gain.setTargetAtTime(0, t, 0.2); amb.dryG.gain.setTargetAtTime(0, t, 0.1);
  }
  amb.windG.gain.setTargetAtTime(0.02 + wind * 0.32, t, 0.6);
  amb.windF.frequency.setTargetAtTime(260 + wind * 600 + Math.random() * 120, t, 0.8);
  amb.cityG.gain.setTargetAtTime(outside ? city * 0.18 : 0.015, t, 1.5);
  // crickets: a few individuals, each chirping in short pulse trains
  if (cricket > 0.05 && t > nextCricket) {
    const f = 4200 + Math.random() * 700, pulses = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < pulses; i++) tone({ freq: f, dur: 0.018, peak: 0.012 * cricket, at: i * 0.045, bus: ambBus, attack: 0.004 });
    nextCricket = t + 0.25 + Math.random() * 0.6 / (0.4 + cricket);
  }
  // distant car
  if (outside && city > 0.2 && t > nextCar) { if (nextCar) carPass(city); nextCar = t + 15 + Math.random() * 50 / city; }
  // owl
  if (outside && owl > 0 && t > nextOwl) { if (nextOwl && Math.random() < 0.5 * owl) hoot(); nextOwl = t + 40 + Math.random() * 90; }
}
function carPass(level) {
  const t0 = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = amb.brownBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(200, t0); f.frequency.linearRampToValueAtTime(700, t0 + 3); f.frequency.linearRampToValueAtTime(220, t0 + 7);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.05 * level, t0 + 3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 7.5);
  s.connect(f); f.connect(g); g.connect(ambBus); s.start(t0); s.stop(t0 + 8);
}
function hoot() {
  const at = [0, 0.55, 0.85];
  at.forEach((a, i) => tone({ freq: i === 0 ? 390 : 360, to: i === 0 ? 370 : 330, dur: i === 0 ? 0.42 : 0.22, peak: 0.03, at: a, bus: ambBus, attack: 0.05 }));
}
