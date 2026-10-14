// Observing log & achievements: which Messier objects, planets and sites you have captured,
// personal records, and achievements (cash rewards in career mode).
import * as A from './astro.js';
import { G, on, emit, save, addMoney, isSandbox } from './state.js';
import { cat } from './catalog.js';
import { LOC, money } from './gear.js';
import { toast } from './wm.js';

export function logbook() {
  const l = G.s.logbook || (G.s.logbook = { messier: {}, bodies: {}, sites: {}, aurora: 0, nights: {}, ach: {}, seenFrames: 0 });
  l.messier ||= {}; l.bodies ||= {}; l.sites ||= {}; l.nights ||= {}; l.ach ||= {};
  return l;
}
export function messierList() {
  const out = [];
  for (let i = 1; i <= 110; i++) { const d = cat.dsos.find((x) => x.id === 'M' + i || x.id === 'M ' + i); if (d) out.push(d); }
  return out;
}

const PLANETS5 = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
// id, title, description, reward, check(log, state)
export const ACHIEVEMENTS = [
  ['first-light', 'First Light', 'Save your first light frame.', 0, (l, s) => s.stats.frames > 0],
  ['m10', 'Messier Novice', 'Capture 10 Messier objects.', 250, (l) => Object.keys(l.messier).length >= 10],
  ['m25', 'Messier Hunter', 'Capture 25 Messier objects.', 600, (l) => Object.keys(l.messier).length >= 25],
  ['m50', 'Half Marathon', 'Capture 50 Messier objects.', 1500, (l) => Object.keys(l.messier).length >= 50],
  ['m110', 'Messier Master', 'Capture all 110 Messier objects.', 6000, (l) => Object.keys(l.messier).length >= 110],
  ['marathon', 'Messier Marathon', 'Capture 20 different Messier objects in a single night.', 1200, (l) => Object.values(l.nights).some((a) => a.length >= 20)],
  ['moon', 'Terminator', 'Image the Moon.', 150, (l) => !!l.bodies.Moon],
  ['jupiter', 'King of Planets', 'Image Jupiter.', 250, (l) => !!l.bodies.Jupiter],
  ['saturn', 'Lord of the Rings', 'Image Saturn.', 250, (l) => !!l.bodies.Saturn],
  ['planets5', 'Wanderers', 'Image all five naked-eye planets.', 900, (l) => PLANETS5.every((p) => l.bodies[p])],
  ['ice-giants', 'Ice Giants', 'Image Uranus and Neptune.', 400, (l) => l.bodies.Uranus && l.bodies.Neptune],
  ['lucky', 'Lucky Imager', 'Lucky-stack a planetary video.', 150, (l, s) => s.stacks.some((x) => x.planetary)],
  ['aurora', 'Northern Lights', 'Photograph an aurora.', 400, (l) => !!l.aurora],
  ['sites5', 'Globetrotter', 'Observe from 5 different sites.', 500, (l) => Object.keys(l.sites).length >= 5],
  ['bortle1', 'Dark Sky Pilgrim', 'Observe under a Bortle 1 sky.', 300, (l) => Object.keys(l.sites).some((id) => LOC[id] && LOC[id].bortle <= 1)],
  ['south', 'Southern Skies', 'Observe from south of latitude −20°.', 300, (l) => Object.keys(l.sites).some((id) => LOC[id] && LOC[id].lat < -20)],
  ['int10', 'Photon Collector', '10 hours of total light-frame integration.', 400, (l, s) => s.stats.integration >= 36000],
  ['int50', 'Photon Hoarder', '50 hours of total integration.', 1500, (l, s) => s.stats.integration >= 180000],
  ['score90', 'Masterpiece', 'Save a final image scoring 90+.', 800, (l, s) => s.finals.some((f) => f.score && f.score.total >= 90)],
  ['iotd', 'Image of the Day', 'Win Image of the Day on StarShare.', 0, (l, s) => s.posts.some((p) => p.award === 'Image of the Day')],
  ['nb', 'Hubble Palette', 'Save an SHO narrowband image.', 400, (l, s) => s.finals.some((f) => (f.filter || []).includes('f_sii') || (f.filter || []).includes('SHO'))],
  ['nights10', 'Regular', 'Spend 10 nights observing.', 300, (l, s) => s.stats.nights >= 10],
];

// Which Messier objects / planets a frame captured
function framesTargets(meta) {
  const r = meta.recipe; if (!r || !r.cam) return { m: [], b: [] };
  const fovW = (r.cam.w * r.cam.pix / r.opt.focal) * 206.265 / 3600, fovH = (r.cam.h * r.cam.pix / r.opt.focal) * 206.265 / 3600;
  const half = (r.roi ? Math.min(r.roi.w, r.roi.h) / Math.max(r.cam.w, r.cam.h) : 1) * Math.min(fovW, fovH) / 2;
  const m = [];
  for (const d of messierList()) if (A.sep(r.ra, r.dec, d.ra, d.dec) < half * 0.9 + (d.size || 5) / 60 * 0.2) m.push(d.id.replace(' ', ''));
  const b = (meta.bodies || []).slice();
  for (const bd of r.bodies || []) if (A.sep(r.ra, r.dec, bd.ra, bd.dec) < half && !b.includes(bd.name)) b.push(bd.name);
  return { m, b };
}

export function initAchievements() {
  on('frame', (fr) => {
    const meta = fr && fr.meta; if (!meta || !meta.id || !G.s.night) return;
    if (meta.type !== 'light' && meta.type !== 'video') return;
    const l = logbook(); const n = G.s.night;
    l.sites[n.loc] = l.sites[n.loc] || G.s.time;
    const { m, b } = framesTargets(meta);
    const tonight = l.nights[n.id] || (l.nights[n.id] = []);
    for (const id of m) { if (!l.messier[id]) l.messier[id] = { t: G.s.time, loc: n.loc }; if (!tonight.includes(id)) tonight.push(id); }
    for (const nm of b) if (!l.bodies[nm]) l.bodies[nm] = { t: G.s.time, loc: n.loc };
    const au = meta.recipe.env && meta.recipe.env.aurora;
    if (au && au.strength > 0.2 && meta.type === 'light' && meta.recipe.opt.focal < 60) l.aurora = l.aurora || G.s.time;
    // prune per-night lists to the last 40 nights
    const keys = Object.keys(l.nights); if (keys.length > 40) delete l.nights[keys[0]];
    check();
  });
  for (const ev of ['stacked', 'final', 'posted', 'award', 'newday', 'night']) on(ev, () => setTimeout(check, 50));
}
export function check() {
  if (!G.s || G.guest) return;
  const l = logbook(); let changed = false;
  for (const [id, title, desc, reward, fn] of ACHIEVEMENTS) {
    if (l.ach[id]) continue;
    let ok = false; try { ok = fn(l, G.s); } catch { ok = false; }
    if (!ok) continue;
    l.ach[id] = G.s.time; changed = true;
    window.dispatchEvent(new CustomEvent('fl-sfx', { detail: { name: 'chime' } }));
    const pay = reward && !isSandbox();
    if (pay) addMoney(reward, `Achievement: ${title}`);
    toast(`🏅 Achievement unlocked — ${title}${pay ? ` · +${money(reward)}` : ''}`, 'good', 7000);
    emit('achievement', { id, title, desc });
  }
  if (changed) save();
}
