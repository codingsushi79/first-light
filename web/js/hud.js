// In-world HUD (instrument-panel style): clock, time warp, sky, rig, session, cautions, chat.
import { h } from './wm.js';
import * as A from './astro.js';
import { G, fmtTime, fmtDate, fmtDur, on } from './state.js';
import { GEAR } from './gear.js';
import * as S from './session.js';
import * as RT from './routines.js';
import { MP, sendChat } from './mp.js';
import { hourlyRate, activeShowers } from './meteors.js';

const row = (k, v, cls = '') => h('div', { class: 'row ' + cls }, h('span', { class: 'lbl' }, k), h('span', { class: 'mono' }, v));
const gauge = (label, frac, value, cls = '') => h('div', { class: 'gauge' }, h('span', { class: 'gauge-label' }, label), h('span', { class: 'gauge-bar' }, h('span', { class: 'gauge-fill ' + cls, style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%' } })), h('span', { class: 'gauge-value' }, value));

export function createHud(root, cb) {
  const clock = h('div', { class: 'hp clock' });
  const warp = h('div', { class: 'hp warp' });
  const sky = h('div', { class: 'hp sky' });
  const top = h('div', { class: 'hud-top' }, h('div', { class: 'hud-top-l' }, h('button', { class: 'hud-menu', title: 'Menu (Esc)', onclick: () => cb.onMenu() }, '☰'), clock), warp, sky);
  const warn = h('div', { class: 'hud-warn' });
  const rig = h('div', { class: 'hp hud-rig' });
  const sess = h('div', { class: 'hp hud-sess' });
  const prompt = h('div', { class: 'hud-prompt' });
  const xh = h('div', { class: 'hud-xhair' });
  const hint = h('div', { class: 'hud-hint' }, 'CLICK look · WASD walk · E interact · R rig controls · F headlamp · , . warp · TAB laptop · ENTER chat · F2 hide HUD');
  const chatLog = h('div', { class: 'chat-log' });
  const chatIn = h('input', { class: 'chat-in', placeholder: 'Say something to your team…', maxlength: 300 });
  const chat = h('div', { class: 'hud-chat' }, chatLog, chatIn);
  // compass strip + sky markers (updated every rendered frame)
  const compassTape = h('div', { class: 'compass-tape' });
  const compass = h('div', { class: 'hud-compass' }, compassTape, h('div', { class: 'compass-caret' }), h('div', { class: 'compass-read mono' }));
  for (let d = -360; d <= 720; d += 5) {
    const lab = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[((d % 360) + 360) % 360];
    compassTape.append(h('span', { class: 'ct' + (d % 15 === 0 ? ' major' : '') + (lab ? ' cd' : ''), style: { left: `${(d + 360) * 4}px` } }, d % 15 === 0 ? (lab || String(((d % 360) + 360) % 360)) : ''));
  }
  const markers = h('div', { class: 'hud-markers' });
  const el = h('div', { class: 'hud' }, top, compass, markers, warn, rig, sess, xh, prompt, hint, chat);
  root.append(el);

  chatIn.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { sendChat(chatIn.value); chatIn.value = ''; chatIn.blur(); chat.classList.remove('typing'); }
    if (e.key === 'Escape') { chatIn.blur(); chat.classList.remove('typing'); }
  });
  const renderChat = () => {
    chatLog.innerHTML = '';
    for (const m of MP.chat.slice(-8)) chatLog.append(h('div', { class: 'chat-line' + (Date.now() - m.t > 20000 ? ' old' : '') }, h('b', { style: { color: m.color || 'var(--muted)' } }, m.from), ' ', m.text));
    chat.style.display = MP.role === 'solo' && !MP.chat.length ? 'none' : '';
  };
  on('mpchat', renderChat); renderChat();

  function update() {
    const n = G.s.night; if (!n) return;
    const loc = S.locNow(); const env = S.envAt(G.s.time); const ri = S.rig(); const p = S.pointing(); const mount = GEAR[G.s.rig.mount];
    // clock
    const tzs = `UTC${loc.tz >= 0 ? '+' : '−'}${Math.abs(loc.tz)}`;
    clock.innerHTML = '';
    clock.append(h('div', { class: 'big mono' }, fmtTime(G.s.time, loc.tz, true)), h('div', { class: 'small lbl' }, `${fmtDate(G.s.time, loc.tz)} · ${loc.name.split(' (')[0]} · ${tzs}`));
    // warp
    warp.innerHTML = '';
    const idx = S.WARPS.indexOf(S.T.warp);
    const pips = h('div', { class: 'warp-pips' }, ...S.WARPS.map((_, i) => h('span', { class: 'pip' + (i <= idx ? ' on' : '') })));
    warp.append(h('div', { class: 'warp-row' },
      h('button', { onclick: () => cb.onWarp(-1), title: 'Slower ( , )' }, '‹'), h('div', { class: 'warp-value mono' }, `${S.T.warp}×`),
      h('button', { onclick: () => cb.onWarp(1), title: 'Faster ( . )' }, '›'), h('button', { class: cb.ffOn() ? 'on' : '', onclick: () => cb.onFF(), title: 'Skip to end of exposure / wait' }, '⏭')), pips,
      h('div', { class: 'warp-note' }, MP.role === 'client' ? 'HOST CONTROLS TIME' : S.T.exposure ? 'EXPOSING' : ''));
    // sky
    const sunState = env.sunAlt > -0.8 ? 'DAY' : env.sunAlt > -6 ? 'CIVIL TWILIGHT' : env.sunAlt > -12 ? 'NAUTICAL TW.' : env.sunAlt > -18 ? 'ASTRO TW.' : 'DARK';
    sky.innerHTML = '';
    sky.append(h('div', { class: 'panel-title' }, 'SKY'), row('SUN', `${env.sunAlt.toFixed(1)}° ${sunState}`), row('MOON', `${Math.round(env.moonIllum * 100)}% ${env.moonAlt > 0 ? '↑ ' + env.moonAlt.toFixed(0) + '°' : 'BELOW'}`),
      row('CLOUDS', `${Math.round(env.clouds * 100)} %`, env.clouds > 0.4 ? 'warn' : ''), row('SEEING', `${env.seeing.toFixed(1)}″`), row('TEMP / DEW PT', `${env.temp.toFixed(1)} / ${env.dewPoint.toFixed(1)} °C`), row('SQM', `${loc.sqm.toFixed(2)} · B${loc.bortle}`),
      row('METEORS', (() => { const sh = activeShowers(G.s.time)[0]; const r = env.sunAlt < -12 ? hourlyRate(G.s.time, env.lat, env.lon) : 0; return `~${Math.round(r)}/H${sh && sh.zhr > 3 ? ' · ' + sh.name.toUpperCase() : ''}`; })(), activeShowers(G.s.time).some((x) => x.zhr > 40) ? 'ok' : ''),
      row('GEOMAG', env.aurora && env.aurora.strength > 0.05 ? `KP ${env.kp.toFixed(1)} · AURORA ${env.aurora.strength > 0.5 ? 'STRONG' : 'VISIBLE'}` : `KP ${env.kp.toFixed(1)}`, env.aurora && env.aurora.strength > 0.05 ? 'ok' : ''));
    // cautions
    const flags = [];
    if (n.capOn) flags.push('LENS CAP ON');
    if (n.bahtinov) flags.push('BAHTINOV MASK ON');
    if (n.dew > 0.2) flags.push(`DEW ON OPTICS ${Math.round(n.dew * 100)}%`);
    if (!ri.hasPower && n.battery < 20) flags.push(`LAPTOP BATTERY ${Math.round(n.battery)}%`);
    if (mount.meridian && !n.mount.tracking && n.mount.synced && n.mount.frame === 'hadec') flags.push('MOUNT STOPPED');
    if (env.clouds > 0.6) flags.push('CLOUDS');
    if (n.mount.slew) flags.unshift('SLEWING');
    else if (RT.R.activity) flags.unshift(RT.R.activity.toUpperCase());
    warn.textContent = flags.join('   ·   ');
    // rig
    const ex = S.T.exposure;
    const fd = S.focusDeltaUm(); const cfz = ri.fstop ? 4.88 * 0.55 * ri.fstop ** 2 : 50;
    rig.innerHTML = '';
    rig.append(h('div', { class: 'panel-title' }, 'RIG'),
      row('MOUNT', `${mount.name.split(' ').slice(0, 2).join(' ').toUpperCase()}`), row('OPTICS', ri.opt ? `${Math.round(ri.focal)} MM F/${ri.fstop.toFixed(1)}` : '—'),
      row('POINTING', p ? `ALT ${p.alt.toFixed(1)}° AZ ${p.az.toFixed(1)}°` : '—'),
      row('TRACKING', mount.type === 'fixed' ? 'NONE' : n.mount.slew ? 'SLEWING' : n.mount.tracking ? (n.guider.guiding ? `GUIDED ${n.guider.rms.toFixed(2)}″` : 'SIDEREAL') : 'OFF', mount.type !== 'fixed' && !n.mount.tracking ? 'warn' : ''),
      row('FOCUS', Math.abs(fd) < cfz ? 'IN CFZ' : `${fd > 0 ? '+' : '−'}${Math.abs(fd).toFixed(0)} µM`, Math.abs(fd) < cfz ? 'ok' : ''),
      gauge('EXPOSURE', ex ? Math.min(1, (G.s.time - ex.t0) / 1000 / ex.exp) : 0, ex ? (ex.rendering ? 'DL' : `${Math.min(ex.exp, (G.s.time - ex.t0) / 1000).toFixed(0)}/${ex.exp >= 1 ? ex.exp.toFixed(0) : ex.exp}S`) : 'IDLE', 'exp'),
      gauge('DEW', n.dew, `${Math.round(n.dew * 100)}%`, n.dew > 0.2 ? 'bad' : ''),
      ri.hasPower ? gauge('POWER STN', 1, 'OK', 'ok') : gauge('BATTERY', n.battery / 100, `${Math.round(n.battery)}%`, n.battery < 20 ? 'bad' : 'ok'),
      ri.cam && ri.cam.cooled ? row('SENSOR', `${n.cam.temp.toFixed(1)} °C ${n.cam.coolerOn ? 'COOLING' : ''}`) : row('SENSOR', `${n.cam.temp.toFixed(1)} °C`));
    // session
    const tonight = G.s.frames.filter((f) => f.session === n.id);
    const lights = tonight.filter((f) => f.type === 'light');
    sess.innerHTML = '';
    sess.append(h('div', { class: 'panel-title' }, 'SESSION'),
      row('TARGET', G.s.target ? G.s.target.name.toUpperCase() : '—'),
      row('FRAMES', `${tonight.length} (${lights.length} LIGHT)`), row('INTEGRATION', fmtDur(lights.reduce((a, f) => a + f.exp, 0)).toUpperCase()),
      RT.R.seq && RT.R.seq.state.running ? row('SEQUENCER', RT.R.seq.state.status.toUpperCase().slice(0, 28)) : '');
    if (MP.role !== 'solo') {
      sess.append(h('div', { class: 'panel-title sub' }, MP.role === 'host' ? `CO-OP · CODE ${MP.code}` : `CO-OP · ${MP.code}`));
      for (const pl of Object.values(MP.players)) sess.append(h('div', { class: 'row' }, h('span', { style: { color: pl.color } }, `● ${pl.name}${pl.id === MP.myId ? ' (YOU)' : ''}${pl.host ? ' ★' : ''}`), h('span', { class: 'lbl' }, pl.pose ? (pl.pose.at === 'laptop' ? 'AT LAPTOP' : 'OUTSIDE') : '')));
    }
  }
  const mk = {}; let lastBodies = 0, bodies = [];
  function marker(id, cls, label) {
    if (!mk[id]) { mk[id] = h('div', { class: 'sky-mk ' + cls }, h('i'), h('b', {}, label), h('small')); markers.append(mk[id]); }
    return mk[id];
  }
  function place(m, p, sub) {
    if (!p) { m.style.display = 'none'; return; }
    const pad = 28, off = p.x < pad || p.y < pad || p.x > p.w - pad || p.y > p.h - pad;
    m.style.display = ''; m.classList.toggle('edge', off);
    m.style.transform = `translate(${Math.max(pad, Math.min(p.w - pad, p.x))}px, ${Math.max(pad + 60, Math.min(p.h - pad - 90, p.y))}px)`;
    m.lastChild.textContent = sub || '';
  }
  function updateView(w) {
    const n = G.s.night; if (!n || document.body.classList.contains('hud-off')) return;
    const v = w.viewAltAz();
    compassTape.style.transform = `translateX(${-(v.az + 360) * 4}px)`;
    compass.lastChild.textContent = `${Math.round(v.az).toString().padStart(3, '0')}° · ALT ${v.alt.toFixed(0)}°`;
    const loc = S.locNow(), L = A.lst(G.s.time, loc.lon);
    const p = S.pointing();
    place(marker('scope', 'scope', 'SCOPE'), p && w.projectAltAz(p.alt, p.az), p ? `${p.alt.toFixed(0)}°` : '');
    const t = G.s.target;
    if (t) { const aa = A.radec2altaz(t.ra, t.dec, L, loc.lat); const m = marker('target', 'target', ''); m.children[1].textContent = t.name.toUpperCase(); place(m, w.projectAltAz(aa.alt, aa.az), aa.alt < 0 ? 'BELOW HORIZON' : p ? `${A.sep(p.ra, p.dec, t.ra, t.dec).toFixed(1)}° FROM SCOPE` : ''); }
    else if (mk.target) mk.target.style.display = 'none';
    if (performance.now() - lastBodies > 2000) { lastBodies = performance.now(); bodies = ['Venus', 'Mars', 'Jupiter', 'Saturn', 'Mercury'].map((nm) => S.bodyInfo(nm)); }
    const dark = S.envAt(G.s.time).sunAlt < -4;
    for (const b of bodies) {
      const aa = A.radec2altaz(b.ra, b.dec, L, loc.lat), m = marker('pl-' + b.name, 'planet', b.name.toUpperCase());
      const pp = dark && aa.alt > 0 ? w.projectAltAz(aa.alt, aa.az) : null;
      if (pp && (pp.x < 0 || pp.y < 0 || pp.x > pp.w || pp.y > pp.h)) { m.style.display = 'none'; continue; }
      place(m, pp, '');
    }
  }
  return {
    el, update, updateView,
    setPrompt(t) { prompt.textContent = t || ''; prompt.style.display = t ? '' : 'none'; },
    setGrab(g) { el.classList.toggle('grabbing', g); },
    openChat() { chat.style.display = ''; chat.classList.add('typing'); chatIn.focus(); },
  };
}
void A;
