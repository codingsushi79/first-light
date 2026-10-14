// AstroCap — the imaging suite (equipment, camera, sequencer, focus, plate solving, polar alignment)
import { h, tabs, toast, select, num, confirmDlg } from '../wm.js';
import { Viewer, drawHistogram, lineChart, canvasFromRGBA, bar } from '../components.js';
import * as A from '../astro.js';
import { G, on, off, emit, fmtTime, fmtDur, save } from '../state.js';
import { GEAR, FILTERS, sensorAt, money } from '../gear.js';
import * as S from '../session.js';
import * as RT from '../routines.js';

export const captureApp = {
  title: 'AstroCap', width: 1180, height: 740, minW: 860, minH: 520,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d63a3a"/><stop offset="1" stop-color="#5a0f24"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gc)"/><circle cx="20" cy="21" r="9" fill="none" stroke="#fff" stroke-width="2.6"/><circle cx="20" cy="21" r="3.5" fill="#fff"/><rect x="13" y="8" width="14" height="5" rx="2" fill="#fff" opacity=".85"/></svg>`,
  open(body) {
    const unsub = [];
    const listen = (ev, fn) => { on(ev, fn); unsub.push(() => off(ev, fn)); };
    const logLines = [];
    const logBox = h('div', { class: 'loglines' });
    const addLog = (m) => { logLines.push(`[${fmtTime(G.s.time, S.locNow().tz, true)}] ${m}`); if (logLines.length > 200) logLines.shift(); logBox.textContent = logLines.slice(-60).join('\n'); logBox.scrollTop = 1e9; };
    listen('log', addLog);

    // ---------- shared image viewer (used by Imaging tab) ----------
    const viewer = new Viewer({
      placeholder: 'No image yet — connect the camera and take an exposure',
      drawOverlay: (o, v) => {
        if (showCross) { o.strokeStyle = 'rgba(255,60,60,.55)'; o.lineWidth = 1; o.beginPath(); o.moveTo(v.w / 2, 0); o.lineTo(v.w / 2, v.h); o.moveTo(0, v.h / 2); o.lineTo(v.w, v.h / 2); o.stroke(); o.beginPath(); o.arc(v.w / 2, v.h / 2, 24, 0, 7); o.stroke(); }
        if (showStars && S.T.lastFrame) { o.strokeStyle = 'rgba(80,220,120,.8)'; const b = S.T.lastFrame.res.stats.bright || []; for (const [x, y] of b) { o.beginPath(); o.arc(v.ox + (x + 0.5) * v.s, v.oy + (y + 0.5) * v.s, 7, 0, 7); o.stroke(); } }
      },
    });
    let showCross = false, showStars = false;
    const saveNote = h('div', { class: 'small', style: { marginTop: '4px' } });
    let warnedCrop = false;
    const histCanvas = h('canvas', { class: 'hist' });
    const statLine = h('div', { class: 'statline' });
    const expBar = h('div', { class: 'expbar' });
    const expLabel = h('div', { class: 'explabel' });

    function showFrame(fr) {
      if (!fr) return;
      viewer.setImage(canvasFromRGBA(fr.res.preview));
      drawHistogram(histCanvas, fr.res.hist);
      const st = fr.res.stats, m = fr.meta;
      const ri = S.rig();
      const hfrAs = st.hfr * fr.res.scale;
      statLine.innerHTML = '';
      const it = (k, v, cls = '') => statLine.append(h('span', { class: 'stat ' + cls }, h('b', {}, k), ' ', v));
      it('Type', m.type.toUpperCase()); it('Exp', `${m.exp}s`); it(G.s.rig && GEAR[m.cam].type === 'dslr' ? 'ISO' : 'Gain', m.gain);
      it('Median', `${st.median.toFixed(0)} ADU`, st.median > fr.res.maxADU * 0.6 ? 'warn' : ''); it('Stars', st.stars, st.stars < 15 ? 'warn' : '');
      it('HFR', `${st.hfr.toFixed(2)}px (${hfrAs.toFixed(1)}″)`); it('Ecc', st.ecc.toFixed(2), st.ecc > 0.6 ? 'warn' : '');
      it('Sat', `${(st.saturated * 100).toFixed(2)}%`, st.saturated > 0.005 ? 'warn' : ''); it('Temp', `${m.temp}°C`);
      if (m.filter) it('Filter', FILTERS.find((f) => f.id === m.filter)?.name.split(' ')[0] || m.filter);
      if (fr.res.trailPx > 3) it('Trail', `${fr.res.trailPx.toFixed(0)}px`, 'warn');
      if (fr.res.warnings && fr.res.warnings.includes('offline')) it('⚠', 'Survey offline: catalog stars only', 'warn');
      void ri;
    }
    listen('frame', (fr) => { if (fr.meta.recipe.target !== 'guider') showFrame(fr); });

    // ---------- tabs ----------
    const t = tabs([
      { id: 'equip', label: 'Equipment', render: renderEquip },
      { id: 'imaging', label: 'Imaging', render: renderImaging },
      { id: 'sequence', label: 'Sequencer', render: renderSequence },
      { id: 'focus', label: 'Focus', render: renderFocus },
      { id: 'solve', label: 'Plate Solve', render: renderSolve },
      { id: 'polar', label: 'Polar Align', render: renderPolar },
      { id: 'log', label: 'Log', render: (el) => { el.append(h('div', { class: 'pad' }, logBox)); logBox.scrollTop = 1e9; } },
    ]);
    const root = h('div', { class: 'cap-root' }, t.bar, t.body);
    body.append(root);

    // ======================= Equipment =======================
    function renderEquip(el) {
      const n = S.night(); const ri = S.rig();
      const wrap = h('div', { class: 'pad grid2' });
      el.append(wrap);
      if (!n) { wrap.append(h('div', { class: 'notice' }, 'You are at home. Equipment can only be connected when you are set up outside. Open the Weather app to head out tonight.')); }
      const devs = h('div', { class: 'card' }, h('h3', {}, 'Devices'));
      const dev = (key, label, name, avail, why) => {
        const conn = n && n.connected[key];
        const btn = h('button', { class: 'btn ' + (conn ? '' : 'primary'), disabled: !n || !avail, onclick: () => {
          if (!n) return; S.setProp('connected.' + key, !conn);
          if (key === 'mount' && !conn) { const mt = GEAR[G.s.rig.mount]; S.log(`Mount connected: ${mt.name}`); }
          if (key === 'camera' && !conn) S.log(`Camera connected: ${ri.cam.name}`);
          if (key === 'guider' && !conn) { S.setProp('guider.calibrated', false); }
          if (!n.connected[key] && key === 'guider') S.stopGuiding('disconnected');
          emit('devices'); renderEquip(clear(el));
        } }, conn ? 'Disconnect' : 'Connect');
        devs.append(h('div', { class: 'devrow' }, h('span', { class: 'led ' + (conn ? 'on' : '') }), h('div', { class: 'devname' }, h('b', {}, label), h('div', { class: 'muted' }, avail ? name : why)), btn));
      };
      const mount = GEAR[G.s.rig.mount];
      dev('camera', 'Camera', ri.cam ? `${ri.cam.name} (USB)` : '—', !!ri.cam, 'No camera');
      dev('mount', 'Mount', mount.name, mount.computer, mount.type === 'fixed' ? 'A photo tripod has no electronics.' : 'This mount is controlled by hand / its own buttons (Field view).');
      dev('focuser', 'Focuser', 'Electronic focuser motor', ri.hasAF, ri.isLens ? 'Camera lenses are focused by hand (Field view).' : 'No motorized focuser — focus by hand (Field view).');
      dev('wheel', 'Filter wheel', `7-position wheel: ${ri.filters.map((f) => FILTERS.find((x) => x.id === f)?.name.split(' ')[0]).join(', ') || 'empty'}`, ri.hasWheel, ri.cam && ri.cam.mono ? 'No filter wheel in your rig.' : 'Filter wheels are for mono cameras.');
      dev('guider', 'Guider (GuideMaster)', 'Guide camera + guide scope', ri.hasGuide && (mount.computer || mount.guideAxes), ri.hasGuide ? 'Mount cannot accept guide pulses.' : 'No guide kit in your rig.');
      wrap.append(devs);
      // rig summary
      const card = h('div', { class: 'card' }, h('h3', {}, 'Optical train'));
      if (ri.opt && ri.cam) {
        const kv = (k, v) => card.append(h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, v)));
        kv('Optics', ri.opt.name + (ri.corr ? ' + ' + ri.corr.name : ''));
        kv('Focal length', `${ri.focal.toFixed(0)} mm`); kv('Aperture', `${ri.D.toFixed(1)} mm (f/${ri.fstop.toFixed(1)})`);
        kv('Camera', ri.cam.name); kv('Sensor', `${ri.cam.w}×${ri.cam.h} · ${ri.cam.pix}µm · ${ri.sensorW.toFixed(1)}×${ri.sensorH.toFixed(1)}mm`);
        kv('Pixel scale', `${ri.scale.toFixed(2)} ″/px`); kv('Field of view', `${ri.fovW.toFixed(2)}° × ${ri.fovH.toFixed(2)}°`);
        kv('Mount', `${mount.name} (${ri.weight.toFixed(1)} / ${mount.payload} kg)`);
        const f = S.currentFilter(); kv('Filter', f ? f.name : 'none');
        const cfz = 4.88 * 0.55 * ri.fstop ** 2; kv('Critical focus zone', `${cfz.toFixed(0)} µm`);
        const npf = (35 * ri.fstop + 30 * ri.cam.pix) / ri.focal; kv('Max untracked exp (NPF)', `${npf.toFixed(1)} s`);
        for (const w of ri.warnings) card.append(h('div', { class: 'warnline' }, '⚠ ' + w));
      }
      wrap.append(card);
      // cooling
      if (ri.cam && ri.cam.cooled && n) {
        const c = h('div', { class: 'card' }, h('h3', {}, 'Cooling'));
        const st = h('div', { class: 'kv' }, h('span', {}, 'Sensor'), h('b', {}, `${n.cam.temp.toFixed(1)}°C · ${n.cam.power.toFixed(0)}% power`));
        c.append(st, h('div', { class: 'row' }, h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: n.cam.coolerOn, onchange: (e) => { S.setProp('cam.coolerOn', e.target.checked); S.log(`Cooler ${e.target.checked ? 'on' : 'off'}`); } }), 'Cooler on'),
          h('span', { class: 'muted' }, 'Set point'), num(n.cam.setpoint, (v) => { S.setProp('cam.setpoint', v); }, { step: 1, min: -30, max: 20, style: { width: '64px' } }), h('span', {}, '°C')));
        const tmr = setInterval(() => { if (!c.isConnected) return clearInterval(tmr); st.lastChild.textContent = `${n.cam.temp.toFixed(1)}°C · ${n.cam.power.toFixed(0)}% power`; }, 500);
        wrap.append(c);
      }
    }
    function clear(el) { el.innerHTML = ''; return el; }

    // ======================= Imaging =======================
    let loopOn = false;
    function renderImaging(el) {
      const n = S.night(); const ri = S.rig(); const cs = RT.cameraSettings();
      const left = h('div', { class: 'img-left' }, viewer.el, h('div', { class: 'img-under' }, histCanvas, statLine));
      const right = h('div', { class: 'img-right' });
      el.append(h('div', { class: 'img-wrap' }, left, right));
      setTimeout(() => { viewer.draw(); if (S.T.lastFrame) showFrame(S.T.lastFrame); }, 0);
      const cam = ri.cam;
      const gainSel = cam.type === 'dslr' ? select(cam.isos.map((i) => [i, 'ISO ' + i]), cs.gain, (v) => { cs.gain = +v; save(); updateInfo(); })
        : num(cs.gain, (v) => { cs.gain = Math.max(0, Math.min(cam.gainMax, Math.round(v))); save(); updateInfo(); }, { min: 0, max: cam.gainMax, step: 10 });
      const sensInfo = h('div', { class: 'muted small' });
      function updateInfo() { const s = sensorAt(cam, cs.gain); sensInfo.textContent = `${s.gainE.toFixed(2)} e⁻/ADU · read noise ${s.rn.toFixed(1)} e⁻ · full well ${Math.round(s.fwEff).toLocaleString()} e⁻`; }
      updateInfo();
      const roiSel = select([['fit', 'Full frame'], ['center', '1:1 center crop (focus)']], cs.roi || 'fit', (v) => { cs.roi = v; });
      const panel = h('div', { class: 'card' }, h('h3', {}, 'Camera'),
        h('div', { class: 'formgrid' },
          h('label', {}, 'Frame type'), select([['light', 'Light'], ['dark', 'Dark'], ['flat', 'Flat'], ['bias', 'Bias']], cs.type, (v) => { cs.type = v; }),
          h('label', {}, 'Exposure (s)'), h('div', { class: 'row' }, num(cs.exp, (v) => { cs.exp = Math.max(0.0001, v); save(); }, { step: 'any', min: 0.0001, style: { width: '90px' } }),
            select([[0.001, '1/1000'], [0.01, '1/100'], [0.1, '0.1'], [1, '1'], [5, '5'], [10, '10'], [20, '20'], [30, '30'], [60, '60'], [120, '120'], [180, '180'], [300, '300'], [600, '600']], '', (v) => { cs.exp = +v; save(); renderImaging(clear(el)); }, { style: { width: '74px' } })),
          h('label', {}, cam.type === 'dslr' ? 'ISO' : 'Gain'), gainSel,
          cam.type !== 'dslr' ? h('label', {}, 'Offset') : null, cam.type !== 'dslr' ? num(cs.offset, (v) => { cs.offset = Math.max(0, Math.round(v)); save(); }, { min: 0, max: 300 }) : null,
          cam.type !== 'dslr' ? h('label', {}, 'Binning') : null, cam.type !== 'dslr' ? select([[1, '1×1'], [2, '2×2'], [4, '4×4']], cs.bin || 1, (v) => { cs.bin = +v; }) : null,
          h('label', {}, 'View'), roiSel,
          h('label', {}, 'Target name'), h('input', { class: 'inp', value: cs.target || (G.s.target ? G.s.target.name : ''), placeholder: 'e.g. M31', onchange: (e) => { cs.target = e.target.value; save(); } }),
        ), sensInfo);
      if (ri.hasWheel && n) {
        const fsel = select(ri.filters.map((f, i) => [i, FILTERS.find((x) => x.id === f)?.name || f]), n.wheelPos, async (v) => { if (!n.connected.wheel) { toast('Connect the filter wheel first', 'warn'); return; } S.setProp('wheelPos', +v); S.log('Filter → ' + ri.filters[+v]); });
        panel.append(h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'muted' }, 'Filter wheel'), fsel));
      }
      const btnCap = h('button', { class: 'btn primary big', onclick: () => doCapture(false) }, '● Capture');
      const btnLoop = h('button', { class: 'btn big' + (loopOn ? ' on' : ''), onclick: () => { loopOn = !loopOn; btnLoop.classList.toggle('on', loopOn); btnLoop.textContent = loopOn ? '■ Stop loop' : '⟳ Loop'; if (loopOn) doCapture(true); } }, loopOn ? '■ Stop loop' : '⟳ Loop');
      const btnAbort = h('button', { class: 'btn big danger', onclick: () => { loopOn = false; S.abortExposure(); } }, 'Abort');
      right.append(panel, h('div', { class: 'card' }, h('div', { class: 'row wrap' }, btnCap, btnLoop, btnAbort), expBar, expLabel, saveNote,
        h('div', { class: 'row wrap', style: { marginTop: '6px' } },
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: G.s.settings.linked, onchange: (e) => { G.s.settings.linked = e.target.checked; save(); } }), 'Linked stretch'),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: showCross, onchange: (e) => { showCross = e.target.checked; viewer.draw(); } }), 'Crosshair'),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: showStars, onchange: (e) => { showStars = e.target.checked; viewer.draw(); } }), 'Mark stars'))),
        h('div', { class: 'card tips' }, h('h3', {}, 'Tips'), h('div', { class: 'muted small', html: tipsHTML(ri) })));
    }
    function tipsHTML(ri) {
      const n = S.night(); const out = [];
      if (n && n.capOn) out.push('🔴 The <b>lens cap is on</b>. Look up from the laptop (Field view) to remove it.');
      if (ri.mount && ri.mount.type === 'fixed') out.push('No tracking: keep exposures under the NPF limit shown in Equipment, or stars will trail.');
      if (ri.cam && ri.cam.type === 'dslr') out.push('DSLR: ISO 800–1600 is a good start. Aim for the histogram peak ~¼ of the way from the left.');
      if (ri.cam && ri.cam.type === 'astro') out.push('Astro camera: gain 100 (HCG) is the classic sweet spot. Set an offset so the histogram never touches zero.');
      out.push('Use the 1:1 center crop with short exposures while focusing — watch the HFR value shrink.');
      out.push('Scroll to zoom the image, drag to pan, double-click for 100%.');
      return out.map((x) => '• ' + x).join('<br>');
    }
    async function doCapture(isLoop) {
      const cs = RT.cameraSettings(); const n = S.night();
      if (!n) { toast('You are not set up outside.', 'warn'); loopOn = false; return; }
      let roi = null;
      if (cs.roi === 'center') { const ri = S.rig(); const w = Math.min(512, ri.cam.w), hh = Math.min(384, ri.cam.h); roi = { cx: Math.floor(ri.cam.w / (cs.bin || 1) / 2), cy: Math.floor(ri.cam.h / (cs.bin || 1) / 2), w, h: hh }; }
      const willSave = !isLoop && !roi;
      if (!isLoop && roi && !warnedCrop) { warnedCrop = true; toast('1:1 crop view is for focusing — these frames are NOT saved. Switch View to “Full frame” to save frames to Files.', 'warn', 7000); }
      try {
        await S.expose({ type: cs.type, exp: cs.exp, gain: cs.gain, offset: cs.offset, bin: cs.bin || 1, roi, target: cs.target || (G.s.target ? G.s.target.name : 'Untitled'), save: !isLoop && !roi });
      } catch (e) { toast(e.message, 'warn'); loopOn = false; return; }
      saveNote.innerHTML = willSave ? `<span style="color:var(--good)">✓ Saved to Files</span> <span class="muted">(${cs.target || (G.s.target ? G.s.target.name : 'Untitled')} · ${cs.type})</span>`
        : `<span style="color:var(--warn)">Preview only — not saved</span> <span class="muted">(${isLoop ? 'Loop' : '1:1 crop view'}; use Capture with View = Full frame)</span>`;
      if (isLoop && loopOn) setTimeout(() => doCapture(true), 50);
    }
    // exposure progress
    const expTimer = setInterval(() => {
      const ex = S.T.exposure;
      expBar.innerHTML = '';
      if (ex) {
        const f = Math.min(1, (G.s.time - ex.t0) / 1000 / ex.exp);
        expBar.append(bar(f, 'red'));
        expLabel.textContent = ex.rendering ? 'Downloading image…' : `Exposing ${((G.s.time - ex.t0) / 1000).toFixed(1)} / ${ex.exp}s ${ex.recipe.roi ? '(crop)' : ''}`;
      } else expLabel.textContent = RT.R.seq && RT.R.seq.state.running ? RT.R.seq.state.status : 'Idle';
    }, 150);

    // ======================= Sequence =======================
    function renderSequence(el) {
      if (!RT.R.seq) RT.R.seq = RT.newSequence();
      const seq = RT.R.seq; const ri = S.rig(); const cam = ri.cam; const n = S.night();
      const wrap = h('div', { class: 'pad' }); el.append(wrap);
      const tgtLine = h('div', { class: 'row wrap' },
        h('b', {}, 'Target: '), seq.target ? `${seq.target.name} — ${A.fmtRA(seq.target.ra)} ${A.fmtDec(seq.target.dec)}` : h('span', { class: 'muted' }, 'none (frames will be taken wherever the scope points)'),
        h('button', { class: 'btn small', onclick: () => { if (G.s.target) { seq.target = { ...G.s.target }; renderSequence(clear(el)); } else toast('Select a target in SkyChart, Tonight or Framing first.', 'warn'); } }, 'Use selected target'),
        seq.target ? h('button', { class: 'btn small', onclick: () => { seq.target = null; renderSequence(clear(el)); } }, 'Clear') : null);
      if (seq.target && n) { const p = A.radec2altaz(seq.target.ra, seq.target.dec, A.lst(G.s.time, S.locNow().lon), S.locNow().lat); tgtLine.append(h('span', { class: 'muted' }, ` · alt ${p.alt.toFixed(0)}°`)); }
      wrap.append(h('div', { class: 'card' }, tgtLine));
      const tbl = h('table', { class: 'tbl' }, h('tr', {}, ...['#', 'Type', 'Filter', 'Exposure (s)', cam.type === 'dslr' ? 'ISO' : 'Gain', cam.type === 'dslr' ? '' : 'Offset', 'Count', 'Done', ''].map((x) => h('th', {}, x))));
      const filters = ri.hasWheel ? ri.filters : [];
      seq.rows.forEach((row, i) => {
        tbl.append(h('tr', { class: seq.state.running && seq.state.row === i ? 'active' : '' },
          h('td', {}, i + 1),
          h('td', {}, select([['light', 'Light'], ['dark', 'Dark'], ['flat', 'Flat'], ['bias', 'Bias']], row.type, (v) => { row.type = v; })),
          h('td', {}, filters.length ? select([['', '(current)'], ...filters.map((f) => [f, FILTERS.find((x) => x.id === f)?.name.split(' ')[0] || f])], row.filter || '', (v) => { row.filter = v || null; }) : h('span', { class: 'muted' }, S.currentFilter() ? S.currentFilter().name.split(' ')[0] : '—')),
          h('td', {}, num(row.exp, (v) => { row.exp = Math.max(0.0001, v); updEta(); }, { step: 'any', style: { width: '80px' } })),
          h('td', {}, cam.type === 'dslr' ? select(cam.isos, row.gain, (v) => { row.gain = +v; }) : num(row.gain, (v) => { row.gain = v; }, { style: { width: '64px' } })),
          h('td', {}, cam.type === 'dslr' ? '' : num(row.offset, (v) => { row.offset = v; }, { style: { width: '56px' } })),
          h('td', {}, num(row.count, (v) => { row.count = Math.max(1, Math.round(v)); updEta(); }, { style: { width: '60px' } })),
          h('td', {}, `${row.done}`, row.done ? h('button', { class: 'btn tiny', title: 'reset', onclick: () => { row.done = 0; renderSequence(clear(el)); } }, '↺') : null),
          h('td', {}, h('button', { class: 'btn tiny', onclick: () => { seq.rows.splice(i, 1); renderSequence(clear(el)); } }, '✕'))));
      });
      const eta = h('span', { class: 'muted' });
      function updEta() { const s = seq.rows.reduce((a, r) => a + Math.max(0, r.count - r.done) * (r.exp + 2), 0); eta.textContent = `Remaining: ${fmtDur(s)} of exposures`; }
      updEta();
      wrap.append(h('div', { class: 'card' }, tbl, h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => { const last = seq.rows[seq.rows.length - 1] || { type: 'light', exp: 60, gain: RT.cameraSettings().gain, offset: RT.cameraSettings().offset, bin: 1, count: 20 }; seq.rows.push({ ...last, done: 0 }); renderSequence(clear(el)); } }, '+ Add row'),
        h('button', { class: 'btn small', onclick: () => { const L = seq.rows.find((r) => r.type === 'light'); seq.rows.push({ type: 'dark', filter: null, exp: L ? L.exp : 60, gain: L ? L.gain : 800, offset: L ? L.offset : 0, bin: 1, count: 20, done: 0 }); renderSequence(clear(el)); } }, '+ Matching darks'),
        h('button', { class: 'btn small', onclick: () => { const L = seq.rows.find((r) => r.type === 'light'); seq.rows.push({ type: 'flat', filter: L ? L.filter : null, exp: 1, gain: L ? L.gain : 800, offset: L ? L.offset : 0, bin: 1, count: 20, done: 0 }); renderSequence(clear(el)); } }, '+ Flats'),
        eta)));
      const o = seq.opts;
      const chk = (k, label, dis) => h('label', { class: 'chk' + (dis ? ' dis' : '') }, h('input', { type: 'checkbox', checked: o[k], disabled: !!dis, onchange: (e) => { o[k] = e.target.checked; } }), label);
      wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Automation'), h('div', { class: 'optgrid' },
        chk('center', 'Slew & center target (plate solve)', !GEAR[G.s.rig.mount].goto && 'needs GoTo'),
        chk('guide', 'Start guiding', !ri.hasGuide),
        chk('afStart', 'Autofocus at start', !ri.hasAF),
        h('label', { class: 'chk' }, 'Autofocus when temp. changes by ', num(o.afTemp, (v) => { o.afTemp = v; }, { style: { width: '48px' } }), '°C'),
        h('label', { class: 'chk' }, 'Dither every ', num(o.ditherEvery, (v) => { o.ditherEvery = Math.max(0, Math.round(v)); }, { style: { width: '48px' } }), ' frames (needs guiding)'),
        chk('flip', 'Automatic meridian flip', !GEAR[G.s.rig.mount].meridian),
        h('label', { class: 'chk' }, 'Pause when target below ', num(o.minAlt, (v) => { o.minAlt = v; }, { style: { width: '48px' } }), '°'),
        chk('cool', 'Cool camera first', !(cam.cooled)),
        chk('stopDawn', 'Stop at astronomical dawn'))));
      const status = h('div', { class: 'seqstatus' }, seq.state.status);
      const startBtn = h('button', { class: 'btn primary big', disabled: seq.state.running, onclick: () => { if (!S.night()) { toast('Head outside first.', 'warn'); return; } RT.runSequence(seq, (m) => S.log(m)); renderSequence(clear(el)); } }, '▶ Start sequence');
      const stopBtn = h('button', { class: 'btn danger big', disabled: !seq.state.running, onclick: () => RT.stopSequence() }, '■ Stop');
      wrap.append(h('div', { class: 'card' }, h('div', { class: 'row' }, startBtn, stopBtn, h('button', { class: 'btn', onclick: () => { RT.R.seq = RT.newSequence(); renderSequence(clear(el)); } }, 'New'), status),
        h('div', { class: 'muted small' }, 'Tip: use time warp (top bar) while a sequence runs. Real astrophotographers wait hours too.')));
      const upd = (s) => { if (!el.isConnected) return; status.textContent = s.state.status; startBtn.disabled = s.state.running; stopBtn.disabled = !s.state.running; tbl.querySelectorAll('tr').forEach((tr, i) => tr.classList.toggle('active', s.state.running && s.state.row === i - 1)); seq.rows.forEach((r, i) => { const tr = tbl.rows[i + 1]; if (tr) tr.cells[7].firstChild.textContent = String(r.done); }); updEta(); };
      listen('seq', upd);
    }

    // ======================= Focus =======================
    function renderFocus(el) {
      const n = S.night(); const ri = S.rig();
      const wrap = h('div', { class: 'pad grid2' }); el.append(wrap);
      if (!n) { wrap.append(h('div', { class: 'notice' }, 'Not observing.')); return; }
      const posLbl = h('b', {}, String(Math.round(n.focus.pos)));
      const c1 = h('div', { class: 'card' }, h('h3', {}, 'Focuser'));
      if (ri.hasAF) {
        const mv = (d) => { if (!n.connected.focuser) { toast('Connect the focuser (Equipment tab).', 'warn'); return; } S.moveFocus(d); posLbl.textContent = String(Math.round(n.focus.pos)); };
        c1.append(h('div', { class: 'kv' }, h('span', {}, 'Position'), posLbl), h('div', { class: 'row wrap' }, ...[-500, -100, -20, 20, 100, 500].map((d) => h('button', { class: 'btn small', onclick: () => mv(d) }, (d > 0 ? '+' : '') + d))),
          h('div', { class: 'formgrid', style: { marginTop: '8px' } },
            h('label', {}, 'AF exposure (s)'), num(RT.cameraSettings().afExp, (v) => { RT.cameraSettings().afExp = v; }),
            h('label', {}, 'AF step size'), num(RT.cameraSettings().afStep || 0, (v) => { RT.cameraSettings().afStep = Math.max(0, Math.round(v)); }, { title: '0 = automatic (based on critical focus zone)' }),
            h('label', {}, 'AF points'), num(RT.cameraSettings().afPoints || 9, (v) => { RT.cameraSettings().afPoints = Math.max(5, Math.min(15, Math.round(v))); })),
          h('button', { class: 'btn primary', onclick: async () => { try { RT.R.abort = false; await RT.autofocus(() => drawV(), (m) => S.log(m)); drawV(); posLbl.textContent = String(Math.round(n.focus.pos)); } catch (e) { toast(e.message, 'warn'); } } }, 'Run autofocus'));
      } else {
        c1.append(h('div', { class: 'notice' }, ri.isLens ? 'Camera lenses are focused by turning the focus ring by hand. Look up from the laptop (Field view), then watch the HFR here while you turn it. Tip: use the 1:1 crop + Loop in Imaging, or a Bahtinov mask.' : 'Your focuser is manual. Turn the focus knob in the Field view while looping short exposures. An electronic focuser enables autofocus.'));
      }
      wrap.append(c1);
      const vc = h('canvas', { class: 'chart', style: { height: '220px' } });
      const hc = h('canvas', { class: 'chart', style: { height: '140px' } });
      wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Autofocus V-curve'), vc, h('h3', {}, 'HFR history (saved frames, tonight)'), hc));
      function drawV() {
        const pts = RT.R.afCurve.map((p) => [p.pos, p.hfr]);
        const ser = [{ data: pts, color: '#ff6b6b', dots: true, r: 3.5 }];
        if (RT.R.afFit && pts.length) { const f = RT.R.afFit; const xs = pts.map((p) => p[0]); const lo = Math.min(...xs), hi = Math.max(...xs); const d = []; for (let i = 0; i <= 40; i++) { const x = lo + ((hi - lo) * i) / 40; d.push([x, f.a * x * x + f.b * x + f.c]); } ser.push({ data: d, color: '#5aa9ff' }); }
        lineChart(vc, ser, { empty: 'Run autofocus to see the V-curve', vlines: RT.R.afBest ? [{ x: RT.R.afBest, color: '#5f5', label: 'best' }] : [] , ymin: 0 });
        const fr = G.s.frames.filter((f) => f.session === n.id && f.type === 'light');
        lineChart(hc, [{ data: fr.map((f, i) => [i, f.stats.hfr]), color: '#ffd166', dots: true }], { empty: 'No light frames yet', ymin: 0 });
      }
      setTimeout(drawV, 0);
      listen('frame', () => { if (vc.isConnected) drawV(); });
    }

    // ======================= Plate solve =======================
    function renderSolve(el) {
      const n = S.night();
      const wrap = h('div', { class: 'pad grid2' }); el.append(wrap);
      const res = h('div', { class: 'card' }, h('h3', {}, 'Last solution'));
      const showRes = () => {
        res.innerHTML = ''; res.append(h('h3', {}, 'Last solution'));
        const r = n && n.lastSolve;
        if (!r) { res.append(h('div', { class: 'muted' }, 'No plate solve yet.')); return; }
        const kv = (k, v) => res.append(h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, v)));
        kv('RA', A.fmtRA(r.ra)); kv('Dec', A.fmtDec(r.dec)); kv('Rotation (PA)', `${r.pa.toFixed(1)}°`); kv('Scale', `${S.rig().scale.toFixed(2)}″/px`); kv('Stars used', r.stars); kv('Solved at', fmtTime(r.t, S.locNow().tz, true));
        if (G.s.target) { const d = A.sep(r.ra, r.dec, G.s.target.ra, G.s.target.dec); kv(`Distance to ${G.s.target.name}`, A.fmtAngle(d * 3600)); const pa = A.posAngle(r.ra, r.dec, G.s.target.ra, G.s.target.dec); kv('Direction to target', `${pa.toFixed(0)}° E of N`); }
        const rp = S.reportedPointing(); if (rp) kv('Mount thinks it points at', `${A.fmtRA(rp.ra)} ${A.fmtDec(rp.dec)} (off by ${A.fmtAngle(A.sep(rp.ra, rp.dec, r.ra, r.dec) * 3600)})`);
      };
      showRes(); listen('solve', () => res.isConnected && showRes());
      const status = h('div', { class: 'muted' });
      const run = async (fn) => { try { RT.R.abort = false; status.textContent = 'Working…'; await fn(); status.textContent = 'Done.'; } catch (e) { status.textContent = '⚠ ' + e.message; toast(e.message, 'warn'); } showRes(); };
      wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Plate solving'), h('div', { class: 'muted small' }, 'Matches star patterns in your image against a star catalog to find exactly where the telescope points.'),
        h('div', { class: 'formgrid' }, h('label', {}, 'Solve exposure (s)'), num(RT.cameraSettings().solveExp, (v) => { RT.cameraSettings().solveExp = v; })),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn primary', onclick: () => run(() => RT.captureAndSolve()) }, 'Capture & solve'),
          h('button', { class: 'btn', onclick: () => run(() => RT.solveFrame(S.T.lastFrame)) }, 'Solve last image'),
          h('button', { class: 'btn', disabled: !S.canGoto(), onclick: () => run(async () => { const r = n.lastSolve; if (!r) throw new Error('Solve first.'); S.syncTo(r.ra, r.dec); }) }, 'Sync mount'),
          h('button', { class: 'btn primary', disabled: !G.s.target, onclick: () => run(() => RT.centerOn(G.s.target, (m) => { status.textContent = m; S.log(m); })) }, G.s.target ? `Slew & center ${G.s.target.name}` : 'Center target')), status), res);
    }

    // ======================= Polar alignment =======================
    function renderPolar(el) {
      const n = S.night(); const mount = GEAR[G.s.rig.mount];
      const wrap = h('div', { class: 'pad grid2' }); el.append(wrap);
      if (!n) { wrap.append(h('div', { class: 'notice' }, 'Not observing.')); return; }
      if (mount.type !== 'eq') { wrap.append(h('div', { class: 'notice' }, mount.type === 'fixed' ? 'A fixed tripod does not track, so there is nothing to polar-align.' : 'Alt-az mounts do not need polar alignment (but they suffer from field rotation).')); return; }
      const big = h('div', { class: 'pa-big' }, '—');
      const altL = h('div', { class: 'pa-axis' }, 'Altitude: —'), azL = h('div', { class: 'pa-axis' }, 'Azimuth: —');
      const status = h('div', { class: 'muted' });
      const knobs = (label, fn) => h('div', { class: 'row' }, h('span', { style: { width: '70px' } }, label), ...[[-10, '⟲⟲'], [-1, '⟲'], [1, '⟳'], [10, '⟳⟳']].map(([d, s]) => h('button', { class: 'btn small', onclick: () => fn(d) }, s)));
      wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Three-point polar alignment'),
        h('div', { class: 'muted small' }, 'Captures and plate-solves three images while rotating the RA axis, computes where your polar axis points, then measures the remaining error live while you turn the mount’s altitude/azimuth bolts.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => {
          if (!n.connected.camera) { toast('Connect the camera.', 'warn'); return; }
          try { RT.R.abort = false; status.textContent = 'Running…'; await RT.tppaStart((m) => { if (!big.isConnected) { RT.tppaStop(); return; } big.textContent = A.fmtAngle(m.total * 60); big.className = 'pa-big ' + (m.total < 1 ? 'good' : m.total < 5 ? 'ok' : 'bad'); altL.textContent = `Altitude: ${m.alt > 0 ? 'too high' : 'too low'} by ${Math.abs(m.alt).toFixed(1)}′ ${m.alt > 0 ? '↓ lower' : '↑ raise'}`; azL.textContent = `Azimuth: ${m.az > 0 ? 'too far east' : 'too far west'} by ${Math.abs(m.az).toFixed(1)}′ ${m.az > 0 ? '← move west' : '→ move east'}`; }, (m) => { status.textContent = m; S.log(m); }); }
          catch (e) { status.textContent = '⚠ ' + e.message; }
        } }, 'Start'), h('button', { class: 'btn', onclick: () => { RT.tppaStop(); RT.R.abort = true; status.textContent = 'Stopped.'; } }, 'Stop')), status),
        h('div', { class: 'card' }, h('h3', {}, 'Total error'), big, altL, azL,
          h('h3', { style: { marginTop: '14px' } }, 'Adjustment bolts'), h('div', { class: 'muted small' }, '(You walk over to the mount and turn the bolts. Each click ≈ 1 arcminute.)'),
          knobs('Altitude', (d) => S.adjustPolar(-d, 0)), knobs('Azimuth', (d) => S.adjustPolar(0, -d)),
          h('div', { class: 'muted small' }, 'Goal: under 5′ for unguided work, under 1–2′ for long guided exposures.')));
    }

    t.show(S.night() && S.night().connected.camera ? 'imaging' : 'equip');
    listen('night', () => t.show(t.current));
    listen('devices', () => {});
    return {
      onClose() { clearInterval(expTimer); unsub.forEach((u) => u()); loopOn = false; },
      onResize() { viewer.draw(); },
    };
  },
};
void money; void confirmDlg;
