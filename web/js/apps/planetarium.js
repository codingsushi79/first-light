// SkyChart — planetarium with real star catalog, constellations, Milky Way and deep-sky objects.
import { h, toast, openApp } from '../wm.js';
import * as A from '../astro.js';
import { G, on, off, emit, save, fmtTime } from '../state.js';
import { cat, findLocal, sesame, bvToRGB, TYPE_LABEL } from '../catalog.js';
import { GEAR, horizonAlt } from '../gear.js';
import * as S from '../session.js';
import * as RT from '../routines.js';

export function setTarget(t) {
  G.s.target = { id: t.id, name: t.name || t.id, ra: t.ra, dec: t.dec, size: t.size || 0, type: t.type || '' };
  save(); emit('target', G.s.target);
}

export const planetariumApp = {
  title: 'SkyChart', width: 1080, height: 700, minW: 600, minH: 400,
  icon: `<svg viewBox="0 0 40 40"><defs><radialGradient id="gp" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#28407a"/><stop offset="1" stop-color="#070b1f"/></radialGradient></defs><rect width="40" height="40" rx="9" fill="url(#gp)"/><g fill="#fff"><circle cx="10" cy="12" r="1.4"/><circle cx="19" cy="9" r="1"/><circle cx="28" cy="14" r="1.6"/><circle cx="24" cy="24" r="1.2"/><circle cx="13" cy="27" r="1"/><circle cx="31" cy="29" r=".9"/></g><path d="M10 12L19 9 28 14 24 24 13 27" stroke="#7fb2ff" stroke-width=".9" fill="none"/></svg>`,
  open(body) {
    const canvas = h('canvas', { class: 'pl-canvas' });
    const search = h('input', { class: 'inp', placeholder: 'Search: M31, NGC 7000, Vega, Sh2-129, any SIMBAD name…', style: { width: '320px' } });
    const results = h('div', { class: 'pl-results' });
    const info = h('div', { class: 'pl-info' });
    const opts = G.s.chartOpts || (G.s.chartOpts = { lines: true, labels: true, dsos: true, mw: true, azgrid: false, eqgrid: false, fov: true, ground: true });
    const tog = (k, label) => h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: opts[k], onchange: (e) => { opts[k] = e.target.checked; draw(); } }), label);
    const timeLbl = h('span', { class: 'muted' });
    const bar = h('div', { class: 'pl-bar' }, search,
      tog('lines', 'Constellations'), tog('labels', 'Labels'), tog('dsos', 'Deep sky'), tog('mw', 'Milky Way'), tog('azgrid', 'Alt/Az grid'), tog('eqgrid', 'RA/Dec grid'), tog('ground', 'Ground'), tog('fov', 'Camera FOV'),
      h('button', { class: 'btn small', onclick: () => centerOnScope() }, '⌖ Scope'), timeLbl);
    const wrap = h('div', { class: 'pl-wrap' }, canvas, results, info);
    body.append(h('div', { class: 'pl-root' }, bar, wrap));

    const loc = () => S.locNow();
    let view = G.s.chartView || (G.s.chartView = { alt: 35, az: 180, fov: 110 });
    let sel = null;
    let proj = null;

    // ---------- projection (stereographic, alt/az) ----------
    function setupProj(W, H) {
      const L = A.lst(G.s.time, loc().lon), lat = loc().lat;
      const a0 = view.alt * A.D2R, z0 = view.az * A.D2R;
      const R = (Math.min(W, H) * 0.5) / (2 * Math.tan((view.fov * A.D2R) / 4)) * (Math.max(W, H) / Math.min(W, H)) * 0.92;
      // rotation basis: center vector c, right vector r, up vector u (in local ENU: x=east, y=north, z=up)
      const vec = (alt, az) => [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
      const c = vec(a0, z0); const r = [Math.cos(z0), -Math.sin(z0), 0]; const u = [c[1] * r[2] - c[2] * r[1], c[2] * r[0] - c[0] * r[2], c[0] * r[1] - c[1] * r[0]];
      const fromAltAz = (alt, az) => {
        const v = vec(alt * A.D2R, az * A.D2R);
        const X = v[0] * r[0] + v[1] * r[1] + v[2] * r[2], Y = v[0] * u[0] + v[1] * u[1] + v[2] * u[2], Z = v[0] * c[0] + v[1] * c[1] + v[2] * c[2];
        if (Z < -0.6) return null;
        const k = 2 / (1 + Z);
        return [W / 2 + X * k * R, H / 2 - Y * k * R];
      };
      const fromRaDec = (ra, dec) => { const aa = A.radec2altaz(ra, dec, L, lat); return fromAltAz(aa.alt, aa.az); };
      const toAltAz = (x, y) => {
        const X = (x - W / 2) / R, Y = -(y - H / 2) / R; const rr = X * X + Y * Y; const Z = (4 - rr) / (4 + rr); const k = (1 + Z) / 2;
        const xx = X * k, yy = Y * k;
        const v = [xx * r[0] + yy * u[0] + Z * c[0], xx * r[1] + yy * u[1] + Z * c[1], xx * r[2] + yy * u[2] + Z * c[2]];
        return { alt: Math.asin(Math.max(-1, Math.min(1, v[2]))) * A.R2D, az: A.norm360(Math.atan2(v[0], v[1]) * A.R2D) };
      };
      proj = { W, H, R, L, lat, fromAltAz, fromRaDec, toAltAz, pxPerDeg: R * A.D2R };
      return proj;
    }

    function draw() {
      const r = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
      const W = r.width, H = r.height; if (W < 10) return;
      canvas.width = W * dpr; canvas.height = H * dpr;
      const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const P = setupProj(W, H);
      const sun = A.sunAltAz(G.s.time, P.lat, loc().lon);
      // sky color by sun altitude
      const t = Math.max(0, Math.min(1, (sun.alt + 18) / 18));
      const top = mix([3, 5, 12], [40, 80, 150], t ** 1.5), bot = mix([8, 12, 24], [140, 120, 140], t ** 1.2);
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgb(${top})`); g.addColorStop(1, `rgb(${bot})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const dark = 1 - t;
      // milky way
      if (opts.mw && cat.loaded && dark > 0.2) {
        for (const poly of cat.mw) {
          ctx.beginPath(); let started = false, ok = true;
          for (const [ra, dec] of poly.pts) { const p = P.fromRaDec(ra, dec); if (!p) { ok = false; break; } if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]); }
          if (!ok) continue; ctx.closePath(); ctx.fillStyle = `rgba(160,175,210,${0.035 * dark})`; ctx.fill();
        }
      }
      // grids
      ctx.lineWidth = 1;
      if (opts.eqgrid) {
        ctx.strokeStyle = 'rgba(90,150,255,.22)';
        for (let ra = 0; ra < 360; ra += 15) polyline(ctx, P, (i) => [ra, -88 + i * 2], 89);
        for (let dec = -80; dec <= 80; dec += 10) polyline(ctx, P, (i) => [i * 4, dec], 91);
      }
      if (opts.azgrid) {
        ctx.strokeStyle = 'rgba(120,255,160,.18)';
        for (let az = 0; az < 360; az += 15) polylineAA(ctx, P, (i) => [i * 2, az], 46);
        for (let alt = 0; alt <= 80; alt += 10) polylineAA(ctx, P, (i) => [alt, i * 4], 91);
      }
      // constellation lines
      if (opts.lines && cat.loaded) {
        ctx.strokeStyle = `rgba(90,140,220,${0.35 + 0.2 * dark})`; ctx.lineWidth = 1;
        for (const l of cat.lines) { ctx.beginPath(); let prev = null; for (const [ra, dec] of l) { const p = P.fromRaDec(ra, dec); if (p && prev) ctx.lineTo(p[0], p[1]); else if (p) ctx.moveTo(p[0], p[1]); prev = p; } ctx.stroke(); }
        if (opts.labels) { ctx.fillStyle = 'rgba(120,160,230,.55)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; for (const c of cat.constNames) { const p = P.fromRaDec(c.ra, c.dec); if (p && inView(p, W, H)) ctx.fillText(c.name.toUpperCase(), p[0], p[1]); } }
      }
      // stars
      const limMag = Math.min(6.5, 3.2 + 2.6 * dark + Math.log10(120 / view.fov) * 1.6);
      if (cat.loaded) {
        ctx.textAlign = 'left';
        for (const s of cat.stars) {
          if (s.mag > limMag) break;
          const p = P.fromRaDec(s.ra, s.dec); if (!p || !inView(p, W, H)) continue;
          const rad = Math.max(0.6, (limMag - s.mag) * 0.75 + 0.4) * Math.min(1.6, Math.max(0.8, 60 / view.fov) ** 0.15);
          const [cr, cg, cb] = bvToRGB(s.bv);
          ctx.fillStyle = `rgb(${cr * 255 | 0},${cg * 255 | 0},${cb * 255 | 0})`;
          ctx.beginPath(); ctx.arc(p[0], p[1], rad, 0, 7); ctx.fill();
          if (opts.labels && s.name && s.mag < limMag - 2.5) { ctx.fillStyle = 'rgba(220,220,200,.75)'; ctx.font = '11px system-ui'; ctx.fillText(s.name, p[0] + rad + 3, p[1] + 3); }
        }
      }
      // DSOs
      if (opts.dsos && cat.loaded) {
        ctx.font = '11px system-ui'; ctx.textAlign = 'left';
        for (const d of cat.dsos) {
          if (!d.curated && view.fov > 60 && !/^M\d/.test(d.id)) continue;
          const p = P.fromRaDec(d.ra, d.dec); if (!p || !inView(p, W, H)) continue;
          const rpx = Math.max(4, (d.size / 60) * P.pxPerDeg / 2);
          ctx.strokeStyle = dsoColor(d.type); ctx.lineWidth = 1.2;
          ctx.beginPath();
          if (d.type === 'galaxy' || /g$/.test(d.type)) ctx.ellipse(p[0], p[1], rpx, rpx * 0.55, 0.5, 0, 7);
          else if (d.type === 'cluster' || d.type === 'oc' || d.type === 'gc') ctx.arc(p[0], p[1], rpx, 0, 7);
          else ctx.rect(p[0] - rpx, p[1] - rpx, rpx * 2, rpx * 2);
          ctx.stroke();
          if (opts.labels && (d.curated || view.fov < 40)) { ctx.fillStyle = dsoColor(d.type); ctx.fillText(d.curated && d.id !== d.name ? `${d.id} ${d.name.length < 22 ? d.name : ''}` : d.id, p[0] + rpx + 3, p[1] - 2); }
        }
      }
      // moon
      const moon = A.moonAltAz(G.s.time, P.lat, loc().lon); const ph = A.moonPhase(G.s.time);
      const mp = P.fromAltAz(moon.alt, moon.az);
      if (mp) { const mr = Math.max(7, 0.26 * P.pxPerDeg); drawMoon(ctx, mp[0], mp[1], mr, ph); ctx.fillStyle = '#ddd'; ctx.fillText(`Moon ${(ph.illum * 100).toFixed(0)}%`, mp[0] + mr + 4, mp[1]); }
      const sp = P.fromAltAz(sun.alt, sun.az); if (sp) { ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(sp[0], sp[1], Math.max(8, 0.26 * P.pxPerDeg), 0, 7); ctx.fill(); }
      // ground
      if (opts.ground) {
        ctx.beginPath(); let first = true;
        for (let az = 0; az <= 360; az += 1) { const p = P.fromAltAz(horizonAlt(loc(), az), az); if (!p) continue; if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]); }
        for (let az = 360; az >= 0; az -= 5) { const p = P.fromAltAz(-60, az); if (p) ctx.lineTo(p[0], p[1]); }
        ctx.closePath(); ctx.fillStyle = `rgba(${mix([10, 14, 10], [40, 52, 34], t)},0.93)`; ctx.fill();
        ctx.strokeStyle = 'rgba(160,190,140,.4)'; ctx.beginPath(); first = true; for (let az = 0; az <= 360; az += 1) { const p = P.fromAltAz(0, az); if (!p) { first = true; continue; } if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]); } ctx.stroke();
        ctx.fillStyle = '#e8c070'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center';
        for (const [az, l] of [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']]) { const p = P.fromAltAz(-2.5, az); if (p && inView(p, W, H)) ctx.fillText(l, p[0], p[1] + 6); }
      }
      // telescope reticle and camera FOV
      const n = S.night();
      if (n) {
        const rp = S.reportedPointing();
        const ls = n.lastSolve;
        const pt = rp || (ls && G.s.time - ls.t < 3600000 ? ls : null);
        if (pt) {
          const p = P.fromRaDec(pt.ra, pt.dec);
          if (p) {
            ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, 7); ctx.moveTo(p[0] - 18, p[1]); ctx.lineTo(p[0] - 6, p[1]); ctx.moveTo(p[0] + 6, p[1]); ctx.lineTo(p[0] + 18, p[1]); ctx.moveTo(p[0], p[1] - 18); ctx.lineTo(p[0], p[1] - 6); ctx.moveTo(p[0], p[1] + 6); ctx.lineTo(p[0], p[1] + 18); ctx.stroke();
            ctx.fillStyle = '#ff6b6b'; ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.fillText(rp ? 'Mount' : 'Last plate solve', p[0] + 14, p[1] + 22);
            if (opts.fov) drawFov(ctx, P, pt.ra, pt.dec, S.pointing().pa);
          }
        }
      }
      if (sel && opts.fov) {
        const p = P.fromRaDec(sel.ra, sel.dec);
        if (p) { ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(p[0], p[1], 14, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      }
      timeLbl.textContent = `${fmtTime(G.s.time, loc().tz)} · ${loc().name} · FOV ${view.fov.toFixed(1)}°`;
    }
    function drawFov(ctx, P, ra, dec, pa) {
      const ri = S.rig(); if (!ri.opt) return;
      const w = ri.fovW / 2, hgt = ri.fovH / 2;
      const corners = [[-w, hgt], [w, hgt], [w, -hgt], [-w, -hgt]];
      ctx.strokeStyle = 'rgba(255,90,90,.9)'; ctx.lineWidth = 1.3; ctx.beginPath();
      corners.forEach(([x, y], i) => {
        // x right (west), y up; rotate by PA: up = PA, right = PA-90
        const th = pa * A.D2R;
        const E = -(x * Math.cos(th)) + y * Math.sin(th), N = x * Math.sin(th) + y * Math.cos(th);
        const q = A.tanDeproject(ra, dec, E * A.D2R, N * A.D2R);
        const p = P.fromRaDec(q.ra, q.dec); if (!p) return;
        i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
      });
      ctx.closePath(); ctx.stroke();
    }
    function polyline(ctx, P, fn, n) { ctx.beginPath(); let prev = null; for (let i = 0; i < n; i++) { const [ra, dec] = fn(i); const p = P.fromRaDec(ra, dec); if (p && prev) ctx.lineTo(p[0], p[1]); else if (p) ctx.moveTo(p[0], p[1]); prev = p; } ctx.stroke(); }
    function polylineAA(ctx, P, fn, n) { ctx.beginPath(); let prev = null; for (let i = 0; i < n; i++) { const [alt, az] = fn(i); const p = P.fromAltAz(alt, az); if (p && prev) ctx.lineTo(p[0], p[1]); else if (p) ctx.moveTo(p[0], p[1]); prev = p; } ctx.stroke(); }
    const inView = (p, W, H) => p[0] > -50 && p[1] > -50 && p[0] < W + 50 && p[1] < H + 50;

    // ---------- interaction ----------
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, alt: view.alt, az: view.az, moved: false }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved || !proj) return;
      const degPerPx = 1 / proj.pxPerDeg;
      view.az = A.norm360(drag.az - dx * degPerPx / Math.max(0.2, Math.cos(view.alt * A.D2R)));
      view.alt = Math.max(-30, Math.min(90, drag.alt + dy * degPerPx));
      draw();
    });
    canvas.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) pick(e);
      drag = null; save();
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.fov = Math.max(0.5, Math.min(200, view.fov * (e.deltaY < 0 ? 0.85 : 1.18))); draw(); }, { passive: false });

    function pick(e) {
      if (!proj) return;
      const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 14;
      const consider = (o, ra, dec) => { const p = proj.fromRaDec(ra, dec); if (!p) return; const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = o; } };
      if (opts.dsos) for (const d of cat.dsos) { if (!d.curated && view.fov > 60 && !/^M\d/.test(d.id)) continue; consider({ ...d, kind: 'dso' }, d.ra, d.dec); }
      for (const s of cat.stars) { if (s.mag > 6) break; consider({ id: s.name || s.desig || `HIP ${s.id}`, name: s.name || s.desig || `HIP ${s.id}`, type: 'star', ra: s.ra, dec: s.dec, mag: s.mag, size: 0, desc: `Star · mag ${s.mag.toFixed(2)} · B−V ${s.bv.toFixed(2)}`, kind: 'star' }, s.ra, s.dec); }
      if (!best) { const aa = proj.toAltAz(x, y); const rd = A.altaz2radec(aa.alt, aa.az, proj.L, proj.lat); best = { id: 'Sky position', name: `RA ${A.fmtRA(rd.ra)}`, type: 'pos', ra: rd.ra, dec: rd.dec, size: 0, desc: 'Empty sky position', kind: 'pos' }; }
      select(best);
    }
    function select(o) { sel = o; showInfo(); draw(); }
    function showInfo() {
      info.innerHTML = '';
      if (!sel) { info.style.display = 'none'; return; }
      info.style.display = '';
      const aa = A.radec2altaz(sel.ra, sel.dec, A.lst(G.s.time, loc().lon), loc().lat);
      const moon = A.moonRaDec(G.s.time);
      const kv = (k, v) => h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, v));
      const ri = S.rig();
      const fits = sel.size && ri.opt ? Math.min(ri.fovW, ri.fovH) * 60 / sel.size : null;
      info.append(h('div', { class: 'pl-info-title' }, sel.id !== sel.name ? `${sel.id} — ${sel.name}` : sel.name, h('span', { class: 'x', onclick: () => { sel = null; showInfo(); draw(); } }, '✕')),
        h('div', { class: 'muted small' }, (TYPE_LABEL[sel.type] || sel.type || '') + (sel.mag && sel.mag < 30 ? ` · mag ${sel.mag}` : '') + (sel.size ? ` · ${sel.size >= 60 ? (sel.size / 60).toFixed(1) + '°' : sel.size + '′'}` : '')),
        sel.desc ? h('div', { class: 'small', style: { margin: '6px 0' } }, sel.desc) : null,
        kv('RA / Dec', `${A.fmtRA(sel.ra)}  ${A.fmtDec(sel.dec)}`), kv('Alt / Az', `${aa.alt.toFixed(1)}° / ${aa.az.toFixed(1)}°`),
        kv('Airmass', aa.alt > 0 ? A.airmass(aa.alt).toFixed(2) : '—'), kv('Moon distance', `${A.sep(sel.ra, sel.dec, moon.ra, moon.dec).toFixed(0)}°`),
        fits ? kv('Fits in your FOV', fits >= 1 ? `yes (${(1 / fits * 100).toFixed(0)}% of short side)` : `no — ${(1 / fits).toFixed(1)}× too big`) : null,
        h('div', { class: 'row wrap', style: { marginTop: '8px' } },
          h('button', { class: 'btn primary small', onclick: () => { setTarget(sel); toast(`Target set: ${sel.name}`); } }, '★ Set target'),
          h('button', { class: 'btn small', disabled: !S.canGoto(), title: S.canGoto() ? '' : 'Needs a connected GoTo mount', onclick: () => { const r = S.gotoRaDec(sel.ra, sel.dec, sel.name); if (r.error) toast(r.error, 'warn'); } }, 'Slew'),
          h('button', { class: 'btn small', disabled: !S.night(), onclick: async () => { setTarget(sel); RT.R.abort = false; try { await RT.centerOn(G.s.target, (m) => S.log(m)); toast('Centered ' + sel.name); } catch (e) { toast(e.message, 'warn'); } } }, 'Slew & center'),
          h('button', { class: 'btn small', onclick: () => { setTarget(sel); openApp('framing', G.s.target); } }, 'Framing…')));
    }
    async function doSearch() {
      const q = search.value.trim(); results.innerHTML = ''; if (!q) { results.style.display = 'none'; return; }
      const local = findLocal(q);
      results.style.display = '';
      const add = (o) => results.append(h('div', { class: 'pl-res', onclick: () => { results.style.display = 'none'; goTo(o); } }, h('b', {}, o.id), ' ', o.name !== o.id ? o.name : '', h('span', { class: 'muted' }, ' · ' + (TYPE_LABEL[o.type] || o.type || ''))));
      local.slice(0, 12).forEach(add);
      if (!local.length || local[0].score > 0) {
        const sp = h('div', { class: 'pl-res muted' }, `Asking CDS Sesame for “${q}”…`); results.append(sp);
        try { const r = await sesame(q); sp.remove(); if (r) add(r); else if (!local.length) results.append(h('div', { class: 'pl-res muted' }, 'Not found.')); } catch { sp.textContent = 'Name resolver unavailable (offline?).'; }
      }
    }
    function goTo(o) { const aa = A.radec2altaz(o.ra, o.dec, A.lst(G.s.time, loc().lon), loc().lat); view.alt = Math.max(-10, aa.alt); view.az = aa.az; view.fov = Math.min(view.fov, Math.max(8, (o.size || 30) / 60 * 6)); select(o); }
    function centerOnScope() { const n = S.night(); if (!n) return; const p = S.pointing(); view.alt = p.alt; view.az = p.az; draw(); }
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    search.addEventListener('input', () => { if (search.value.length >= 2) { const q = search.value; setTimeout(() => { if (q === search.value) { results.innerHTML = ''; const l = findLocal(q); results.style.display = l.length ? '' : 'none'; l.slice(0, 10).forEach((o) => results.append(h('div', { class: 'pl-res', onclick: () => { results.style.display = 'none'; goTo(o); } }, h('b', {}, o.id), ' ', o.name !== o.id ? o.name : '', h('span', { class: 'muted' }, ' · ' + (TYPE_LABEL[o.type] || o.type))))); } }, 150); } else results.style.display = 'none'; });
    results.style.display = 'none'; info.style.display = 'none';

    const ro = new ResizeObserver(() => draw()); ro.observe(canvas);
    let last = 0;
    const onTick = () => { const t = performance.now(); if (t - last > 500) { last = t; draw(); } };
    on('tick', onTick); on('mount', draw); on('solve', draw); on('catalog', draw);
    if (G.s.target) { sel = { ...G.s.target, desc: '' }; showInfo(); }
    setTimeout(draw, 0);
    return {
      onClose() { off('tick', onTick); off('mount', draw); off('solve', draw); off('catalog', draw); ro.disconnect(); },
      onArg(o) { if (o) goTo(o); },
    };
  },
};

function mix(a, b, t) { return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)).join(','); }
function dsoColor(t) { return t === 'galaxy' || /g$/.test(t) || t === 's0' ? '#ff9e7a' : t === 'cluster' || t === 'oc' || t === 'gc' ? '#ffe28a' : t === 'planetary' || t === 'pn' ? '#7af0d0' : t === 'snr' || t === 'sn' ? '#d38aff' : t === 'milkyway' || t === 'star' ? '#9ac8ff' : '#8ad2ff'; }
function drawMoon(ctx, x, y, r, ph) {
  ctx.save(); ctx.fillStyle = '#2a2a2a'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#eee7cf'; ctx.beginPath();
  const k = Math.cos((ph.phaseAngle) * A.D2R); // 1 full, -1 new
  const dir = ph.waxing ? 1 : -1;
  ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, dir < 0);
  ctx.ellipse(x, y, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === (dir > 0) ? true : false);
  ctx.fill(); ctx.restore();
}
void GEAR;
