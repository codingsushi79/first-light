// GuideMaster, Framing assistant, Tonight planner, Weather
import { h, toast, openApp, select, confirmDlg } from '../wm.js';
import { lineChart, Viewer } from '../components.js';
import * as A from '../astro.js';
import { G, on, off, emit, save, fmtTime, fmtDate, localParts, localMs, dayIndexOf } from '../state.js';
import { GEAR, LOC, LOCATIONS, horizonAlt, money } from '../gear.js';
import { cat, TYPE_LABEL } from '../catalog.js';
import { forecast, NIGHT_START_HOUR, NIGHT_SLOTS } from '../weather.js';
import * as S from '../session.js';
import * as RT from '../routines.js';
import { framingImage } from '../imaging.js';
import { setTarget } from './planetarium.js';

// ============================== GuideMaster ==============================
export const guideApp = {
  title: 'GuideMaster', width: 720, height: 520, minW: 520, minH: 380,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b6cb0"/><stop offset="1" stop-color="#16325c"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gg)"/><circle cx="20" cy="20" r="10" fill="none" stroke="#9fd0ff" stroke-width="2"/><path d="M20 6v8M20 26v8M6 20h8M26 20h8" stroke="#fff" stroke-width="2"/><circle cx="21" cy="19" r="2.2" fill="#fff"/></svg>`,
  open(body) {
    const star = h('canvas', { class: 'guide-star', width: 160, height: 160 });
    const graph = h('canvas', { class: 'chart', style: { height: '200px' } });
    const stats = h('div', { class: 'guide-stats' });
    const status = h('div', { class: 'muted' });
    const btns = h('div', { class: 'row wrap' });
    body.append(h('div', { class: 'pad' }, h('div', { class: 'row', style: { alignItems: 'flex-start' } }, star, h('div', { style: { flex: 1 } }, btns, status, stats)), graph,
      h('div', { class: 'muted small' }, 'RA (blue) and Dec (red) guide errors in arcseconds. Guiding corrects polar-alignment drift and periodic error every 2 seconds. Lower RMS = rounder, sharper stars.')));
    function render() {
      const n = S.night(); const ri = S.rig(); btns.innerHTML = '';
      if (!n) { status.textContent = 'Not observing.'; return; }
      if (!ri.hasGuide) { status.textContent = 'No guide scope / guide camera in your rig. Buy a guide kit in AstroMart.'; return; }
      const conn = n.connected.guider;
      btns.append(
        h('button', { class: 'btn ' + (conn ? '' : 'primary'), onclick: () => { if (!conn && !GEAR[G.s.rig.mount].computer && !GEAR[G.s.rig.mount].guideAxes) { toast('Mount cannot be guided.', 'warn'); return; } n.connected.guider = !conn; if (conn) S.stopGuiding('disconnected'); emit('devices'); render(); } }, conn ? 'Disconnect' : 'Connect equipment'),
        h('button', { class: 'btn', disabled: !conn || n.guider.guiding, onclick: async () => {
          if (!n.mount.tracking) { toast('Start tracking first.', 'warn'); return; }
          status.textContent = 'Calibrating… (moving the mount in RA and Dec)'; btns.querySelectorAll('button').forEach((b) => (b.disabled = true));
          try { await S.waitSim(60); n.guider.calibrated = true; status.textContent = 'Calibration complete.'; S.log('Guider calibrated.'); } catch (e) { status.textContent = e.message; }
          render();
        } }, n.guider.calibrated ? 'Re-calibrate' : 'Calibrate'),
        h('button', { class: 'btn ' + (n.guider.guiding ? 'danger' : 'primary'), disabled: !conn, onclick: () => { if (n.guider.guiding) S.stopGuiding('user'); else { const r = S.startGuiding(); if (r.error) toast(r.error, 'warn'); } render(); } }, n.guider.guiding ? '■ Stop guiding' : '◎ Guide'),
        h('button', { class: 'btn', disabled: !n.guider.guiding, onclick: () => { S.dither(8); toast('Dithered.'); } }, 'Dither'));
      if (!status.textContent || status.textContent === 'Not observing.') status.textContent = conn ? (n.guider.calibrated ? 'Ready.' : 'Connected. Calibrate before guiding.') : 'Disconnected.';
      if (GEAR[G.s.rig.mount].guideAxes === 'ra') status.textContent += ' (Tracker: RA-only guiding via ST-4 — declination drift is not corrected.)';
    }
    function draw() {
      const n = S.night(); if (!n) return;
      const hist = S.T.guideHist.slice(-120);
      const t0 = hist.length ? hist[0].t : 0;
      lineChart(graph, [{ data: hist.map((p) => [(p.t - t0) / 1000, p.ra]), color: '#5aa9ff', label: 'RA' }, { data: hist.map((p) => [(p.t - t0) / 1000, p.dec]), color: '#ff6b6b', label: 'Dec' }], { symmetric: true, zero: true, legend: true, empty: 'Not guiding' });
      const rms = (k) => Math.sqrt(hist.reduce((a, p) => a + p[k] ** 2, 0) / Math.max(1, hist.length));
      const ri = S.rig(); const ra = rms('ra'), de = rms('dec'), tot = Math.hypot(ra, de);
      stats.innerHTML = '';
      const kv = (k, v) => stats.append(h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, v)));
      kv('State', n.guider.guiding ? (n.guider.lost ? '⚠ STAR LOST' : (G.s.time < n.guider.settleUntil ? 'Settling…' : 'Guiding')) : 'Idle');
      kv('RMS RA / Dec', hist.length ? `${ra.toFixed(2)}″ / ${de.toFixed(2)}″` : '—');
      kv('RMS total', hist.length ? `${tot.toFixed(2)}″ (${(tot / (ri.scale || 1)).toFixed(2)} main-camera px)` : '—');
      // guide star image
      const ctx = star.getContext('2d'); const W = star.width;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, W);
      if (n.connected.guider && !n.capOn) {
        const last = hist[hist.length - 1] || { ra: 0, dec: 0 }; const env = S.envAt(G.s.time);
        const fade = n.guider.lost ? 0.1 : 1 - env.clouds * 0.7;
        const x = W / 2 + last.ra * 6, y = W / 2 + last.dec * 6, r = 6 + env.seeing * 2;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,255,255,${fade})`); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
        ctx.strokeStyle = '#3f3'; ctx.strokeRect(W / 2 - 16, W / 2 - 16, 32, 32);
      }
    }
    render(); draw();
    const t = setInterval(draw, 400);
    const r2 = () => render(); on('guider', r2); on('devices', r2);
    return { onClose() { clearInterval(t); off('guider', r2); off('devices', r2); } };
  },
};

// ============================== Framing ==============================
export const framingApp = {
  title: 'Framing', width: 900, height: 660, minW: 600, minH: 440,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b3fe4"/><stop offset="1" stop-color="#2a1260"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gf)"/><rect x="9" y="12" width="22" height="16" fill="none" stroke="#fff" stroke-width="2" transform="rotate(-12 20 20)"/><circle cx="20" cy="20" r="3" fill="#ffb3e0"/></svg>`,
  open(body, w, arg) {
    let tgt = arg || G.s.target;
    let center = tgt ? { ra: tgt.ra, dec: tgt.dec } : null;
    let rot = G.s.framingRot || 0;
    let img = null; // {ra, dec, fov, N, canvas}
    const viewer = new Viewer({ placeholder: 'Pick a target (SkyChart → Framing…) to load real survey imagery', drawOverlay: overlay });
    const info = h('div', { class: 'small' });
    const rotIn = h('input', { type: 'range', min: 0, max: 359, value: rot, oninput: (e) => { rot = +e.target.value; G.s.framingRot = rot; rotL.textContent = `${rot}°`; viewer.draw(); } });
    const rotL = h('b', {}, `${rot}°`);
    const side = h('div', { class: 'fr-side' },
      h('div', { class: 'card' }, h('h3', {}, 'Target'), info),
      h('div', { class: 'card' }, h('h3', {}, 'Camera rotation (PA)'), rotIn, rotL, h('div', { class: 'muted small' }, 'Position angle of the frame’s top edge, east of north. To match it, rotate your camera in the Field view and check with a plate solve.')),
      h('div', { class: 'card' }, h('div', { class: 'col' },
        h('button', { class: 'btn primary', onclick: () => { if (!center) return; setTarget({ id: (tgt && tgt.id) || 'Custom', name: (tgt && tgt.name) || 'Custom framing', ra: center.ra, dec: center.dec, size: tgt ? tgt.size : 0 }); toast('Target set — used by AstroCap sequencer & centering.'); } }, '★ Use this framing as target'),
        h('button', { class: 'btn', onclick: async () => { if (!center) return; setTarget({ id: (tgt && tgt.id) || 'Custom', name: (tgt && tgt.name) || 'Custom', ra: center.ra, dec: center.dec, size: tgt ? tgt.size : 0 }); RT.R.abort = false; try { await RT.centerOn(G.s.target, (m) => S.log(m)); toast('Centered.'); } catch (e) { toast(e.message, 'warn'); } } }, 'Slew & center now'),
        h('button', { class: 'btn', onclick: () => load() }, 'Reload survey image'))),
      h('div', { class: 'muted small' }, 'Imagery: Digitized Sky Survey 2 (color) / Mellinger, via CDS hips2fits. Drag the image to move the frame center.'));
    body.append(h('div', { class: 'fr-root' }, viewer.el, side));
    viewer.onClickImg = (x, y) => {
      if (!img) return;
      const sc = img.fov / img.N; const xi = -(x - img.N / 2) * sc * A.D2R, eta = -(y - img.N / 2) * sc * A.D2R;
      center = A.tanDeproject(img.ra, img.dec, xi, eta); viewer.draw(); upd();
    };
    function overlay(o, v) {
      if (!img || !center) return;
      const ri = S.rig(); if (!ri.opt) return;
      const pxPerDeg = (img.N / img.fov) * v.s;
      const p = A.tanProject(img.ra, img.dec, center.ra, center.dec);
      const cx = v.ox + (img.N / 2 - p.xi * A.R2D * img.N / img.fov) * v.s, cy = v.oy + (img.N / 2 - p.eta * A.R2D * img.N / img.fov) * v.s;
      o.save(); o.translate(cx, cy); o.rotate(-rot * A.D2R);
      o.strokeStyle = '#ff4d6d'; o.lineWidth = 2; o.strokeRect(-ri.fovW / 2 * pxPerDeg, -ri.fovH / 2 * pxPerDeg, ri.fovW * pxPerDeg, ri.fovH * pxPerDeg);
      o.fillStyle = '#ff4d6d'; o.beginPath(); o.moveTo(-6, -ri.fovH / 2 * pxPerDeg - 2); o.lineTo(6, -ri.fovH / 2 * pxPerDeg - 2); o.lineTo(0, -ri.fovH / 2 * pxPerDeg - 10); o.fill();
      o.restore();
      o.strokeStyle = 'rgba(255,255,255,.5)'; o.beginPath(); o.arc(cx, cy, 4, 0, 7); o.stroke();
      o.fillStyle = '#fff'; o.font = '12px system-ui'; o.fillText('N ↑  E ←', v.w - 70, 18);
    }
    function upd() {
      info.innerHTML = '';
      if (!tgt) { info.textContent = 'No target.'; return; }
      const ri = S.rig();
      info.append(h('div', {}, h('b', {}, tgt.name || tgt.id)), h('div', { class: 'muted' }, center ? `${A.fmtRA(center.ra)} ${A.fmtDec(center.dec)}` : ''),
        ri.opt ? h('div', { class: 'muted' }, `Your FOV: ${ri.fovW.toFixed(2)}° × ${ri.fovH.toFixed(2)}° (${Math.round(ri.focal)}mm on ${ri.cam.name.split('(')[0]})`) : null);
    }
    async function load() {
      if (!center) { upd(); return; }
      const ri = S.rig();
      const fov = Math.max(ri.fovW * 1.8, (tgt && tgt.size ? tgt.size / 60 * 1.6 : 0), 0.3);
      info.append(h('div', { class: 'muted' }, 'Downloading survey image…'));
      try {
        const res = await framingImage(center.ra, center.dec, Math.min(fov, 120), 1000);
        const c = document.createElement('canvas'); c.width = res.N; c.height = res.N; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(res.rgba.buffer || res.rgba), res.N, res.N), 0, 0);
        img = { ...res, canvas: c }; viewer.setImage(c); upd();
        if (res.synthetic) toast('Survey server unreachable — showing catalog stars only.', 'warn');
      } catch (e) { toast('Could not load survey image: ' + e.message, 'warn'); }
    }
    upd(); load();
    return { onArg(a) { tgt = a; center = { ra: a.ra, dec: a.dec }; load(); }, onResize() { viewer.draw(); } };
  },
};

// ============================== Tonight planner ==============================
export const tonightApp = {
  title: 'Tonight', width: 900, height: 620, minW: 600, minH: 400,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f3d5e"/><stop offset="1" stop-color="#05121f"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gt)"/><path d="M6 30 Q20 4 34 30" stroke="#ffcc66" stroke-width="2.4" fill="none"/><circle cx="20" cy="17" r="3" fill="#ffcc66"/><path d="M5 31h30" stroke="#5c8" stroke-width="2"/></svg>`,
  open(body) {
    const chart = h('canvas', { class: 'chart', style: { height: '220px' } });
    const list = h('div', { class: 'tn-list' });
    const filt = h('select', { class: 'inp' }, ...['All', 'Galaxies', 'Nebulae', 'Clusters', 'Wide fields'].map((x) => h('option', {}, x)));
    const fitChk = h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: true }), 'Only targets that suit my FOV');
    const head = h('div', { class: 'small muted' });
    body.append(h('div', { class: 'pad tn-root' }, head, chart, h('div', { class: 'row' }, filt, fitChk), list));
    let sel = G.s.target;
    function nightWindow() {
      const loc = S.locNow(); const p = localParts(G.s.time - (localParts(G.s.time, loc.tz).h < 12 ? 86400000 : 0), loc.tz);
      const noon = localMs(p.y, p.mo, p.d, 12, 0, loc.tz);
      const ev = A.nightEvents(noon, loc.lat, loc.lon);
      return { noon, ev, t0: noon + 5 * 3600000, t1: noon + 20 * 3600000, loc };
    }
    function render() {
      const { ev, t0, t1, loc } = nightWindow();
      const ri = S.rig(); const ph = A.moonPhase(t0 + 6 * 3600000);
      head.innerHTML = `<b>${loc.name}</b> · ${fmtDate(t0, loc.tz)} · Sunset ${ev.sunStart ? fmtTime(ev.sunStart, loc.tz) : '—'} · Astro dark ${ev.astroStart ? fmtTime(ev.astroStart, loc.tz) : '—'}–${ev.astroEnd ? fmtTime(ev.astroEnd, loc.tz) : '—'} · Moon ${(ph.illum * 100).toFixed(0)}% ${ph.waxing ? 'waxing' : 'waning'}`;
      const f = filt.value, onlyFit = fitChk.querySelector('input').checked;
      const L = (t) => A.lst(t, loc.lon);
      const darkStart = ev.astroStart || ev.nautStart || t0 + 3 * 3600000, darkEnd = ev.astroEnd || ev.nautEnd || t1 - 3 * 3600000;
      const rows = [];
      for (const d of cat.dsos) {
        if (!d.curated && !/^M\d/.test(d.id)) continue;
        if (f === 'Galaxies' && d.type !== 'galaxy' && !/g$/.test(d.type)) continue;
        if (f === 'Nebulae' && !['nebula', 'planetary', 'snr', 'dark', 'en', 'rn', 'pn', 'bn', 'sn'].includes(d.type)) continue;
        if (f === 'Clusters' && !['cluster', 'oc', 'gc'].includes(d.type)) continue;
        if (f === 'Wide fields' && !['milkyway', 'star'].includes(d.type) && d.size < 150) continue;
        let maxAlt = -90, tMax = 0, hours = 0;
        for (let t = darkStart; t <= darkEnd; t += 15 * 60000) { const a = A.radec2altaz(d.ra, d.dec, L(t), loc.lat).alt; if (a > maxAlt) { maxAlt = a; tMax = t; } if (a > 30) hours += 0.25; }
        if (maxAlt < 15) continue;
        const fit = ri.opt && d.size ? (d.size / 60) / Math.min(ri.fovW, ri.fovH) : 0.5;
        if (onlyFit && ri.opt && (fit > 1.3 || fit < 0.06)) continue;
        const now = A.radec2altaz(d.ra, d.dec, L(G.s.time), loc.lat).alt;
        rows.push({ d, maxAlt, tMax, hours, fit, now, score: hours * 2 + maxAlt / 30 + (fit > 0.2 && fit < 0.9 ? 2 : 0) + (d.curated ? 1.5 : 0) });
      }
      rows.sort((a, b) => b.score - a.score);
      list.innerHTML = '';
      const tbl = h('table', { class: 'tbl' }, h('tr', {}, ...['Target', 'Type', 'Size', 'Now', 'Max alt', 'Transit', 'Hours >30°', 'Frame fill', ''].map((x) => h('th', {}, x))));
      for (const r of rows.slice(0, 60)) {
        const tr = h('tr', { class: sel && sel.id === r.d.id ? 'active' : '', onclick: () => { sel = r.d; drawChart(); render(); } },
          h('td', {}, h('b', {}, r.d.id), r.d.name !== r.d.id ? ' ' + r.d.name : ''), h('td', {}, TYPE_LABEL[r.d.type] || r.d.type), h('td', {}, r.d.size >= 60 ? `${(r.d.size / 60).toFixed(1)}°` : `${r.d.size}′`),
          h('td', {}, `${r.now.toFixed(0)}°`), h('td', {}, `${r.maxAlt.toFixed(0)}°`), h('td', {}, fmtTime(r.tMax, loc.tz)), h('td', {}, r.hours.toFixed(1)),
          h('td', {}, ri.opt ? `${Math.round(r.fit * 100)}%` : '—'),
          h('td', {}, h('button', { class: 'btn tiny', onclick: (e) => { e.stopPropagation(); setTarget(r.d); openApp('framing', G.s.target); } }, 'Frame'), h('button', { class: 'btn tiny', onclick: (e) => { e.stopPropagation(); setTarget(r.d); openApp('planetarium', r.d); } }, 'Chart')));
        tbl.append(tr);
      }
      list.append(rows.length ? tbl : h('div', { class: 'muted' }, 'Nothing fits these filters tonight.'));
      drawChart();
    }
    function drawChart() {
      const { ev, t0, t1, loc } = nightWindow();
      const series = []; const L = (t) => A.lst(t, loc.lon);
      const moon = []; const tgt = []; const hz = [];
      for (let t = t0; t <= t1; t += 10 * 60000) {
        const x = (t - t0) / 3600000;
        moon.push([x, A.moonAltAz(t, loc.lat, loc.lon).alt]);
        if (sel) { const aa = A.radec2altaz(sel.ra, sel.dec, L(t), loc.lat); tgt.push([x, aa.alt]); hz.push([x, horizonAlt(loc, aa.az)]); }
      }
      series.push({ data: moon, color: '#c8c8a0', label: 'Moon' });
      if (sel) { series.push({ data: hz, color: '#3c6e3c', label: 'Trees/horizon' }); series.push({ data: tgt, color: '#ffcc66', label: sel.id, width: 2.2 }); }
      const bands = []; const X = (t) => (t - t0) / 3600000;
      if (ev.sunStart && ev.astroStart) bands.push({ x0: X(ev.sunStart), x1: X(ev.astroStart), color: 'rgba(70,90,140,.25)' });
      if (ev.astroEnd && ev.sunEnd) bands.push({ x0: X(ev.astroEnd), x1: X(ev.sunEnd), color: 'rgba(70,90,140,.25)' });
      if (ev.sunEnd) bands.push({ x0: X(ev.sunEnd), x1: X(t1), color: 'rgba(120,140,190,.35)' });
      if (ev.sunStart) bands.push({ x0: 0, x1: X(ev.sunStart), color: 'rgba(120,140,190,.35)' });
      const xticks = []; for (let hh = 0; hh <= 15; hh += 2) { const t = t0 + hh * 3600000; xticks.push([hh, fmtTime(t, loc.tz)]); }
      const vl = []; if (S.night()) vl.push({ x: X(G.s.time), color: '#ff5050', label: 'now' });
      lineChart(chart, series, { ymin: 0, ymax: 90, xmin: 0, xmax: 15, bands, xticks, legend: true, vlines: vl });
    }
    filt.onchange = render; fitChk.querySelector('input').onchange = render;
    render();
    const rr = () => render(); on('catalog', rr); on('rig', rr); on('night', rr);
    return { onClose() { off('catalog', rr); off('rig', rr); off('night', rr); }, onResize() { drawChart(); } };
  },
};

// ============================== Weather ==============================
export const weatherApp = {
  title: 'Weather', width: 960, height: 600, minW: 640, minH: 400,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3aa0ff"/><stop offset="1" stop-color="#1450a0"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gw)"/><circle cx="16" cy="16" r="6" fill="#ffd34d"/><path d="M12 29h16a5 5 0 0 0 0-10 7 7 0 0 0-13 2 4 4 0 0 0-3 8z" fill="#fff"/></svg>`,
  open(body) {
    let locId = G.s.mode === 'night' ? G.s.location : (G.s.wxLoc || 'backyard');
    const content = h('div', { class: 'pad' });
    body.append(content);
    function render() {
      content.innerHTML = '';
      const loc = LOC[locId]; const home = LOC.backyard;
      const today = dayIndexOf(G.s.time, home.tz);
      const locSel = select(LOCATIONS.map((l) => [l.id, `${l.name} — Bortle ${l.bortle}${l.travel ? ' · ' + money(l.travel) : ' · free'}`]), locId, (v) => { locId = v; G.s.wxLoc = v; render(); });
      content.append(h('div', { class: 'row wrap' }, h('b', {}, 'Location'), locSel, h('button', { class: 'btn small', onclick: () => openApp('atlas') }, '🌍 Pick anywhere on Earth…'), h('span', { class: 'muted small' }, loc.desc)));
      // night action
      const n = S.night();
      const act = h('div', { class: 'card wx-act' });
      if (n) {
        act.append(h('div', {}, `You are out at `, h('b', {}, LOC[n.loc].name), '. Frames are saved automatically.'),
          h('button', { class: 'btn danger', onclick: async () => { if (await confirmDlg('Pack up?', 'End the session and drive home? Any running exposure will be aborted.', 'Pack up')) { S.endNight('user'); } } }, 'Pack up & go home'));
      } else {
        const hr = localParts(G.s.time, home.tz).h;
        act.append(h('div', {}, `It’s ${fmtDate(G.s.time, home.tz)}, ${fmtTime(G.s.time, home.tz)}. `, hr >= 4 ? 'Tonight’s forecast for this site is below.' : ''),
          h('button', { class: 'btn primary big', onclick: () => { const r = S.startNight(locId); if (r.error) toast(r.error, 'warn'); else { toast(`Driving to ${loc.name}… you set up as the sun goes down.`); emit('wentOut'); } } }, `🌙 Head out tonight → ${loc.name}${loc.travel ? ' (' + money(loc.travel) + ')' : ''}`),
          h('button', { class: 'btn', onclick: async () => { if (await confirmDlg('Skip a day?', 'Stay in tonight and skip to tomorrow?', 'Skip')) S.skipDay(); render(); } }, 'Stay in, skip to tomorrow'));
      }
      content.append(act);
      // 5-night forecast grid
      const days = 5;
      for (let d = 0; d < days; d++) {
        const di = today + d; const fc = forecast(locId, di, today);
        const noon = (di * 86400000) + 12 * 3600000 - loc.tz * 3600000 + 86400000 * 0;
        const noonFix = noonForDay(di, loc.tz);
        const ev = A.nightEvents(noonFix, loc.lat, loc.lon);
        const ph = A.moonPhase(noonFix + 10 * 3600000);
        const grid = h('div', { class: 'wx-grid' });
        const label = (t) => grid.append(h('div', { class: 'wx-lab' }, t));
        const cell = (v, bg, title) => grid.append(h('div', { class: 'wx-cell', style: { background: bg }, title }, v));
        label('');
        for (let i = 0; i < NIGHT_SLOTS; i++) grid.append(h('div', { class: 'wx-hr' }, String((NIGHT_START_HOUR + i) % 24)));
        label('Clouds');
        fc.clouds.forEach((c) => cell('', `rgb(${Math.round(20 + 200 * c)},${Math.round(40 + 190 * c)},${Math.round(110 + 140 * c)})`, `${Math.round(c * 100)}% cloud`));
        label('Transparency');
        fc.transp.forEach((v) => cell('', `hsl(210,70%,${Math.round(15 + 45 * (1 - v))}%)`, `transparency ${(v * 100).toFixed(0)}%`));
        label('Seeing');
        fc.seeing.forEach((v) => cell(v.toFixed(1), `hsl(${Math.max(0, 140 - (v - 1) * 45)},60%,30%)`, `${v}″ FWHM`));
        label('Darkness');
        for (let i = 0; i < NIGHT_SLOTS; i++) {
          const t = noonFix + (NIGHT_START_HOUR - 12 + i) * 3600000 + 1800000;
          const sun = A.sunAltAz(t, loc.lat, loc.lon).alt, moon = A.moonAltAz(t, loc.lat, loc.lon).alt;
          const dark = sun > -6 ? 0.05 : sun > -12 ? 0.3 : sun > -18 ? 0.6 : moon > 0 ? 1 - ph.illum * 0.7 : 1;
          cell('', `rgb(${Math.round(200 - 190 * dark)},${Math.round(210 - 200 * dark)},${Math.round(230 - 200 * dark)})`, sun > -18 ? 'twilight' : moon > 0 ? `moon up (${(ph.illum * 100).toFixed(0)}%)` : 'dark');
        }
        label('Wind km/h'); fc.wind.forEach((v) => cell(v, `hsl(${Math.max(0, 120 - v * 4)},50%,25%)`));
        label('Temp °C'); fc.temp.forEach((v) => cell(Math.round(v), 'transparent'));
        label('Humidity'); fc.hum.forEach((v) => cell(Math.round(v * 100), `hsl(200,50%,${Math.round(10 + v * 25)}%)`));
        content.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, d === 0 ? 'Tonight' : fmtDate(noonFix, loc.tz)), h('span', { class: 'muted small' }, ` · astro dark ${ev.astroStart ? fmtTime(ev.astroStart, loc.tz) : '—'}–${ev.astroEnd ? fmtTime(ev.astroEnd, loc.tz) : '—'} · 🌙 ${(ph.illum * 100).toFixed(0)}%`), fc.lead > 1 ? h('span', { class: 'muted small' }, ` · forecast uncertainty ±${Math.round(fc.lead * 12)}%`) : null), grid));
        void noon;
      }
      content.append(h('div', { class: 'muted small' }, 'Read it like a Clear Sky Chart: dark blue = clear, white = overcast. Seeing is the blur from air turbulence (lower = sharper). Forecasts further out are less reliable.'));
    }
    render();
    const rr = () => render(); on('night', rr); on('newday', rr);
    return { onClose() { off('night', rr); off('newday', rr); } };
  },
};
function noonForDay(dayIndex, tz) { return dayIndex * 86400000 + 12 * 3600000 - tz * 3600000; }
