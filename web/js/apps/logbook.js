// Logbook — Messier checklist, planets, achievements and personal records.
import { h, tabs, openApp } from '../wm.js';
import * as A from '../astro.js';
import { G, on, off, fmtDate, fmtDur } from '../state.js';
import { LOC, money } from '../gear.js';
import { TYPE_LABEL, bodyTarget, BODY_NAMES } from '../catalog.js';
import * as S from '../session.js';
import { logbook, messierList, ACHIEVEMENTS } from '../achievements.js';

export const logbookApp = {
  title: 'Logbook', width: 980, height: 660, minW: 640, minH: 420,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="glb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c79a4a"/><stop offset="1" stop-color="#5b3a12"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#glb)"/><rect x="11" y="8" width="18" height="24" rx="2" fill="#fff4dc"/><path d="M14 14h12M14 18h12M14 22h8" stroke="#8a5a1c" stroke-width="1.6"/><path d="M24 25l1.6 3.2 3.4.4-2.5 2.3.7 3.4-3.2-1.7-3.2 1.7.7-3.4-2.5-2.3 3.4-.4z" fill="#f2b23a"/></svg>`,
  open(body) {
    const t = tabs([
      { id: 'messier', label: 'Messier', render: renderMessier },
      { id: 'planets', label: 'Solar system', render: renderPlanets },
      { id: 'ach', label: 'Achievements', render: renderAch },
      { id: 'records', label: 'Records', render: renderRecords },
    ]);
    body.append(h('div', { class: 'lb-root' }, t.bar, t.body));
    let filter = 'all';
    setTimeout(() => t.show('messier'), 0);
    function renderMessier(el) {
      const l = logbook(); const list = messierList();
      const done = list.filter((d) => l.messier[d.id.replace(' ', '')]).length;
      const head = h('div', { class: 'lb-head' },
        h('div', { class: 'lb-ring', style: { '--p': `${(done / 110) * 360}deg` } }, h('b', {}, done), h('span', {}, '/ 110')),
        h('div', {}, h('h2', {}, 'The Messier catalogue'), h('div', { class: 'muted small' }, 'Charles Messier’s 1781 list of “things that are not comets” — the classic checklist for every astrophotographer. An object counts once it is inside a saved light frame.'),
          h('div', { class: 'seg', style: { marginTop: '8px' } }, ...[['all', 'All'], ['todo', 'Not yet'], ['done', 'Captured'], ['up', 'Up now']].map(([k, lab]) => h('button', { class: filter === k ? 'on' : '', onclick: () => { filter = k; el.innerHTML = ''; renderMessier(el); } }, lab)))));
      const grid = h('div', { class: 'lb-grid' });
      const n = S.night(); const loc = n ? S.locNow() : LOC[G.s.location] || LOC.backyard; const L = A.lst(G.s.time, loc.lon);
      for (const d of list) {
        const id = d.id.replace(' ', ''); const got = l.messier[id];
        const alt = A.radec2altaz(d.ra, d.dec, L, loc.lat).alt;
        if (filter === 'todo' && got) continue; if (filter === 'done' && !got) continue; if (filter === 'up' && alt < 25) continue;
        grid.append(h('div', { class: 'lb-tile' + (got ? ' got' : ''), title: `${d.name}\n${TYPE_LABEL[d.type] || d.type}${got ? `\nCaptured ${fmtDate(got.t, LOC[got.loc]?.tz || 0)} at ${LOC[got.loc]?.name || got.loc}` : ''}\nAltitude now ${alt.toFixed(0)}°`, onclick: () => openApp('planetarium', { ...d, kind: 'dso' }) },
          h('b', {}, id), h('span', { class: 'lb-name' }, d.name && d.name !== d.id ? d.name.replace(/^M\s?\d+\s*/, '').replace(/[()]/g, '') : TYPE_LABEL[d.type] || ''),
          h('span', { class: 'lb-alt' + (alt > 25 ? ' up' : '') }, got ? '✓' : alt > 0 ? `${alt.toFixed(0)}°` : '—')));
      }
      el.append(h('div', { class: 'pad' }, head, grid));
    }
    function renderPlanets(el) {
      const l = logbook();
      const grid = h('div', { class: 'lb-planets' });
      const loc = S.night() ? S.locNow() : LOC[G.s.location] || LOC.backyard; const L = A.lst(G.s.time, loc.lon);
      for (const nm of BODY_NAMES) {
        const t = bodyTarget(nm); if (!t) continue; const b = S.bodyInfo(nm);
        const alt = A.radec2altaz(b.ra, b.dec, L, loc.lat).alt; const got = l.bodies[nm];
        const sw = h('canvas', { width: 64, height: 64, class: 'lb-disc' }); drawDisc(sw, nm, b);
        grid.append(h('div', { class: 'lb-planet' + (got ? ' got' : '') }, sw,
          h('div', {}, h('b', {}, nm, got ? ' ✓' : ''), h('div', { class: 'small muted' }, `${b.diam > 120 ? (b.diam / 60).toFixed(1) + '′' : b.diam.toFixed(1) + '″'} · mag ${b.mag.toFixed(1)} · ${Math.round(b.illum * 100)}% lit`),
            h('div', { class: 'small' }, alt > 0 ? `Up now, ${alt.toFixed(0)}° high` : 'Below the horizon now'),
            got ? h('div', { class: 'small muted' }, `First imaged ${fmtDate(got.t, LOC[got.loc]?.tz || 0)}`) : null,
            h('button', { class: 'btn tiny', onclick: () => openApp('planetarium', t) }, 'Show in SkyChart'))));
      }
      el.append(h('div', { class: 'pad' }, h('div', { class: 'muted small', style: { marginBottom: '10px' } }, 'Planets need long focal lengths (2000–6000 mm), a fast planetary camera and steady seeing. Record short videos in AstroCap → Planetary, then lucky-stack them in DeepStack.'), grid));
    }
    function renderAch(el) {
      const l = logbook(); const got = ACHIEVEMENTS.filter(([id]) => l.ach[id]).length;
      const list = h('div', { class: 'lb-ach' });
      const prog = { m10: [Object.keys(l.messier).length, 10], m25: [Object.keys(l.messier).length, 25], m50: [Object.keys(l.messier).length, 50], m110: [Object.keys(l.messier).length, 110], sites5: [Object.keys(l.sites).length, 5], int10: [G.s.stats.integration / 3600, 10], int50: [G.s.stats.integration / 3600, 50], nights10: [G.s.stats.nights, 10], marathon: [Math.max(0, ...Object.values(l.nights).map((a) => a.length)), 20] };
      for (const [id, title, desc, reward] of ACHIEVEMENTS) {
        const t = l.ach[id]; const p = prog[id];
        list.append(h('div', { class: 'lb-a' + (t ? ' got' : '') }, h('div', { class: 'lb-medal' }, t ? '🏅' : '○'),
          h('div', { class: 'lb-a-body' }, h('b', {}, title), h('div', { class: 'small muted' }, desc),
            !t && p ? h('div', { class: 'lb-bar' }, h('span', { style: { width: `${Math.min(100, (p[0] / p[1]) * 100)}%` } })) : null,
            !t && p ? h('div', { class: 'small muted' }, `${Math.floor(p[0])} / ${p[1]}`) : null),
          h('div', { class: 'lb-reward' }, t ? fmtDate(t, 0) : reward ? money(reward) : '')));
      }
      el.append(h('div', { class: 'pad' }, h('h2', {}, `${got} of ${ACHIEVEMENTS.length} achievements`), list));
    }
    function renderRecords(el) {
      const s = G.s, l = logbook();
      const best = [...s.finals].sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0))[0];
      const liked = [...s.posts].sort((a, b) => b.likesNow - a.likesNow)[0];
      const longest = [...s.finals].sort((a, b) => (b.integration || 0) - (a.integration || 0))[0];
      const sites = Object.keys(l.sites).map((id) => LOC[id]).filter(Boolean);
      const darkest = [...sites].sort((a, b) => b.sqm - a.sqm)[0];
      const kv = (k, v) => h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, v));
      el.append(h('div', { class: 'pad grid2' },
        h('div', { class: 'card' }, h('h3', {}, 'Totals'), kv('Nights out', s.stats.nights), kv('Frames saved', s.stats.frames), kv('Light integration', fmtDur(s.stats.integration)), kv('Stacks', s.stacks.length), kv('Final images', s.finals.length), kv('Posts', s.posts.length)),
        h('div', { class: 'card' }, h('h3', {}, 'Bests'), kv('Best image', best ? `${best.title} · ${best.score.total}` : '—'), kv('Most liked', liked ? `${liked.title} · ${liked.likesNow} ♥` : '—'), kv('Longest integration', longest ? `${longest.title} · ${fmtDur(longest.integration)}` : '—'), kv('Darkest sky', darkest ? `${darkest.name} · SQM ${darkest.sqm.toFixed(2)}` : '—')),
        h('div', { class: 'card' }, h('h3', {}, `Sites visited (${sites.length})`), ...sites.map((x) => h('div', { class: 'small' }, `${x.name} — ${x.region || ''} · Bortle ${x.bortle}`)))));
    }
    const rr = () => { if (t.current) t.show(t.current); };
    on('achievement', rr);
    return { onClose() { off('achievement', rr); } };
  },
};

function drawDisc(c, nm, b) {
  const g = c.getContext('2d'), r = 26, cx = 32;
  g.fillStyle = '#05070b'; g.fillRect(0, 0, 64, 64);
  const [R, Gc, B] = b.col.map((x) => Math.round(x * 255));
  const grad = g.createRadialGradient(cx - 6, cx - 6, 2, cx, cx, r); grad.addColorStop(0, `rgb(${R},${Gc},${B})`); grad.addColorStop(1, `rgb(${R * 0.55 | 0},${Gc * 0.55 | 0},${B * 0.55 | 0})`);
  g.fillStyle = grad; g.beginPath(); g.arc(cx, cx, r, 0, 7); g.fill();
  if (nm === 'Jupiter') { g.fillStyle = 'rgba(120,70,40,.55)'; g.fillRect(cx - r, cx - 8, 2 * r, 5); g.fillRect(cx - r, cx + 4, 2 * r, 5); }
  if (nm === 'Saturn') { g.strokeStyle = 'rgba(230,210,160,.9)'; g.lineWidth = 3; g.beginPath(); g.ellipse(cx, cx, r * 1.25, r * 0.28, -0.2, 0, 7); g.stroke(); }
  if (b.illum < 0.97) { // phase shadow
    g.fillStyle = 'rgba(5,7,11,.92)'; g.beginPath(); const k = 2 * b.illum - 1; g.arc(cx, cx, r + 0.5, Math.PI / 2, -Math.PI / 2); g.ellipse(cx, cx, Math.abs(k) * r, r + 0.5, 0, -Math.PI / 2, Math.PI / 2, k > 0); g.fill();
  }
}
