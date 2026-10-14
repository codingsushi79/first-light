// Files, DeepStack (stacking) and PixelLab (processing)
import { h, toast, openApp, select, confirmDlg, promptDlg } from '../wm.js';
import { Viewer, drawHistogram, canvasFromRGBA, bar } from '../components.js';
import * as A from '../astro.js';
import { G, on, off, emit, save, fmtTime, fmtDate, fmtDur, idbGet, idbSet, idbDel } from '../state.js';
import { GEAR, LOC, FILTERS } from '../gear.js';
import { viewRecipe, stackJob } from '../imaging.js';
import { uid } from '../util.js';
import { scoreImage } from './social.js';
import { cat } from '../catalog.js';

const fname = (f) => FILTERS.find((x) => x.id === f)?.name.split(' ')[0] || f || 'none';

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
    function renderTree() {
      tree.innerHTML = '';
      const gs = groupFrames();
      if (!gs.length) tree.append(h('div', { class: 'muted pad' }, 'No frames yet. Go out and shoot!'));
      for (const g of gs) {
        const s = g.sess; const loc = s ? LOC[s.location] : null;
        const title = s ? `${fmtDate(s.start, loc.tz)} · ${loc.name.split(' (')[0]}` : 'Unknown session';
        const byT = {}; for (const f of g.frames) { const k = `${f.type === 'light' ? (f.target || 'Untitled') : f.type.toUpperCase() + 'S'}`; (byT[k] = byT[k] || []).push(f); }
        tree.append(h('div', { class: 'ft-sess' }, '📁 ' + title));
        for (const [k, arr] of Object.entries(byT)) tree.append(h('div', { class: 'ft-item' + (cur && cur.key === s.id + k ? ' on' : ''), onclick: () => { cur = { key: s.id + k, frames: arr }; renderTree(); renderGrid(); } }, `${k} (${arr.length})`));
      }
    }
    async function renderGrid() {
      grid.innerHTML = '';
      if (!cur) return;
      const total = cur.frames.reduce((a, f) => a + (f.type === 'light' ? f.exp : 0), 0);
      grid.append(h('div', { class: 'row small muted' }, `${cur.frames.length} frames · ${fmtDur(total)} integration`, h('button', { class: 'btn tiny danger', onclick: async () => { if (await confirmDlg('Delete frames', `Delete all ${cur.frames.length} frames in this folder?`, 'Delete')) { const ids = new Set(cur.frames.map((f) => f.id)); G.s.frames = G.s.frames.filter((f) => !ids.has(f.id)); ids.forEach((id) => idbDel('thumb:' + id)); save(); cur = null; renderTree(); renderGrid(); } } }, 'Delete folder')));
      for (const f of cur.frames) {
        const img = h('img', { class: 'thumb', alt: '' });
        idbGet('thumb:' + f.id).then((u) => { if (u) img.src = u; });
        const card = h('div', { class: 'fcard', onclick: () => show(f) }, img, h('div', { class: 'small' }, `${f.type} · ${f.exp}s · ${fname(f.filter)}`), h('div', { class: 'tiny muted' }, `HFR ${f.stats.hfr} · ★${f.stats.stars}${f.stats.trail > 4 ? ' · trails' : ''}`));
        grid.append(card);
      }
    }
    async function show(f) {
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
      for (const f of G.s.frames) if (f.type === 'light') { const k = `${f.target || 'Untitled'}|${f.cam}|${f.optic}|${f.focal}|${f.filter || ''}|${f.quality || 1024}`; (g[k] = g[k] || []).push(f); }
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
      left.append(h('h3', { style: { marginTop: '14px' } }, 'Saved stacks'));
      for (const s of [...G.s.stacks].reverse()) left.append(h('div', { class: 'st-group', onclick: () => openApp('pixellab', s.id) }, h('b', {}, s.target), h('div', { class: 'small muted' }, `${s.n} subs · ${fmtDur(s.integration)} · ${fname(s.filter)} · ${s.method}`)));
    }
    function calibCandidates(lights, type) {
      const L = lights[0];
      return G.s.frames.filter((f) => f.type === type && f.cam === L.cam && f.quality === L.quality && (type === 'bias' || type === 'flat' ? true : true));
    }
    function renderRight() {
      right.innerHTML = '';
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
            quality: { hfr: avg(sel.map((f) => f.stats.hfr)), ecc: avg(sel.map((f) => f.stats.ecc)), trail: avg(sel.map((f) => f.stats.trail || 0)) }, loc: L.loc, sessions: [...new Set(sel.map((f) => f.session))].length };
          await idbSet('stack:' + id, { data: res.data, coverage: res.coverage });
          G.s.stacks.push(meta);
          while (G.s.stacks.length > 14) { const old = G.s.stacks.shift(); idbDel('stack:' + old.id); }
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
    function defaultParams() { return { crop: 0.03, be: true, beStr: 1, neutral: true, wb: [1, 1, 1], black: 0, mid: 0.25, white: 1, auto: true, contrast: 0.15, sat: 0.4, nr: 0.3, sharp: 0.2, starRed: 0, title: '' }; }

    async function loadStack(id) {
      const meta = G.s.stacks.find((s) => s.id === id); if (!meta) return;
      const d = await idbGet('stack:' + id); if (!d) { toast('Stack data missing.', 'warn'); return; }
      src = { ...d, W: meta.W, H: meta.H, nc: meta.nc, meta };
      mono = meta.nc === 1; combo = mono ? { R: id, G: id, B: id, L: null } : null;
      P = defaultParams(); P.title = meta.target;
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
      if (P.be) for (const k of ['r', 'g', 'b']) subtractBackground(work[k], CW, CH, P.beStr);
      if (P.neutral) neutralize(work);
      if (P.auto) autoStretchParams();
      render();
    }
    function autoStretchParams() {
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
        const preset = (name) => { const by = (f) => (G.s.stacks.find((s) => s.nc === 1 && s.target === src.meta.target && s.filter === f) || {}).id || null;
          if (name === 'HOO') combo = { R: by('f_ha'), G: by('f_oiii'), B: by('f_oiii'), L: null };
          if (name === 'SHO') combo = { R: by('f_sii'), G: by('f_ha'), B: by('f_oiii'), L: null };
          if (name === 'LRGB') combo = { R: by('f_R'), G: by('f_G'), B: by('f_B'), L: by('f_L') };
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
      panel.append(h('div', { class: 'card' }, h('h3', {}, '1 · Crop & gradients'), slider('Crop edges', 'crop', 0, 0.2, 0.005, rebuild, (v) => `${(v * 100).toFixed(1)}%`), chk('Background extraction (remove light-pollution gradient)', 'be', rebuild), slider('Strength', 'beStr', 0, 1, 0.05, rebuild)));
      panel.append(h('div', { class: 'card' }, h('h3', {}, '2 · Color calibration'), chk('Neutralize background', 'neutral', rebuild),
        ...['Red', 'Green', 'Blue'].map((c, i) => { const lab = h('b', {}, P.wb[i].toFixed(2)); return h('div', { class: 'sl' }, h('span', {}, c), h('input', { type: 'range', min: 0.5, max: 1.8, step: 0.01, value: P.wb[i], oninput: (e) => { P.wb[i] = +e.target.value; lab.textContent = P.wb[i].toFixed(2); render(); } }), lab); })));
      panel.append(h('div', { class: 'card' }, h('h3', {}, '3 · Stretch (histogram transformation)'),
        h('button', { class: 'btn small', onclick: () => { P.auto = true; autoStretchParams(); renderPanel(); render(); } }, 'Auto stretch'),
        slider('Black point', 'black', 0, 0.2, 0.0005, render, (v) => v.toFixed(4)), slider('Midtones', 'mid', 0.001, 0.5, 0.001, render, (v) => v.toFixed(3)), slider('White point', 'white', 0.05, 1, 0.005)));
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
