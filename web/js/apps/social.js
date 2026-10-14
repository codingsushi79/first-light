// StarShare (publishing & judging), AstroMart (shop), Mail (mentor & quests), Settings
import { h, toast, openApp, confirmDlg, dialog, select } from '../wm.js';
import { G, on, off, emit, save, addMoney, fmtDate, fmtDur, idbGet, idbDel, isSandbox } from '../state.js';
import { GEAR, CAMERAS, OPTICS, MOUNTS, FILTERS, CORRECTORS, ACCESSORIES, STORAGE, LOC, money } from '../gear.js';
import { usage, fmtBytes } from '../storage.js';
import * as NET from '../starshare-net.js';
import { PREFS, savePrefs } from '../menu.js';
import { cat } from '../catalog.js';
import * as S from '../session.js';
import * as A from '../astro.js';
import { mulberry32, hashStr } from '../util.js';

// ============================== scoring ==============================
// Planetary / lunar images are judged on resolved detail, exposure and processing — not on stars & background.
function scorePlanet(out, work, meta, P) {
  const { W, H } = work, n = W * H, px = out.rgba; const pl = meta.planet; const fb = [];
  if (!pl) return { total: 8, feedback: ['There is no planet in this image!'], snr: 0, bg: 0, grad: 0, clip: 0, cast: 0, popularity: 0.3, targetKnown: false };
  const L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = (0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2]) / 255;
  const disk = []; let blown = 0, lap = 0, cnt = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (L[i] > 0.12) { disk.push(L[i]); if (L[i] > 0.985) blown++; lap += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - W] - L[i + W]); cnt++; } }
  const blownF = cnt ? blown / cnt : 0, texture = cnt ? lap / cnt : 0;
  // resolved detail: resolution elements across the disk
  const elems = pl.diam / Math.max(0.15, pl.fwhm);
  const detail = Math.max(0, Math.min(1, Math.log(Math.max(1, elems / 4)) / Math.log(90 / 4)));
  let s = detail * 42;
  if (elems > 60) fb.push('Stunning fine detail — the seeing was with you. 🔭'); else if (elems < 12) fb.push('Not much detail resolved — more focal length, steadier seeing or a bigger scope would help.');
  // the planet's size in the frame
  const rFrac = pl.rPix * 2 / Math.min(W, H); let sizeS = rFrac < 0.05 ? 0.3 : rFrac < 0.12 ? 0.7 : 1; if (rFrac < 0.06) fb.push('The planet is tiny in the frame — use a Barlow.'); s += sizeS * 10;
  // exposure / processing
  let expS = 1 - Math.min(1, blownF * 6); if (blownF > 0.04) fb.push('Highlights are blown out — lower the exposure or the white point.');
  const med = disk.length ? disk.sort((a, b) => a - b)[disk.length >> 1] : 0; if (med < 0.25) { expS *= 0.6; fb.push('The planet looks dark — stretch more.'); }
  s += expS * 14;
  const sharpS = texture < 0.015 ? 0.4 : texture > 0.16 ? Math.max(0, 1 - (texture - 0.16) * 6) : 1;
  if (texture < 0.015) fb.push('Looks soft — lucky stacks need wavelet sharpening.'); if (texture > 0.2) fb.push('Over-sharpened: noise and ringing artifacts.');
  s += sharpS * 14;
  const noiseS = Math.min(1, Math.log10(Math.max(1, pl.kept)) / 3); s += noiseS * 10; if (pl.kept < 60) fb.push('Very few frames stacked — the result is noisy.');
  if (pl.alt < 30 && !pl.adc && !P.rgbAlign) { s -= 6; fb.push('Rainbow fringes from atmospheric dispersion (low altitude) — use RGB align or an ADC.'); }
  if (pl.smear > 0.25) { s -= Math.min(10, pl.smear * 15); fb.push('Rotation smeared the features — keep videos shorter.'); }
  if (meta.quality && meta.quality.defocus > 2) { s -= Math.min(15, (meta.quality.defocus - 2) * 3); fb.push('Out of focus.'); }
  const pop = { Jupiter: 1.25, Saturn: 1.3, Mars: 1.15, Moon: 1.1, Venus: 0.8, Mercury: 0.9, Uranus: 0.7, Neptune: 0.7, Io: 0.5 }[pl.name] || 0.6;
  return { total: Math.round(Math.max(0, Math.min(100, s + 10))), snr: +(noiseS * 100).toFixed(0), bg: 0, grad: 0, clip: +blownF.toFixed(3), cast: 0, feedback: fb, popularity: pop, targetKnown: true, planet: pl.name };
}

export function scoreImage(out, work, meta, P) {
  if (meta.planetary) return scorePlanet(out, work, meta, P);
  const { W, H } = work; const n = W * H; const px = out.rgba;
  const L = new Float32Array(n), R = new Float32Array(n), Gc = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { R[i] = px[i * 4] / 255; Gc[i] = px[i * 4 + 1] / 255; B[i] = px[i * 4 + 2] / 255; L[i] = 0.3 * R[i] + 0.59 * Gc[i] + 0.11 * B[i]; }
  const srt = (a) => { const s = []; const st = Math.max(1, Math.floor(a.length / 50000)); for (let i = 0; i < a.length; i += st) s.push(a[i]); return s.sort((x, y) => x - y); };
  const sL = srt(L); const q = (s, f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
  const bg = q(sL, 0.3), hi = q(sL, 0.997);
  // noise on background pixels (high-pass)
  const hp = []; for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) { const i = y * W + x; if (L[i] > q(sL, 0.5)) continue; hp.push(Math.abs(L[i] - (L[i - 1] + L[i + 1] + L[i - W] + L[i + W]) / 4)); }
  hp.sort((a, b) => a - b); const noise = (hp[hp.length >> 1] || 0.001) * 1.4826 + 0.0015;
  const snr = (hi - bg) / noise;
  // gradient: grid of low percentiles
  const cells = []; for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) { const s = []; for (let y = Math.floor(j * H / 4); y < (j + 1) * H / 4; y += 4) for (let x = Math.floor(i * W / 6); x < (i + 1) * W / 6; x += 4) s.push(L[y * W + x]); s.sort((a, b) => a - b); cells.push(s[Math.floor(s.length * 0.2)]); }
  const grad = (Math.max(...cells) - Math.min(...cells));
  const clip = sL.filter((v) => v < 0.004).length / sL.length;
  const blown = sL.filter((v) => v > 0.995).length / sL.length;
  const bgR = q(srt(R), 0.3), bgG = q(srt(Gc), 0.3), bgB = q(srt(B), 0.3);
  const cast = Math.max(bgR, bgG, bgB) - Math.min(bgR, bgG, bgB);
  const fb = []; // feedback
  let s = 0;
  const noiseS = Math.max(0, Math.min(1, Math.log10(Math.max(1, snr)) / Math.log10(90)));
  s += noiseS * 30; if (noiseS < 0.5) fb.push('Very noisy — more integration time (or darker skies) would help a lot.'); else if (noiseS > 0.85) fb.push('Smooth, clean data. 👏');
  const qa = meta.quality || {}; const scaleAs = meta.scale || 3;
  let starS = 1;
  if (qa.defocus !== undefined) { // physical truth (newer stacks)
    if (qa.trail > 1.5) { starS -= Math.min(0.6, (qa.trail - 1.5) * 0.15); fb.push(qa.trail > 4 ? 'Visible star trails — tracking, polar alignment or exposure too long for this focal length.' : 'Stars are slightly elongated — tracking/guiding or polar alignment.'); }
    if (qa.defocus > 1.5) { starS -= Math.min(0.6, (qa.defocus - 1.5) * 0.12); fb.push(qa.defocus > 5 ? 'Out of focus — stars are bloated disks.' : 'Stars look soft — focus could be sharper.'); }
    if (qa.jitterPx > 2.5) { starS -= Math.min(0.3, (qa.jitterPx - 2.5) * 0.1); fb.push('Stars are blurred by tracking jitter (wind, overloaded mount or guiding).'); }
    if (starS > 0.95) fb.push('Pin-sharp, round stars.');
  } else {
    if (qa.ecc > 0.5) { starS -= Math.min(0.7, (qa.ecc - 0.5) * 2); fb.push('Stars are elongated — tracking/guiding or polar alignment issues.'); }
    if (qa.trail > 3) { starS -= 0.3; fb.push('Visible star trails.'); }
    const hfrAs = (qa.hfr || 1.5) * scaleAs; const ideal = Math.max(scaleAs * 1.2, 2.2);
    if (hfrAs > ideal * 2.2 && hfrAs > 6) { starS -= 0.35; fb.push('Stars look soft — check focus.'); }
  }
  s += Math.max(0, starS) * 20;
  let bgS = 1 - Math.min(1, grad / 0.18) - Math.min(0.6, clip * 8);
  if (grad > 0.08) fb.push('Uneven background — light pollution gradient or missing flats (vignetting).');
  if (clip > 0.04) fb.push('Black point clipped — the shadows are crushed to pure black.');
  s += Math.max(0, bgS) * 15;
  let strS = bg < 0.03 ? bg / 0.03 : bg > 0.3 ? Math.max(0, 1 - (bg - 0.3) * 3) : 1;
  if (bg > 0.3) fb.push('Over-stretched: washed-out grey background.'); if (bg < 0.02) fb.push('Under-stretched / very dark image.');
  if (blown > 0.02) { strS *= 0.7; fb.push('Large areas are blown out to white.'); }
  s += strS * 10;
  const colS = Math.max(0, 1 - cast / 0.09); s += colS * 5; if (cast > 0.06) fb.push('Strong color cast in the background.');
  // target
  const t = cat.dsos.find((d) => d.id.toLowerCase() === String(meta.target).toLowerCase() || d.name.toLowerCase() === String(meta.target).toLowerCase());
  let tgtS = 0.4;
  if (t && meta.ref) {
    const d = A.sep(t.ra, t.dec, meta.ref.ra, meta.ref.dec); const fovS = Math.min(W, H) * scaleAs / 3600; const fill = (t.size / 60) / fovS;
    if (d > fovS * 0.6) { tgtS = 0; fb.push(`${t.id} is not actually in the frame!`); }
    else { tgtS = fill < 0.06 ? 0.35 : fill > 1.6 ? 0.6 : 1; if (fill < 0.08) fb.push('The target is tiny in the frame — a longer focal length would show more detail.'); if (d > fovS * 0.3) { tgtS *= 0.75; fb.push('Framing is off-center.'); } }
  }
  s += tgtS * 10;
  const hours = (meta.integration || 0) / 3600;
  s += Math.min(1, Math.log2(1 + hours) / Math.log2(11)) * 10;
  if (hours >= 3) fb.push(`${hours.toFixed(1)} hours of integration — dedication!`);
  return { total: Math.round(Math.max(0, Math.min(100, s))), snr: +snr.toFixed(1), bg: +bg.toFixed(3), grad: +grad.toFixed(3), clip: +clip.toFixed(3), cast: +cast.toFixed(3), feedback: fb, popularity: t ? (t.curated ? 1.2 : /^M\d/.test(t.id) ? 1.0 : 0.7) : 0.5, targetKnown: !!t };
}

// ============================== StarShare ==============================
const NAMES = ['NebulaNerd', 'PhotonHunter', 'f2Fanatic', 'DarkSkyDan', 'GuidingGuru', 'OIIIwhoa', 'TrackerTess', 'SkyFlatSam', 'BortleOne', 'HaHaHalpha', 'DitherDave', 'Kappa_Sigma', 'MeridianMia', 'RedDotRick'];
function makeComments(f, rnd) {
  const c = []; const sc = f.score.total;
  const praise = ['Gorgeous!', 'Great detail in the nebula.', 'Lovely colors.', 'Wow, from the suburbs?!', 'This is APOD material.', 'Super clean stars.', 'What gear did you use?', 'Beautiful framing.'];
  const crit = { 'elongated': 'Your stars look a bit egg-shaped — check balance & guiding?', 'trails': 'Stars are trailing; maybe shorter subs or a tracker.', 'gradient': 'Try flats + background extraction to fix that gradient.', 'noisy': 'Needs more integration time, but a great start!', 'focus': 'A Bahtinov mask helps nail focus.', 'clipped': 'Careful with the black point, you clipped the faint stuff.', 'washed': 'Pull the black point in a bit — background is too bright.' };
  const n = 1 + Math.floor(rnd() * 3 + sc / 35);
  for (let i = 0; i < n; i++) {
    let txt;
    const issues = f.score.feedback.join(' ').toLowerCase();
    if (rnd() < 0.45 && sc < 75) {
      if (issues.includes('elongated')) txt = crit.elongated; else if (issues.includes('trails')) txt = crit.trails; else if (issues.includes('uneven')) txt = crit.gradient; else if (issues.includes('noisy')) txt = crit.noisy; else if (issues.includes('soft')) txt = crit.focus; else if (issues.includes('clipped')) txt = crit.clipped; else if (issues.includes('over-stretched')) txt = crit.washed; else txt = praise[Math.floor(rnd() * praise.length)];
    } else txt = praise[Math.floor(rnd() * praise.length)];
    c.push({ who: NAMES[Math.floor(rnd() * NAMES.length)], txt });
  }
  return c;
}
export function publish(fid) {
  const f = G.s.finals.find((x) => x.id === fid); if (!f || f.posted) return;
  const rnd = mulberry32(hashStr(fid));
  const sc = f.score.total;
  const same = G.s.posts.filter((p) => p.target === f.target).length;
  const novelty = 1 / (1 + same * 0.6);
  const repF = 1 + Math.min(2, G.s.rep / 400);
  const likes = Math.round(Math.pow(sc, 1.75) / 9 * f.score.popularity * novelty * repF * (0.8 + rnd() * 0.4));
  let award = null; if (sc >= 88 && novelty > 0.5) award = 'Image of the Day'; else if (sc >= 77) award = 'Top Pick';
  const post = { id: fid, target: f.target, title: f.title, t: G.s.time, likesTotal: likes, likesNow: 0, paidLikes: 0, award, awardPaid: false, comments: makeComments(f, rnd) };
  G.s.posts.push(post); f.posted = true; G.s.stats.uploads++;
  save(true); emit('posted', post);
  return post;
}
export function updatePosts() {
  let earned = 0;
  for (const p of G.s.posts) {
    const age = (G.s.time - p.t) / 86400000;
    p.likesNow = Math.round(p.likesTotal * Math.min(1, Math.sqrt(Math.max(0, age) / 3) + 0.15));
    const newLikes = p.likesNow - p.paidLikes;
    if (newLikes > 0) { earned += newLikes * 1.5; G.s.rep += newLikes * 0.1; p.paidLikes = p.likesNow; }
    if (p.award && !p.awardPaid && age >= 0.5) { p.awardPaid = true; const amt = p.award === 'Image of the Day' ? 600 : 150; addMoney(amt, `${p.award}: ${p.title}`); toast(`🏆 "${p.title}" won ${p.award}! +${money(amt)}`, 'good', 8000); emit('award', p); }
  }
  if (earned >= 1) { addMoney(earned, 'Print sales & tips from StarShare'); toast(`StarShare: +${money(earned)} from likes, prints & tips`, 'good'); }
}

export const shareApp = {
  title: 'StarShare', width: 980, height: 680, minW: 620, minH: 420,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5f8a"/><stop offset="1" stop-color="#7c2bd9"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gss)"/><path d="M20 9l3.2 7 7.6.7-5.8 5 1.8 7.4L20 25l-6.8 4.1 1.8-7.4-5.8-5 7.6-.7z" fill="#fff"/></svg>`,
  open(body) {
    const root = h('div', { class: 'pad ss-root' }); body.append(root);
    let view = 'community', sort = 'new', posts = [], loading = false, netErr = '';
    const segBar = () => h('div', { class: 'seg' }, ...[['community', '🌍 Community'], ['mine', 'My images']].map(([k, l]) => h('button', { class: view === k ? 'on' : '', onclick: () => { view = k; render(); if (k === 'community') loadFeed(); } }, l)));
    async function loadFeed(more = false) {
      loading = true; netErr = ''; render();
      try { const r = await NET.feed(sort, more && posts.length ? posts[posts.length - 1].created : null); posts = more ? [...posts, ...r.posts] : r.posts; }
      catch (e) { netErr = /fetch|network/i.test(e.message) ? 'Can’t reach StarShare — are you online?' : e.message; }
      loading = false; render();
    }
    function renderCommunity() {
      const acc = NET.account();
      root.append(h('div', { class: 'row wrap', style: { margin: '6px 0 12px' } },
        h('div', { class: 'seg' }, ...[['new', 'Newest'], ['top', 'Top this month']].map(([k, l]) => h('button', { class: sort === k ? 'on' : '', onclick: () => { sort = k; loadFeed(); } }, l))),
        h('button', { class: 'btn small', onclick: () => loadFeed() }, '↻ Refresh'),
        h('span', { class: 'muted small' }, acc ? `Signed in as ${acc.name}` : 'You’ll get a StarShare name when you first post, like or comment.'),
        acc ? h('button', { class: 'btn tiny', onclick: async () => { const n = await promptDlgLocal('StarShare name', 'Your public name:', acc.name); if (n) { try { await NET.rename(n); render(); } catch (e) { toast(e.message, 'warn'); } } } }, 'Rename') : null));
      if (netErr) root.append(h('div', { class: 'notice' }, netErr));
      const grid = h('div', { class: 'ss-grid' });
      for (const p of posts) {
        const img = h('img', { class: 'ss-img', loading: 'lazy', src: NET.thumbUrl(p.id), onclick: () => openPost(p.id) });
        grid.append(h('div', { class: 'ss-card' }, img, h('div', { class: 'ss-title' }, p.title),
          h('div', { class: 'small muted' }, `${p.author} · ${p.target || ''}${p.meta && p.meta.site ? ' · ' + p.meta.site : ''}`),
          h('div', { class: 'ss-likes' }, h('span', { class: 'ss-heart' + (p.liked ? ' on' : '') }, p.liked ? '♥' : '♡'), ` ${p.likes}`, h('span', { class: 'muted small' }, ` · 💬 ${p.comments} · 🖼 ${p.prints}`))));
      }
      if (!posts.length && !loading && !netErr) grid.append(h('div', { class: 'muted' }, 'No community posts yet — publish one of yours to be the first!'));
      root.append(grid);
      if (loading) root.append(h('div', { class: 'muted small', style: { margin: '10px' } }, 'Loading…'));
      else if (posts.length >= 24) root.append(h('button', { class: 'btn small', style: { margin: '10px 0' }, onclick: () => loadFeed(true) }, 'Load more'));
    }
    async function openPost(id) {
      let d; try { d = await NET.detail(id); } catch (e) { toast(e.message, 'warn'); return; }
      const p = d.post; const acc = NET.account(); const mine = acc && acc.id === p.authorId;
      const likeBtn = h('button', { class: 'btn small' + (p.liked ? ' on' : ''), onclick: async () => { try { const r = await NET.like(id); p.liked = r.liked; p.likes += r.liked ? 1 : -1; likeBtn.textContent = `${p.liked ? '♥' : '♡'} ${p.likes}`; likeBtn.classList.toggle('on', p.liked); const q = posts.find((x) => x.id === id); if (q) { q.liked = p.liked; q.likes = p.likes; } } catch (e) { toast(e.message, 'warn'); } } }, `${p.liked ? '♥' : '♡'} ${p.likes}`);
      const list = h('div', { class: 'ss-clist' }, ...d.comments.map((c) => h('div', { class: 'small' }, h('b', {}, c.author + ': '), c.text)));
      const inp = h('input', { class: 'inp', placeholder: 'Write a comment…', maxlength: 280, style: { flex: 1 } });
      const send = async () => { const t = inp.value.trim(); if (!t) return; try { const c = await NET.comment(id, t); list.append(h('div', { class: 'small' }, h('b', {}, c.author + ': '), c.text)); inp.value = ''; } catch (e) { toast(e.message, 'warn'); } };
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); });
      const prints = h('div', { class: 'row wrap' }, h('span', { class: 'small muted' }, 'Prints:'), ...Object.entries(d.printSizes).map(([size, price]) => {
        const owned = d.bought.includes(size);
        return h('button', { class: 'btn small', disabled: owned || mine, title: mine ? 'Your own image' : '', onclick: async (e) => { if (!(await confirmDlg('Buy print', `Buy a ${size}″ print of “${p.title}” for ${money(price)}? ${p.author} gets 60%.`, 'Buy'))) return; try { await NET.buyPrint(id, size, price); e.target.disabled = true; e.target.textContent = `${size} ✓`; toast(`🖼 Print ordered — it will hang on your wall!`, 'good'); } catch (er) { toast(er.message, 'warn'); } } }, owned ? `${size} ✓` : `${size} · ${money(price)}`);
      }));
      const m = p.meta || {};
      dialog({ title: `${p.title} — ${p.author}`, width: Math.min(1100, window.innerWidth - 60), body: h('div', {},
        h('img', { src: NET.imageUrl(id), style: { width: '100%', borderRadius: '8px', background: '#000' } }),
        h('div', { class: 'small muted', style: { margin: '6px 0' } }, [p.target, m.camera, m.optic, m.integration ? `${fmtDur(m.integration)} integration` : '', m.site, `score ${p.score}`].filter(Boolean).join(' · ')),
        h('div', { class: 'row wrap' }, likeBtn, prints, !mine ? h('button', { class: 'btn tiny danger', onclick: async () => { if (await confirmDlg('Report', 'Report this post as inappropriate?', 'Report')) { await NET.report(id).catch(() => {}); toast('Thanks — reported.'); } } }, 'Report') : null),
        h('h4', { style: { margin: '12px 0 6px' } }, 'Comments'), list, h('div', { class: 'row', style: { marginTop: '6px' } }, inp, h('button', { class: 'btn small primary', onclick: send }, 'Send'))),
        buttons: [{ label: 'Close', value: true }] });
    }
    function promptDlgLocal(t, l, d) { return import('../wm.js').then((w) => w.promptDlg(t, l, d)); }
    function render() {
      root.innerHTML = '';
      root.append(h('div', { class: 'ss-head' }, h('div', { class: 'ss-logo' }, '★ StarShare'), segBar(), h('div', { class: 'muted' }, `reputation ${Math.round(G.s.rep)} · ${G.s.posts.length} posts`)));
      if (view === 'community') { renderCommunity(); return; }
      root.append(h('label', { class: 'chk small', style: { margin: '4px 0 8px' } }, h('input', { type: 'checkbox', checked: PREFS.globalShare !== false, onchange: (e) => { PREFS.globalShare = e.target.checked; savePrefs(); } }), 'When I publish, also post to the global StarShare community (other players can see, like, comment and buy prints)'));
      const unposted = G.s.finals.filter((f) => !f.posted);
      if (unposted.length) {
        root.append(h('h3', {}, 'Ready to publish'));
        const row = h('div', { class: 'ss-grid' });
        for (const f of [...unposted].reverse()) row.append(card(f, false));
        root.append(row);
      }
      root.append(h('h3', {}, 'Your gallery'));
      const row2 = h('div', { class: 'ss-grid' });
      for (const p of [...G.s.posts].reverse()) { const f = G.s.finals.find((x) => x.id === p.id); if (f) row2.append(card(f, p)); }
      if (!G.s.posts.length) row2.append(h('div', { class: 'muted' }, 'Nothing published yet. Process a stack in PixelLab and save a final image.'));
      root.append(row2);
    }
    function card(f, p) {
      const img = h('img', { class: 'ss-img', onclick: () => big(f) }); idbGet('finalthumb:' + f.id).then((u) => u && (img.src = u));
      const c = h('div', { class: 'ss-card' }, img, h('div', { class: 'ss-title' }, f.title),
        h('div', { class: 'small muted' }, `${GEAR[f.optic]?.name.split('(')[0] || ''} · ${GEAR[f.cam]?.name.split('(')[0] || ''} · ${fmtDur(f.integration)} · ${fmtDate(f.created, -4)}`));
      if (!p) {
        c.append(h('div', { class: 'small' }, `Self-assessment: `, h('b', {}, `${f.score.total}/100`)), h('ul', { class: 'small fb' }, ...f.score.feedback.slice(0, 4).map((x) => h('li', {}, x))),
          h('div', { class: 'row' }, h('button', { class: 'btn primary small', onclick: () => { if (G.guest) { toast('Publishing works from your own save (you are a guest in this session).', 'warn'); return; } const post = publish(f.id); if (post) { toast(`Published "${f.title}". Likes will roll in over the next days.`, 'good'); updatePosts(); render();
              if (PREFS.globalShare !== false) NET.uploadFinal(f).then(() => toast('🌍 Also posted to the StarShare community.', 'good')).catch((e) => toast('Community upload failed: ' + e.message, 'warn')); } } }, 'Publish'),
            h('button', { class: 'btn small danger', onclick: async () => { if (await confirmDlg('Delete', 'Delete this image?', 'Delete')) deleteFinal(f); } }, 'Delete')));
      } else {
        c.append(h('button', { class: 'fcard-x', title: 'Delete this image', onclick: async (e) => { e.stopPropagation(); if (!(await confirmDlg('Delete image', `Delete “${f.title}”${f.globalId ? ' (also removes it from the StarShare community)' : ''}? Likes already earned are kept.`, 'Delete'))) return; deleteFinal(f); } }, '✕'));
        if (f.script) c.append(h('button', { class: 'btn small', style: { margin: '4px 0' }, title: 'Open the script that made this image', onclick: () => openApp('scripts', { text: f.script, name: 'Retake: ' + f.title }) }, '↻ Retake with script'));
        c.append(h('div', { class: 'ss-likes' }, `♥ ${p.likesNow}`, p.award && p.awardPaid ? h('span', { class: 'award' }, '🏆 ' + p.award) : null, h('span', { class: 'muted small' }, ` · score ${f.score.total}`)),
          h('div', { class: 'ss-comments' }, ...p.comments.slice(0, Math.max(1, Math.ceil(p.comments.length * Math.min(1, p.likesNow / Math.max(1, p.likesTotal) + 0.2)))).map((cm) => h('div', { class: 'small' }, h('b', {}, cm.who + ': '), cm.txt))));
      }
      return c;
    }
    function deleteFinal(f) {
      G.s.finals = G.s.finals.filter((x) => x.id !== f.id); G.s.posts = G.s.posts.filter((x) => x.id !== f.id);
      idbDel('final:' + f.id); idbDel('finalthumb:' + f.id); save(); emit('storage');
      if (f.globalId) NET.deletePost(f.globalId).then(() => { posts = posts.filter((p) => p.id !== f.globalId); }).catch((e) => toast('Could not remove it from the community: ' + e.message, 'warn'));
      toast(`Deleted “${f.title}”.`, 'info', 2500); render();
    }
    async function big(f) {
      const url = await idbGet('final:' + f.id);
      dialog({ title: f.title, width: Math.min(1100, window.innerWidth - 60), body: h('div', {}, h('img', { src: url, style: { width: '100%', borderRadius: '6px' } }), h('div', { class: 'small muted' }, f.score.feedback.join(' · '))), buttons: [{ label: 'Close', value: true }] });
    }
    render(); loadFeed();
    NET.syncEarnings(true).then((r) => { if (r && r.amount) toast(`🌍 StarShare community: +${money(r.amount)} from likes & print sales`, 'good', 7000); }).catch(() => {});
    const rr = () => render(); on('final', rr); on('posted', rr); on('newday', rr); on('award', rr);
    return { onClose() { off('final', rr); off('posted', rr); off('newday', rr); off('award', rr); } };
  },
};

// ============================== AstroMart ==============================
export const shopApp = {
  title: 'AstroMart', width: 1000, height: 700, minW: 620, minH: 420,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22b573"/><stop offset="1" stop-color="#0b5a3a"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gm)"/><path d="M9 12h3l3 13h13l3-9H14" stroke="#fff" stroke-width="2.4" fill="none" stroke-linejoin="round"/><circle cx="17" cy="29" r="2" fill="#fff"/><circle cx="26" cy="29" r="2" fill="#fff"/></svg>`,
  open(body) {
    const cats = [['camera', 'Cameras', CAMERAS], ['optic', 'Lenses & Telescopes', OPTICS], ['mount', 'Mounts', MOUNTS], ['filter', 'Filters', FILTERS], ['corrector', 'Correctors', CORRECTORS], ['acc', 'Accessories', ACCESSORIES], ['storage', 'Storage', STORAGE]];
    let cur = 'camera', brand = 'all', q = '', sortBy = 'brand', ownedOnly = false;
    const SUB = { camera: (g) => (g.type === 'dslr' ? 'DSLR & mirrorless' : g.planetary ? 'Planetary' : g.guideOnly ? 'Guide' : g.mono ? 'Cooled mono' : 'Cooled color'),
      optic: (g) => (g.type === 'lens' ? 'Camera lenses' : g.type === 'refractor' ? 'Refractors' : g.type === 'newtonian' ? 'Newtonians' : g.type === 'sct' || g.type === 'mak' ? 'Catadioptrics (SCT / Mak)' : 'Astrographs'),
      mount: (g) => (g.type === 'fixed' ? 'Tripods' : !g.goto ? 'Star trackers' : g.type === 'altaz' ? 'Alt-az' : g.payload >= 20 ? 'Heavy-duty EQ' : 'Equatorial'),
      filter: (g) => (g.monoOnly ? 'LRGB (mono)' : g.cont && g.cont[0] < 0.2 && g.cont[1] < 0.2 ? 'Narrowband' : 'Light pollution & broadband'),
      corrector: (g) => (g.barlow ? 'Barlows' : g.factor < 1 ? 'Reducers' : 'Flatteners & coma correctors') };
    const nav = h('div', { class: 'shop-nav' }); const list = h('div', { class: 'shop-list' }); const bal = h('div', { class: 'shop-bal' });
    const search = h('input', { class: 'inp', placeholder: 'Search gear…', oninput: (e) => { q = e.target.value.toLowerCase(); renderList(); } });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    const tools = h('div', { class: 'shop-tools' });
    const main = h('div', { class: 'shop-main' }, tools, list);
    body.append(h('div', { class: 'shop-root' }, h('div', { class: 'shop-side' }, h('div', { class: 'shop-logo' }, 'AstroMart'), bal, search, nav), main));
    function specs(g) {
      if (g.kind === 'camera') return [`${g.mono ? 'Mono' : 'Color'} · ${(g.w * g.pix / 1000).toFixed(1)}×${(g.h * g.pix / 1000).toFixed(1)}mm · ${(g.w * g.h / 1e6).toFixed(1)} MP`, `${g.pix}µm pixels · QE ${Math.round(g.qe * 100)}% · ${g.bits}-bit`, g.type === 'dslr' ? `Read noise ${g.rnHigh}–${g.rnLow} e⁻ · Hα ${Math.round((g.haFactor ?? 1) * 100)}%` : `Read noise ${g.rnHCG}–${g.rnLCG} e⁻ · ${g.cooled ? 'TEC cooled Δ' + g.deltaT + '°C' : 'uncooled'}${g.ampGlow > 5 ? ' · amp glow' : ''}`];
      if (g.kind === 'optic') return g.type === 'lens' ? [g.zoom ? `${g.zoom[0]}–${g.zoom[1]}mm f/${g.fMinAt[0]}–${g.fMinAt[1]}` : `${g.focal}mm f/${g.fMin}`, `Camera lens · ${g.weight} kg`] : [`${g.D}mm aperture · ${g.focal}mm · f/${(g.focal / g.D).toFixed(1)}`, `${g.type}${g.obstruction ? ' · ' + Math.round(g.obstruction * 100) + '% obstruction' : ''} · ${g.weight} kg`];
      if (g.kind === 'mount') return [`${g.type === 'fixed' ? 'No tracking' : g.type === 'eq' ? 'Equatorial' : 'Alt-azimuth'} · payload ${g.payload} kg`, `${g.goto ? 'GoTo' : 'Manual pointing'} · ${g.computer ? 'PC control' : 'no PC control'} · PE ±${g.pe}″`];
      if (g.kind === 'storage') { const u = usage(); return [`+${fmtBytes(g.bytes)} · you have ${fmtBytes(u.free)} free of ${fmtBytes(u.cap)}`]; }
      if (g.kind === 'filter') return [g.monoOnly ? 'For mono cameras' : 'Fits any camera', g.cont && g.cont[0] < 0.2 && g.cont[1] < 0.2 ? 'Narrowband' : 'Broadband'];
      return [];
    }
    function itemRow(g) {
        const owned = G.s.inventory.includes(g.id);
        const inRig = Object.values(G.s.rig).flat().includes(g.id);
        const sellPrice = Math.round(g.sell ?? g.price * 0.6);
        const b = owned && (isSandbox() || G.guest) ? h('span', { class: 'muted small' }, inRig ? 'In use' : 'Owned') : owned ? h('button', { class: 'btn small', disabled: inRig || g.price === 0, title: inRig ? 'Currently mounted in your rig' : '', onclick: async () => {
          if (await confirmDlg('Sell used', `Sell your ${g.name} for ${money(sellPrice)} on the used market?`, 'Sell')) { G.s.inventory = G.s.inventory.filter((x) => x !== g.id); addMoney(sellPrice, 'Sold ' + g.name); render(); }
        } }, inRig ? 'In use' : `Sell ${money(sellPrice)}`)
          : h('button', { class: 'btn primary small', disabled: G.s.money < g.price || G.guest, onclick: async () => {
            if (await confirmDlg('Buy', `Buy ${g.name} for ${money(g.price)}?`, 'Buy')) { addMoney(-g.price, 'Bought ' + g.name); G.s.inventory.push(g.id); emit('bought', g); toast(g.kind === 'storage' ? `💾 ${g.name} installed — ${fmtBytes(usage().free)} free now.` : `📦 ${g.name} delivered! Mount it via Field view → Change gear.`, 'good', 6000); save(true); render(); }
          } }, g.price ? money(g.price) : 'Free');
        return h('div', { class: 'shop-item' + (owned ? ' owned' : '') }, h('div', { class: 'shop-ico', html: gearIcon(g) }),
          h('div', { class: 'shop-txt' }, h('div', { class: 'shop-name' }, g.name, owned ? h('span', { class: 'tag' }, 'owned') : null, SUB[g.kind] ? h('span', { class: 'tag sub' }, SUB[g.kind](g)) : null), ...specs(g).map((s) => h('div', { class: 'small muted' }, s)), h('div', { class: 'small' }, g.desc)), b);
    }
    function render() {
      nav.innerHTML = '';
      bal.innerHTML = isSandbox() ? 'Sandbox<br><b>∞</b><br><span class="small">Everything is unlocked.</span>' : G.guest ? 'Guest<br><b>—</b><br><span class="small">The host buys gear.</span>' : `Balance<br><b>${money(G.s.money)}</b>`;
      for (const [k, l, arr] of cats) nav.append(h('div', { class: 'shop-cat' + (k === cur ? ' on' : ''), onclick: () => { cur = k; brand = 'all'; render(); } }, h('span', {}, l), h('span', { class: 'shop-count' }, arr.length)));
      renderList();
    }
    function renderList() {
      tools.innerHTML = ''; list.innerHTML = '';
      const all = cats.find((c) => c[0] === cur)[2];
      const brands = [...new Set(all.map((g) => g.brand || 'Other'))].sort();
      tools.append(h('div', { class: 'shop-brands' }, ...['all', ...brands].map((b) => h('button', { class: 'chipbtn' + (brand === b ? ' on' : ''), onclick: () => { brand = b; renderList(); } }, b === 'all' ? `All brands` : `${b} · ${all.filter((g) => (g.brand || 'Other') === b).length}`))),
        h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'small muted' }, 'Group by'), select([['brand', 'Brand'], ['type', 'Type'], ['price', 'Price (low → high)'], ['pricedesc', 'Price (high → low)']], sortBy, (v) => { sortBy = v; renderList(); }),
          h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: ownedOnly, onchange: (e) => { ownedOnly = e.target.checked; renderList(); } }), 'Owned only')));
      let items = all.filter((g) => (brand === 'all' || (g.brand || 'Other') === brand) && (!ownedOnly || G.s.inventory.includes(g.id)) && (!q || `${g.name} ${g.brand} ${g.desc}`.toLowerCase().includes(q)));
      if (sortBy === 'price' || sortBy === 'pricedesc') { items.sort((a, b) => (a.price - b.price) * (sortBy === 'price' ? 1 : -1)); for (const g of items) list.append(itemRow(g)); }
      else {
        const key = sortBy === 'type' && SUB[cur] ? SUB[cur] : (g) => g.brand || 'Other';
        const groups = {}; for (const g of items) (groups[key(g)] = groups[key(g)] || []).push(g);
        for (const k of Object.keys(groups).sort()) { list.append(h('div', { class: 'shop-group' }, h('b', {}, k), h('span', { class: 'muted small' }, `${groups[k].length} item${groups[k].length > 1 ? 's' : ''}`))); for (const g of groups[k].sort((a, b) => a.price - b.price)) list.append(itemRow(g)); }
      }
      if (!items.length) list.append(h('div', { class: 'muted pad' }, 'Nothing matches.'));
      list.scrollTop = 0;
    }
    render(); const rr = () => render(); on('money', rr);
    return { onClose() { off('money', rr); } };
  },
};
function gearIcon(g) {
  const c = { camera: '#e05a5a', optic: '#5aa9ff', mount: '#ffb84d', filter: '#b06bff', corrector: '#4dd2c0', acc: '#9aa5b5', storage: '#7dd3a8' }[g.kind];
  const sym = { camera: '<rect x="8" y="13" width="24" height="16" rx="3"/><circle cx="20" cy="21" r="5" fill="#000" opacity=".4"/>', optic: '<rect x="6" y="15" width="28" height="10" rx="3" transform="rotate(-20 20 20)"/>', mount: '<path d="M20 8v12M12 34l8-14 8 14"/><rect x="15" y="16" width="10" height="7"/>', filter: '<circle cx="20" cy="20" r="10"/>', corrector: '<rect x="13" y="12" width="14" height="16" rx="3"/>', acc: '<rect x="11" y="11" width="18" height="18" rx="4"/>', storage: '<rect x="10" y="9" width="20" height="22" rx="3"/><circle cx="20" cy="24" r="2" fill="#000" opacity=".4"/>' }[g.kind];
  return `<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="${c}" opacity=".18"/><g fill="${c}" stroke="${c}" stroke-width="2">${sym}</g></svg>`;
}

// ============================== Mail & quests ==============================
const MENTOR = 'Ray Okafor (Riverside Astronomy Club)';
export const QUESTS = [
  { id: 'welcome', subject: 'Welcome to the hobby!', reward: 0, body: `Hey! Great meeting you at the club’s star party. Here’s the quick-start I promised:<br><br>1. Open <b>Weather</b> and click <b>Head out tonight</b>. Your backyard is free. (Later, the <b>Atlas</b> app lets you travel anywhere on Earth: dark-sky parks, deserts, mountain observatories, even a Tokyo rooftop.)<br>2. You’ll be standing next to your rig. Walk over (WASD + mouse), press <b>E</b> on the lens cap to take it off, then <b>E</b> on the camera to grab it and aim it at the sky. Press <b>E</b> on the laptop to sit down.<br>3. Back on the laptop, open <b>AstroCap</b> → Equipment → <b>Connect</b> the camera. Then Imaging → set ~10 s at ISO 1600 → <b>Capture</b>.<br>4. Focus! Use the 1:1 crop + Loop and turn the focus ring (Field view) until the HFR number is smallest.<br><br>When you’ve got a frame with some stars, I’ll send you $40 for a coffee & a red flashlight. 😄` , check: () => false, auto: true },
  { id: 'first_light', subject: 'First light 🎉', reward: 40, body: 'You captured your first real star field! Next step: shoot a series of frames (AstroCap → Sequencer), then open <b>DeepStack</b> to stack them. Stacking 20 frames cuts the noise by ~4.5×.', check: () => G.s.frames.some((f) => f.type === 'light' && f.stats.stars >= 20 && f.exp >= 2) },
  { id: 'first_stack', subject: 'Your first stack', reward: 60, body: 'Nice stack! Now open <b>PixelLab</b>: crop the ragged edges, remove the gradient, auto-stretch, and save the final image. Then publish it on <b>StarShare</b> — people actually buy prints there.', check: () => G.s.stacks.some((s) => s.n >= 10) },
  { id: 'first_post', subject: 'Published!', reward: 50, body: 'Congrats on your first post! Watch the likes come in over the next few days. Tip: the Andromeda Galaxy is high this time of year. With the kit lens zoomed to 55mm you can catch it — try it!', check: () => G.s.posts.length > 0 },
  { id: 'andromeda', subject: 'Andromeda challenge', reward: 150, body: 'Great M31! You probably noticed: on a tripod, even 4-second exposures trail at 55mm. A <b>star tracker</b> (AstroMart) changes everything — you’ll polar-align it with the polar scope and the PolarClock reading in the Field view.', check: () => G.s.posts.some((p) => /^M\s?31$/i.test(p.target) && (G.s.finals.find((f) => f.id === p.id)?.score.total || 0) >= 40) },
  { id: 'tracked', subject: 'Tracking unlocked', reward: 100, body: 'A 60+ second exposure with round stars — welcome to tracked imaging! Remember: polar alignment error = drift. And always take <b>darks</b> (same exposure, cap on) and <b>flats</b> (twilight sky or a flat panel) for clean stacks.', check: () => G.s.frames.some((f) => f.type === 'light' && f.exp >= 60 && f.stats.trail < 2.5 && f.stats.ecc < 0.55 && f.stats.stars > 30) },
  { id: 'calibrated', subject: 'Calibration master', reward: 80, body: 'Darks and flats in the same stack — your backgrounds will thank you. Hot pixels, amp glow, vignetting and dust donuts: gone.', check: () => G.s.stacks.some((s) => s.darks > 0 && s.flats > 0) },
  { id: 'trails', subject: 'Star trails!', reward: 120, body: 'Love the trails. That’s the "Maximum" integration method — the same trick used for those circular trails around Polaris.', check: () => G.s.stacks.some((s) => s.method === 'max' && s.n >= 20) },
  { id: 'orion', subject: 'The Great Orion Nebula', reward: 200, body: 'Beautiful M42. It rises late in October — worth the late night. Next: get away from the city lights. The dark site costs gas money, but the sky is on another level.', check: () => G.s.posts.some((p) => /^M\s?42$/i.test(p.target) && (G.s.finals.find((f) => f.id === p.id)?.score.total || 0) >= 55) },
  { id: 'darksite', subject: 'Dark skies', reward: 100, body: 'Isn’t it amazing out there? Bortle 2 skies make the Milky Way cast shadows. Your SNR per hour is many times higher than in the backyard.', check: () => G.s.sessions.some((s) => ['darksite', 'desert', 'atacama'].includes(s.location)) },
  { id: 'narrowband', subject: 'Narrowband', reward: 200, body: 'Narrowband filters let you shoot nebulae from the city and even under the Moon. Try a mono camera with Hα, OIII and SII for the Hubble palette (PixelLab → SHO).', check: () => G.s.stacks.some((s) => ['f_ha', 'f_oiii', 'f_sii', 'f_ha3', 'f_oiii3', 'f_sii3', 'f_dual', 'f_ultimate', 'f_lenhance'].includes(s.filter)) },
  { id: 'guided', subject: 'Guided long exposures', reward: 250, body: 'Five-minute guided subs at long focal length — that’s serious astrophotography. Keep an eye on the guiding RMS vs your pixel scale.', check: () => G.s.frames.some((f) => f.type === 'light' && f.exp >= 300 && f.focal >= 300 && f.stats.ecc < 0.5 && f.stats.stars > 50) },
  { id: 'iotd', subject: 'IMAGE OF THE DAY!!!', reward: 500, body: 'I saw your picture on the StarShare front page! The whole club is talking about it. Proud of you.', check: () => G.s.posts.some((p) => p.award === 'Image of the Day' && p.awardPaid) },
];
export function checkQuests() {
  const q = G.s.quests;
  if (!q.welcome) { q.welcome = 'done'; G.s.mail.push({ id: 'welcome', from: MENTOR, subject: QUESTS[0].subject, body: QUESTS[0].body, t: G.s.time, read: false }); emit('mail'); save(); }
  for (const Q of QUESTS) {
    if (Q.auto || q[Q.id]) continue;
    let ok = false; try { ok = Q.check(); } catch { ok = false; }
    if (ok) {
      q[Q.id] = 'done';
      G.s.mail.push({ id: Q.id, from: MENTOR, subject: Q.subject, body: Q.body + (Q.reward ? `<br><br><i>Sent you ${money(Q.reward)} — spend it on gear!</i>` : ''), t: G.s.time, read: false });
      if (Q.reward) addMoney(Q.reward, `Gift from Ray: ${Q.subject}`);
      toast(`✉️ New mail: ${Q.subject}`, 'good', 6000);
      emit('mail'); save();
    }
  }
}

export const mailApp = {
  title: 'Mail', width: 820, height: 540, minW: 520, minH: 360,
  icon: `<svg viewBox="0 0 40 40"><defs><linearGradient id="gml" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fb3ff"/><stop offset="1" stop-color="#1d6fd6"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#gml)"/><rect x="8" y="12" width="24" height="17" rx="2" fill="#fff"/><path d="M8 13l12 9 12-9" stroke="#1d6fd6" stroke-width="2" fill="none"/></svg>`,
  badge: () => G.s && G.s.mail.filter((m) => !m.read).length,
  open(body) {
    const list = h('div', { class: 'mail-list' }); const view = h('div', { class: 'mail-view' });
    body.append(h('div', { class: 'mail-root' }, list, view));
    let cur = null;
    function render() {
      list.innerHTML = '';
      for (const m of [...G.s.mail].reverse()) list.append(h('div', { class: 'mail-item' + (m.read ? '' : ' unread') + (cur === m ? ' on' : ''), onclick: () => { cur = m; m.read = true; save(); emit('mailread'); render(); } }, h('div', { class: 'small muted' }, m.from), h('b', {}, m.subject)));
      view.innerHTML = '';
      if (cur) view.append(h('div', { class: 'mail-subj' }, cur.subject), h('div', { class: 'small muted' }, `From: ${cur.from}`), h('div', { class: 'mail-body', html: cur.body }));
      else view.append(h('div', { class: 'muted pad' }, 'Select a message.'));
      // quest list
      const qs = h('div', { class: 'card' }, h('h3', {}, 'Challenges from Ray'));
      for (const Q of QUESTS.slice(1)) qs.append(h('div', { class: 'small' }, G.s.quests[Q.id] ? '✅ ' : '⬜ ', Q.subject, Q.reward ? h('span', { class: 'muted' }, ` (${money(Q.reward)})`) : ''));
      view.append(qs);
    }
    if (G.s.mail.length) { cur = G.s.mail.find((m) => !m.read) || G.s.mail[G.s.mail.length - 1]; cur.read = true; emit('mailread'); }
    render(); const rr = () => render(); on('mail', rr);
    return { onClose() { off('mail', rr); } };
  },
};

// ============================== Settings ==============================
export const settingsApp = {
  title: 'Settings', width: 560, height: 520, minW: 420, minH: 360,
  icon: `<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#6b7280"/><circle cx="20" cy="20" r="6" fill="none" stroke="#fff" stroke-width="3"/><g stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M20 7v4M20 29v4M7 20h4M29 20h4M10.8 10.8l2.8 2.8M26.4 26.4l2.8 2.8M10.8 29.2l2.8-2.8M26.4 13.6l2.8-2.8"/></g></svg>`,
  open(body) {
    const s = G.s.settings;
    const root = h('div', { class: 'pad' }); body.append(root);
    root.append(h('div', { class: 'card' }, h('h3', {}, 'Display'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.nightMode, onchange: (e) => { s.nightMode = e.target.checked; document.body.classList.toggle('nightmode', s.nightMode); save(); } }), 'Red night-vision mode (preserves your dark adaptation)'),
      h('div', { class: 'row' }, h('span', {}, 'Simulation resolution'), select([[1024, '1024 px (fast)'], [1600, '1600 px'], [2048, '2048 px (default)'], [3072, '3072 px (ultra, slower)'], [4096, '4096 px (extreme: slow, needs lots of RAM)']], s.quality, (v) => { s.quality = +v; save(); }), h('span', { class: 'muted small' }, 'Long side of rendered frames. Stacks need consistent resolution.'))));
    root.append(h('div', { class: 'card' }, h('h3', {}, 'About the simulation'), h('div', { class: 'small', html: `Sky imagery: <b>DSS2 color</b> & <b>Mellinger</b> surveys via CDS <i>hips2fits</i> (Université de Strasbourg/CNRS). Name resolving: CDS <b>Sesame</b> (SIMBAD/NED/VizieR). Stars, constellations & Milky Way: <b>d3-celestial</b> data (Hipparcos-based).<br><br>Each frame is simulated from photons up: aperture, transmission, QE, filter bandpass (Hα/OIII/SII are extracted from survey colors), sky brightness (Bortle level, Moon via Krisciunas–Schaefer, twilight, airmass), extinction, clouds, seeing, diffraction, defocus, coma/field curvature, vignetting & dust, tracking errors (polar misalignment drift, periodic error, wind, field rotation), shot noise, read noise, dark current & hot pixels, amp glow, bias banding, full-well & ADC clipping.` })));
    if (G.s.gameMode === 'sandbox') root.append(h('div', { class: 'card' }, h('h3', {}, 'Sandbox'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!(G.s.sandbox && G.s.sandbox.clearSkies), onchange: (e) => { G.s.sandbox = { ...(G.s.sandbox || {}), clearSkies: e.target.checked }; if (e.target.checked && G.s.night) G.s.night.wx.clouds = G.s.night.wx.clouds.map(() => 0); save(); } }), 'Always clear skies'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!(G.s.sandbox && G.s.sandbox.noFocusDrift), onchange: (e) => { if (e.target.checked && G.s.night) G.s.night.focus.best0 = S.focusBest(); G.s.sandbox = { ...(G.s.sandbox || {}), noFocusDrift: e.target.checked }; save(); } }), 'No focus drift (focus stays perfect as the night cools)'),
      h('div', { class: 'muted small' }, 'Gear: everything is in your inventory — swap it outside with R → Change gear.')));
    root.append(h('div', { class: 'card' }, h('h3', {}, 'Save game'), h('div', { class: 'muted small' }, 'Progress is saved automatically.'),
      h('div', { class: 'small' }, `Save: ${G.s.saveName || 'guest session'} · ${G.s.gameMode === 'sandbox' ? 'Sandbox' : 'Career'}`),
      h('div', { class: 'muted small' }, 'Manage saves (new, load, delete) from the main menu: Pause (Esc) → Save & exit to main menu.')));
    return {};
  },
};
void LOC; void openApp;
