// Scripts — write, save and run observing scripts (retake the same photo with one click).
import { h, toast, confirmDlg, promptDlg } from '../wm.js';
import { G, on, off, save } from '../state.js';
import { uid } from '../util.js';
import { HELP, EXAMPLES, SR, runScript, stopScript, scriptFromCurrent, parse } from '../script.js';

export const scriptsApp = {
  title: 'Scripts', width: 1180, height: 720, minW: 820, minH: 460,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gsc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3f4b"/><stop offset="1" stop-color="#14171d"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gsc)"/><path d="M11 14l5 6-5 6" stroke="#9fe3a8" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 26h10" stroke="#e4e8ec" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  open(body, w, arg) {
    G.s.scripts = G.s.scripts || [];
    let cur = null; // {id?, name, text, builtin?}
    const list = h('div', { class: 'sc-list' });
    const name = h('input', { class: 'inp sc-name', placeholder: 'Script name' });
    const ed = h('textarea', { class: 'sc-ed', spellcheck: 'false' });
    const gutter = h('div', { class: 'sc-gutter' });
    const out = h('pre', { class: 'sc-out' });
    const prog = h('div', { class: 'small muted sc-prog' });
    const runBtn = h('button', { class: 'btn primary', onclick: () => run() }, '▶ Run');
    const stopBtn = h('button', { class: 'btn danger', onclick: () => stopScript() }, '■ Stop');
    const help = h('div', { class: 'sc-help' }, h('h3', {}, 'Commands'), ...HELP.map(([c, d]) => h('div', { class: 'sc-cmd' }, h('code', {}, c), h('div', { class: 'small muted' }, d))));
    body.append(h('div', { class: 'sc-root' },
      h('div', { class: 'sc-side' }, h('div', { class: 'row wrap' }, h('button', { class: 'btn small', onclick: () => newScript('') }, '+ New'), h('button', { class: 'btn small', title: 'Write a script from your current site, gear, target, framing and sequence', onclick: () => newScript(scriptFromCurrent(), 'My setup') }, '⧉ From current setup')), list),
      h('div', { class: 'sc-main' },
        h('div', { class: 'row' }, name, h('button', { class: 'btn small', onclick: () => saveCur() }, 'Save'), h('button', { class: 'btn small', onclick: () => delCur() }, 'Delete'), h('span', { style: { flex: 1 } }), runBtn, stopBtn),
        h('div', { class: 'sc-edwrap' }, gutter, ed), prog, out),
      help));
    const syncGutter = () => { const n = ed.value.split('\n').length; gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); gutter.scrollTop = ed.scrollTop; markLine(); };
    ed.addEventListener('input', syncGutter); ed.addEventListener('scroll', () => (gutter.scrollTop = ed.scrollTop));
    ed.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const s = ed.selectionStart; ed.setRangeText('  ', s, ed.selectionEnd, 'end'); } });
    function markLine() { gutter.innerHTML = ''; const n = ed.value.split('\n').length; for (let i = 1; i <= n; i++) gutter.append(h('div', { class: i === SR.line && SR.running ? 'on' : '' }, String(i))); gutter.scrollTop = ed.scrollTop; }
    function renderList() {
      list.innerHTML = '';
      list.append(h('div', { class: 'sc-sec' }, 'Examples'));
      for (const ex of EXAMPLES) list.append(h('div', { class: 'sc-item' + (cur && cur.builtin === ex.name ? ' on' : ''), onclick: () => open({ name: ex.name, text: ex.text, builtin: ex.name }) }, ex.name));
      list.append(h('div', { class: 'sc-sec' }, 'My scripts'));
      if (!G.s.scripts.length) list.append(h('div', { class: 'small muted', style: { padding: '4px 10px' } }, 'None yet. “From current setup” captures everything you have configured so you can retake the photo any time.'));
      for (const sc of G.s.scripts) list.append(h('div', { class: 'sc-item' + (cur && cur.id === sc.id ? ' on' : ''), onclick: () => open(sc) }, sc.name));
    }
    function open(sc) { cur = { ...sc }; name.value = sc.name; ed.value = sc.text; syncGutter(); renderList(); }
    function newScript(text, nm = 'Untitled') { cur = { id: null, name: nm, text }; name.value = nm; ed.value = text; syncGutter(); renderList(); ed.focus(); }
    function saveCur() {
      if (!cur) cur = {};
      const entry = { id: cur.id || uid(), name: name.value.trim() || 'Untitled', text: ed.value };
      if (cur.builtin) entry.name = name.value.trim() === cur.builtin ? cur.builtin + ' (copy)' : entry.name;
      const i = G.s.scripts.findIndex((s) => s.id === entry.id); if (i >= 0) G.s.scripts[i] = entry; else G.s.scripts.push(entry);
      cur = { ...entry }; save(); renderList(); toast('Script saved.', 'good');
    }
    async function delCur() { if (!cur || !cur.id) return; if (!(await confirmDlg('Delete script', `Delete “${cur.name}”?`, 'Delete'))) return; G.s.scripts = G.s.scripts.filter((s) => s.id !== cur.id); cur = null; name.value = ''; ed.value = ''; syncGutter(); save(); renderList(); }
    async function run() {
      try { parse(ed.value); } catch (e) { toast(e.message, 'warn'); return; }
      if (G.guest) { toast('Scripts run on the host’s game.', 'warn'); return; }
      runScript(ed.value).catch((e) => toast(e.message, 'warn'));
    }
    const showLog = () => { out.textContent = SR.log.slice(-200).join('\n'); out.scrollTop = 1e9; };
    const st = () => { runBtn.disabled = SR.running; stopBtn.disabled = !SR.running; ed.readOnly = SR.running; markLine(); showLog(); if (!SR.running) prog.textContent = ''; };
    const pr = (m) => { prog.textContent = m; };
    on('scriptlog', showLog); on('scriptstate', st); on('scriptprogress', pr);
    if (arg && arg.text) newScript(arg.text, arg.name || 'Retake'); else open({ name: EXAMPLES[0].name, text: EXAMPLES[0].text, builtin: EXAMPLES[0].name });
    st(); void promptDlg;
    return { onClose() { off('scriptlog', showLog); off('scriptstate', st); off('scriptprogress', pr); }, onArg(a) { if (a && a.text) newScript(a.text, a.name || 'Retake'); } };
  },
};
