// Planets, Jupiter's Galilean moons and the Moon's appearance.
// Positions: JPL approximate Keplerian elements (Standish, valid 1800–2050), ~arcminute accuracy.
// Galilean moons: Meeus, Astronomical Algorithms ch. 44 (low accuracy). Orientation: IAU pole/rotation.
import * as A from './astro.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI, AU_KM = 149597870.7;
// a, e, I, L, varpi, Omega  (J2000) and their rates per Julian century
const EL = {
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  Venus: [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  Earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  Mars: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  Saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  Uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};
// equatorial radius km, IAU pole RA/Dec (deg), prime meridian W0 and rate (deg/day), colour (r,g,b), magnitude model
export const PHYS = {
  Mercury: { R: 2439.7, pole: [281.01, 61.45], W: [329.5469, 6.1385025], col: [0.8, 0.76, 0.7] },
  Venus: { R: 6051.8, pole: [272.76, 67.16], W: [160.20, -1.4813688], col: [1.0, 0.95, 0.82] },
  Mars: { R: 3396.2, pole: [317.681, 52.887], W: [176.630, 350.89198226], col: [1.0, 0.62, 0.38] },
  Jupiter: { R: 71492, pole: [268.057, 64.495], W: [43.3, 870.27], col: [1.0, 0.9, 0.76], flat: 0.0649 },
  Saturn: { R: 60268, pole: [40.589, 83.537], W: [38.90, 810.7939024], col: [1.0, 0.9, 0.68], flat: 0.098 },
  Uranus: { R: 25559, pole: [257.311, -15.175], W: [203.81, -501.1600928], col: [0.7, 0.92, 1.0] },
  Neptune: { R: 24764, pole: [299.36, 43.46], W: [253.18, 536.3128492], col: [0.55, 0.7, 1.0] },
};
export const PLANET_NAMES = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

function helio(name, T) {
  const [e0, r] = EL[name];
  const a = e0[0] + r[0] * T, e = e0[1] + r[1] * T, I = (e0[2] + r[2] * T) * D2R, L = e0[3] + r[3] * T, vp = e0[4] + r[4] * T, Om = e0[5] + r[5] * T;
  const w = (vp - Om) * D2R, O = Om * D2R;
  let M = A.norm180(L - vp) * D2R, E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, sw * sI * xp + cw * sI * yp];
}
const EPS = 23.43928 * D2R;
const eclToEq = ([x, y, z]) => [x, y * Math.cos(EPS) - z * Math.sin(EPS), y * Math.sin(EPS) + z * Math.cos(EPS)];
const unitRD = (ra, dec) => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.cos(dec * D2R) * Math.sin(ra * D2R), Math.sin(dec * D2R)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

// Sub-observer latitude & central-meridian longitude for a body (IAU frame), given the direction body→Earth.
function subObserver(phys, toEarthEq, d, lightDays) {
  const p = unitRD(phys.pole[0], phys.pole[1]);
  const Q = [Math.cos((phys.pole[0] + 90) * D2R), Math.sin((phys.pole[0] + 90) * D2R), 0];
  const e = norm(toEarthEq);
  const lat = Math.asin(Math.max(-1, Math.min(1, dot(e, p)))) * R2D;
  const eq = norm([e[0] - dot(e, p) * p[0], e[1] - dot(e, p) * p[1], e[2] - dot(e, p) * p[2]]);
  const lonFromNode = Math.atan2(dot(eq, cross(p, Q)), dot(eq, Q)) * R2D;
  const W = phys.W[0] + phys.W[1] * (d - lightDays);
  return { lat, cm: A.norm360(W - lonFromNode) };
}

export function planetInfo(name, ms) {
  const jd = A.jd(ms), d = jd - 2451545.0, T = d / 36525;
  const P = helio(name, T), Ea = helio('Earth', T);
  const g = [P[0] - Ea[0], P[1] - Ea[1], P[2] - Ea[2]];
  const geq = eclToEq(g); const delta = Math.hypot(...geq);
  const ra = A.norm360(Math.atan2(geq[1], geq[0]) * R2D), dec = Math.asin(geq[2] / delta) * R2D;
  const r = Math.hypot(...P), Re = Math.hypot(...Ea);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (r * r + delta * delta - Re * Re) / (2 * r * delta)))) * R2D; // phase angle
  const lr = 5 * Math.log10(r * delta);
  const mag = { Mercury: -0.42 + lr + 0.038 * alpha - 0.000273 * alpha ** 2 + 0.000002 * alpha ** 3, Venus: -4.40 + lr + 0.0009 * alpha + 0.000239 * alpha ** 2 - 0.00000065 * alpha ** 3, Mars: -1.52 + lr + 0.016 * alpha, Jupiter: -9.40 + lr + 0.005 * alpha, Saturn: -8.88 + lr + 0.044 * alpha, Uranus: -7.19 + lr, Neptune: -6.87 + lr }[name];
  const phys = PHYS[name];
  const diam = (2 * phys.R / (delta * AU_KM)) * 206265; // arcsec
  const sun = A.sunRaDec(ms);
  const limbPA = A.posAngle(ra, dec, sun.ra, sun.dec); // direction of the bright limb
  const polePA = A.posAngle(ra, dec, phys.pole[0], phys.pole[1]);
  const so = subObserver(phys, [-geq[0], -geq[1], -geq[2]], d, delta * 0.0057755);
  let m = mag;
  if (name === 'Saturn') { const sb = Math.sin(Math.abs(so.lat) * D2R); m += -2.6 * sb + 1.25 * sb * sb; } // rings
  const info = { name, ra, dec, delta, r, alpha, mag: m, diam, limbPA, polePA, subLat: so.lat, cm: so.cm, illum: (1 + Math.cos(alpha * D2R)) / 2, col: phys.col, flat: phys.flat || 0 };
  if (name === 'Jupiter') info.moons = galilean(d, delta, so.cm);
  return info;
}

// Galilean moons: offsets in Jupiter equatorial radii (x positive = west of Jupiter on the sky, y north)
function galilean(d, delta) {
  const V = 172.74 + 0.00111588 * d, M = 357.529 + 0.9856003 * d;
  const N = 20.020 + 0.0830853 * d + 0.329 * Math.sin(V * D2R), J = 66.115 + 0.9025179 * d - 0.329 * Math.sin(V * D2R);
  const Ac = 1.915 * Math.sin(M * D2R) + 0.020 * Math.sin(2 * M * D2R), B = 5.555 * Math.sin(N * D2R) + 0.168 * Math.sin(2 * N * D2R);
  const K = J + Ac - B, R = 1.00014 - 0.01671 * Math.cos(M * D2R) - 0.00014 * Math.cos(2 * M * D2R);
  const r = 5.20872 - 0.25208 * Math.cos(N * D2R) - 0.00611 * Math.cos(2 * N * D2R);
  const Dl = Math.sqrt(r * r + R * R - 2 * r * R * Math.cos(K * D2R));
  const psi = Math.asin(R * Math.sin(K * D2R) / Dl) * R2D;
  const t = d - Dl / 173;
  const u = [163.8069 + 203.4058646 * t, 358.4140 + 101.2916335 * t, 5.7176 + 50.2345180 * t, 224.8092 + 21.4879800 * t].map((x) => x + psi - B);
  const lam = 34.35 + 0.083091 * d + 0.329 * Math.sin(V * D2R) + B;
  const Ds = 3.12 * Math.sin((lam + 42.8) * D2R);
  const De = Ds - 2.22 * Math.sin(psi * D2R) * Math.cos((lam + 22) * D2R) - 1.30 * ((r - Dl) / Dl) * Math.sin((lam - 100.5) * D2R);
  const rad = [5.9057, 9.3966, 14.9883, 26.3627], names = ['Io', 'Europa', 'Ganymede', 'Callisto'], mags = [5.0, 5.3, 4.6, 5.6];
  void delta;
  return u.map((ui, i) => {
    const x = rad[i] * Math.sin(ui * D2R), y = -rad[i] * Math.cos(ui * D2R) * Math.sin(De * D2R);
    const behind = Math.cos(ui * D2R) < 0 && Math.hypot(x, y) < 1; // occulted by Jupiter
    return { name: names[i], x, y, z: rad[i] * Math.cos(ui * D2R), mag: mags[i], hidden: behind };
  });
}

export function moonInfo(ms) {
  const m = A.moonRaDec(ms); const ph = A.moonPhase(ms); const sun = A.sunRaDec(ms);
  return { name: 'Moon', ra: m.ra, dec: m.dec, delta: m.dist / AU_KM, alpha: ph.phaseAngle, mag: -12.7 + 0.026 * Math.abs(ph.phaseAngle) + 4e-9 * ph.phaseAngle ** 4, diam: (2 * 1737.4 / m.dist) * 206265, limbPA: A.posAngle(m.ra, m.dec, sun.ra, sun.dec), polePA: A.posAngle(m.ra, m.dec, 269.99, 66.54), subLat: 0, cm: 0, illum: ph.illum, col: [1, 0.97, 0.92], flat: 0 };
}

// All bodies (planets + Moon) with alt/az for an observer
export function allBodies(ms, lat, lon) {
  const L = A.lst(ms, lon);
  return [...PLANET_NAMES.map((n) => planetInfo(n, ms)), moonInfo(ms)].map((b) => ({ ...b, ...A.radec2altaz(b.ra, b.dec, L, lat) }));
}
