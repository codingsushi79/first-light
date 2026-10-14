// Star & deep-sky catalogs. Bright stars / constellations / Milky Way outline
// come from the d3-celestial data set (fetched at runtime); deep-sky imaging uses
// real survey imagery (CDS HiPS). Any object name can be resolved via CDS Sesame.
const CDN = 'https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/';

// Curated popular astrophotography targets (J2000, size in arcmin)
export const TARGETS = [
  ['M31', 'Andromeda Galaxy', 'galaxy', 10.6847, 41.2688, 178, 3.4, 'Our nearest big spiral neighbour, 2.5 million light years away. Huge — fits a 200–400mm field.'],
  ['M42', 'Orion Nebula', 'nebula', 83.8221, -5.3911, 85, 4.0, 'Blazing stellar nursery. Extreme dynamic range: the core burns out in long exposures.'],
  ['M45', 'Pleiades', 'cluster', 56.75, 24.1167, 110, 1.6, 'Blue reflection nebulosity around the Seven Sisters. Needs dark skies for the dust.'],
  ['M33', 'Triangulum Galaxy', 'galaxy', 23.4621, 30.6599, 70, 5.7, 'Face-on spiral with pink HII regions. Low surface brightness — loves dark skies.'],
  ['M51', 'Whirlpool Galaxy', 'galaxy', 202.4696, 47.1952, 11, 8.4, 'Interacting spiral pair. Needs 700mm+.'],
  ['M81', "Bode's Galaxy", 'galaxy', 148.8882, 69.0653, 27, 6.9, 'Grand spiral; pair it with M82 (Cigar) in one frame.'],
  ['M101', 'Pinwheel Galaxy', 'galaxy', 210.8023, 54.3488, 29, 7.9, 'Large, faint face-on spiral.'],
  ['M8', 'Lagoon Nebula', 'nebula', 270.9042, -24.3867, 90, 6.0, 'Bright emission nebula low in the summer south.'],
  ['M20', 'Trifid Nebula', 'nebula', 270.6, -23.03, 28, 6.3, 'Red emission + blue reflection with dark lanes.'],
  ['M16', 'Eagle Nebula', 'nebula', 274.7, -13.8067, 35, 6.0, 'Home of the Pillars of Creation.'],
  ['M17', 'Omega / Swan Nebula', 'nebula', 275.1958, -16.1717, 46, 6.0, 'Bright, compact emission nebula.'],
  ['M27', 'Dumbbell Nebula', 'planetary', 299.9017, 22.7211, 8, 7.5, 'Bright planetary nebula. OIII-rich.'],
  ['M57', 'Ring Nebula', 'planetary', 283.3963, 33.0292, 1.4, 8.8, 'Tiny smoke ring in Lyra — needs long focal length.'],
  ['M1', 'Crab Nebula', 'snr', 83.6331, 22.0145, 7, 8.4, 'Supernova remnant from 1054 AD.'],
  ['M13', 'Great Hercules Cluster', 'cluster', 250.4235, 36.4613, 20, 5.8, 'Brilliant globular cluster of ~300,000 stars.'],
  ['M82', 'Cigar Galaxy', 'galaxy', 148.9685, 69.6797, 11, 8.4, 'Starburst galaxy with red Hα filaments.'],
  ['M63', 'Sunflower Galaxy', 'galaxy', 198.9555, 42.0293, 13, 8.6, 'Flocculent spiral.'],
  ['M104', 'Sombrero Galaxy', 'galaxy', 189.9976, -11.6231, 9, 8.0, 'Edge-on with a dramatic dust lane.'],
  ['M97', 'Owl Nebula', 'planetary', 168.6988, 55.0191, 3.4, 9.9, 'Faint round planetary nebula with two dark "eyes".'],
  ['M78', 'M78 reflection nebula', 'nebula', 86.6908, 0.0794, 8, 8.3, 'Blue reflection nebula in Orion surrounded by dark dust.'],
  ['NGC 7000', 'North America Nebula', 'nebula', 314.6958, 44.33, 120, 4.0, 'Enormous Hα region shaped like the continent. Perfect for 135–400mm.'],
  ['IC 5070', 'Pelican Nebula', 'nebula', 312.75, 44.367, 60, 8.0, 'Neighbour of the North America Nebula.'],
  ['IC 1396', 'Elephant’s Trunk Nebula', 'nebula', 324.745, 57.51389, 170, 3.5, 'Huge Hα nebula with a dark trunk of dust. Narrowband favourite.'],
  ['IC 1805', 'Heart Nebula', 'nebula', 38.21, 61.47111, 150, 6.5, 'Big emission nebula in Cassiopeia.'],
  ['IC 1848', 'Soul Nebula', 'nebula', 42.855, 60.41889, 150, 6.5, 'Twin of the Heart Nebula.'],
  ['NGC 6960', 'Western Veil (Witch’s Broom)', 'snr', 311.40833, 30.70833, 70, 7.0, 'Delicate supernova remnant filaments. Hα + OIII.'],
  ['NGC 6992', 'Eastern Veil Nebula', 'snr', 314.0792, 31.7433, 60, 7.0, 'The brighter, eastern arc of the Cygnus Loop.'],
  ['IC 434', 'Horsehead Nebula', 'nebula', 85.25, -2.5, 60, 7.3, 'The iconic dark horse head against red Hα glow, next to the Flame.'],
  ['NGC 2024', 'Flame Nebula', 'nebula', 85.42917, -1.84167, 30, 2.0, 'Bright, near Alnitak.'],
  ['NGC 2244', 'Rosette Nebula', 'nebula', 98.045, 4.91389, 80, 4.8, 'A cosmic rose. Gorgeous in bicolor narrowband.'],
  ['NGC 6888', 'Crescent Nebula', 'nebula', 303.0273, 38.355, 18, 7.4, 'Wolf-Rayet bubble; OIII shell.'],
  ['NGC 281', 'Pacman Nebula', 'nebula', 13.10458, 56.565, 35, 7.4, 'Emission nebula with Bok globules.'],
  ['IC 405', 'Flaming Star Nebula', 'nebula', 79.35, 34.383, 37, 6.0, 'Red & blue nebula in Auriga.'],
  ['IC 410', 'Tadpoles Nebula', 'nebula', 80.5, 33.483, 40, 7.5, 'Emission nebula with tadpole-shaped gas tails.'],
  ['NGC 2264', 'Cone Nebula / Christmas Tree', 'nebula', 100.21708, 9.87694, 60, 3.9, 'Christmas Tree cluster and Fox Fur nebula.'],
  ['Sh2-155', 'Cave Nebula', 'nebula', 344.2746, 62.6359, 50, 7.7, 'Faint emission nebula with dark "cave".'],
  ['Sh2-129', 'Flying Bat & Squid', 'nebula', 317.95, 59.95, 140, 9, 'Faint Hα bat; inside it the extremely faint OIII "Squid" (Ou4). Expert target.'],
  ['NGC 7635', 'Bubble Nebula', 'nebula', 350.20125, 61.20167, 15, 10, 'A bubble blown by a massive star.'],
  ['NGC 6946', 'Fireworks Galaxy', 'galaxy', 308.71805, 60.15368, 11, 8.8, 'Face-on spiral behind the Milky Way.'],
  ['NGC 891', 'Silver Sliver Galaxy', 'galaxy', 35.63711, 42.34832, 13, 9.9, 'Perfectly edge-on spiral with dust lane.'],
  ['NGC 4565', 'Needle Galaxy', 'galaxy', 189.08668, 25.98739, 16, 9.6, 'Thin edge-on spiral in Coma Berenices.'],
  ['NGC 7331', 'Deer Lick Group', 'galaxy', 339.26688, 34.41578, 11, 9.5, 'Galaxy with companions; Stephan’s Quintet nearby.'],
  ['IC 2118', 'Witch Head Nebula', 'nebula', 75.5, -7.9, 180, 13, 'Faint blue reflection nebula lit by Rigel.'],
  ['LDN 1251', 'Space Shark (LDN 1251)', 'dark', 339.025, 75.26667, 120, 99, 'Faint dusty dark nebula. Needs a dark site and hours.'],
  ['NGC 3372', 'Carina Nebula', 'nebula', 161.2593, -59.69994, 120, 1.0, 'Southern showpiece around Eta Carinae.'],
  ['NGC 5128', 'Centaurus A', 'galaxy', 201.36506, -43.01911, 25, 6.8, 'Peculiar galaxy with a dust band.'],
  ['LMC', 'Large Magellanic Cloud', 'galaxy', 80.89417, -69.75611, 650, 0.9, 'Satellite galaxy, home of the Tarantula Nebula. Southern sky.'],
  ['SMC', 'Small Magellanic Cloud', 'galaxy', 13.15833, -72.80028, 320, 2.7, 'Satellite galaxy next to 47 Tucanae. Southern sky.'],
  ['NGC 2070', 'Tarantula Nebula', 'nebula', 84.675, -69.1, 40, 8, 'Most active star-forming region in the Local Group.'],
  ['NGC 104', '47 Tucanae', 'cluster', 6.02233, -72.08144, 30, 4.0, 'Second-brightest globular cluster.'],
  ['NGC 5139', 'Omega Centauri', 'cluster', 201.697, -47.47947, 36, 3.7, 'The biggest globular cluster of the Milky Way.'],
  ['rho Oph', 'Rho Ophiuchi cloud complex', 'nebula', 246.39632, -23.44717, 300, 4.6, 'The most colorful region of the sky, near Antares. 50–135mm.'],
  ['NGC 1499', 'California Nebula', 'nebula', 60.825, 36.42167, 160, 6, 'Long Hα nebula in Perseus.'],
  ['NGC 869', 'Double Cluster', 'cluster', 34.7375, 57.13389, 60, 4.3, 'Two rich open clusters side by side.'],
  ['NGC 7293', 'Helix Nebula', 'planetary', 337.41061, -20.83715, 25, 7.6, 'Large nearby planetary nebula — the "Eye of God".'],
  ['NGC 253', 'Sculptor Galaxy', 'galaxy', 11.88806, -25.2888, 27, 7.1, 'Dusty bright starburst galaxy.'],
  ['NGC 4631', 'Whale Galaxy', 'galaxy', 190.53337, 32.54151, 15, 9.2, 'Edge-on with a hockey-stick companion.'],
  ['Sh2-240', 'Spaghetti Nebula (Simeis 147)', 'snr', 85.275, 28.08333, 180, 99, 'Huge, ultra-faint supernova remnant. Hα only, many hours.'],
  ['IC 1318', 'Sadr Region (Butterfly)', 'nebula', 304.2, 41.95667, 180, 99, 'Hα-rich region around Gamma Cygni.'],
  ['NGC 2174', 'Monkey Head Nebula', 'nebula', 92.425, 20.5, 40, 6.8, 'Emission nebula in Orion.'],
  ['NGC 1333', 'NGC 1333', 'nebula', 52.28833, 31.34972, 9, 5.6, 'Reflection nebula in a dusty Perseus field.'],
  ['IC 63', 'Ghost of Cassiopeia', 'nebula', 14.75571, 60.88828, 10, 99, 'Hα + reflection ghost near Gamma Cas.'],
  ['NGC 7023', 'Iris Nebula', 'nebula', 315.40375, 68.16333, 18, 6.8, 'Blue reflection nebula wrapped in dust.'],
  ['vdB 141', 'Ghost Nebula (vdB 141)', 'nebula', 319.1097, 68.26015, 30, 99, 'Faint reflection nebula in Cepheus.'],
  ['NGC 2359', 'Thor’s Helmet', 'nebula', 109.625, -13.22667, 16, 11.5, 'Wolf-Rayet bubble, OIII rich.'],
  ['IC 2177', 'Seagull Nebula', 'nebula', 106.10417, -10.455, 120, 99, 'Big emission nebula on the Monoceros/CMa border.'],
  ['NGC 6334', 'Cat’s Paw Nebula', 'nebula', 260.21942, -36.13123, 40, 99, 'Southern emission nebula.'],
  ['NGC 6357', 'Lobster Nebula', 'nebula', 261.185, -34.203, 50, 99, 'Next to the Cat’s Paw.'],
  ['NGC 2403', 'Caldwell 7', 'galaxy', 114.21391, 65.60268, 22, 8.4, 'Bright intermediate spiral in Camelopardalis.'],
  ['IC 342', 'Hidden Galaxy', 'galaxy', 56.70214, 68.09611, 20, 9.1, 'Big face-on spiral obscured by Milky Way dust.'],
  ['NGC 6543', 'Cat’s Eye Nebula', 'planetary', 269.63918, 66.63299, 0.4, 8.1, 'Tiny bright planetary. Long focal length only.'],
  ['NGC 7380', 'Wizard Nebula', 'nebula', 341.8475, 58.11528, 25, 7.2, 'Emission nebula shaped like a wizard.'],
  ['Sh2-101', 'Tulip Nebula', 'nebula', 299.97917, 35.27667, 16, 9, 'Hα tulip near Cygnus X-1.'],
  ['NGC 7822', 'Cepheus "Question Mark"', 'nebula', 0.28575, 67.42139, 100, 99, 'Large Hα complex with pillars.'],
  ['Abell 426', 'Perseus Galaxy Cluster', 'galaxy', 49.9482, 41.515, 30, 12, 'Hundreds of galaxies 240 million light years away.'],
  ["Stephan's Quintet", "Stephan's Quintet", 'galaxy', 338.98958, 33.96, 4, 13, 'Compact galaxy group. Long focal length.'],
  ['Leo Triplet', 'Leo Triplet', 'galaxy', 169.75, 13.2, 50, 9, 'M65, M66 and NGC 3628 in one frame.'],
  ['NGC 3576', 'Statue of Liberty Nebula', 'nebula', 167.9718, -61.3072, 40, 99, 'Southern emission nebula.'],
  ['IC 2944', 'Running Chicken Nebula', 'nebula', 174.58333, -63.37278, 75, 4.5, 'Southern emission nebula with Thackeray’s globules.'],
  ['NGC 6188', 'Fighting Dragons of Ara', 'nebula', 250.0, -48.5, 60, 99, 'Southern Hα nebula with dark dragons.'],
  ['Sh2-264', 'Meissa (Angelfish) Nebula', 'nebula', 83.825, 9.93333, 300, 99, 'Huge faint Hα ring around Lambda Orionis. Wide lens.'],
  ['Galactic Core', 'Milky Way core (Sagittarius)', 'milkyway', 266.4168, -29.0078, 1500, 99, 'Dense star clouds of the galactic center. Wide lens, dark site.'],
  ['Cygnus', 'Cygnus Milky Way', 'milkyway', 305.6, 40.2, 1500, 99, 'The Northern Cross on the summer Milky Way. Wide lens.'],
  ['Orion', 'Orion constellation', 'milkyway', 83.8, -1.0, 1600, 99, 'Whole constellation: Barnard’s Loop, M42, Horsehead. 24–50mm.'],
  ['Polaris', 'North celestial pole (star trails)', 'star', 37.95456, 89.26411, 600, 2.0, 'Point here with a fixed tripod for concentric star trails.'],
  ['Big Dipper', 'Big Dipper (Ursa Major)', 'star', 178.0, 55.0, 1800, 2.0, 'The famous asterism. 18–35mm lens.'],
  ['Cassiopeia', 'Cassiopeia W', 'star', 14.0, 60.5, 900, 2.5, 'The W asterism in the Milky Way. 35–50mm.'],
];

export const TYPE_LABEL = { galaxy: 'Galaxy', nebula: 'Nebula', cluster: 'Star cluster', planetary: 'Planetary nebula', snr: 'Supernova remnant', dark: 'Dark nebula', milkyway: 'Milky Way field', star: 'Star field', oc: 'Open cluster', gc: 'Globular cluster', en: 'Emission nebula', rn: 'Reflection nebula', pn: 'Planetary nebula', bn: 'Nebula', sg: 'Spiral galaxy', eg: 'Elliptical galaxy', ig: 'Irregular galaxy', lg: 'Galaxy', dn: 'Dark nebula', sn: 'Supernova remnant', 'g': 'Galaxy', gg: 'Galaxy group', s0: 'Lenticular galaxy', 'pos': 'Position' };

export const cat = {
  stars: [], lines: [], mw: [], dsos: [], names: {}, constNames: [], loaded: false,
};

function lonToRa(l) { return l < 0 ? l + 360 : l; }

export async function loadCatalogs(progress) {
  const get = async (f) => { const r = await fetch(CDN + f); if (!r.ok) throw new Error(f); return r.json(); };
  progress && progress('Downloading star catalog…');
  const [stars, lines, mw, messier, dsos, starnames, consts] = await Promise.all([
    get('stars.6.json'), get('constellations.lines.json'), get('mw.json'), get('messier.json'), get('dsos.bright.json'), get('starnames.json').catch(() => ({})), get('constellations.json'),
  ]);
  for (const f of stars.features) {
    const [l, d] = f.geometry.coordinates;
    const nm = starnames[f.id];
    cat.stars.push({ ra: lonToRa(l), dec: d, mag: f.properties.mag, bv: parseFloat(f.properties.bv) || 0.6, id: f.id, name: nm && nm.name ? nm.name : '', desig: nm ? `${nm.bayer || nm.flam || ''} ${nm.c || ''}`.trim() : '' });
  }
  cat.stars.sort((a, b) => a.mag - b.mag);
  for (const f of lines.features) for (const ls of f.geometry.coordinates) cat.lines.push(ls.map(([l, d]) => [lonToRa(l), d]));
  for (const f of mw.features) {
    const lvl = +String(f.id).replace(/\D/g, '') || 1;
    for (const poly of f.geometry.coordinates) for (const ring of poly) cat.mw.push({ lvl, pts: ring.map(([l, d]) => [lonToRa(l), d]) });
  }
  for (const f of consts.features) cat.constNames.push({ id: f.id, name: f.properties.name, ra: lonToRa(f.geometry.coordinates[0]), dec: f.geometry.coordinates[1] });
  const seen = new Set();
  for (const t of TARGETS) {
    const [id, name, type, ra, dec, size, mag, desc] = t;
    cat.dsos.push({ id, name, type, ra, dec, size, mag, desc, curated: true }); seen.add(id.replace(/\s/g, ''));
  }
  for (const f of messier.features) {
    const p = f.properties; const id = p.name;
    if (seen.has(id)) continue; seen.add(id);
    const [l, d] = f.geometry.coordinates;
    const sz = parseFloat(String(p.dim).split('x')[0]) || 5;
    cat.dsos.push({ id, name: p.alt || `${id} (${p.desig})`, type: p.type, ra: lonToRa(l), dec: d, size: sz, mag: p.mag, desc: `${TYPE_LABEL[p.type] || p.type} ${p.desig ? '· ' + p.desig : ''}` });
  }
  for (const f of dsos.features) {
    const p = f.properties; const id = p.desig || f.id;
    if (seen.has(id.replace(/\s/g, ''))) continue; seen.add(id.replace(/\s/g, ''));
    const [l, d] = f.geometry.coordinates;
    const sz = parseFloat(String(p.dim).split('x')[0]) || 3;
    cat.dsos.push({ id, name: id, type: p.type, ra: lonToRa(l), dec: d, size: sz, mag: p.mag, desc: `${TYPE_LABEL[p.type] || p.type}` });
  }
  cat.loaded = true;
}

export function findLocal(q) {
  const s = q.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return [];
  const norm = (x) => x.toLowerCase().replace(/\s+/g, '');
  const sn = norm(s);
  const res = [];
  for (const d of cat.dsos) {
    const score = norm(d.id) === sn ? 0 : norm(d.name) === sn ? 0.5 : norm(d.id).startsWith(sn) ? 1 : d.name.toLowerCase().includes(s) ? 2 : -1;
    if (score >= 0) res.push({ ...d, score, kind: 'dso' });
  }
  for (const st of cat.stars) {
    if (st.name && st.name.toLowerCase().startsWith(s)) res.push({ id: st.name, name: st.name, type: 'star', ra: st.ra, dec: st.dec, mag: st.mag, size: 0, desc: `Star, mag ${st.mag.toFixed(1)} ${st.desig}`, score: st.name.toLowerCase() === s ? 0.2 : 1.5, kind: 'star' });
  }
  res.sort((a, b) => a.score - b.score || (a.mag || 20) - (b.mag || 20));
  return res.slice(0, 30);
}

// Resolve ANY object name through CDS Sesame (SIMBAD / NED / VizieR)
export async function sesame(name) {
  const url = `https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?${encodeURIComponent(name)}`;
  const r = await fetch(url);
  const txt = await r.text();
  const ra = /<jradeg>([^<]+)</.exec(txt), dec = /<jdedeg>([^<]+)</.exec(txt);
  if (!ra || !dec) return null;
  const otype = /<otype>([^<]+)</.exec(txt), oname = /<oname>([^<]+)</.exec(txt);
  return { id: oname ? oname[1].trim() : name, name: oname ? oname[1].trim() : name, type: 'pos', ra: +ra[1], dec: +dec[1], size: 10, mag: 99, desc: `Resolved by CDS Sesame${otype ? ' · type ' + otype[1] : ''}`, kind: 'sesame' };
}

export function bvToRGB(bv) {
  const t = Math.max(-0.4, Math.min(2.0, bv));
  let r, g, b;
  if (t < 0.0) { r = 0.61 + 0.11 * (t + 0.4) / 0.4; g = 0.7 + 0.07 * (t + 0.4) / 0.4; b = 1; }
  else if (t < 0.4) { r = 0.83 + 0.17 * t / 0.4; g = 0.87 + 0.11 * t / 0.4; b = 1; }
  else if (t < 1.6) { r = 1; g = 0.98 - 0.3 * (t - 0.4) / 1.2; b = 1 - 0.55 * (t - 0.4) / 1.2; }
  else { r = 1; g = 0.68; b = 0.42; }
  return [r, g, b];
}
