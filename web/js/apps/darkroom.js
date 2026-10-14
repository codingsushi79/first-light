// Files, DeepStack (stacking) and PixelLab (processing)
import { h, toast, openApp, select, confirmDlg, promptDlg, dialog } from '../wm.js';
import { Viewer, drawHistogram, canvasFromRGBA, bar } from '../components.js';
import * as A from '../astro.js';
import { G, on, off, emit, save, fmtTime, fmtDate, fmtDur, idbGet, idbSet, idbDel } from '../state.js';
import { GEAR, LOC, FILTERS, filterLabel, filterBand } from '../gear.js';
import { viewRecipe, stackJob } from '../imaging.js';
import { uid } from '../util.js';
import { scoreImage } from './social.js';
import { cat } from '../catalog.js';
import { luckySeeing } from '../bodies.js';
import { ensureSpace, stackBytes, finalBytes, usage, fmtBytes, frameBytes } from '../storage.js';

const fname = (f) => (f ? filterLabel(f) : 'none');

function groupFrames() {
  const groups = {};
  for (const f of G.s.frames) {
    const sess = G.s.sessions.find((s) => s.id === f.session);
    const key = f.session;
    (groups[key] = groups[key] || { sess, frames: [] }).frames.push(f);
  }
  return Object.values(groups).sort((a, b) => (b.sess ? b.sess.start : 0) - (a.sess ? a.sess.start : 0));
}

// ============================== Files ==============================
export const filesApp = {
  title: 'Files', width: 980, height: 640, minW: 620, minH: 400,
  icon: `<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#2a8cff"/><path d="M8 13a3 3 0 0 1 3-3h6l3 3h9a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="#bfe0ff"/><path d="M8 17h24v11a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="#fff"/></svg>`,
  open(body) {
    const tree = h('div', { class: 'files-tree' });
    const grid = h('div', { class: 'files-grid' });
    const viewer = new Viewer({ placeholder: 'Select a frame' });
    const meta = h('pre', { class: 'fits-header' });
    const right = h('div', { class: 'files-view' }, viewer.el, meta);
    body.append(h('div', { class: 'files-root' }, tree, grid, right));
    let cur = null;
    function deleteFrames(ids) {
      ids = new Set(ids); G.s.frames = G.s.frames.filter((f) => !ids.has(f.id)); ids.forEach((id) => idbDel('thumb:' + id)); save(); emit('storage');
    }
    function diskCard() {
      const u = usage(); const pct = (b) => `${Math.max(0, (b / u.cap) * 100)}%`;
      return h('div', { class: 'disk' },
        h('div', { class: 'disk-top' }, h('b', {}, 'Internal SSD'), h('span', { class: u.free < u.cap * 0.1 ? 'warnline' : 'muted' }, `${fmtBytes(Math.max(0, u.free))} free of ${fmtBytes(u.cap)}`)),
        h('div', { class: 'disk-bar' }, h('span', { class: 'sys', style: { width: pct(u.system) } }), h('span', { class: 'fr', style: { width: pct(u.frames) } }), h('span', { class: 'vid', style: { width: pct(u.videos) } }), h('span', { class: 'stk', style: { width: pct(u.stacks) } }), h('span', { class: 'fin', style: { width: pct(u.finals) } })),
        h('div', { class: 'disk-leg small' }, ...[['fr', 'Frames', u.frames], ['vid', 'Videos', u.videos], ['stk', 'Stacks', u.stacks], ['fin', 'Images', u.finals], ['sys', 'System', u.system]].map(([c, l, b]) => h('span', {}, h('i', { class: c }), `${l} ${fmtBytes(b)}`))),
        h('button', { class: 'btn tiny', onclick: () => freeUp() }, 'Free up space…'));
    }
    async function freeUp() {
      const lights = G.s.frames.filter((f) => f.type === 'light');
      const bad = lights.filter((f) => f.stats.stars < 8 || f.stats.trail > 6 || (f.recipe && f.recipe.capOn));
      const stackedVids = G.s.frames.filter((f) => f.type === 'video' && G.s.stacks.some((s) => s.planetary && String(s.target).toLowerCase() === String(f.target).toLowerCase()));
      const sessOrder = [...G.s.sessions].sort((a, b) => b.start - a.start).map((s) => s.id);
      const oldCal = G.s.frames.filter((f) => f.type !== 'light' && f.type !== 'video' && sessOrder.indexOf(f.session) >= 3);
      const newestStack = {}; for (const s of G.s.stacks) newestStack[s.target + '|' + (s.filter || '')] = s.id;
      const oldStacks = G.s.stacks.filter((s) => newestStack[s.target + '|' + (s.filter || '')] !== s.id);
      const sum = (a, f) => a.reduce((x, y) => x + f(y), 0);
      const opts = [
        ['bad', `Rejected light frames — no stars, trails or cap on (${bad.length}, ${fmtBytes(sum(bad, frameBytes))})`, bad.length],
        ['vids', `Planetary videos already lucky-stacked (${stackedVids.length}, ${fmtBytes(sum(stackedVids, frameBytes))})`, stackedVids.length],
        ['cal', `Calibration frames from older sessions (${oldCal.length}, ${fmtBytes(sum(oldCal, frameBytes))})`, oldCal.length],
        ['stk', `Older stacks (newer ones of the same target & filter exist) (${oldStacks.length}, ${fmtBytes(sum(oldStacks, stackBytes))})`, oldStacks.length],
      ];
      const pick = {}; const box = h('div', {}, ...opts.map(([k, l, n]) => h('label', { class: 'chk', style: { display: 'flex', margin: '6px 0' } }, h('input', { type: 'checkbox', disabled: !n, checked: !!n && k !== 'stk', onchange: (e) => { pick[k] = e.target.checked; } }), l)));
      opts.forEach(([k, , n]) => { pick[k] = !!n && k !== 'stk'; });
      const ok = await dialog({ title: 'Free up space', body: box, buttons: [{ label: 'Cancel', value: false }, { label: 'Delete selected', value: true, danger: true }], width: 520 });
      if (!ok) return;
      const ids = [...(pick.bad ? bad : []), ...(pick.vids ? stackedVids : []), ...(pick.cal ? oldCal : [])].map((f) => f.id);
      if (ids.length) deleteFrames(ids);
      if (pick.stk) { const del = new Set(oldStacks.map((s) => s.id)); G.s.stacks = G.s.stacks.filter((s) => !del.has(s.id)); del.forEach((id) => idbDel('stack:' + id)); save(); emit('storage'); }
      toast(`Freed space — ${fmtBytes(usage().free)} free now.`, 'good');
      cur = null; renderTree(); renderGrid();
    }
    function renderTree() {
      tree.innerHTML = '';
      tree.append(diskCard());
      const gs = groupFrames();
      if (!gs.length) tree.append(h('div', { class: 'muted pad' }, 'No frames yet. Go out and shoot!'));
      for (const g of gs) {
        const s = g.sess; const loc = s ? LOC[s.location] : null;
        const title = s ? `${fmtDate(s.start, loc.tz)} · ${loc.name.split(' (')[0]}` : 'Unknown session';
        const byT = {}; for (const f of g.frames) { const k = `${f.type === 'light' ? (f.target || 'Untitled') : f.type.toUpperCase() + 'S'}`; (byT[k] = byT[k] || []).push(f); }
        tree.append(h('div', { class: 'ft-sess' }, '📁 ' + title));
        for (const [k, arr] of Object.entries(byT)) tree.append(h('div', { class: 'ft-item' + (cur && cur.key === s.id + k ? ' on' : ''), onclick: () => { cur = { key: s.id + k, frames: arr }; renderTree(); renderGrid(); } }, `${k} (${arr.length})`, h('span', { class: 'ft-size' }, fmtBytes(arr.reduce((a, f) => a + (f.bytes || frameBytes(f)), 0)))));
      }
    }
    let sel = new Set(), shown = null;
    async function delSelected(ids) {
      ids = [...ids]; if (!ids.length) return;
      const bytes = ids.reduce((a, id) => { const f = G.s.frames.find((x) => x.id === id); return a + (f ? f.bytes || frameBytes(f) : 0); }, 0);
      if (ids.length > 1 && !(await confirmDlg('Delete frames', `Delete ${ids.length} frames (${fmtBytes(bytes)})? This can’t be undone.`, 'Delete'))) return;
      deleteFrames(ids);
      cur.frames = cur.frames.filter((x) => !ids.includes(x.id)); sel = new Set([...sel].filter((id) => !ids.includes(id)));
      if (shown && ids.includes(shown.id)) { shown = null; viewer.setImage(null); meta.textContent = ''; delBtn.style.display = 'none'; }
      toast(`Deleted ${ids.length} frame${ids.length > 1 ? 's' : ''} · freed ${fmtBytes(bytes)}`, 'info', 2500);
      renderTree(); renderGrid();
    }
    const delBtn = h('button', { class: 'btn small danger', style: { display: 'none', alignSelf: 'flex-start' }, onclick: () => shown && delSelected([shown.id]) }, '🗑 Delete this frame');
    right.insertBefore(delBtn, meta);
    body.tabIndex = 0;
    body.addEventListener('keydown', (e) => {
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && (sel.size || shown)) { e.preventDefault(); e.stopPropagation(); delSelected(sel.size ? sel : [shown.id]); }
      if (e.key === 'a' && (e.metaKey || e.ctrlKey) && cur) { e.preventDefault(); sel = new Set(cur.frames.map((f) => f.id)); renderGrid(); }
      if (e.key === 'Escape' && sel.size) { sel.clear(); renderGrid(); }
    });
    async function renderGrid() {
      grid.innerHTML = '';
      if (!cur) return;
      const total = cur.frames.reduce((a, f) => a + (f.type === 'light' ? f.exp : 0), 0);
      grid.append(h('div', { class: 'row small muted wrap' }, `${cur.frames.length} frames · ${fmtDur(total)} integration · ${fmtBytes(cur.frames.reduce((a, f) => a + (f.bytes || frameBytes(f)), 0))}`,
        sel.size ? h('button', { class: 'btn tiny danger', onclick: () => delSelected(sel) }, `Delete selected (${sel.size})`) : h('span', { class: 'tiny muted' }, '⌘/Shift-click to select several · Delete key removes'),
        sel.size ? h('button', { class: 'btn tiny', onclick: () => { sel.clear(); renderGrid(); } }, 'Clear selection') : null,
        h('button', { class: 'btn tiny danger', onclick: async () => { if (await confirmDlg('Delete frames', `Delete all ${cur.frames.length} frames in this folder?`, 'Delete')) { deleteFrames(cur.frames.map((f) => f.id)); cur = null; sel.clear(); renderTree(); renderGrid(); } } }, 'Delete folder')));
      let lastIdx = null;
      cur.frames.forEach((f, idx) => {
        const img = h('img', { class: 'thumb', alt: '' });
        idbGet('thumb:' + f.id).then((u) => { if (u) img.src = u; });
        const del = h('button', { class: 'fcard-x', title: 'Delete this frame', onclick: (e) => { e.stopPropagation(); delSelected([f.id]); } }, '✕');
        const card = h('div', { class: 'fcard' + (sel.has(f.id) ? ' sel' : '') + (shown && shown.id === f.id ? ' on' : ''), onclick: (e) => {
          if (e.metaKey || e.ctrlKey) { sel.has(f.id) ? sel.delete(f.id) : sel.add(f.id); lastIdx = idx; renderGrid(); return; }
          if (e.shiftKey && (lastIdx !== null || shown)) { const a = lastIdx ?? cur.frames.findIndex((x) => x.id === shown.id); for (let i = Math.min(a, idx); i <= Math.max(a, idx); i++) sel.add(cur.frames[i].id); renderGrid(); return; }
          sel.clear(); lastIdx = idx; show(f); renderGrid(); body.focus();
        } }, del, img, h('div', { class: 'small' }, `${f.type} · ${f.exp < 0.5 ? +(f.exp * 1000).toFixed(1) + 'ms' : f.exp + 's'} · ${f.type === 'video' ? (f.frames || '') + ' fr' : fname(f.filter)} · ${fmtBytes(f.bytes || frameBytes(f))}`), h('div', { class: 'tiny muted' }, `HFR ${f.stats.hfr} · ★${f.stats.stars}${f.stats.trail > 4 ? ' · trails' : ''}`));
        grid.append(card);
      });
    }
    async function show(f) {
      shown = f; delBtn.style.display = '';
      const loc = LOC[f.loc];
      meta.textContent = [
        `SIMPLE  = T`, `IMAGETYP= '${f.type.toUpperCase()}'`, `OBJECT  = '${f.target}'`, `EXPTIME = ${f.exp}`, `${GEAR[f.cam].type === 'dslr' ? 'ISOSPEED' : 'GAIN    '}= ${f.gain}`, f.offset != null ? `OFFSET  = ${f.offset}` : '',
        `CCD-TEMP= ${f.temp}`, `FILTER  = '${fname(f.filter)}'`, `INSTRUME= '${GEAR[f.cam].name}'`, `TELESCOP= '${GEAR[f.optic].name}'`, `FOCALLEN= ${f.focal}`, `FOCRATIO= ${f.fstop}`,
        `DATE-OBS= '${new Date(f.t0).toISOString()}'`, `SITENAME= '${loc.name}'`, `SITELAT = ${loc.lat}`, `RA      = ${f.recipe.ra.toFixed(4)}`, `DEC     = ${f.recipe.dec.toFixed(4)}`,
        `HFR     = ${f.stats.hfr}`, `STARS   = ${f.stats.stars}`, `MEDIAN  = ${f.stats.median}`, `ECCENTR = ${f.stats.ecc}`].filter(Boolean).join('\n');
      viewer.placeholder = 'Rendering frame…'; viewer.setImage(null);
      try { const r = await viewRecipe(f.recipe, G.s.settings.linked); viewer.setImage(canvasFromRGBA(r.preview)); } catch (e) { viewer.placeholder = 'Error: ' + e.message; viewer.draw(); }
    }
    renderTree();
    const rr = () => { renderTree(); }; on('frame', rr);
    return { onClose() { off('frame', rr); }, onResize() { viewer.draw(); } };
  },
};

// ============================== DeepStack ==============================
export const stackerApp = {
  title: 'DeepStack', width: 1040, height: 680, minW: 720, minH: 460,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f9d8a"/><stop offset="1" stop-color="#0b3b38"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gs)"/><g fill="none" stroke="#fff" stroke-width="2"><rect x="9" y="9" width="16" height="12" rx="1.5" opacity=".5"/><rect x="12" y="13" width="16" height="12" rx="1.5" opacity=".75"/><rect x="15" y="17" width="16" height="12" rx="1.5"/></g></svg>`,
  open(body) {
    const left = h('div', { class: 'st-left' }); const right = h('div', { class: 'st-right' });
    body.append(h('div', { class: 'st-root' }, left, right));
    let selKey = null; let chosen = new Set();
    const opts = { method: 'kappa', kappa: 2.5, darks: true, flats: true, bias: true };
    function lightGroups() {
      const g = {};
      for (const f of G.s.frames) if (f.type === 'light') { const k = `${f.target || 'Untitled'}|${f.cam}|${f.optic}|${f.focal}|${f.filter || ''}|${f.quality || 2048}`; (g[k] = g[k] || []).push(f); }
      return g;
    }
    function renderLeft() {
      left.innerHTML = '';
      left.append(h('h3', {}, 'Light frame groups'), h('div', { class: 'muted small' }, 'Frames are grouped by target, camera, optics and filter. Groups can span several nights.'));
      const g = lightGroups();
      if (!Object.keys(g).length) left.append(h('div', { class: 'muted' }, 'No light frames yet.'));
      for (const [k, arr] of Object.entries(g)) {
        const [tgt, cam, opt, focal, filt] = k.split('|');
        const tot = arr.reduce((a, f) => a + f.exp, 0);
        left.append(h('div', { class: 'st-group' + (k === selKey ? ' on' : ''), onclick: () => { selKey = k; chosen = new Set(arr.filter((f) => f.stats.stars > 5).map((f) => f.id)); renderLeft(); renderRight(); } },
          h('b', {}, tgt), h('div', { class: 'small muted' }, `${arr.length} × ~${Math.round(tot / arr.length)}s = ${fmtDur(tot)} · ${fname(filt)} · ${focal}mm · ${GEAR[cam].name.split('(')[0]}`), void opt));
      }
      const vids = G.s.frames.filter((f) => f.type === 'video');
      if (vids.length) {
        left.append(h('h3', { style: { marginTop: '14px' } }, 'Planetary videos'));
        for (const v of [...vids].reverse()) left.append(h('div', { class: 'st-group' + (selKey === 'v:' + v.id ? ' on' : ''), onclick: () => { selKey = 'v:' + v.id; renderLeft(); renderRight(); } },
          h('b', {}, `🎞 ${v.target}`), h('div', { class: 'small muted' }, `${v.frames} frames · ${+(v.exp * 1000).toFixed(1)} ms · ${v.fps} fps · ${fmtTime(v.t0, LOC[v.loc].tz)}${v.bodies && v.bodies.length ? '' : ' · ⚠ no planet in view'}`)));
      }
      left.append(h('h3', { style: { marginTop: '14px' } }, 'Saved stacks'));
      for (const s of [...G.s.stacks].reverse()) left.append(h('div', { class: 'st-group', onclick: () => openApp('pixellab', s.id) },
        h('button', { class: 'fcard-x', title: 'Delete this stack', onclick: async (e) => { e.stopPropagation(); if (!(await confirmDlg('Delete stack', `Delete the ${s.target} stack (${fmtBytes(s.bytes || stackBytes(s))})? Your raw frames are kept.`, 'Delete'))) return; G.s.stacks = G.s.stacks.filter((x) => x.id !== s.id); idbDel('stack:' + s.id); save(); emit('storage'); renderLeft(); } }, '✕'),
        h('b', {}, s.target), h('div', { class: 'small muted' }, `${s.n} subs · ${fmtDur(s.integration)} · ${fname(s.filter)} · ${s.method} · ${fmtBytes(s.bytes || stackBytes(s))}`)));
    }
    function calibCandidates(lights, type) {
      const L = lights[0];
      return G.s.frames.filter((f) => f.type === type && f.cam === L.cam && f.quality === L.quality && (type === 'bias' || type === 'flat' ? true : true));
    }
    function renderVideo(v) {
      const r = v.recipe; const dur = r.frames / r.fps;
      const alt = A.radec2altaz(r.ra, r.dec, A.lst(r.t0, r.env.lon), r.env.lat).alt;
      const seeingX = r.env.seeing * Math.pow(A.airmass(Math.max(alt, 5)), 0.6);
      const vopts = { keep: 0.1, ap: true };
      const est = h('div', { class: 'small muted' });
      const upd = () => {
        const fw = luckySeeing(seeingX, r.opt.D, vopts.keep);
        est.innerHTML = `Seeing during capture ${seeingX.toFixed(1)}″ → best ${Math.round(vopts.keep * 100)}% of frames ≈ <b>${fw.toFixed(2)}″</b> (diffraction limit ${(116 / r.opt.D).toFixed(2)}″) · ${Math.round(r.frames * vopts.keep)} frames averaged → noise ÷ ${Math.sqrt(r.frames * vopts.keep).toFixed(0)}`;
      };
      const keepSel = select([[0.02, 'Best 2%'], [0.05, 'Best 5%'], [0.1, 'Best 10%'], [0.25, 'Best 25%'], [0.5, 'Best 50%'], [1, 'All frames']], vopts.keep, (x) => { vopts.keep = +x; upd(); });
      upd();
      const quality = h('canvas', { width: 520, height: 110, class: 'lucky-graph' });
      { // quality graph: sorted frame sharpness (lognormal), like AutoStakkert
        const c = quality.getContext('2d'); const W = 520, H = 110; c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, 0, W, H);
        const N = 200, vals = []; let seed = r.seed >>> 0; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        for (let i = 0; i < N; i++) vals.push(Math.exp(-Math.abs((rnd() + rnd() + rnd() - 1.5)) * 1.3));
        const sorted = [...vals].sort((a, b) => b - a);
        c.strokeStyle = 'rgba(120,170,255,.5)'; c.beginPath(); vals.forEach((q, i) => { const x = i / (N - 1) * W, y = H - q * (H - 10) - 4; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
        c.strokeStyle = '#7dffb0'; c.lineWidth = 2; c.beginPath(); sorted.forEach((q, i) => { const x = i / (N - 1) * W, y = H - q * (H - 10) - 4; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.7)'; c.font = '11px system-ui'; c.fillText('frame quality (blue: in order · green: sorted)', 8, 14);
      }
      right.append(h('div', { class: 'card' }, h('h3', {}, `🎞 ${v.target} — ${v.frames} frames`),
        h('div', { class: 'small muted' }, `${+(v.exp * 1000).toFixed(2)} ms · gain ${v.gain} · ${v.fps} fps · ${fmtDur(dur)} long · ${v.focal}mm f/${v.fstop} · alt ${alt.toFixed(0)}°`),
        !(v.bodies && v.bodies.length) ? h('div', { class: 'warnline' }, '⚠ No planet or Moon was in the field in this video.') : null,
        dur > 150 && (v.bodies || []).some((b) => b === 'Jupiter' || b === 'Saturn') ? h('div', { class: 'warnline' }, `⚠ ${fmtDur(dur)} is long for a fast-rotating giant planet — expect rotational smearing.`) : null,
        quality));
      const prog = h('div', {}); const progL = h('div', { class: 'small muted' });
      const go = h('button', { class: 'btn primary big', onclick: async () => {
        go.disabled = true;
        try {
          const meta = await luckyStackVideo(v, vopts.keep, (msg, f) => { prog.innerHTML = ''; prog.append(bar(f)); progL.textContent = msg; });
          toast(`Lucky stack done: ${meta.n} of ${r.frames} frames`, 'good');
          openApp('pixellab', meta.id);
        } catch (e) { console.error(e); progL.textContent = '⚠ ' + e.message; }
        go.disabled = false; renderLeft();
      } }, '▶ Analyse & lucky-stack');
      right.append(h('div', { class: 'card' }, h('h3', {}, 'Lucky stacking'), h('div', { class: 'row' }, h('span', {}, 'Keep'), keepSel), est,
        h('div', { class: 'row', style: { marginTop: '8px' } }, go, h('div', { style: { flex: 1 } }, prog, progL)),
        h('div', { class: 'muted small' }, 'Every frame is graded for sharpness; the best are aligned on the planet with many alignment points and averaged. Fewer frames = sharper but noisier. Then sharpen with wavelets in PixelLab.')));
    }
    function renderRight() {
      right.innerHTML = '';
      if (selKey && selKey.startsWith('v:')) { const v = G.s.frames.find((f) => f.id === selKey.slice(2)); if (v) { renderVideo(v); return; } }
      if (!selKey) { right.append(h('div', { class: 'notice' }, 'Pick a light-frame group on the left.')); return; }
      const lights = lightGroups()[selKey]; if (!lights) return;
      // frame table
      const tbl = h('table', { class: 'tbl' }, h('tr', {}, ...['', '#', 'Time', 'Exp', 'Stars', 'HFR', 'Ecc', 'Median', 'Trail', 'Score'].map((x) => h('th', {}, x))));
      const maxStars = Math.max(1, ...lights.map((f) => f.stats.stars));
      const minHfr = Math.min(...lights.map((f) => f.stats.hfr || 99));
      const scoreOf = (f) => Math.round(100 * (f.stats.stars / maxStars) * Math.min(1, minHfr / Math.max(0.1, f.stats.hfr)) * (1 - Math.max(0, f.stats.ecc - 0.4)));
      lights.forEach((f, i) => {
        const sc = scoreOf(f);
        tbl.append(h('tr', { class: sc < 50 ? 'bad' : '' }, h('td', {}, h('input', { type: 'checkbox', checked: chosen.has(f.id), onchange: (e) => { e.target.checked ? chosen.add(f.id) : chosen.delete(f.id); sumL.textContent = summary(); } })),
          h('td', {}, i + 1), h('td', {}, fmtTime(f.t0, LOC[f.loc].tz)), h('td', {}, f.exp + 's'), h('td', {}, f.stats.stars), h('td', {}, f.stats.hfr), h('td', {}, f.stats.ecc), h('td', {}, f.stats.median), h('td', {}, f.stats.trail > 2 ? f.stats.trail + 'px' : ''), h('td', {}, sc)));
      });
      const summary = () => { const sel = lights.filter((f) => chosen.has(f.id)); return `${sel.length} of ${lights.length} selected · ${fmtDur(sel.reduce((a, f) => a + f.exp, 0))}`; };
      const sumL = h('span', { class: 'muted' }, summary());
      right.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, 'Light frames'), sumL,
        h('button', { class: 'btn tiny', onclick: () => { lights.forEach((f) => (scoreOf(f) >= 60 ? chosen.add(f.id) : chosen.delete(f.id))); renderRight(); } }, 'Keep best (score ≥ 60)'),
        h('button', { class: 'btn tiny', onclick: () => { lights.forEach((f) => chosen.add(f.id)); renderRight(); } }, 'All')), h('div', { class: 'st-table' }, tbl)));
      // calibration
      const L = lights[0];
      const darks = calibCandidates(lights, 'dark'), flats = calibCandidates(lights, 'flat'), biases = calibCandidates(lights, 'bias');
      const matchDark = darks.filter((d) => Math.abs(d.exp - L.exp) < 0.5 && d.gain === L.gain && Math.abs(d.temp - L.temp) < 3 && (d.bin || 1) === (L.bin || 1));
      const nearDark = darks.filter((d) => !matchDark.includes(d) && Math.abs(d.exp - L.exp) < 0.5 && d.gain === L.gain);
      const matchFlat = flats.filter((f) => f.optic === L.optic && (f.filter || '') === (L.filter || '') && Math.abs(f.focal - L.focal) < 2);
      const darkSel = matchDark.length ? matchDark : nearDark;
      const c = h('div', { class: 'card' }, h('h3', {}, 'Calibration frames'));
      const crow = (key, label, arr, note) => c.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: opts[key] && arr.length > 0, disabled: !arr.length, onchange: (e) => { opts[key] = e.target.checked; } }), `${label}: ${arr.length} found`, h('span', { class: 'muted small' }, ' ' + note)));
      crow('darks', 'Darks', darkSel, matchDark.length ? '(matching exposure, gain & temperature)' : nearDark.length ? '⚠ temperature does not match well — residual hot pixels / amp glow likely' : '(shoot darks with the lens cap ON at the same exposure, gain and temperature)');
      crow('flats', 'Flats', matchFlat, matchFlat.length ? '(same optics & filter — will remove vignetting and dust donuts)' : '(shoot flats at dusk/dawn sky or with a flat panel, without changing focus/rotation)');
      crow('bias', 'Bias / flat-darks', biases, '(shortest exposure, cap on — calibrates the flats)');
      const meth = select([['kappa', 'Kappa-sigma clipping (rejects satellites, hot pixels)'], ['average', 'Average'], ['max', 'Maximum (star trails)']], opts.method, (v) => { opts.method = v; });
      c.append(h('div', { class: 'row' }, h('span', {}, 'Integration'), meth, h('span', { class: 'muted small' }, 'κ'), h('input', { class: 'inp num', type: 'number', step: 0.1, value: opts.kappa, style: { width: '56px' }, onchange: (e) => { opts.kappa = +e.target.value; } })));
      right.append(c);
      const prog = h('div', {}); const progL = h('div', { class: 'small muted' });
      const goBtn = h('button', { class: 'btn primary big', onclick: async () => {
        const sel = lights.filter((f) => chosen.has(f.id));
        if (!sel.length) { toast('Select some frames.', 'warn'); return; }
        // best frame first (reference)
        sel.sort((a, b) => scoreOf(b) - scoreOf(a));
        goBtn.disabled = true;
        const job = { lights: sel.map((f) => f.recipe), darks: opts.darks ? darkSel.slice(0, 40).map((f) => f.recipe) : [], flats: opts.flats ? matchFlat.slice(0, 40).map((f) => f.recipe) : [], biases: opts.bias ? biases.slice(0, 40).map((f) => f.recipe) : [], method: opts.method, kappa: opts.kappa };
        const t0 = performance.now();
        try {
          const res = await stackJob(job, (msg, f) => { prog.innerHTML = ''; prog.append(bar(f)); progL.textContent = msg; });
          const id = uid();
          const integ = sel.reduce((a, f) => a + f.exp, 0);
          const meta = { id, target: L.target || 'Untitled', n: sel.length, integration: integ, filter: L.filter, cam: L.cam, optic: L.optic, focal: L.focal, W: res.W, H: res.H, nc: res.nc, method: opts.method, ref: res.refPointing, scale: res.scale, created: G.s.time, darks: job.darks.length, flats: job.flats.length,
            quality: qualityOf(sel), loc: L.loc, sessions: [...new Set(sel.map((f) => f.session))].length };
          meta.bytes = stackBytes(meta); ensureSpace(meta.bytes, 'the stacked image');
  await idbSet('stack:' + id, { data: res.data, coverage: res.coverage });
          G.s.stacks.push(meta);
          while (G.s.stacks.length > 40) { const old = G.s.stacks.shift(); idbDel('stack:' + old.id); }
          save(true);
          progL.textContent = `Stacked ${sel.length} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s.`;
          emit('stacked', meta);
          toast(`Stack complete: ${meta.target} (${fmtDur(integ)})`, 'good');
          openApp('pixellab', id);
        } catch (e) { console.error(e); progL.textContent = '⚠ ' + e.message; }
        goBtn.disabled = false; renderLeft();
      } }, '▶ Register & stack');
      right.append(h('div', { class: 'card' }, h('div', { class: 'row' }, goBtn, h('div', { style: { flex: 1 } }, prog, progL)), h('div', { class: 'muted small' }, 'Stacking re-develops every raw frame, calibrates it, aligns stars to the best frame and averages. Noise drops with √N — 4× the frames, half the noise.')));
    }
    renderLeft(); renderRight();
    const rr = () => renderLeft(); on('frame', rr);
    return { onClose() { off('frame', rr); } };
  },
};
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
// Lucky-stack a planetary video (also used by scripts). Returns the new stack's meta.
export async function luckyStackVideo(v, keep, onProgress = () => {}) {
  const r = v.recipe;
  const alt = A.radec2altaz(r.ra, r.dec, A.lst(r.t0, r.env.lon), r.env.lat).alt;
  const seeingX = r.env.seeing * Math.pow(A.airmass(Math.max(alt, 5)), 0.6);
  const res = await stackJob({ video: r, keep }, onProgress);
  const id = uid(); const kept = Math.round(r.frames * keep);
  const body = (res.bodies || [])[0];
  const fwhm = Math.hypot(luckySeeing(seeingX, r.opt.D, keep), 116 / r.opt.D, res.smear || 0);
  const meta = { id, target: v.target || 'Planet', n: kept, integration: kept * r.exp, filter: v.filter, cam: v.cam, optic: v.optic, focal: v.focal, W: res.W, H: res.H, nc: res.nc, method: 'lucky', ref: res.refPointing, scale: res.scale, created: G.s.time, darks: 0, flats: 0,
    loc: v.loc, sessions: 1, planetary: true, planet: body ? { name: body.name, rPix: body.rPix, diam: body.rPix * 2 * res.scale, fwhm, smear: res.smear, alt, adc: !!r.adc, total: r.frames, kept } : null, quality: { defocus: Math.abs(r.focusDelta || 0) / (4.88 * 0.55 * (r.opt.focal / r.opt.D) ** 2), trail: 0, jitterPx: 0 } };
  meta.bytes = stackBytes(meta); ensureSpace(meta.bytes, 'the stacked image');
  await idbSet('stack:' + id, { data: res.data, coverage: res.coverage });
  G.s.stacks.push(meta);
  while (G.s.stacks.length > 40) { const old = G.s.stacks.shift(); idbDel('stack:' + old.id); }
  save(true); emit('stacked', meta);
  return meta;
}

// Star quality of a set of subs. Measured HFR/eccentricity on the downscaled frames is polluted by
// nebulosity and survey star halos, so sharpness is judged from what physically happened to each sub:
// defocus relative to the critical focus zone, and tracking trail / jitter relative to the pixel scale.
function qualityOf(sel) {
  const defocus = avg(sel.map((f) => { const r = f.recipe; const N = r.opt.focal / r.opt.D; return Math.abs(r.focusDelta || 0) / (4.88 * 0.55 * N * N); }));
  const trail = avg(sel.map((f) => f.stats.trail || 0));
  const jitterPx = avg(sel.map((f) => (2.355 * (f.recipe.jitter || 0)) / Math.max(0.1, f.scale || 1)));
  return { hfr: avg(sel.map((f) => f.stats.hfr)), ecc: avg(sel.map((f) => f.stats.ecc)), trail, defocus, jitterPx };
}

// ============================== PixelLab ==============================
export const pixellabApp = {
  title: 'PixelLab', width: 1180, height: 760, minW: 820, minH: 520,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f08a24"/><stop offset="1" stop-color="#8a2d0a"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gx)"/><path d="M8 30 C14 10, 22 30, 32 10" stroke="#fff" stroke-width="2.5" fill="none"/><circle cx="12" cy="12" r="2.5" fill="#fff"/></svg>`,
  open(body, w, arg) {
    const viewer = new Viewer({ placeholder: 'Open a stack from DeepStack (or pick one on the right)' });
    const hist = h('canvas', { class: 'hist' });
    const panel = h('div', { class: 'px-panel' });
    body.append(h('div', { class: 'px-root' }, h('div', { class: 'px-left' }, viewer.el, hist), panel));
    let src = null;      // {W,H,nc,data:[Float32Array], meta}
    let work = null;     // working linear RGB after crop/BE/color  {W,H,r,g,b}
    let P = defaultParams();
    let mono = false;
    let combo = null;    // channel combination for mono stacks
    function defaultParams(planetary = false) {
      if (planetary) return { planetary: true, crop: 0, be: false, beStr: 0, neutral: false, wb: [1, 1, 1], black: 0, mid: 0.4, white: 1, auto: true, contrast: 0.1, sat: 0.35, nr: 0.05, sharp: 0, starRed: 0, hdr: 0, wave: 0.9, waveFine: 1, rgbAlign: true, title: '' };
      return { crop: 0.03, be: true, beStr: 1, neutral: true, wb: [1, 1, 1], black: 0, mid: 0.25, white: 1, auto: true, contrast: 0.15, sat: 0.4, nr: 0.3, sharp: 0.2, starRed: 0, hdr: 0, wave: 0, title: '' };
    }

    async function loadStack(id) {
      const meta = G.s.stacks.find((s) => s.id === id); if (!meta) return;
      const d = await idbGet('stack:' + id); if (!d) { toast('Stack data missing.', 'warn'); return; }
      src = { ...d, W: meta.W, H: meta.H, nc: meta.nc, meta };
      mono = meta.nc === 1; combo = mono ? { R: id, G: id, B: id, L: null } : null;
      P = defaultParams(!!meta.planetary); P.title = meta.target;
      await rebuild(); renderPanel();
    }
    // resample a stack onto the grid of the reference stack (for multi-filter combination)
    function resampleTo(refMeta, s) {
      if (s.meta.id === refMeta.id) return s.data[0];
      const W = refMeta.W, H = refMeta.H; const out = new Float32Array(W * H);
      const pr = refMeta.ref, pf = s.meta.ref; const sc = refMeta.scale / s.meta.scale;
      const p = A.tanProject(pr.ra, pr.dec, pf.ra, pf.dec);
      const dxi = p.xi * A.R2D * 3600 / refMeta.scale, deta = p.eta * A.R2D * 3600 / refMeta.scale;
      const thR = pr.rot * A.D2R, thF = pf.rot * A.D2R; const a = s.data[0]; const SW = s.meta.W, SH = s.meta.H;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const u = x + 0.5 - W / 2, v = y + 0.5 - H / 2;
        const bx = u * Math.cos(thR) + v * Math.sin(thR) + dxi, by = -u * Math.sin(thR) + v * Math.cos(thR) + deta;
        const fu = (bx * Math.cos(thF) - by * Math.sin(thF)) * sc + SW / 2 - 0.5, fv = (bx * Math.sin(thF) + by * Math.cos(thF)) * sc + SH / 2 - 0.5;
        const x0 = Math.floor(fu), y0 = Math.floor(fv); if (x0 < 0 || y0 < 0 || x0 >= SW - 1 || y0 >= SH - 1) continue;
        const fx = fu - x0, fy = fv - y0, i = y0 * SW + x0;
        out[y * W + x] = a[i] * (1 - fx) * (1 - fy) + a[i + 1] * fx * (1 - fy) + a[i + SW] * (1 - fx) * fy + a[i + SW + 1] * fx * fy;
      }
      return out;
    }
    async function rebuild() {
      if (!src) return;
      let { W, H } = src; let r, g, b;
      if (mono) {
        const get = async (id) => { if (!id) return null; const m = G.s.stacks.find((s) => s.id === id); const d = await idbGet('stack:' + id); return resampleTo(src.meta, { meta: m, data: d.data }); };
        r = await get(combo.R); g = await get(combo.G); b = await get(combo.B);
        const L = combo.L ? await get(combo.L) : null;
        r = r || new Float32Array(W * H); g = g || r; b = b || r;
        if (L) { // LRGB: replace luminance
          const nr = new Float32Array(W * H), ng = new Float32Array(W * H), nb = new Float32Array(W * H);
          for (let i = 0; i < W * H; i++) { const y = (r[i] + g[i] + b[i]) / 3 + 1e-6; const k = L[i] / y; nr[i] = r[i] * k; ng[i] = g[i] * k; nb[i] = b[i] * k; }
          r = nr; g = ng; b = nb;
        }
      } else { r = src.data[0]; g = src.data[1]; b = src.data[2]; }
      // crop (stacking edges)
      const cx = Math.round(W * P.crop), cy = Math.round(H * P.crop);
      const CW = W - 2 * cx, CH = H - 2 * cy;
      const crop = (a) => { const o = new Float32Array(CW * CH); for (let y = 0; y < CH; y++) o.set(a.subarray((y + cy) * W + cx, (y + cy) * W + cx + CW), y * CW); return o; };
      work = { W: CW, H: CH, r: crop(r), g: crop(g), b: crop(b) };
      if (P.rgbAlign) rgbAlign(work);
      if (P.be) for (const k of ['r', 'g', 'b']) subtractBackground(work[k], CW, CH, P.beStr);
      if (P.neutral) neutralize(work);
      asinhHDR(work, P.hdr);
      if (P.auto) autoStretchParams();
      render();
    }
    function autoStretchParams() {
      if (P.planetary) { const s = sample(lum(work)); P.black = s[Math.floor(s.length * 0.3)] * 1.02; P.white = Math.max(P.black + 1e-4, s[s.length - 1] * 1.03); P.mid = 0.4; return; }
      const L = lum(work); const s = sample(L); const med = s[s.length >> 1]; const mad = s.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[s.length >> 1] * 1.4826;
      P.black = Math.max(0, med - 2.5 * mad); const hi = s[Math.floor(s.length * 0.9995)] || 1; P.white = Math.max(P.black + 1e-4, Math.min(1, hi * 1.05));
      const mN = (med - P.black) / (P.white - P.black); const T = 0.2; P.mid = mN <= 0 ? 0.5 : ((T - 1) * mN) / ((2 * T - 1) * mN - T);
      P.mid = Math.max(0.0005, Math.min(0.5, P.mid));
    }
    let renderTimer = null;
    function render() { clearTimeout(renderTimer); renderTimer = setTimeout(doRender, 30); }
    function doRender() {
      if (!work) return;
      const out = process(work, P);
      const c = document.createElement('canvas'); c.width = work.W; c.height = work.H;
      const id = new ImageData(out.rgba, work.W, work.H); c.getContext('2d').putImageData(id, 0, 0);
      viewer.setImage(c); lastCanvas = c;
      drawHistogram(hist, out.hist, { log: true });
    }
    let lastCanvas = null;

    function renderPanel() {
      panel.innerHTML = '';
      const stackSel = select([['', '— choose stack —'], ...[...G.s.stacks].reverse().map((s) => [s.id, `${s.target} · ${fname(s.filter)} · ${s.n}×${Math.round(s.integration / s.n)}s`])], src ? src.meta.id : '', (v) => v && loadStack(v));
      panel.append(h('div', { class: 'card' }, h('h3', {}, 'Image'), stackSel, src ? h('div', { class: 'small muted' }, `${src.meta.n} subs · ${fmtDur(src.meta.integration)} · ${src.meta.darks} darks · ${src.meta.flats} flats`) : null));
      if (!src) return;
      if (mono) {
        const opts = [['', '—'], ...G.s.stacks.filter((s) => s.nc === 1 && s.target === src.meta.target).map((s) => [s.id, `${fname(s.filter)} (${s.n} subs)`])];
        const ch = (k, label) => h('div', { class: 'row' }, h('span', { style: { width: '22px' } }, label), select(opts, combo[k] || '', (v) => { combo[k] = v || null; rebuild(); }));
        const preset = (name) => { const by = (band) => ([...G.s.stacks].reverse().find((s) => s.nc === 1 && s.target === src.meta.target && filterBand(s.filter) === band) || {}).id || null;
          if (name === 'HOO') combo = { R: by('ha'), G: by('oiii'), B: by('oiii'), L: null };
          if (name === 'SHO') combo = { R: by('sii'), G: by('ha'), B: by('oiii'), L: null };
          if (name === 'LRGB') combo = { R: by('R'), G: by('G'), B: by('B'), L: by('L') };
          if (name === 'Mono') combo = { R: src.meta.id, G: src.meta.id, B: src.meta.id, L: null };
          for (const k of ['R', 'G', 'B']) if (!combo[k]) combo[k] = src.meta.id; renderPanel(); rebuild(); };
        panel.append(h('div', { class: 'card' }, h('h3', {}, 'Channel combination (mono)'), ch('R', 'R'), ch('G', 'G'), ch('B', 'B'), ch('L', 'L'),
          h('div', { class: 'row wrap' }, ...['Mono', 'HOO', 'SHO', 'LRGB'].map((p) => h('button', { class: 'btn tiny', onclick: () => preset(p) }, p)))));
      }
      const slider = (label, k, min, max, step, onCh = render, fmt = (v) => v.toFixed(2)) => {
        const lab = h('b', {}, fmt(P[k]));
        return h('div', { class: 'sl' }, h('span', {}, label), h('input', { type: 'range', min, max, step, value: P[k], oninput: (e) => { P[k] = +e.target.value; lab.textContent = fmt(P[k]); if (k === 'black' || k === 'mid' || k === 'white') P.auto = false; onCh(); } }), lab);
      };
      const chk = (label, k, onCh) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: P[k], onchange: (e) => { P[k] = e.target.checked; onCh(); } }), label);
      if (P.planetary) panel.append(h('div', { class: 'card' }, h('h3', {}, '1 · Planetary'), chk('RGB align (undo atmospheric dispersion)', 'rgbAlign', rebuild),
        slider('Wavelets (detail)', 'wave', 0, 2.5, 0.01), slider('Finest layer', 'waveFine', 0, 2, 0.01), h('div', { class: 'small muted' }, 'Lucky stacks are soft until sharpened. Push the wavelets until detail pops — but stop before noise and dark rings at the limb appear.')));
      else panel.append(h('div', { class: 'card' }, h('h3', {}, '1 · Crop & gradients'), slider('Crop edges', 'crop', 0, 0.2, 0.005, rebuild, (v) => `${(v * 100).toFixed(1)}%`), chk('Background extraction (remove light-pollution gradient)', 'be', rebuild), slider('Strength', 'beStr', 0, 1, 0.05, rebuild)));
      panel.append(h('div', { class: 'card' }, h('h3', {}, '2 · Color calibration'), chk('Neutralize background', 'neutral', rebuild),
        ...['Red', 'Green', 'Blue'].map((c, i) => { const lab = h('b', {}, P.wb[i].toFixed(2)); return h('div', { class: 'sl' }, h('span', {}, c), h('input', { type: 'range', min: 0.5, max: 1.8, step: 0.01, value: P.wb[i], oninput: (e) => { P.wb[i] = +e.target.value; lab.textContent = P.wb[i].toFixed(2); render(); } }), lab); })));
      panel.append(h('div', { class: 'card' }, h('h3', {}, '3 · Stretch (histogram transformation)'),
        h('button', { class: 'btn small', onclick: () => { P.auto = true; autoStretchParams(); renderPanel(); render(); } }, 'Auto stretch'),
        slider('Black point', 'black', 0, 0.2, 0.0005, render, (v) => v.toFixed(4)), slider('Midtones', 'mid', 0.001, 0.5, 0.001, render, (v) => v.toFixed(3)), slider('White point', 'white', 0.05, 1, 0.005), slider('HDR (protect cores)', 'hdr', 0, 1, 0.01, () => { P.auto = true; rebuild(); })));
      panel.append(h('div', { class: 'card' }, h('h3', {}, '4 · Finishing'), slider('Contrast (S-curve)', 'contrast', 0, 0.8, 0.01), slider('Saturation', 'sat', 0, 1.5, 0.01), slider('Noise reduction', 'nr', 0, 1, 0.01), slider('Sharpening', 'sharp', 0, 1.5, 0.01), slider('Star reduction', 'starRed', 0, 1, 0.01)));
      const title = h('input', { class: 'inp', value: P.title, oninput: (e) => { P.title = e.target.value; } });
      panel.append(h('div', { class: 'card' }, h('h3', {}, '5 · Export'), title, h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => exportFinal() }, '💾 Save final image'),
        h('button', { class: 'btn', onclick: () => { if (!lastCanvas) return; const a = document.createElement('a'); a.download = `${(P.title || 'astro').replace(/\W+/g, '_')}.jpg`; a.href = lastCanvas.toDataURL('image/jpeg', 0.92); a.click(); } }, '⬇ Download JPEG'))));
    }
    async function exportFinal() {
      if (!lastCanvas || !work) return;
      const out = process(work, P);
      const sc = scoreImage(out, work, src.meta, P);
      try { ensureSpace(finalBytes(src.meta), 'the exported image'); } catch (e) { toast(e.message, 'bad', 8000); return; }
      const id = uid();
      const url = lastCanvas.toDataURL('image/jpeg', 0.9);
      const thumbC = document.createElement('canvas'); const tw = 360; thumbC.width = tw; thumbC.height = Math.round(tw * work.H / work.W); thumbC.getContext('2d').drawImage(lastCanvas, 0, 0, thumbC.width, thumbC.height);
      await idbSet('final:' + id, url); await idbSet('finalthumb:' + id, thumbC.toDataURL('image/jpeg', 0.85));
      G.s.finals.push({ id, title: P.title || src.meta.target, target: src.meta.target, created: G.s.time, stack: src.meta.id, integration: src.meta.integration, n: src.meta.n, cam: src.meta.cam, optic: src.meta.optic, focal: src.meta.focal, filter: mono ? Object.values(combo).filter(Boolean).map((sid) => G.s.stacks.find((s) => s.id === sid)?.filter).filter(Boolean) : [src.meta.filter], score: sc, posted: false, loc: src.meta.loc });
      save(true); emit('final', id);
      toast(`Saved "${P.title}". Open StarShare to publish it!`, 'good');
    }
    if (arg) loadStack(arg); else renderPanel();
    return { onArg(id) { loadStack(id); }, onResize() { viewer.draw(); } };
  },
};

// ---------- processing pipeline ----------
// HDR: arcsinh stretch of luminance (colour ratios preserved). Linear for faint signal, logarithmic for
// bright cores, so the following histogram stretch no longer burns out M42-like cores.
export function asinhHDR(w, amount) {
  if (!amount) return;
  const beta = Math.pow(10, 1 + 3 * amount), norm = Math.asinh(beta), n = w.W * w.H;
  let mx = 1e-6; for (let i = 0; i < n; i++) { const L = (w.r[i] + w.g[i] + w.b[i]) / 3; if (L > mx) mx = L; }
  for (let i = 0; i < n; i++) {
    const L = Math.max(0, (w.r[i] + w.g[i] + w.b[i]) / 3) / mx;
    const k = L > 1e-9 ? Math.asinh(beta * L) / (norm * L) : beta / norm;
    w.r[i] *= k; w.g[i] *= k; w.b[i] *= k;
  }
}
function lum(w) { const n = w.W * w.H, L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = (w.r[i] + w.g[i] + w.b[i]) / 3; return L; }
function sample(a, n = 40000) { const s = []; const st = Math.max(1, Math.floor(a.length / n)); for (let i = 0; i < a.length; i += st) s.push(a[i]); return s.sort((x, y) => x - y); }
function subtractBackground(a, W, H, str) {
  // grid of low percentiles -> fit 2nd order polynomial -> subtract
  const GX = 12, GY = 8; const pts = [];
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const x0 = Math.floor((i * W) / GX), x1 = Math.floor(((i + 1) * W) / GX), y0 = Math.floor((j * H) / GY), y1 = Math.floor(((j + 1) * H) / GY);
    const s = []; for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) s.push(a[y * W + x]); s.sort((p, q) => p - q);
    pts.push([(x0 + x1) / 2 / W - 0.5, (y0 + y1) / 2 / H - 0.5, s[Math.floor(s.length * 0.25)]]);
  }
  // robust: drop the brightest 25% of samples (nebulae)
  const vals = pts.map((p) => p[2]).sort((p, q) => p - q); const cut = vals[Math.floor(vals.length * 0.75)];
  const use = pts.filter((p) => p[2] <= cut);
  const basis = (x, y) => [1, x, y, x * x, x * y, y * y];
  const M = Array.from({ length: 6 }, () => new Float64Array(6)), v = new Float64Array(6);
  for (const [x, y, z] of use) { const b = basis(x, y); for (let i = 0; i < 6; i++) { v[i] += b[i] * z; for (let k = 0; k < 6; k++) M[i][k] += b[i] * b[k]; } }
  const c = solve(M, v); if (!c) return;
  const minV = vals[0];
  for (let y = 0; y < H; y++) { const yy = y / H - 0.5; for (let x = 0; x < W; x++) { const xx = x / W - 0.5; const b = basis(xx, yy); let m = 0; for (let i = 0; i < 6; i++) m += c[i] * b[i]; a[y * W + x] -= (m - minV * 0.9) * str; } }
}
function solve(M, v) {
  const n = v.length; const A2 = M.map((r, i) => [...r, v[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A2[k][i]) > Math.abs(A2[p][i])) p = k;
    [A2[i], A2[p]] = [A2[p], A2[i]]; if (Math.abs(A2[i][i]) < 1e-14) return null;
    for (let k = i + 1; k < n; k++) { const f = A2[k][i] / A2[i][i]; for (let j = i; j <= n; j++) A2[k][j] -= f * A2[i][j]; }
  }
  const x = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let s = A2[i][n]; for (let j = i + 1; j < n; j++) s -= A2[i][j] * x[j]; x[i] = s / A2[i][i]; } return x;
}
function neutralize(w) {
  const meds = ['r', 'g', 'b'].map((k) => { const s = sample(w[k]); return s[Math.floor(s.length * 0.3)]; });
  const target = Math.max(...meds);
  ['r', 'g', 'b'].forEach((k, i) => { const d = target - meds[i]; const a = w[k]; for (let j = 0; j < a.length; j++) a[j] += d; });
}
function blur(a, W, H, r) {
  const o = new Float32Array(a.length), t = new Float32Array(a.length);
  for (let y = 0; y < H; y++) { let s = 0; const row = y * W; for (let x = -r; x <= r; x++) s += a[row + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { t[row + x] = s / (2 * r + 1); s += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; } }
  for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = s / (2 * r + 1); s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; } }
  return o;
}
// Shift R and B so their centroids match G (atmospheric dispersion on planets)
export function rgbAlign(w) {
  const { W, H } = w;
  const cen = (a) => { let mx = 0; for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i]; const th = mx * 0.25; let sx = 0, sy = 0, sw = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = a[y * W + x] - th; if (v > 0) { sx += x * v; sy += y * v; sw += v; } } return sw ? [sx / sw, sy / sw] : [W / 2, H / 2]; };
  const g = cen(w.g);
  for (const k of ['r', 'b']) {
    const c = cen(w[k]), dx = c[0] - g[0], dy = c[1] - g[1]; if (Math.hypot(dx, dy) < 0.05) continue;
    const a = w[k], o = new Float32Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const fx = x + dx, fy = y + dy, x0 = Math.floor(fx), y0 = Math.floor(fy); if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
      const u = fx - x0, v = fy - y0, i = y0 * W + x0;
      o[y * W + x] = a[i] * (1 - u) * (1 - v) + a[i + 1] * u * (1 - v) + a[i + W] * (1 - u) * v + a[i + W + 1] * u * v;
    }
    w[k] = o;
  }
}
export function process(w, P) {
  const { W, H } = w, n = W * H;
  const mtf = (x, m) => (x <= 0 ? 0 : x >= 1 ? 1 : ((m - 1) * x) / ((2 * m - 1) * x - m));
  const ch = ['r', 'g', 'b'].map((k, i) => {
    const a = w[k], o = new Float32Array(n);
    for (let j = 0; j < n; j++) { const v = (a[j] * P.wb[i] - P.black) / (P.white - P.black); o[j] = mtf(v, P.mid); }
    return o;
  });
  // star reduction (min filter on bright compact features)
  if (P.starRed > 0) for (const a of ch) { const m = new Float32Array(a); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; let mn = a[i]; for (const d of [-1, 1, -W, W]) mn = Math.min(mn, a[i + d]); m[i] = mn; } for (let i = 0; i < n; i++) a[i] = a[i] * (1 - P.starRed) + m[i] * P.starRed; }
  // wavelet sharpening (à trous-style detail layers at 1, 2 and 4 px), for lucky-imaging stacks
  if (P.wave > 0) for (const a of ch) {
    const b1 = blur(a, W, H, 1), b2 = blur(b1, W, H, 2), b3 = blur(b2, W, H, 4);
    const f = P.waveFine ?? 1;
    for (let i = 0; i < n; i++) a[i] += P.wave * (1.6 * f * (a[i] - b1[i]) + 1.2 * (b1[i] - b2[i]) + 0.45 * (b2[i] - b3[i]));
  }
  // noise reduction: blend toward blur, weighted by darkness (protect bright detail)
  if (P.nr > 0 || P.sharp > 0) for (const a of ch) {
    const b1 = blur(a, W, H, 1), b2 = P.nr > 0 ? blur(a, W, H, 2) : null;
    for (let i = 0; i < n; i++) {
      let v = a[i];
      if (P.sharp > 0) v += (a[i] - b1[i]) * P.sharp * Math.min(1, a[i] * 3);
      if (b2) { const m = P.nr * Math.max(0, 1 - a[i] * 2.2); v = v * (1 - m) + b2[i] * m; }
      a[i] = v;
    }
  }
  const rgba = new Uint8ClampedArray(n * 4); const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const S = (x) => { const c = P.contrast; return x + c * (x - 0.5) * (1 - Math.abs(2 * x - 1)) * 0.9 * (x > 0.5 ? 1 : 1); };
  for (let i = 0; i < n; i++) {
    let r = S(ch[0][i]), g = S(ch[1][i]), b = S(ch[2][i]);
    const l = 0.299 * r + 0.587 * g + 0.114 * b; const s = 1 + P.sat;
    r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s;
    const R = Math.max(0, Math.min(255, r * 255)), G2 = Math.max(0, Math.min(255, g * 255)), B = Math.max(0, Math.min(255, b * 255));
    rgba[i * 4] = R; rgba[i * 4 + 1] = G2; rgba[i * 4 + 2] = B; rgba[i * 4 + 3] = 255;
    hist[0][R | 0]++; hist[1][G2 | 0]++; hist[2][B | 0]++;
  }
  return { rgba, hist };
}
void cat; void promptDlg; void select;

// =====================================================================
// Headless versions of DeepStack / PixelLab, used by scripts
// =====================================================================
function resampleStack(refMeta, s) {
  if (s.meta.id === refMeta.id) return s.data[0];
  const W = refMeta.W, H = refMeta.H; const out = new Float32Array(W * H);
  const pr = refMeta.ref, pf = s.meta.ref; const sc = refMeta.scale / s.meta.scale;
  const p = A.tanProject(pr.ra, pr.dec, pf.ra, pf.dec);
  const dxi = p.xi * A.R2D * 3600 / refMeta.scale, deta = p.eta * A.R2D * 3600 / refMeta.scale;
  const thR = pr.rot * A.D2R, thF = pf.rot * A.D2R; const a = s.data[0]; const SW = s.meta.W, SH = s.meta.H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x + 0.5 - W / 2, v = y + 0.5 - H / 2;
    const bx = u * Math.cos(thR) + v * Math.sin(thR) + dxi, by = -u * Math.sin(thR) + v * Math.cos(thR) + deta;
    const fu = (bx * Math.cos(thF) - by * Math.sin(thF)) * sc + SW / 2 - 0.5, fv = (bx * Math.sin(thF) + by * Math.cos(thF)) * sc + SH / 2 - 0.5;
    const x0 = Math.floor(fu), y0 = Math.floor(fv); if (x0 < 0 || y0 < 0 || x0 >= SW - 1 || y0 >= SH - 1) continue;
    const fx = fu - x0, fy = fv - y0, i = y0 * SW + x0;
    out[y * W + x] = a[i] * (1 - fx) * (1 - fy) + a[i + 1] * fx * (1 - fy) + a[i + SW] * (1 - fx) * fy + a[i + SW + 1] * fx * fy;
  }
  return out;
}

// Stack the newest light frames of `target` (optionally one filter) with matching calibration frames.
export async function autoStack({ target, filter = null, method = 'kappa', minScore = 40, onProgress = () => {} }) {
  const key = (s) => String(s || '').toLowerCase();
  let lights = G.s.frames.filter((f) => f.type === 'light' && key(f.target) === key(target) && (filter === null || (f.filter || null) === filter));
  if (!lights.length) throw new Error(`No light frames of “${target}”${filter ? ' with filter ' + fname(filter) : ''}.`);
  // keep the newest rig/resolution group
  const last = lights[lights.length - 1];
  lights = lights.filter((f) => f.cam === last.cam && f.optic === last.optic && f.focal === last.focal && f.quality === last.quality && (f.filter || null) === (last.filter || null));
  const maxStars = Math.max(1, ...lights.map((f) => f.stats.stars));
  const minHfr = Math.min(...lights.map((f) => f.stats.hfr || 99));
  const scoreOf = (f) => Math.round(100 * (f.stats.stars / maxStars) * Math.min(1, minHfr / Math.max(0.1, f.stats.hfr)) * (1 - Math.max(0, f.stats.ecc - 0.4)));
  let sel = lights.filter((f) => scoreOf(f) >= minScore); if (sel.length < Math.min(3, lights.length)) sel = lights.slice();
  sel.sort((a, b) => scoreOf(b) - scoreOf(a));
  const L = sel[0];
  const pool = (type) => G.s.frames.filter((f) => f.type === type && f.cam === L.cam && f.quality === L.quality);
  const darks = pool('dark'), flats = pool('flat'), biases = pool('bias');
  const matchDark = darks.filter((d) => Math.abs(d.exp - L.exp) < 0.5 && d.gain === L.gain && Math.abs(d.temp - L.temp) < 3 && (d.bin || 1) === (L.bin || 1));
  const darkSel = matchDark.length ? matchDark : darks.filter((d) => Math.abs(d.exp - L.exp) < 0.5 && d.gain === L.gain);
  const flatSel = flats.filter((f) => f.optic === L.optic && (f.filter || '') === (L.filter || '') && Math.abs(f.focal - L.focal) < 2);
  const job = { lights: sel.map((f) => f.recipe), darks: darkSel.slice(-40).map((f) => f.recipe), flats: flatSel.slice(-40).map((f) => f.recipe), biases: biases.slice(-40).map((f) => f.recipe), method, kappa: 2.5 };
  const res = await stackJob(job, onProgress);
  const id = uid(); const integ = sel.reduce((a, f) => a + f.exp, 0);
  const meta = { id, target: L.target || 'Untitled', n: sel.length, integration: integ, filter: L.filter, cam: L.cam, optic: L.optic, focal: L.focal, W: res.W, H: res.H, nc: res.nc, method, ref: res.refPointing, scale: res.scale, created: G.s.time, darks: job.darks.length, flats: job.flats.length,
    quality: qualityOf(sel), loc: L.loc, sessions: [...new Set(sel.map((f) => f.session))].length };
  meta.bytes = stackBytes(meta); ensureSpace(meta.bytes, 'the stacked image');
  await idbSet('stack:' + id, { data: res.data, coverage: res.coverage });
  G.s.stacks.push(meta);
  while (G.s.stacks.length > 40) { const old = G.s.stacks.shift(); idbDel('stack:' + old.id); }
  save(true); emit('stacked', meta);
  return meta;
}

// Combine + process the newest stacks of `target` and save a final image. Returns the final's id.
// preset: 'auto' | 'color' | 'mono' | 'LRGB' | 'RGB' | 'HOO' | 'SHO'
export async function autoProcess({ target, preset = 'auto', title, params = {} }) {
  const key = (s) => String(s || '').toLowerCase();
  const mine = G.s.stacks.filter((s) => key(s.target) === key(target));
  if (!mine.length) throw new Error(`No stacks of “${target}” — run stack first.`);
  const newest = (band) => [...mine].reverse().find((s) => filterBand(s.filter) === band);
  const color = [...mine].reverse().find((s) => s.nc === 3);
  if (preset === 'auto') preset = color ? 'color' : newest('R') && newest('G') && newest('B') ? (newest('L') ? 'LRGB' : 'RGB') : newest('ha') && newest('oiii') ? (newest('sii') ? 'SHO' : 'HOO') : 'mono';
  const load = async (m) => ({ meta: m, data: (await idbGet('stack:' + m.id)).data });
  let ref, r, g, b, L = null, used = [];
  if (preset === 'color') { if (!color) throw new Error('No color stack.'); const s = await load(color); ref = color; used = [color]; [r, g, b] = s.data; }
  else {
    const pick = { LRGB: ['R', 'G', 'B', 'L'], RGB: ['R', 'G', 'B', null], HOO: ['ha', 'oiii', 'oiii', null], SHO: ['sii', 'ha', 'oiii', null] }[preset];
    if (pick) {
      const ms = pick.map((f) => (f ? newest(f) : null));
      if (ms.slice(0, 3).some((m) => !m)) throw new Error(`${preset} needs stacks for ${pick.filter(Boolean).map((b) => ({ ha: 'Hα', oiii: 'OIII', sii: 'SII' }[b] || b)).join(', ')}.`);
      ref = ms[3] || ms[0]; used = [...new Set(ms.filter(Boolean))];
      const get = async (m) => resampleStack(ref, await load(m));
      r = await get(ms[0]); g = await get(ms[1]); b = await get(ms[2]); if (ms[3]) L = await get(ms[3]);
    } else { ref = [...mine].reverse()[0]; used = [ref]; const s = await load(ref); r = g = b = s.data[0]; }
  }
  const W = ref.W, H = ref.H;
  if (L) { const nr = new Float32Array(W * H), ng = new Float32Array(W * H), nb = new Float32Array(W * H); for (let i = 0; i < W * H; i++) { const y = (r[i] + g[i] + b[i]) / 3 + 1e-6; const k = L[i] / y; nr[i] = r[i] * k; ng[i] = g[i] * k; nb[i] = b[i] * k; } r = nr; g = ng; b = nb; }
  const planetary = !!ref.planetary;
  const P = planetary ? { planetary: true, crop: 0, be: false, beStr: 0, neutral: false, wb: [1, 1, 1], contrast: 0.1, sat: 0.35, nr: 0.05, sharp: 0, starRed: 0, hdr: 0, wave: 0.9, waveFine: 1, rgbAlign: true, midScale: 1, ...params }
    : { crop: 0.03, be: true, beStr: 1, neutral: true, wb: [1, 1, 1], contrast: 0.15, sat: 0.4, nr: 0.3, sharp: 0.2, starRed: 0, hdr: 0, midScale: 1, ...params };
  const cx = Math.round(W * P.crop), cy = Math.round(H * P.crop), CW = W - 2 * cx, CH = H - 2 * cy;
  const crop = (a) => { const o = new Float32Array(CW * CH); for (let y = 0; y < CH; y++) o.set(a.subarray((y + cy) * W + cx, (y + cy) * W + cx + CW), y * CW); return o; };
  const work = { W: CW, H: CH, r: crop(r), g: crop(g), b: crop(b) };
  if (P.rgbAlign) rgbAlign(work);
  if (P.be) for (const k of ['r', 'g', 'b']) subtractBackground(work[k], CW, CH, P.beStr);
  if (P.neutral) neutralize(work);
  asinhHDR(work, P.hdr);
  if (planetary) { const sp = sample(lum(work)); P.black = sp[Math.floor(sp.length * 0.3)] * 1.02; P.white = Math.max(P.black + 1e-4, sp[sp.length - 1] * 1.03); P.mid = 0.4 * P.midScale; }
  // auto stretch, then optional midtone scaling (midScale < 1 = gentler stretch to protect bright cores)
  if (!planetary) {
    const Ls = lum(work); const s = sample(Ls); const med = s[s.length >> 1]; const mad = s.map((v) => Math.abs(v - med)).sort((x, y) => x - y)[s.length >> 1] * 1.4826;
    P.black = Math.max(0, med - 2.5 * mad); const hi = s[Math.floor(s.length * 0.9995)] || 1; P.white = Math.max(P.black + 1e-4, Math.min(1, hi * 1.05));
    const mN = (med - P.black) / (P.white - P.black); const T = 0.2; P.mid = mN <= 0 ? 0.5 : ((T - 1) * mN) / ((2 * T - 1) * mN - T);
    P.mid = Math.max(0.0005, Math.min(0.5, P.mid * P.midScale));
  }
  const out = process(work, P);
  const c = document.createElement('canvas'); c.width = CW; c.height = CH; c.getContext('2d').putImageData(new ImageData(out.rgba, CW, CH), 0, 0);
  const sc = scoreImage(out, work, ref, P);
  ensureSpace(finalBytes(ref), 'the exported image');
  const id = uid();
  const thumbC = document.createElement('canvas'); thumbC.width = 360; thumbC.height = Math.round(360 * CH / CW); thumbC.getContext('2d').drawImage(c, 0, 0, thumbC.width, thumbC.height);
  await idbSet('final:' + id, c.toDataURL('image/jpeg', 0.9)); await idbSet('finalthumb:' + id, thumbC.toDataURL('image/jpeg', 0.85));
  const integration = used.reduce((a, m) => a + m.integration, 0);
  G.s.finals.push({ id, title: title || target, target, created: G.s.time, stack: ref.id, integration, n: ref.n, cam: ref.cam, optic: ref.optic, focal: ref.focal, filter: [preset], score: sc, posted: false, loc: ref.loc });
  save(true); emit('final', id);
  return id;
}
