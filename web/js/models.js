// Procedural 3D models for the observing site: tripods & piers, mount heads, optical tubes,
// camera lenses, cameras, accessories, the camp (table, laptop, chair, cases) and scenery.
// Everything is built from primitives so the rig always matches the gear you own.
//
// Conventions for the optical assembly (OTA): built along +Z (toward the sky), with local -Y
// facing the mount. `mountPoint` is the OTA-local point that sits on the mount's saddle.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32, hashStr } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ------------------------------------------------------------------ materials
const cache = new Map();
export function std(color, rough = 0.5, metal = 0.2, extra = {}) {
  const key = `s${color}/${rough}/${metal}/${JSON.stringify(extra)}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
  return cache.get(key);
}
export function lam(color, extra = {}) {
  const key = `l${color}/${JSON.stringify(extra)}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshLambertMaterial({ color, ...extra }));
  return cache.get(key);
}
export function basic(color, extra = {}) {
  const key = `b${color}/${JSON.stringify(extra)}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra }));
  return cache.get(key);
}
const M = {
  black: () => std(0x18191b, 0.55, 0.25),
  satin: () => std(0x232428, 0.38, 0.55),
  gloss: () => std(0x111214, 0.18, 0.35),
  rubber: () => std(0x0c0c0d, 0.95, 0.0),
  alu: () => std(0xb9bdc4, 0.3, 0.9),
  chrome: () => std(0xdde1e6, 0.12, 1.0),
  steel: () => std(0x8d9198, 0.35, 0.85),
  white: () => std(0xecece8, 0.32, 0.05),
  glass: () => std(0x0c1626, 0.05, 0.9, { envMapIntensity: 1.6 }),
  mirror: () => std(0xd6dbe2, 0.03, 1.0, { envMapIntensity: 1.4 }),
  flock: () => std(0x050505, 1.0, 0.0, { side: THREE.BackSide }),
};

let knurlTex = null;
function knurl() {
  if (knurlTex) return knurlTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 8; const g = c.getContext('2d');
  g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, 128, 8);
  for (let x = 0; x < 128; x += 4) { g.fillStyle = '#060606'; g.fillRect(x, 0, 2, 8); }
  knurlTex = new THREE.CanvasTexture(c); knurlTex.wrapS = knurlTex.wrapT = THREE.RepeatWrapping; knurlTex.repeat.set(6, 1); knurlTex.colorSpace = THREE.SRGBColorSpace;
  return knurlTex;
}
// double-sided variant of a material, for open rings and cells you can look into
const dblCache = new Map();
const dbl = (m) => { if (!dblCache.has(m)) { const c = m.clone(); c.side = THREE.DoubleSide; dblCache.set(m, c); } return dblCache.get(m); };
// an open-ended tube along +Z (rings, cells, barrels that surround glass)
const tubeZ = (rTop, rBot, len, mat, z, seg = 48) => cylZ(rTop, rBot, len, dbl(mat), z, seg, true);
const rubberRing = () => std(0xffffff, 0.9, 0.0, { map: knurl() });

// ------------------------------------------------------------------ primitives
const mesh = (geo, mat, tag) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; if (tag) m.userData.action = tag; return m; };
// cylinder along +Z centred at z (rTop is at +Z)
export function cylZ(rTop, rBot, len, mat, z = 0, seg = 32, open = false) { const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, open); g.rotateX(Math.PI / 2); const m = mesh(g, mat); m.position.z = z; return m; }
// cylinder along +X centred at x (rTop is at +X)
export function cylX(rTop, rBot, len, mat, x = 0, seg = 24) { const g = new THREE.CylinderGeometry(rTop, rBot, len, seg); g.rotateZ(-Math.PI / 2); const m = mesh(g, mat); m.position.x = x; return m; }
export function cylY(rTop, rBot, len, mat, y = 0, seg = 24, open = false) { const m = mesh(new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, open), mat); m.position.y = y; return m; }
export function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
export function rbox(w, h, d, r, mat, x = 0, y = 0, z = 0) { const m = mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat); m.position.set(x, y, z); return m; }
export function sphere(r, mat, x = 0, y = 0, z = 0, ws = 16, hs = 12) { const m = mesh(new THREE.SphereGeometry(r, ws, hs), mat); m.position.set(x, y, z); return m; }
// a rod (cylinder) between two points; rA at a, rB at b
export function rod(a, b, rA, rB, mat, seg = 10) {
  const d = b.clone().sub(a); const len = d.length();
  const m = mesh(new THREE.CylinderGeometry(rB, rA, len, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}
const ring = (r, tube, mat, z = 0, seg = 40) => { const m = mesh(new THREE.TorusGeometry(r, tube, 8, seg), mat); m.position.z = z; return m; };
const disc = (r, mat, z = 0, seg = 40) => { const m = mesh(new THREE.CircleGeometry(r, seg), mat); m.position.z = z; m.castShadow = false; return m; };
const put = (parent, child) => { parent.add(child); return child; };
const tagAll = (obj, tag) => { obj.traverse((o) => { if (o.isMesh && !o.userData.action) o.userData.action = tag; }); return obj; };
// a sagging cable between two points (catenary-ish)
export function cable(a, b, sag = 0.15, r = 0.0035, color = 0x111111) {
  const mid = a.clone().lerp(b, 0.5); mid.y -= sag;
  const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).add(V(0, -sag * 0.25, 0)), mid, b.clone().lerp(mid, 0.5).add(V(0, -sag * 0.25, 0)), b]);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, r, 5), std(color, 0.7, 0.05)); m.castShadow = true;
  return m;
}
function textTex(lines, w = 256, h = 64, bg = '#000', fg = '#fff', font = '600 28px "IBM Plex Sans Condensed", system-ui') {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const L = [].concat(lines); L.forEach((s, i) => g.fillText(s, w / 2, h * (i + 0.5) / L.length));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ------------------------------------------------------------------ styles
const MOUNT_STYLE = {
  tripod: { kind: 'ball', tripod: 'photo' },
  tracker: { kind: 'tracker', body: 0xe6e6e2, accent: 0x1c1d20, tripod: 'alu' },
  sa_gti: { kind: 'tracker', body: 0x26282c, accent: 0xb3161c, tripod: 'alu' },
  azgti: { kind: 'altaz', body: 0x1c1d20, accent: 0xe7e7e3, tripod: 'alu' },
  eq5: { kind: 'gem', body: 0xe8e8e4, accent: 0x1d1e21, tripod: 'steel' },
  eq6: { kind: 'gem', body: 0x2b2c30, accent: 0xdedfe2, tripod: 'steel' },
  eq8: { kind: 'gem', body: 0xe8e8e4, accent: 0x1d1e21, tripod: 'pier' },
  gem28: { kind: 'gem', body: 0x2a2c31, accent: 0xc3202a, tripod: 'steel' },
  cem40: { kind: 'gem', body: 0xb61e25, accent: 0x1e1f22, tripod: 'steel' },
  cgx: { kind: 'gem', body: 0x1d1e21, accent: 0xcfd2d7, tripod: 'steel' },
  harmonic: { kind: 'harmonic', body: 0xb3141a, accent: 0x161618, tripod: 'carbon' },
  rst135: { kind: 'harmonic', body: 0x1b1c1f, accent: 0x2c6fd1, tripod: 'carbon' },
  observatory: { kind: 'gem', body: 0x474a50, accent: 0x1a1b1d, tripod: 'pier' },
};
export function mountStyle(mount) {
  const s = MOUNT_STYLE[mount.id];
  if (s) return s;
  if (mount.type === 'fixed') return { kind: 'ball', tripod: 'photo' };
  if (mount.type === 'altaz') return { kind: 'altaz', body: 0x1c1d20, accent: 0xe7e7e3, tripod: 'alu' };
  if (mount.payload < 6) return { kind: 'tracker', body: 0xe6e6e2, accent: 0x1c1d20, tripod: 'alu' };
  return { kind: 'gem', body: 0xe8e8e4, accent: 0x1d1e21, tripod: mount.payload > 30 ? 'pier' : 'steel' };
}
export function optStyle(opt) {
  const n = opt.name || '';
  if (/RedCat/i.test(n)) return { tube: 0xa3141c, accent: 0xcaa64a, handle: true };
  if (/ZenithStar/i.test(n)) return { tube: 0x2f5ea8, accent: 0xcaa64a, handle: true };
  if (/Takahashi/i.test(n)) return { tube: 0xf1eee2, accent: 0x2e6b4f };
  if (/Askar/i.test(n)) return { tube: 0xf2f2ef, accent: 0x9a9da3, handle: true };
  if (/Esprit/i.test(n)) return { tube: 0xefefec, accent: 0x1d3f8f };
  if (/Evostar/i.test(n)) return { tube: 0xefefec, accent: 0xc0a04a };
  if (/Explore Scientific/i.test(n)) return { tube: 0x1a1a1c, accent: 0xc0c3c8 };
  if (/Quattro/i.test(n)) return { tube: 0xedede9, accent: 0x1d1e21 };
  if (/Explorer/i.test(n)) return { tube: 0x15161a, accent: 0xd4d6da };
  if (/C8 SCT/i.test(n)) return { tube: 0xc65a1e, accent: 0x18191b };
  if (/Celestron/i.test(n)) return { tube: 0x141518, accent: 0xc0c3c8 };
  if (/Maksutov|Skymax/i.test(n)) return { tube: 0x1b2442, accent: 0xc0c3c8 };
  if (/Ritchey|GSO/i.test(n)) return { tube: 0x131417, accent: 0xc6c9ce };
  if (opt.type === 'refractor') return { tube: 0xefefec, accent: 0x1d1e21 };
  return { tube: 0x16171a, accent: 0xc0c3c8 };
}
const CAM_BODY = { ZWO: 0xc0161c, QHYCCD: 0x1e1f22, 'Player One': 0x1c3d8f };

// ------------------------------------------------------------------ tripods & piers
export function buildTripod(kind) {
  const g = new THREE.Group();
  if (kind === 'pier') {
    const headH = 1.12, paint = std(0xdedfe0, 0.45, 0.15);
    g.add(cylY(0.3, 0.3, 0.02, M.steel(), 0.01, 36));
    g.add(cylY(0.11, 0.11, headH - 0.06, paint, (headH - 0.06) / 2 + 0.02, 32));
    for (let i = 0; i < 4; i++) { const gs = box(0.012, 0.22, 0.14, paint); const a = i * Math.PI / 2; gs.position.set(Math.cos(a) * 0.16, 0.13, Math.sin(a) * 0.16); gs.rotation.y = -a; g.add(gs); }
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.3; put(g, cylY(0.012, 0.012, 0.03, M.chrome(), 0.03, 6)).position.set(Math.cos(a) * 0.26, 0.03, Math.sin(a) * 0.26); }
    g.add(cylY(0.14, 0.14, 0.03, M.black(), headH - 0.045, 36));
    for (let i = 0; i < 3; i++) { const a = i * 2.094; const b = cylY(0.008, 0.008, 0.07, M.chrome(), headH - 0.06, 8); b.position.x = Math.cos(a) * 0.12; b.position.z = Math.sin(a) * 0.12; g.add(b); }
    tagAll(g, 'mount');
    return { group: g, headH, apex: V(0, headH - 0.08, 0.11) };
  }
  const P = {
    photo: { headH: 1.3, spread: 0.5, r1: 0.015, r2: 0.01, leg: std(0x1b1c1e, 0.35, 0.4), apexR: 0.045, column: true },
    alu: { headH: 1.12, spread: 0.5, r1: 0.017, r2: 0.013, leg: M.alu(), apexR: 0.05, tray: true },
    steel: { headH: 1.0, spread: 0.6, r1: 0.025, r2: 0.019, leg: M.chrome(), apexR: 0.085, tray: true, heavy: true },
    carbon: { headH: 1.02, spread: 0.55, r1: 0.022, r2: 0.017, leg: std(0x15161a, 0.3, 0.5), apexR: 0.075, tray: false, heavy: true },
  }[kind] || {};
  const { headH, spread, r1, r2, leg, apexR } = P;
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const foot = V(Math.cos(a) * spread, 0.012, Math.sin(a) * spread), top = V(Math.cos(a) * apexR, headH - 0.07, Math.sin(a) * apexR);
    const at = (t) => top.clone().lerp(foot, t);
    g.add(rod(top, at(0.56), r1, r1, leg, 12));
    g.add(rod(at(0.46), foot, r2, r2 * 0.95, kind === 'steel' ? M.chrome() : leg, 12));
    g.add(rod(at(0.5), at(0.58), r1 * 1.35, r1 * 1.35, M.black(), 12)); // leg lock
    if (P.heavy) g.add(rod(at(0.22), at(0.28), r1 * 1.25, r1 * 1.25, M.black(), 12));
    g.add(sphere(r2 * 1.5, M.rubber(), foot.x, foot.y, foot.z, 10, 8));
    const hinge = box(r1 * 2.6, 0.05, r1 * 2.6, M.black()); hinge.position.copy(top).add(V(0, 0.02, 0)); hinge.lookAt(V(0, hinge.position.y, 0)); g.add(hinge);
    legs.push({ top, foot, at });
  }
  g.add(cylY(apexR + 0.02, apexR + 0.025, 0.06, P.heavy ? std(0x2a2b2f, 0.45, 0.6) : M.black(), headH - 0.04, 24));
  if (P.column) { g.add(cylY(0.017, 0.017, headH * 0.45, M.black(), headH * 0.72, 16)); g.add(cylY(0.022, 0.022, 0.02, M.black(), headH * 0.5, 16)); }
  if (P.tray) {
    const y = headH * 0.42; const pts = legs.map((L) => L.at((L.top.y - y) / (L.top.y - L.foot.y)));
    const a0 = 0.3; const trayR = pts[0].length() * 0.72;
    const tray = mesh(new THREE.CylinderGeometry(trayR, trayR, 0.008, 3, 1, false, Math.PI / 2 - a0), std(0x3a3d42, 0.55, 0.5)); tray.position.y = y + 0.02; g.add(tray);
    for (let i = 0; i < 3; i++) { const a = a0 + (i / 3) * Math.PI * 2 + Math.PI / 3; const hole = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.009, 16), M.rubber()); hole.position.set(Math.cos(a) * trayR * 0.4, y + 0.0205, Math.sin(a) * trayR * 0.4); g.add(hole); }
    for (const p of pts) g.add(rod(V(0, y, 0), p, 0.007, 0.007, M.steel(), 6));
    g.add(cylY(0.007, 0.007, headH - 0.07 - y, M.steel(), (headH - 0.07 + y) / 2, 8));
  }
  tagAll(g, 'mount');
  return { group: g, headH, apex: V(0, headH - 0.1, 0), legs };
}

// ------------------------------------------------------------------ mount heads
// Returns { head (Group at y=0 of the mount head), refs } where refs follow world3d's contract:
//  eq:    polar, raRot, decSide (mirror group), saddle, south
//  altaz: azRot, saddle;  fixed: saddle
export function buildMountHead(mount, loc, st) {
  const head = new THREE.Group(); const refs = {};
  const body = std(st.body ?? 0xe8e8e4, 0.32, 0.25), accent = std(st.accent ?? 0x1d1e21, 0.4, 0.45);
  if (st.kind === 'ball') {
    head.add(cylY(0.03, 0.032, 0.03, M.satin(), 0.015, 24));
    head.add(sphere(0.024, M.satin(), 0, 0.045));
    put(head, cylX(0.006, 0.006, 0.035, M.black(), 0.04)).position.y = 0.035;
    head.add(sphere(0.009, M.black(), 0.058, 0.035, 0));
    const qr = box(0.05, 0.016, 0.05, M.satin()); qr.position.y = 0.075; head.add(qr);
    const saddle = new THREE.Object3D(); saddle.position.y = 0.083; head.add(saddle);
    tagAll(head, 'mount'); refs.saddle = saddle; refs.ballTop = qr;
    return { head, refs };
  }
  if (st.kind === 'altaz') {
    const azRot = new THREE.Group(); head.add(azRot);
    azRot.add(cylY(0.07, 0.075, 0.05, body, 0.025, 32));
    azRot.add(cylY(0.072, 0.072, 0.008, accent, 0.054, 32));
    azRot.add(rbox(0.055, 0.25, 0.095, 0.012, body, 0.035, 0.18, 0));
    azRot.add(rbox(0.057, 0.06, 0.097, 0.012, accent, 0.035, 0.27, 0));
    put(azRot, cylX(0.03, 0.03, 0.02, accent, 0.07)).position.y = 0.245;
    const clamp = box(0.02, 0.05, 0.09, M.black(), 0.082, 0.245, 0); azRot.add(clamp);
    put(azRot, cylZ(0.006, 0.006, 0.03, M.black(), 0.06)).position.set(0.082, 0.245, 0.06);
    azRot.add(sphere(0.01, M.black(), 0.082, 0.245, 0.078));
    const saddle = new THREE.Object3D(); saddle.position.set(0.092, 0.245, 0); azRot.add(saddle);
    tagAll(head, 'mount'); refs.azRot = azRot; refs.saddle = saddle;
    return { head, refs };
  }
  // equatorial
  const south = loc.lat < 0; refs.south = south;
  const az = new THREE.Group(); az.rotation.y = south ? Math.PI : 0; head.add(az);
  const polar = new THREE.Group(); const raRot = new THREE.Group(); const decSide = new THREE.Group(); raRot.add(decSide);
  const saddle = new THREE.Object3D(); decSide.add(saddle);
  const s = st.kind === 'tracker' ? 1 : Math.min(1.45, 0.82 + 0.6 * Math.min(1, mount.payload / 40));
  const tagP = (m) => { m.userData.action = 'polar'; return m; };
  if (st.kind === 'tracker') {
    // wedge + compact tracker body + declination bracket with a mini ball head
    az.add(tagP(rbox(0.09, 0.025, 0.11, 0.006, M.alu(), 0, 0.0125, 0)));
    az.add(tagP(box(0.012, 0.09, 0.08, M.alu(), 0.04, 0.06, 0)));
    az.add(tagP(box(0.012, 0.09, 0.08, M.alu(), -0.04, 0.06, 0)));
    az.add(tagP(rod(V(0, 0.03, 0.06), V(0, 0.11, 0.035), 0.004, 0.004, M.chrome())));
    az.add(tagP(sphere(0.012, M.black(), 0, 0.112, 0.035)));
    polar.position.y = 0.09; az.add(polar);
    polar.add(tagP(rbox(0.085, 0.15, 0.07, 0.014, body, 0, 0.05, 0)));
    polar.add(tagP(rbox(0.087, 0.03, 0.072, 0.01, accent, 0, 0.0, 0)));
    polar.add(tagP(cylY(0.016, 0.016, 0.03, M.black(), -0.035, 16)));
    const dial = cylZ(0.022, 0.022, 0.006, accent, 0.037); dial.position.y = 0.07; polar.add(dial);
    raRot.position.y = 0.135; polar.add(raRot);
    raRot.add(cylY(0.035, 0.035, 0.018, M.satin(), -0.006, 24));
    decSide.add(box(0.13, 0.012, 0.045, M.alu(), 0.06, 0.008, 0));
    decSide.add(box(0.012, 0.05, 0.045, M.alu(), 0.12, 0.03, 0));
    // ball head on the bracket, pointing out along +X
    const bh = new THREE.Group(); bh.position.set(0.126, 0.03, 0); decSide.add(bh);
    bh.add(cylX(0.02, 0.022, 0.02, M.satin(), 0.01)); bh.add(sphere(0.016, M.satin(), 0.03, 0, 0)); bh.add(box(0.012, 0.04, 0.04, M.satin(), 0.052, 0, 0));
    saddle.position.set(0.185, 0.03, 0); refs.sadOff = 0.185;
    if (mount.payload >= 5) {
      const cw = new THREE.Group(); decSide.add(cw);
      cw.add(rod(V(0, 0.01, 0), V(-0.19, 0.01, 0), 0.006, 0.006, M.chrome()));
      put(cw, cylX(0.035, 0.035, 0.035, M.steel(), -0.15)).position.y = 0.01;
    }
  } else if (st.kind === 'harmonic') {
    az.add(rbox(0.15 * s, 0.045, 0.15 * s, 0.01, accent, 0, 0.0225, 0));
    for (const x of [-1, 1]) put(az, tagP(cylX(0.008, 0.008, 0.03, M.chrome(), x * 0.085 * s))).position.set(x * 0.085 * s, 0.025, -0.05 * s);
    polar.position.y = 0.075; az.add(polar);
    polar.add(tagP(rbox(0.12 * s, 0.16 * s, 0.1 * s, 0.018, body, 0, 0.06 * s, 0)));
    polar.add(tagP(cylY(0.055 * s, 0.055 * s, 0.03 * s, accent, 0.15 * s, 32)));
    put(polar, tagP(cylZ(0.035 * s, 0.035 * s, 0.012, accent, 0.052 * s))).position.y = 0.05 * s;
    raRot.position.y = 0.2 * s; polar.add(raRot);
    raRot.add(cylY(0.045 * s, 0.05 * s, 0.05 * s, body, -0.02 * s, 32));
    raRot.add(rbox(0.11 * s, 0.1 * s, 0.1 * s, 0.018, body, 0.0, 0.0, 0));
    decSide.add(cylX(0.068 * s, 0.068 * s, 0.06 * s, body, 0.07 * s, 40));
    decSide.add(cylX(0.06 * s, 0.06 * s, 0.015 * s, accent, 0.108 * s, 40));
    decSide.add(box(0.016, 0.09 * s, 0.13 * s, M.black(), 0.122 * s, 0, 0));
    put(decSide, cylZ(0.006, 0.006, 0.04, M.chrome(), 0.08 * s)).position.set(0.122 * s, 0.03 * s, 0.08 * s);
    saddle.position.x = 0.13 * s; refs.sadOff = 0.13 * s;
  } else {
    // German equatorial
    az.add(tagP(cylY(0.088 * s, 0.095 * s, 0.05 * s, body, 0.025 * s, 40)));
    az.add(tagP(cylY(0.09 * s, 0.09 * s, 0.008, accent, 0.052 * s, 40)));
    for (const x of [-1, 1]) az.add(tagP(box(0.014 * s, 0.1 * s, 0.11 * s, body, x * 0.058 * s, 0.1 * s, 0)));
    az.add(tagP(box(0.03 * s, 0.03 * s, 0.03 * s, accent, 0, 0.04 * s, -0.1 * s))); // azimuth peg
    for (const x of [-1, 1]) { put(az, tagP(cylX(0.006 * s, 0.006 * s, 0.05 * s, M.chrome(), x * 0.04 * s))).position.set(x * 0.04 * s, 0.04 * s, -0.1 * s); put(az, tagP(cylX(0.012 * s, 0.012 * s, 0.012 * s, M.black(), x * 0.07 * s))).position.set(x * 0.07 * s, 0.04 * s, -0.1 * s); }
    az.add(tagP(rod(V(0, 0.04 * s, 0.09 * s), V(0, 0.19 * s, 0.03 * s), 0.007 * s, 0.007 * s, M.chrome())));
    put(az, tagP(cylX(0.004 * s, 0.004 * s, 0.07 * s, M.chrome(), 0))).position.set(0, 0.04 * s, 0.095 * s);
    polar.position.y = 0.12 * s; az.add(polar);
    polar.add(tagP(cylY(0.064 * s, 0.07 * s, 0.24 * s, body, 0.06 * s, 40)));
    polar.add(tagP(rbox(0.09 * s, 0.13 * s, 0.05 * s, 0.01, accent, 0, 0.05 * s, 0.07 * s)));
    polar.add(tagP(cylY(0.066 * s, 0.066 * s, 0.014, M.alu(), 0.17 * s, 40)));
    if (mount.polarScope || st.tripod !== 'pier') { polar.add(tagP(cylY(0.022 * s, 0.022 * s, 0.05 * s, M.black(), -0.08 * s, 16))); polar.add(tagP(cylY(0.026 * s, 0.022 * s, 0.015 * s, M.rubber(), -0.11 * s, 16))); }
    raRot.position.y = 0.27 * s; polar.add(raRot);
    raRot.add(cylY(0.055 * s, 0.06 * s, 0.07 * s, body, -0.045 * s, 32));
    raRot.add(cylX(0.056 * s, 0.056 * s, 0.25 * s, body, -0.01 * s, 40));
    raRot.add(rbox(0.11 * s, 0.07 * s, 0.05 * s, 0.01, accent, -0.03 * s, 0, 0.065 * s));
    raRot.add(cylX(0.058 * s, 0.058 * s, 0.012, M.alu(), 0.06 * s, 40));
    decSide.add(cylX(0.06 * s, 0.065 * s, 0.03 * s, accent, 0.125 * s, 40));
    decSide.add(box(0.016, 0.09 * s, 0.15 * s, M.black(), 0.148 * s, 0, 0));
    for (const z of [-1, 1]) { put(decSide, cylY(0.005, 0.005, 0.04, M.chrome(), 0)).position.set(0.148 * s, 0.05 * s, z * 0.045 * s); put(decSide, sphere(0.011, M.black(), 0.148 * s, 0.075 * s, z * 0.045 * s)); }
    saddle.position.x = 0.156 * s; refs.sadOff = 0.156 * s;
    if (mount.payload >= 5) {
      const cw = new THREE.Group(); decSide.add(cw);
      const L = 0.42 * s, x0 = -0.13 * s;
      cw.add(rod(V(x0, 0, 0), V(x0 - L, 0, 0), 0.011 * s, 0.011 * s, M.chrome(), 12));
      cw.add(cylX(0.02 * s, 0.02 * s, 0.015 * s, M.black(), x0 - L - 0.005));
      const n = mount.payload >= 40 ? 3 : mount.payload >= 18 ? 2 : 1;
      for (let i = 0; i < n; i++) { const xw = x0 - L + 0.07 * s + i * 0.075 * s; cw.add(cylX(0.075 * s, 0.075 * s, 0.065 * s, M.steel(), xw, 32)); const sc = cylY(0.006, 0.006, 0.03, M.chrome(), 0); sc.position.set(xw, 0.088 * s, 0); cw.add(sc); cw.add(sphere(0.01, M.black(), xw, 0.104 * s, 0)); }
    }
  }
  tagAll(head, 'mount');
  Object.assign(refs, { polar, raRot, decSide, saddle });
  return { head, refs };
}

// GoTo hand controller hanging from a tripod leg (static), with its coiled cable
export function buildHandController(tri) {
  const g = new THREE.Group();
  if (!tri.legs) return g;
  const L = tri.legs[0]; const p = L.at(0.3);
  const hc = new THREE.Group(); hc.position.copy(p).add(V(0, -0.1, 0)).addScaledVector(V(p.x, 0, p.z).normalize(), 0.04); hc.lookAt(V(0, hc.position.y, 0)); hc.rotateY(Math.PI);
  hc.add(rbox(0.07, 0.16, 0.028, 0.012, std(0x2a2c30, 0.6, 0.1)));
  const scr = mesh(new THREE.PlaneGeometry(0.05, 0.025), basic(0x5a0a06)); scr.position.set(0, 0.045, 0.0145); hc.add(scr);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) hc.add(box(0.012, 0.008, 0.004, M.rubber(), (c - 1) * 0.018, 0.0 - r * 0.016, 0.015));
  g.add(hc);
  g.add(cable(hc.position.clone().add(V(0, 0.08, 0)), V(0.0, tri.headH + 0.05, 0.06), 0.12, 0.004));
  tagAll(g, 'mount');
  return g;
}

// ------------------------------------------------------------------ cameras
// Built facing +Z: the front (lens mount / sensor window) at z=0, body toward -Z.
export function buildCamera(cam, onScope) {
  const g = new THREE.Group(); let len; const ledPos = V(0, 0, 0);
  if (cam.type === 'dslr') {
    const mirrorless = /Sony/i.test(cam.brand || cam.name);
    const W = mirrorless ? 0.126 : 0.132, H = mirrorless ? 0.074 : 0.1, D = mirrorless ? 0.05 : 0.075;
    const bodyM = std(0x141416, 0.6, 0.15);
    let z = 0;
    if (onScope) { g.add(cylZ(0.029, 0.029, 0.014, M.alu(), -0.007)); g.add(cylZ(0.03, 0.03, 0.004, M.black(), -0.012)); z = -0.014; }
    g.add(ring(0.027, 0.0025, M.chrome(), z - 0.002));
    g.add(rbox(W, H, D, 0.012, bodyM, 0, mirrorless ? 0.012 : 0.016, z - D / 2 - 0.002));
    g.add(rbox(0.036, H * 0.95, D * 0.55, 0.012, M.rubber(), -W / 2 + 0.018, mirrorless ? 0.008 : 0.012, z - D * 0.2)); // grip
    const prism = mesh(new THREE.CylinderGeometry(0.022, 0.036, mirrorless ? 0.022 : 0.032, 4, 1), bodyM); prism.rotation.y = Math.PI / 4; prism.scale.set(1.1, 1, 0.8); prism.position.set(0, (mirrorless ? 0.012 : 0.016) + H / 2 + (mirrorless ? 0.009 : 0.014), z - D * 0.45); g.add(prism);
    g.add(box(0.02, 0.003, 0.018, M.alu(), 0, prism.position.y + (mirrorless ? 0.012 : 0.017), prism.position.z)); // hot shoe
    put(g, cylY(0.012, 0.012, 0.008, M.satin(), (mirrorless ? 0.012 : 0.016) + H / 2 + 0.004, 24)).position.set(W * 0.3, (mirrorless ? 0.012 : 0.016) + H / 2 + 0.004, z - D * 0.5);
    const lcd = mesh(new THREE.PlaneGeometry(W * 0.55, H * 0.55), std(0x05070a, 0.1, 0.5)); lcd.rotation.y = Math.PI; lcd.position.set(W * 0.12, 0.004, z - D - 0.0025); g.add(lcd);
    ledPos.set(-W * 0.32, H * 0.25, z - D - 0.004);
    len = D + (onScope ? 0.014 : 0);
  } else {
    const col = CAM_BODY[cam.brand] ?? 0xc0161c;
    const bodyM = std(col, 0.32, 0.55);
    if (cam.planetary || cam.guideOnly || !cam.cooled) {
      const r = 0.031, L = 0.045;
      g.add(cylZ(0.016, 0.016, 0.03, M.chrome(), 0.015, 24)); // 1.25" nosepiece
      g.add(cylZ(r, r, L, bodyM, -L / 2, 32));
      g.add(cylZ(r * 1.01, r * 1.01, 0.006, M.black(), -L + 0.003, 32));
      g.add(box(0.012, 0.006, 0.014, M.black(), r * 0.5, -r + 0.004, -L * 0.6));
      ledPos.set(r * 0.5, r * 0.3, -L - 0.001); len = L;
    } else {
      const r = cam.w > 7000 ? 0.047 : 0.04;
      g.add(cylZ(0.027, 0.027, 0.012, M.chrome(), -0.006, 24)); // M48 thread
      g.add(cylZ(r * 0.95, r * 0.95, 0.008, M.black(), -0.014, 40));
      g.add(cylZ(r, r, 0.05, bodyM, -0.043, 48));
      for (let i = 0; i < 7; i++) g.add(cylZ(r * 0.92, r * 0.92, 0.0025, M.black(), -0.071 - i * 0.0045, 40)); // heat-sink fins
      g.add(cylZ(r * 0.95, r * 0.95, 0.008, M.black(), -0.105, 40));
      const grill = disc(r * 0.8, std(0x050505, 0.8, 0.3), -0.1095); grill.rotation.y = Math.PI; g.add(grill);
      for (let i = 0; i < 3; i++) { const s = box(r * 1.6, 0.0025, 0.002, M.satin(), 0, 0, -0.11); s.rotation.z = i * Math.PI / 3; g.add(s); }
      g.add(cylZ(0.01, 0.01, 0.003, M.satin(), -0.11, 16));
      g.add(box(0.016, 0.012, 0.024, M.black(), 0, r + 0.004, -0.04));
      g.add(box(0.012, 0.008, 0.012, M.alu(), r * 0.55, r * 0.6, -0.06));
      ledPos.set(-r * 0.6, -r * 0.55, -0.111); len = 0.11;
    }
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x00ff40, toneMapped: false })); led.position.copy(ledPos); g.add(led);
  tagAll(g, 'camera');
  return { group: g, len, led };
}

// imaging train behind a focuser (corrector, filter wheel, ADC, camera); faces +Z, extends to -Z
function buildTrain(ri, cam, refs) {
  const g = new THREE.Group(); let z = 0;
  if (ri.corr && ri.corr.forTypes && ri.corr.forTypes.includes(ri.opt.type)) {
    const L = ri.corr.barlow ? 0.075 : 0.04;
    g.add(cylZ(0.028, 0.028, L, std(0x1b1c1f, 0.35, 0.6), z - L / 2, 32)); g.add(cylZ(0.03, 0.03, 0.006, M.alu(), z - L + 0.003, 32)); z -= L;
  }
  if (ri.hasADC) { g.add(cylZ(0.022, 0.022, 0.06, M.black(), z - 0.03, 24)); g.add(box(0.05, 0.008, 0.012, M.alu(), 0, 0.024, z - 0.03)); z -= 0.06; }
  if (ri.hasWheel) {
    const w = cylZ(0.072, 0.072, 0.026, std(0x1c1d20, 0.35, 0.5), z - 0.013, 48); w.position.y = 0.032; g.add(w);
    put(g, cylZ(0.074, 0.074, 0.006, std(0xc0161c, 0.35, 0.5), z - 0.013, 48)).position.y = 0.032;
    z -= 0.026;
  }
  const c = buildCamera(cam, true); c.group.position.z = z; g.add(c.group); refs.led = c.led; z -= c.len;
  refs.camBack = V(0, 0, z);
  return { group: g, len: -z };
}

// ------------------------------------------------------------------ optical assemblies
// Returns { group, refs, mountPoint, frontZ, frontR, glassZ, glassR, rad }
export function buildOTA(ri) {
  const g = new THREE.Group(); const refs = {};
  const opt = ri.opt, cam = ri.cam;
  let frontZ, frontR, glassZ, glassR, rad, mountPoint, topY, dewZ, dewR, focuserAt;
  const addRingsAndBar = (rad, len, z0, wide) => {
    for (const f of [0.28, 0.66]) {
      const z = z0 + len * f; g.add(cylZ(rad + 0.009, rad + 0.009, 0.02, M.black(), z, 40));
      g.add(box(0.03, 0.02, 0.026, M.black(), 0, -rad - 0.011, z));
      put(g, cylY(0.006, 0.006, 0.02, M.chrome(), rad + 0.015, 8)).position.set(0.0, rad + 0.015, z);
    }
    g.add(box(wide ? 0.075 : 0.044, 0.014, len * 0.72, M.satin(), 0, -rad - 0.028, z0 + len * 0.47));
    return V(0, -rad - 0.035, z0 + len * 0.47);
  };
  if (!opt) { rad = 0.04; frontZ = 0.1; frontR = rad; glassZ = 0.09; glassR = rad; mountPoint = V(0, -0.06, 0); }
  else if (opt.type === 'lens') {
    const fMax = opt.zoom ? opt.zoom[1] : opt.focal;
    const Dp = ri.focal / Math.max(1, ri.fMin);
    rad = THREE.MathUtils.clamp(Dp / 2000 + 0.024, 0.031, 0.06);
    const len = 0.045 + fMax * 0.00058 + (fMax >= 135 ? 0.03 : 0);
    const white = /\b200mm f\/2\.8L|L II|L USM/i.test(opt.name);
    const bodyM = white ? std(0xe9e6dc, 0.4, 0.05) : std(0x141416, 0.55, 0.2);
    g.add(cylZ(0.028, 0.028, 0.008, M.alu(), 0.004));
    g.add(cylZ(rad * 0.86, rad * 0.8, len * 0.3, bodyM, 0.008 + len * 0.15, 40));
    if (opt.zoom) g.add(cylZ(rad * 0.93, rad * 0.93, len * 0.24, rubberRing(), 0.008 + len * 0.42, 48));
    else g.add(cylZ(rad * 0.88, rad * 0.86, len * 0.24, bodyM, 0.008 + len * 0.42, 40));
    g.add(cylZ(rad * 0.98, rad * 0.93, len * 0.2, rubberRing(), 0.008 + len * 0.66, 48));
    g.add(tubeZ(rad, rad * 0.98, len * 0.24, bodyM, 0.008 + len * 0.88));
    g.add(disc(rad * 0.98, M.black(), 0.008 + len * 0.76));
    if (white) g.add(ring(rad * 0.99, 0.0018, std(0xb01818, 0.4, 0.3), 0.008 + len * 0.95));
    const fz = 0.008 + len;
    g.add(ring(rad * 0.86, rad * 0.08, M.black(), fz - 0.004));
    if (fMax <= 16) {
      const bulb = mesh(new THREE.SphereGeometry(rad * 0.84, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.6), M.glass()); bulb.rotation.x = Math.PI / 2; bulb.position.z = fz - rad * 0.55; g.add(bulb);
      for (let i = 0; i < 4; i++) { const p = mesh(new THREE.CylinderGeometry(rad * 1.12, rad * 1.08, 0.03, 24, 1, true, i * Math.PI / 2 + 0.25, 1.05), std(0x141416, 0.55, 0.2, { side: THREE.DoubleSide })); p.rotation.x = Math.PI / 2; p.position.z = fz + 0.012; p.scale.z = i % 2 ? 0.6 : 1; g.add(p); }
      glassZ = fz + 0.005; frontZ = fz + 0.028; frontR = rad * 1.12;
    } else {
      g.add(disc(rad * 0.8, M.glass(), fz - 0.006));
      glassZ = fz - 0.004; frontZ = fz; frontR = rad;
      if (fMax >= 85) {
        const hl = rad * 1.3;
        g.add(cylZ(rad * 1.16, rad * 1.04, hl, white ? bodyM : std(0x141416, 0.6, 0.15), fz + hl / 2, 48, true));
        g.add(cylZ(rad * 1.15, rad * 1.03, hl, M.flock(), fz + hl / 2, 48, true));
        frontZ = fz + hl; frontR = rad * 1.16;
      }
    }
    dewZ = 0.008 + len * 0.82; dewR = rad * 1.05;
    tagAll(g, 'focus');
    if (fMax >= 135) {
      const cz = 0.008 + len * 0.32;
      g.add(cylZ(rad * 0.9, rad * 0.9, 0.025, bodyM, cz, 40));
      g.add(box(0.018, rad * 0.5, 0.025, bodyM, 0, -rad * 0.95 - 0.004, cz));
      g.add(box(0.04, 0.012, 0.07, bodyM, 0, -rad * 1.2 - 0.008, cz));
      mountPoint = V(0, -rad * 1.2 - 0.02, cz);
    } else mountPoint = V(0, -0.062, -0.04);
    const c = buildCamera(cam, false); g.add(c.group); refs.led = c.led; refs.camBack = V(0, 0.01, -c.len);
    topY = 0.1;
  } else {
    const st = optStyle(opt); const tubeM = std(st.tube, 0.3, 0.2), accM = std(st.accent, 0.35, 0.5);
    const D = opt.D / 1000, flen = opt.focal / 1000;
    if (opt.type === 'refractor') {
      const len = Math.max(0.17, flen * 0.72); rad = D / 2 + 0.013;
      g.add(cylZ(rad, rad, len, tubeM, len / 2, 48, true));
      g.add(cylZ(rad * 1.02, rad * 1.02, 0.012, M.black(), 0.006, 48));
      g.add(tubeZ(rad * 1.045, rad * 1.045, D * 0.38, accM, len - D * 0.19));
      const shL = D * 1.45, shZ0 = len - D * 0.12;
      g.add(cylZ(rad * 1.1, rad * 1.1, shL, tubeM, shZ0 + shL / 2, 48, true));
      g.add(cylZ(rad * 1.095, rad * 1.095, shL, M.flock(), shZ0 + shL / 2, 48, true));
      g.add(ring(rad * 1.1, 0.0035, M.black(), shZ0 + shL));
      glassZ = len - 0.012; glassR = rad * 0.9;
      g.add(disc(glassR, M.glass(), glassZ));
      g.add(ring(glassR, 0.004, M.black(), glassZ + 0.002));
      frontZ = shZ0 + shL; frontR = rad * 1.1;
      // focuser: body, drawtube, coarse + fine knobs
      const fr = Math.max(0.035, rad * 0.75);
      g.add(cylZ(fr, rad * 0.95, 0.045, M.black(), -0.0225, 40));
      g.add(box(fr * 1.6, 0.022, 0.05, M.black(), 0, -fr - 0.005, -0.025));
      g.add(cylZ(0.031, 0.031, 0.055, M.alu(), -0.072, 32));
      g.add(cylZ(0.034, 0.034, 0.012, M.black(), -0.096, 32));
      for (const x of [-1, 1]) { const k = cylX(0.014, 0.014, 0.018, rubberRing(), x * (fr * 0.8 + 0.015)); k.position.y = -fr - 0.005; k.position.z = -0.025; g.add(k); }
      const fk = cylX(0.008, 0.008, 0.012, M.alu(), fr * 0.8 + 0.03); fk.position.set(fr * 0.8 + 0.03, -fr - 0.005, -0.025); g.add(fk);
      focuserAt = V(-(fr * 0.8 + 0.04), -fr - 0.005, -0.025);
      const tr = buildTrain(ri, cam, refs); tr.group.position.z = -0.102; g.add(tr.group); refs.camBack.z -= 0.102;
      mountPoint = addRingsAndBar(rad, len, 0, D > 0.12);
      if (st.handle) { for (const f of [0.28, 0.66]) g.add(box(0.016, 0.03, 0.016, M.black(), 0, rad + 0.024, len * f)); g.add(rbox(0.024, 0.016, len * 0.5, 0.006, M.black(), 0, rad + 0.045, len * 0.47)); }
      dewZ = len - D * 0.19; dewR = rad * 1.07; topY = rad + (st.handle ? 0.055 : 0.025);
      tagAll(g, 'scope');
    } else if (opt.type === 'newtonian') {
      const len = flen * 1.0; rad = D / 2 + 0.02;
      g.add(cylZ(rad, rad, len, tubeM, len / 2, 48, true));
      g.add(cylZ(rad * 0.995, rad * 0.995, len, M.flock(), len / 2, 48, true));
      g.add(ring(rad, 0.006, accM, len));
      g.add(cylZ(rad * 1.015, rad * 1.015, 0.035, M.black(), 0.0175, 48));
      for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; const k = cylZ(0.008, 0.008, 0.025, M.black(), -0.012); k.position.x = Math.cos(a) * rad * 0.6; k.position.y = Math.sin(a) * rad * 0.6; g.add(k); }
      g.add(disc(rad * 0.88, M.mirror(), 0.036));
      const sz = len - D * 0.5, sr = Math.max(0.018, D * (opt.obstruction || 0.25) / 2);
      for (let i = 0; i < 2; i++) { const v = box(rad * 2 - 0.004, 0.0015, 0.022, M.black(), 0, 0, sz); v.rotation.z = Math.PI / 4 + i * Math.PI / 2; g.add(v); }
      g.add(cylZ(sr * 0.9, sr * 0.9, 0.05, M.black(), sz, 24));
      const sec = mesh(new THREE.CircleGeometry(sr * 0.85, 24), M.mirror()); sec.position.set(0, 0, sz - 0.03); sec.rotation.y = Math.PI / 2 + Math.PI / 4; sec.scale.x = 1.4; g.add(sec);
      // low-profile focuser on the +X side
      const fb = box(0.02, 0.075, 0.085, M.black(), rad + 0.008, 0, sz); g.add(fb);
      const dt = cylX(0.03, 0.03, 0.06, M.alu(), rad + 0.045); dt.position.z = sz; g.add(dt);
      for (const zz of [-1, 1]) { const k = cylZ(0.014, 0.014, 0.018, rubberRing(), sz + zz * 0.055); k.position.x = rad + 0.03; k.position.y = -0.03; g.add(k); }
      focuserAt = V(rad + 0.03, -0.03, sz - 0.08);
      const tr = buildTrain(ri, cam, refs); tr.group.position.set(rad + 0.078, 0, sz); tr.group.rotation.y = -Math.PI / 2; g.add(tr.group);
      refs.camBack = V(rad + 0.078 + tr.len, 0, sz);
      mountPoint = addRingsAndBar(rad, len, 0, D > 0.18);
      frontZ = len; frontR = rad; glassZ = len - 0.004; glassR = rad * 0.97; dewZ = len - 0.03; dewR = rad * 1.02; topY = rad + 0.025;
      tagAll(g, 'scope');
    } else if (opt.type === 'sct' || opt.type === 'mak' || opt.type === 'rasa') {
      const len = D * (opt.type === 'sct' ? 2.1 : 2.4); rad = D / 2 + (opt.type === 'mak' ? 0.012 : 0.014);
      const z0 = 0.045, zf = z0 + len;
      g.add(cylZ(rad, rad, len, std(st.tube, 0.16, 0.35), z0 + len / 2, 56, true));
      g.add(disc(rad, M.black(), z0 + 0.002));
      g.add(cylZ(rad * 1.02, rad * 0.86, 0.05, M.black(), z0 - 0.025 + 0.005, 56));
      g.add(tubeZ(rad * 1.03, rad * 1.03, 0.04, opt.type === 'mak' ? M.alu() : accM, zf - 0.02, 56));
      glassZ = zf - 0.007; glassR = rad * 0.93;
      g.add(disc(glassR, std(0x0e1a1c, 0.03, 0.85, { envMapIntensity: 1.8 }), glassZ));
      if (opt.type === 'sct') { g.add(cylZ(D * 0.16, D * 0.17, 0.026, M.black(), zf - 0.002, 32)); g.add(disc(D * 0.09, M.alu(), zf + 0.0115)); }
      if (opt.type === 'mak') g.add(disc(D * 0.13, M.mirror(), glassZ + 0.001));
      if (opt.type !== 'rasa') {
        g.add(cylZ(0.033, 0.033, 0.04, M.black(), z0 - 0.07, 32));
        const fk = cylZ(0.013, 0.013, 0.025, rubberRing(), z0 - 0.06); fk.position.set(rad * 0.45, -rad * 0.45, z0 - 0.06); g.add(fk);
        for (const x of [-1, 1]) { const ml = cylZ(0.008, 0.008, 0.02, M.alu(), z0 - 0.06); ml.position.set(x * rad * 0.6, rad * 0.35, z0 - 0.06); g.add(ml); }
        focuserAt = V(rad * 0.45 + 0.03, -rad * 0.45, z0 - 0.06);
        const tr = buildTrain(ri, cam, refs); tr.group.position.z = z0 - 0.09; g.add(tr.group); refs.camBack.z += z0 - 0.09;
      } else {
        // RASA: the camera sits in front of the corrector, facing the primary mirror
        const tr = buildTrain(ri, cam, refs); tr.group.position.z = zf - 0.01; tr.group.rotation.y = Math.PI; g.add(tr.group);
        refs.camBack = V(0, 0, zf - 0.01 + tr.len);
        const fk = cylZ(0.013, 0.013, 0.025, rubberRing(), z0 - 0.01); fk.position.set(rad * 0.5, -rad * 0.5, z0 - 0.01); g.add(fk);
        focuserAt = V(rad * 0.5 + 0.03, -rad * 0.5, z0 - 0.01);
      }
      const wide = D > 0.25;
      g.add(box(wide ? 0.075 : 0.044, 0.016, len * 0.92, M.satin(), 0, -rad - 0.012, z0 + len / 2));
      mountPoint = V(0, -rad - 0.022, z0 + len * 0.44);
      g.add(rbox(0.024, 0.018, len * 0.5, 0.006, M.black(), 0, rad + 0.012, z0 + len * 0.55));
      frontZ = zf; frontR = rad * 1.03; dewZ = zf - 0.02; dewR = rad * 1.05; topY = rad + 0.025;
      tagAll(g, 'scope');
    } else {
      // Ritchey–Chrétien (and anything else with a closed tube and spider)
      const len = Math.max(0.3, flen * 0.33); rad = D / 2 + 0.022;
      g.add(cylZ(rad, rad, len, tubeM, len / 2, 56, true));
      g.add(cylZ(rad * 0.99, rad * 0.99, len, M.flock(), len / 2, 56, true));
      g.add(tubeZ(rad * 1.03, rad * 1.03, 0.03, accM, len - 0.015, 56)); g.add(tubeZ(rad * 1.03, rad * 1.03, 0.03, accM, 0.015, 56));
      g.add(disc(rad * 0.98, M.black(), 0.002));
      g.add(disc(rad * 0.85, M.mirror(), 0.045));
      g.add(cylZ(D * 0.11, D * 0.11, len * 0.45, M.black(), 0.045 + len * 0.225, 24));
      for (let i = 0; i < 4; i++) { const v = box(rad * 2 - 0.004, 0.0018, 0.025, M.black(), 0, 0, len - 0.03); v.rotation.z = i * Math.PI / 2; v.scale.x = 0.5; v.position.x = Math.cos(i * Math.PI / 2) * rad / 2; v.position.y = Math.sin(i * Math.PI / 2) * rad / 2; g.add(v); }
      g.add(cylZ(D * 0.2, D * 0.17, 0.05, M.black(), len - 0.035, 32));
      g.add(cylZ(0.04, 0.04, 0.05, M.black(), -0.025, 32)); g.add(cylZ(0.031, 0.031, 0.03, M.alu(), -0.06, 32));
      for (const x of [-1, 1]) { const k = cylX(0.014, 0.014, 0.018, rubberRing(), x * 0.06); k.position.z = -0.025; k.position.y = -0.035; g.add(k); }
      focuserAt = V(-0.08, -0.035, -0.025);
      const tr = buildTrain(ri, cam, refs); tr.group.position.z = -0.075; g.add(tr.group); refs.camBack.z -= 0.075;
      mountPoint = addRingsAndBar(rad, len, 0, true);
      frontZ = len; frontR = rad * 1.03; glassZ = len - 0.006; glassR = rad * 0.97; dewZ = len - 0.05; dewR = rad * 1.05; topY = rad + 0.025;
      tagAll(g, 'scope');
    }
    if (ri.hasAF && focuserAt) { const af = new THREE.Group(); af.position.copy(focuserAt); af.add(rbox(0.045, 0.05, 0.04, 0.008, std(0xc0161c, 0.35, 0.5))); af.add(box(0.03, 0.004, 0.03, M.black(), 0, 0.026, 0)); g.add(af); tagAll(af, 'focus'); }
    // focuser parts are what you grab to focus
    g.traverse((o) => { if (o.isMesh && o.material && o.material.map === knurl()) o.userData.action = 'focus'; });
  }
  // guide scope
  if (ri.hasGuide) {
    const gg = new THREE.Group(); const gy = (topY ?? rad + 0.03) + 0.04; gg.position.set(0, gy, Math.max(0.03, (mountPoint ? mountPoint.z : 0.1)));
    gg.add(box(0.03, 0.01, 0.09, M.satin(), 0, -0.035, 0));
    for (const z of [-0.03, 0.03]) { gg.add(cylZ(0.024, 0.024, 0.012, M.black(), z, 24)); gg.add(box(0.012, 0.02, 0.012, M.black(), 0, -0.026, z)); }
    gg.add(cylZ(0.018, 0.018, 0.14, M.black(), 0.02, 24)); gg.add(cylZ(0.0185, 0.0185, 0.012, std(0xc8a44a, 0.3, 0.8), 0.08, 24));
    gg.add(disc(0.015, M.glass(), 0.0905));
    gg.add(cylZ(0.016, 0.016, 0.03, M.alu(), -0.065, 16)); gg.add(cylZ(0.019, 0.019, 0.032, std(0xc0161c, 0.32, 0.55), -0.096, 24));
    g.add(gg); tagAll(gg, 'scope');
  }
  rad = rad || 0.04;
  // dew strap (+ controller) — the heater glows faintly when on
  const dew = new THREE.Mesh(new THREE.CylinderGeometry((dewR || rad * 1.05), (dewR || rad * 1.05), 0.03, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95, emissive: 0x000000, side: THREE.DoubleSide }));
  dew.rotation.x = Math.PI / 2; dew.position.z = dewZ ?? frontZ - 0.03; dew.visible = !!ri.hasDew; dew.userData.action = 'dew'; g.add(dew); refs.dew = dew;
  if (ri.hasDew) { const ctl = rbox(0.05, 0.022, 0.035, 0.005, std(0x1e1f22, 0.5, 0.3), 0, -(dewR || rad) - 0.016, dew.position.z - 0.06); ctl.userData.action = 'dew'; g.add(ctl); g.add(cable(V(0, -(dewR || rad), dew.position.z), V(0, -(dewR || rad) - 0.02, dew.position.z - 0.045), 0.01, 0.002)); }
  // lens cap
  const capR = frontR * 1.04;
  const cap = new THREE.Group(); cap.position.z = frontZ + 0.007;
  cap.add(cylZ(capR, capR, 0.014, std(0x0c0c0c, 0.75, 0.05), 0, 40)); cap.add(ring(capR * 0.6, 0.0015, std(0x2a2a2a, 0.6, 0.2), 0.0072));
  tagAll(cap, 'cap'); g.add(cap); refs.cap = cap;
  // dew on the front glass
  const fog = new THREE.Mesh(new THREE.CircleGeometry((glassR || frontR) * 0.98, 40), new THREE.MeshBasicMaterial({ color: 0xd8e2ec, transparent: true, opacity: 0, depthWrite: false }));
  fog.position.z = (glassZ ?? frontZ) + 0.003; fog.userData.action = 'dew'; g.add(fog); refs.fog = fog;
  // Bahtinov mask
  const bc = document.createElement('canvas'); bc.width = bc.height = 128; const bg = bc.getContext('2d'); bg.fillStyle = '#222'; bg.beginPath(); bg.arc(64, 64, 62, 0, 7); bg.fill(); bg.globalCompositeOperation = 'destination-out';
  for (let i = -56; i < 56; i += 8) bg.fillRect(8, 64 + i, 52, 4); bg.save(); bg.translate(96, 34); bg.rotate(0.35); for (let i = -30; i < 30; i += 8) bg.fillRect(-26, i, 52, 4); bg.restore(); bg.save(); bg.translate(96, 94); bg.rotate(-0.35); for (let i = -30; i < 30; i += 8) bg.fillRect(-26, i, 52, 4); bg.restore();
  const baht = new THREE.Mesh(new THREE.CircleGeometry(frontR * 1.12, 40), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, roughness: 0.7 }));
  baht.position.z = frontZ + 0.016; baht.userData.action = 'bahtinov'; g.add(baht); refs.baht = baht;
  // flat panel
  const panel = new THREE.Group(); panel.position.z = frontZ + 0.03;
  panel.add(cylZ(frontR * 1.3, frontR * 1.3, 0.022, std(0x1c1d20, 0.5, 0.4), 0, 48));
  const face = disc(frontR * 1.22, new THREE.MeshBasicMaterial({ color: 0xf4f6ff, toneMapped: false }), -0.0115); face.rotation.y = Math.PI; panel.add(face);
  g.add(panel); refs.panel = panel;
  refs.frontZ = frontZ;
  return { group: g, refs, mountPoint, frontZ, frontR, rad };
}

// ------------------------------------------------------------------ power station (Jackery-style)
export function buildPowerStation() {
  const g = new THREE.Group();
  g.add(rbox(0.3, 0.2, 0.19, 0.02, std(0x3b3d42, 0.6, 0.1), 0, 0.1, 0));
  g.add(rbox(0.302, 0.03, 0.192, 0.012, std(0xf08a24, 0.5, 0.1), 0, 0.2, 0));
  g.add(rbox(0.22, 0.035, 0.04, 0.012, std(0xf08a24, 0.5, 0.1), 0, 0.225, 0));
  const scr = mesh(new THREE.PlaneGeometry(0.08, 0.045), new THREE.MeshBasicMaterial({ map: textTex(['IN 0W', 'OUT 46W  92%'], 160, 90, '#06140c', '#5dff9a', '600 22px "IBM Plex Mono", monospace'), toneMapped: false })); scr.position.set(-0.07, 0.12, 0.0955); g.add(scr);
  for (let i = 0; i < 3; i++) g.add(box(0.02, 0.014, 0.004, M.black(), 0.02 + i * 0.03, 0.12, 0.096));
  for (let i = 0; i < 2; i++) put(g, cylZ(0.008, 0.008, 0.004, M.black(), 0.096)).position.set(0.04 + i * 0.03, 0.08, 0.096);
  g.traverse((o) => { if (o.isMesh) o.userData.action = 'power'; });
  return g;
}

// ------------------------------------------------------------------ the camp: table, laptop, chair, case
export function buildCampTable(screenTex) {
  const t = new THREE.Group(); const out = { group: t };
  const alu = std(0xa7abb2, 0.35, 0.8), dark = std(0x26282c, 0.5, 0.4);
  // roll-top slat surface
  const sc = document.createElement('canvas'); sc.width = 32; sc.height = 256; const sg = sc.getContext('2d');
  for (let y = 0; y < 256; y += 16) { sg.fillStyle = '#9da2a9'; sg.fillRect(0, y, 32, 14); sg.fillStyle = '#5c6066'; sg.fillRect(0, y + 14, 32, 2); }
  const st = new THREE.CanvasTexture(sc); st.colorSpace = THREE.SRGBColorSpace; st.wrapS = st.wrapT = THREE.RepeatWrapping; st.repeat.set(1, 1);
  const top = box(0.9, 0.018, 0.6, std(0xffffff, 0.45, 0.6, { map: st }), 0, 0.72, 0); t.add(top);
  for (const z of [-0.3, 0.3]) t.add(box(0.9, 0.025, 0.02, alu, 0, 0.705, z));
  for (const x of [-0.42, 0.42]) {
    t.add(rod(V(x, 0.01, -0.26), V(x, 0.7, 0.26), 0.011, 0.011, alu));
    t.add(rod(V(x, 0.01, 0.26), V(x, 0.7, -0.26), 0.011, 0.011, alu));
    for (const z of [-0.26, 0.26]) t.add(rbox(0.03, 0.015, 0.05, 0.006, M.rubber(), x, 0.008, z));
  }
  t.add(rod(V(-0.42, 0.36, 0), V(0.42, 0.36, 0), 0.008, 0.008, alu));
  // laptop
  const lap = new THREE.Group(); lap.position.set(0, 0.73, 0.03); t.add(lap); out.laptop = lap;
  const shell = std(0x8f949c, 0.35, 0.75);
  const base = rbox(0.34, 0.016, 0.235, 0.006, shell, 0, 0.008, 0); lap.add(base);
  const kc = document.createElement('canvas'); kc.width = 512; kc.height = 200; const kg = kc.getContext('2d');
  kg.fillStyle = '#121316'; kg.fillRect(0, 0, 512, 200);
  const rows = [14, 14, 13, 12, 11]; rows.forEach((n, r) => { const kw = 512 / 14.6; for (let i = 0; i < n; i++) { kg.fillStyle = '#25272c'; kg.fillRect(8 + i * kw + (14 - n) * kw / 2, 10 + r * 36, kw - 5, 30); } });
  kg.fillStyle = '#25272c'; kg.fillRect(150, 190 - 12, 210, 0);
  const kb = mesh(new THREE.PlaneGeometry(0.29, 0.11), std(0xffffff, 0.7, 0.1, { map: (() => { const x = new THREE.CanvasTexture(kc); x.colorSpace = THREE.SRGBColorSpace; return x; })() }));
  kb.rotation.x = -Math.PI / 2; kb.position.set(0, 0.0162, -0.035); lap.add(kb);
  const pad = mesh(new THREE.PlaneGeometry(0.11, 0.07), std(0x9ba0a8, 0.3, 0.6)); pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.0162, 0.072); lap.add(pad);
  const lid = new THREE.Group(); lid.position.set(0, 0.016, -0.115); lid.rotation.x = 0.28; lap.add(lid); out.lid = lid;
  put(lid, cylX(0.006, 0.006, 0.3, shell, 0)).position.set(0, 0, 0);
  const back = rbox(0.34, 0.225, 0.007, 0.006, shell, 0, 0.112, -0.004); lid.add(back);
  const bezel = mesh(new THREE.PlaneGeometry(0.334, 0.219), std(0x050506, 0.2, 0.3)); bezel.position.set(0, 0.112, 0.0001); lid.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.194), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 0.114, 0.0006); lid.add(screen); out.screen = screen;
  lap.traverse((o) => { if (o.isMesh) o.userData.action = 'laptop'; });
  // red lantern, thermos, mug, star atlas, headlamp
  const lantern = new THREE.Group(); lantern.position.set(0.33, 0.729, -0.17); t.add(lantern);
  lantern.add(cylY(0.03, 0.034, 0.012, M.black(), 0.006, 20)); lantern.add(cylY(0.026, 0.026, 0.07, new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a08, emissiveIntensity: 1.4, roughness: 0.3, transparent: true, opacity: 0.92 }), 0.047, 20)); lantern.add(cylY(0.028, 0.03, 0.012, M.black(), 0.088, 20));
  put(lantern, mesh(new THREE.TorusGeometry(0.018, 0.0025, 6, 20, Math.PI), M.black())).position.y = 0.094;
  const ll = new THREE.PointLight(0xff2008, 0.55, 3.5, 1.8); ll.position.y = 0.05; lantern.add(ll); out.lantern = ll;
  const thermos = new THREE.Group(); thermos.position.set(-0.34, 0.729, -0.18); t.add(thermos);
  thermos.add(cylY(0.036, 0.036, 0.25, std(0x2e5541, 0.45, 0.4), 0.125, 24)); thermos.add(cylY(0.03, 0.036, 0.04, M.steel(), 0.27, 24)); thermos.add(cylY(0.03, 0.03, 0.035, M.black(), 0.305, 24));
  const mug = new THREE.Group(); mug.position.set(-0.24, 0.729, 0.08); t.add(mug);
  mug.add(cylY(0.04, 0.036, 0.09, std(0xdcd6c8, 0.4, 0.05), 0.045, 24, true)); mug.add(cylY(0.036, 0.036, 0.005, std(0x2a1a10, 0.2, 0.1), 0.075, 24));
  put(mug, mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 16, Math.PI), std(0xdcd6c8, 0.4, 0.05))).position.set(0.04, 0.045, 0);
  mug.children[2].rotation.z = -Math.PI / 2;
  const atlas = rbox(0.21, 0.02, 0.29, 0.003, std(0x1d2f5a, 0.7, 0.05), 0.28, 0.739, 0.12); atlas.rotation.y = 0.25; t.add(atlas);
  const atlasT = mesh(new THREE.PlaneGeometry(0.16, 0.06), new THREE.MeshBasicMaterial({ map: textTex(['STAR ATLAS', '2000.0'], 256, 96, '#1d2f5a', '#e6d9a8'), toneMapped: false })); atlasT.rotation.x = -Math.PI / 2; atlasT.rotation.z = 0.25; atlasT.position.set(0.28, 0.7495, 0.1); t.add(atlasT);
  const lamp = new THREE.Group(); lamp.position.set(0.12, 0.735, 0.2); t.add(lamp);
  put(lamp, mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 24), std(0x1a1a1a, 0.9, 0))).rotation.x = Math.PI / 2;
  put(lamp, rbox(0.04, 0.03, 0.025, 0.006, M.black(), 0, 0.008, 0.06)); put(lamp, disc(0.01, basic(0x550000), 0.0731)).position.set(0, 0.008, 0.0731);
  return out;
}
export function buildCampChair() {
  const g = new THREE.Group(); const frame = std(0x24262a, 0.5, 0.6), fab = std(0x1f3150, 0.85, 0.0, { side: THREE.DoubleSide });
  const W = 0.27;
  for (const x of [-W, W]) {
    g.add(rod(V(x, 0, -0.22), V(x, 0.45, 0.2), 0.009, 0.009, frame));
    g.add(rod(V(x, 0, 0.2), V(x, 0.45, -0.22), 0.009, 0.009, frame));
    g.add(rod(V(x, 0.45, -0.22), V(x, 0.95, -0.32), 0.009, 0.009, frame));
    g.add(rod(V(x, 0.62, -0.22), V(x, 0.62, 0.2), 0.012, 0.012, frame));
    g.add(rbox(0.06, 0.015, 0.36, 0.006, fab, x, 0.63, -0.01));
  }
  for (const [a, b] of [[V(-W, 0, -0.22), V(W, 0.45, -0.22)], [V(W, 0, -0.22), V(-W, 0.45, -0.22)]]) g.add(rod(a, b, 0.008, 0.008, frame));
  // fabric seat and back sag between the frame rails
  const sag = (geo, amt) => { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getX(i) / W; p.setZ(i, p.getZ(i) - amt * (1 - u * u)); } geo.computeVertexNormals(); return geo; };
  const seatG = sag(new THREE.PlaneGeometry(W * 2, 0.4, 10, 4), 0.05); seatG.rotateX(-Math.PI / 2);
  const seat = mesh(seatG, fab); seat.position.set(0, 0.46, -0.01); seat.rotation.x = -0.08; g.add(seat);
  const backM = mesh(sag(new THREE.PlaneGeometry(W * 2, 0.44, 10, 4), -0.04), fab); backM.position.set(0, 0.71, -0.27); backM.rotation.x = -0.2; g.add(backM);
  const cup = cylY(0.04, 0.035, 0.07, fab, 0.6); cup.position.set(W + 0.045, 0.6, 0.12); g.add(cup);
  g.traverse((o) => { if (o.isMesh) o.userData.action = 'chair'; });
  return g;
}
export function buildGearCase(color = 0x2a2c30) {
  const g = new THREE.Group(); const body = std(color, 0.6, 0.1);
  g.add(rbox(0.56, 0.12, 0.42, 0.02, body, 0, 0.06, 0)); g.add(rbox(0.56, 0.1, 0.42, 0.02, body, 0, 0.175, 0));
  g.add(box(0.565, 0.01, 0.425, M.black(), 0, 0.122, 0));
  for (const x of [-0.16, 0.16]) g.add(rbox(0.05, 0.05, 0.012, 0.004, std(0xf2c230, 0.45, 0.2), x, 0.125, 0.214));
  g.add(rbox(0.16, 0.025, 0.03, 0.01, M.black(), 0, 0.15, 0.225));
  return g;
}

// ------------------------------------------------------------------ scenery
export function conifer(rnd, hgt, snowy, colors) {
  const g = new THREE.Group();
  const trunk = cylY(0.08 + hgt * 0.008, 0.13 + hgt * 0.012, hgt * 0.35, lam(0x2a1d14), hgt * 0.175, 7); g.add(trunk);
  const n = 5 + Math.floor(rnd() * 3); const leaf = lam(colors[Math.floor(rnd() * colors.length)], { flatShading: true }); const snow = lam(0xe8eef6, { flatShading: true });
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1); const r = hgt * (0.34 - f * 0.26) * (0.85 + rnd() * 0.3); const h = hgt * (0.32 - f * 0.1);
    const c = mesh(new THREE.ConeGeometry(r, h, 7 + Math.floor(rnd() * 3)), snowy && k >= n - 2 ? snow : leaf);
    c.position.y = hgt * (0.22 + f * 0.68); c.rotation.y = rnd() * 6; c.rotation.z = (rnd() - 0.5) * 0.08; g.add(c);
  }
  return g;
}
export function broadleaf(rnd, hgt, colors) {
  const g = new THREE.Group();
  g.add(cylY(0.1 + hgt * 0.01, 0.18 + hgt * 0.015, hgt * 0.5, lam(0x33251a), hgt * 0.25, 7));
  const leaf = lam(colors[Math.floor(rnd() * colors.length)], { flatShading: true });
  const n = 4 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) {
    const r = hgt * (0.16 + rnd() * 0.12); const a = rnd() * 6.28, d = k === 0 ? 0 : hgt * (0.1 + rnd() * 0.14);
    const b = mesh(new THREE.IcosahedronGeometry(r, 1), leaf); b.position.set(Math.cos(a) * d, hgt * (0.58 + rnd() * 0.25), Math.sin(a) * d); b.scale.y = 0.8 + rnd() * 0.3; g.add(b);
  }
  return g;
}
export function house(rnd) {
  const g = new THREE.Group();
  const wall = lam(0x6a625a), trim = lam(0xd8d4cc), roofM = lam(0x2b2828, { flatShading: true });
  const W = 12, H = 5.4, D = 8;
  g.add(box(W, H, D, wall, 0, H / 2, 0));
  g.add(box(W + 0.1, 0.25, D + 0.1, trim, 0, 0.12, 0));
  // gable roof: extruded triangle with overhang
  const sh = new THREE.Shape(); sh.moveTo(-D / 2 - 0.5, 0); sh.lineTo(0, 2.9); sh.lineTo(D / 2 + 0.5, 0); sh.lineTo(-D / 2 - 0.5, 0);
  const rg = new THREE.ExtrudeGeometry(sh, { depth: W + 0.8, bevelEnabled: false }); rg.translate(0, 0, -(W + 0.8) / 2);
  const roof = mesh(rg, roofM); roof.rotation.y = Math.PI / 2; roof.position.y = H - 0.05; g.add(roof);
  g.add(box(0.7, 1.6, 0.7, lam(0x4a3530), -3.2, H + 1.6, -1.2));
  const lit = new THREE.MeshBasicMaterial({ color: 0xffc070, toneMapped: false }), dark = lam(0x111418);
  for (const [x, y] of [[-3.6, 1.7], [3.6, 1.7], [-3.6, 4.1], [0, 4.1], [3.6, 4.1]]) {
    const on = rnd() > 0.45;
    g.add(box(1.4, 1.25, 0.12, trim, x, y, D / 2 + 0.02));
    const w = mesh(new THREE.PlaneGeometry(1.2, 1.05), on ? lit : dark); w.position.set(x, y, D / 2 + 0.085); g.add(w);
    g.add(box(0.05, 1.05, 0.04, trim, x, y, D / 2 + 0.1)); g.add(box(1.2, 0.05, 0.04, trim, x, y, D / 2 + 0.1));
    if (on) { const c = box(0.5, 1.05, 0.02, lam(0x7a5a3a), x - 0.38, y, D / 2 + 0.095); g.add(c); }
  }
  g.add(box(1.2, 2.3, 0.14, trim, 0.9, 1.15 + 0.1, D / 2 + 0.02)); g.add(box(1.0, 2.15, 0.08, lam(0x3a2a20), 0.9, 1.18, D / 2 + 0.07));
  g.add(box(2.6, 0.18, 1.4, lam(0x5a5550), 0.9, 0.09, D / 2 + 0.7));
  return g;
}
export function fence(group, fromAz, toAz, radius, altAzToVec, rnd) {
  const wood = lam(0x3b3128); const boardW = 0.14, H = 1.75;
  const arc = (toAz - fromAz) * Math.PI / 180 * radius; const n = Math.floor(arc / (boardW + 0.015));
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(boardW, 1, 0.022), wood, n); boards.castShadow = true; boards.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const az = fromAz + (toAz - fromAz) * (i + 0.5) / n; const p = altAzToVec(0, az, radius); const h = H * (0.97 + rnd() * 0.05);
    q.setFromAxisAngle(UP, -az * Math.PI / 180); s.set(1, h, 1); m4.compose(V(p.x, h / 2, p.z), q, s); boards.setMatrixAt(i, m4);
  }
  group.add(boards);
  const postN = Math.floor(arc / 2.4);
  for (let i = 0; i <= postN; i++) {
    const az = fromAz + (toAz - fromAz) * i / postN; const p = altAzToVec(0, az, radius - 0.08);
    const post = box(0.1, H + 0.1, 0.1, lam(0x2e261f), p.x, (H + 0.1) / 2, p.z); group.add(post);
    if (i < postN) {
      const az2 = fromAz + (toAz - fromAz) * (i + 1) / postN; const p2 = altAzToVec(0, az2, radius - 0.06);
      for (const y of [0.35, H - 0.3]) group.add(rod(V(p.x, y, p.z), V(p2.x, y, p2.z), 0.035, 0.035, lam(0x2e261f), 4));
    }
  }
}
export function car(rnd, color = 0x223044) {
  const g = new THREE.Group();
  const paint = std(color, 0.35, 0.6), glass = std(0x06080c, 0.08, 0.8), rubber = M.rubber();
  const prof = new THREE.Shape(); // side profile (x along length, y up)
  prof.moveTo(-2.2, 0.35); prof.lineTo(2.1, 0.35); prof.quadraticCurveTo(2.25, 0.5, 2.2, 0.85); prof.lineTo(1.0, 0.98); prof.lineTo(0.45, 1.48); prof.lineTo(-1.3, 1.5); prof.lineTo(-1.95, 1.05); prof.quadraticCurveTo(-2.25, 0.95, -2.2, 0.35);
  const bg = new THREE.ExtrudeGeometry(prof, { depth: 1.72, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 }); bg.translate(0, 0, -0.86);
  g.add(mesh(bg, paint));
  const win = new THREE.Shape(); win.moveTo(0.95, 1.0); win.lineTo(0.44, 1.43); win.lineTo(-1.25, 1.45); win.lineTo(-1.85, 1.05); win.lineTo(0.95, 1.0);
  const wg = new THREE.ExtrudeGeometry(win, { depth: 1.8, bevelEnabled: false }); wg.translate(0, 0, -0.9); const wm = mesh(wg, glass); wm.scale.set(0.98, 1, 1); g.add(wm);
  for (const [x, z] of [[-1.4, 0.82], [1.35, 0.82], [-1.4, -0.82], [1.35, -0.82]]) {
    const w = new THREE.Group(); w.position.set(x, 0.34, z);
    const tire = mesh(new THREE.TorusGeometry(0.26, 0.09, 10, 24), rubber); w.add(tire);
    const rim = cylZ(0.2, 0.2, 0.16, std(0x9aa0a8, 0.3, 0.9), 0, 20); w.add(rim);
    g.add(w);
  }
  for (const z of [-0.6, 0.6]) { g.add(box(0.06, 0.12, 0.3, std(0x300404, 0.4, 0.1, { emissive: 0x400000 }), -2.23, 0.8, z)); g.add(box(0.06, 0.12, 0.35, std(0xdde4ea, 0.2, 0.3), 2.2, 0.7, z)); }
  void rnd;
  return g;
}
// clumps of grass blades, instanced and swaying in the wind (uniform `time` drives the sway)
export function grassField(n, rMin, rMax, rnd, pal, heightAt, avoid = () => false, maxH = 0.32) {
  const [r0, r1] = pal; // root and tip colours (0–255)
  const S = 64, c = document.createElement('canvas'); c.width = S; c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#fff';
  for (let i = 0; i < 22; i++) {
    const x = 6 + rnd() * 52, w = 1.4 + rnd() * 1.8, h = 28 + rnd() * 36, lean = (rnd() - 0.5) * 14;
    g.beginPath(); g.moveTo(x - w, S); g.quadraticCurveTo(x + lean * 0.3, S - h * 0.6, x + lean, S - h); g.lineTo(x + w, S); g.fill();
  }
  const src = g.getImageData(0, 0, S, S).data; const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, oi = ((S - 1 - y) * S + x) * 4, f = 1 - y / S; // darker at the roots
    for (let c = 0; c < 3; c++) data[oi + c] = r0[c] + (r1[c] - r0[c]) * (1 - f); data[oi + 3] = src[i + 3];
  }
  const tex = new THREE.DataTexture(data, S, S); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  const p1 = new THREE.PlaneGeometry(0.42, maxH); p1.translate(0, maxH / 2, 0);
  const p2 = p1.clone(); p2.rotateY(Math.PI / 3); const p3 = p1.clone(); p3.rotateY(-Math.PI / 3);
  const geo = mergeSimple([p1, p2, p3]);
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4 });
  const time = { value: 0 };
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;
        float k = position.y / ${maxH.toFixed(3)};
        transformed.x += sin(uTime * 1.6 + ph) * 0.05 * k * k;
        transformed.z += cos(uTime * 1.1 + ph * 1.3) * 0.035 * k * k;
      #endif`);
  };
  const im = new THREE.InstancedMesh(geo, mat, n); im.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V(1, 1, 1), tint = new THREE.Color();
  let k = 0;
  for (let i = 0; i < n * 3 && k < n; i++) {
    const a = rnd() * Math.PI * 2, d = rMin + (rMax - rMin) * Math.pow(rnd(), 1.45);
    const x = Math.cos(a) * d, z = Math.sin(a) * d; if (avoid(x, z)) continue;
    q.setFromAxisAngle(UP, rnd() * 6.28); const sc = 0.6 + rnd() * 0.8; s.set(sc, sc * (0.7 + rnd() * 0.6), sc);
    m4.compose(V(x, heightAt(x, z) - 0.01, z), q, s); im.setMatrixAt(k, m4);
    const b = 0.75 + rnd() * 0.45; tint.setRGB(b * (0.95 + rnd() * 0.12), b, b * (0.9 + rnd() * 0.1)); im.setColorAt(k++, tint);
  }
  im.count = k; im.frustumCulled = false;
  return { mesh: im, time };
}
function mergeSimple(geos) {
  const pos = [], nor = [], uv = [], idx = []; let off = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(0, 1, 0); uv.push(u.getX(i), u.getY(i)); }
    // both windings, both with upward normals, so the back of a blade is lit like the front
    const ix = g.index.array; for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off); for (let i = 0; i < ix.length; i += 3) idx.push(ix[i] + off, ix[i + 2] + off, ix[i + 1] + off); off += p.count; void n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); out.setIndex(idx);
  return out;
}
export const seeded = (s) => mulberry32(hashStr(s));
