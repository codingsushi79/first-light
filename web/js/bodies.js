// Solar-system bodies for the imaging worker: procedural surface maps (Jupiter, Saturn, Mars,
// the Moon…) and a physically normalised disk renderer (phase, limb darkening, rings, moons,
// atmospheric dispersion). Fluxes come from the bodies' real visual magnitudes.
import * as A from './astro.js';
import { makeNoise, smoothstep, mulberry32 } from './util.js';

const D2R = Math.PI / 180;
const maps = {};
const MW = 512, MH = 256;

// noise that wraps smoothly in longitude (blend across the seam)
function lonNoise(nz, lon, lat, fx, fy, oct) {
  const x = (lon / 360) * fx;
  const a = nz.fbm(x, lat * fy, oct);
  if (lon < 330) return a;
  const b = nz.fbm(x - fx, lat * fy, oct);
  return a + (b - a) * smoothstep(330, 360, lon);
}

function makeMap(fn, w = MW, h = MH) {
  const rgb = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    const lat = 90 - (j + 0.5) * 180 / h;
    for (let i = 0; i < w; i++) {
      const lon = (i + 0.5) * 360 / w, c = fn(lat, lon), o = (j * w + i) * 3;
      rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
    }
  }
  return { w, h, rgb };
}
function sampleMap(m, lat, lon, out) {
  const fx = (A.norm360(lon) / 360) * m.w - 0.5, fy = ((90 - lat) / 180) * m.h - 0.5;
  let x0 = Math.floor(fx), y0 = Math.floor(fy); const u = fx - x0, v = fy - y0;
  y0 = Math.max(0, Math.min(m.h - 2, y0));
  const x1 = (x0 + 1 + m.w) % m.w; x0 = (x0 + m.w) % m.w;
  const a = (y0 * m.w + x0) * 3, b = (y0 * m.w + x1) * 3, c = ((y0 + 1) * m.w + x0) * 3, d = ((y0 + 1) * m.w + x1) * 3, r = m.rgb;
  for (let k = 0; k < 3; k++) out[k] = r[a + k] * (1 - u) * (1 - v) + r[b + k] * u * (1 - v) + r[c + k] * (1 - u) * v + r[d + k] * u * v;
  return out;
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---- Jupiter: zones & belts, festoons, the Great Red Spot (System II lon ~ 70°), white ovals
function jupiterMap() {
  const nz = makeNoise(9101), nz2 = makeNoise(77);
  const zone = [0.96, 0.9, 0.78], belt = [0.64, 0.46, 0.33], polar = [0.62, 0.6, 0.58];
  const bands = [[-90, -45, 0.55], [-45, -36, 0.7], [-36, -31, 0.3], [-31, -26, 0.8], [-26, -19.5, 0.08], [-19.5, -16.5, 0.95], [-16.5, -8, 1.0], [-8, -2, 0.12], [-2, 6.5, 0.0], [6.5, 9, 0.85], [9, 17, 1.0], [17, 23, 0.05], [23, 29, 0.65], [29, 34, 0.15], [34, 42, 0.5], [42, 90, 0.55]];
  return makeMap((lat, lon) => {
    const wob = (lonNoise(nz, lon, lat, 24, 0.25, 4) - 0.5) * 3.2;
    const L = lat + wob;
    let d = 0;
    for (const [a, b, v] of bands) if (L >= a && L < b) { const e = Math.min(L - a, b - L); d = v; if (e < 1.5) { d = v; } break; }
    // soft edges by sampling neighbours
    let acc = 0, wsum = 0;
    for (const off of [-1.4, -0.7, 0, 0.7, 1.4]) { const q = L + off; for (const [a, b, v] of bands) if (q >= a && q < b) { acc += v; wsum++; break; } }
    d = wsum ? acc / wsum : d;
    const turb = lonNoise(nz2, lon, lat, 90, 0.9, 5);
    d = Math.max(0, Math.min(1, d + (turb - 0.5) * 0.45 * (Math.abs(lat) < 35 ? 1 : 0.5)));
    let c = mix(zone, belt, d);
    if (Math.abs(lat) > 42) c = mix(c, polar, smoothstep(42, 70, Math.abs(lat)) * 0.8);
    // festoons: dark blue-grey wisps at the north edge of the equatorial zone
    if (lat > 2 && lat < 8) { const f = smoothstep(0.62, 0.8, lonNoise(nz, lon * 3, lat, 40, 0.5, 3)); c = mix(c, [0.42, 0.42, 0.48], f * 0.75); }
    // Great Red Spot
    const dl = A.norm180(lon - 70) / 11.5, db = (lat + 22.5) / 5.6, rr = dl * dl + db * db;
    if (rr < 1.6) { c = mix(c, [0.98, 0.95, 0.88], smoothstep(1.6, 1.15, rr) * 0.8); c = mix(c, [0.82, 0.5, 0.36], smoothstep(1.0, 0.25, rr)); }
    // white ovals in the south temperate belt
    for (const ol of [150, 205, 300]) { const q = (A.norm180(lon - ol) / 3.2) ** 2 + ((lat + 33) / 2.2) ** 2; if (q < 1) c = mix(c, [0.97, 0.95, 0.92], smoothstep(1, 0.2, q)); }
    return c;
  });
}
function saturnMap() {
  const nz = makeNoise(4242);
  return makeMap((lat, lon) => {
    const L = lat + (lonNoise(nz, lon, lat, 16, 0.3, 3) - 0.5) * 1.5;
    const s = Math.sin(L * D2R * 9) * 0.5 + 0.5, a = Math.abs(L);
    let c = mix([0.96, 0.89, 0.7], [0.82, 0.7, 0.5], s * 0.35 + smoothstep(18, 40, a) * 0.25);
    c = mix(c, [0.63, 0.66, 0.68], smoothstep(55, 85, a) * 0.8); // grey-blue polar regions
    if (a < 6) c = mix(c, [0.98, 0.93, 0.78], 0.5);
    return c;
  });
}
function marsMap() {
  const nz = makeNoise(1877), nz2 = makeNoise(555);
  const dark = [ // lat, east-lon, radius deg — classical albedo features
    [10, 69, 14], [45, -30, 15], [-25, -40, 22], [-20, 20, 18], [-30, 100, 25], [-10, 130, 12], [20, -100, 8], [-50, 0, 20], [5, 0, 10]];
  return makeMap((lat, lon) => {
    let d = 0;
    for (const [la, lo, r] of dark) {
      const dd = A.sep(lo, la, 360 - lon, lat) / r; d = Math.max(d, smoothstep(1.3, 0.3, dd + (nz.fbm((lon / 360) * 20, lat * 0.12, 4) - 0.5) * 0.9));
    }
    d = Math.max(0, Math.min(1, d * 0.85 + (lonNoise(nz2, lon, lat, 50, 0.4, 5) - 0.5) * 0.35));
    let c = mix([0.95, 0.56, 0.33], [0.42, 0.3, 0.24], d);
    const hellas = A.sep(70, -42, 360 - lon, lat); if (hellas < 18) c = mix(c, [0.98, 0.78, 0.6], smoothstep(18, 8, hellas) * 0.6);
    const cap = Math.max(smoothstep(78, 84, lat + (nz.noise(lon * 0.08, 3) - 0.5) * 4), smoothstep(-80, -86, lat));
    return mix(c, [1, 0.98, 0.96], cap);
  });
}
function plainMap(base, var1, seed, f = 6) {
  const nz = makeNoise(seed);
  return makeMap((lat, lon) => { const n = lonNoise(nz, lon, lat, f, 0.1, 4) - 0.5; return [base[0] * (1 + n * var1), base[1] * (1 + n * var1), base[2] * (1 + n * var1)]; });
}

// ---- The Moon: maria at their real selenographic positions, cratered height map, ray systems
const MARIA = [ // lat, lon(E+), radius km, elongation [dlat scale]
  [18, -57, 900, 1.6], [33, -16, 560, 1], [28, 17, 350, 1], [8.5, 31, 430, 1.1], [17, 59, 270, 1.2], [-8, 51, 420, 1.3], [-15, 35, 170, 1],
  [-21, -17, 360, 1], [-24, -39, 190, 1], [-10, -23, 200, 1], [13, 4, 120, 1], [7, -31, 260, 1], [-5, -45, 380, 1.3], [-25, -52, 260, 1], [47, -25, 200, 2.2], [56, 5, 300, 3.5], [20, 26, 160, 1]];
const CRATERS = [ // lat, lon, radius km, ray strength, floor albedo
  [-43.3, -11.2, 43, 1.0, 1.25], [9.6, -20.1, 47, 0.7, 1.1], [8.1, -38.0, 16, 0.45, 1.2], [23.7, -47.4, 20, 0.3, 1.6], [51.6, -9.4, 50, 0, 0.6],
  [-58.4, -14.4, 115, 0, 1], [-9.3, -1.9, 77, 0, 0.95], [-11.4, 26.4, 50, 0, 1.1], [-8.9, 61.1, 66, 0.1, 1.1], [-25.3, 60.4, 88, 0, 1], [-5.2, -68.6, 87, 0, 0.55],
  [-8.1, 46.1, 4, 0.25, 1.4], [-20.2, 13.2, 23, 0.2, 1.2], [47.4, 6.2, 43, 0, 1], [26.3, 4.2, 30, 0, 1], [-12.0, -1.0, 15, 0, 1], [-29.5, 30.2, 50, 0, 1], [-37, -77, 75, 0, 1]];
function moonMaps() {
  const w = 2048, h = 1024;
  const alb = new Float32Array(w * h), hgt = new Float32Array(w * h);
  const nz = makeNoise(3141), nz2 = makeNoise(2718);
  const R = 1737.4, kmPerDeg = (Math.PI * R) / 180;
  for (let j = 0; j < h; j++) {
    const lat = 90 - (j + 0.5) * 180 / h;
    for (let i = 0; i < w; i++) {
      const lon = (i + 0.5) * 360 / w - 180;
      let mare = 0;
      for (const [la, lo, r, el] of MARIA) {
        const dLat = (lat - la) * kmPerDeg / el, dLon = A.norm180(lon - lo) * kmPerDeg * Math.cos(lat * D2R);
        const d = Math.hypot(dLat, dLon) / r; if (d > 1.5) continue;
        const edge = (nz.fbm(lon * 0.06 + 40, lat * 0.06, 4) - 0.5) * 0.7;
        mare = Math.max(mare, smoothstep(1.05, 0.8, d + edge));
      }
      const hl = 0.95 + (nz2.fbm(lon * 0.08, lat * 0.08, 5) - 0.5) * 0.35;
      alb[j * w + i] = mare > 0 ? hl * (1 - 0.48 * mare) + (nz.noise(lon * 0.4, lat * 0.4) - 0.5) * 0.04 * mare : hl;
      hgt[j * w + i] = -mare * 0.6 + (nz2.fbm(lon * 0.5, lat * 0.5, 4) - 0.5) * 0.5;
    }
  }
  // craters: power-law sizes, more on the highlands
  const rnd = mulberry32(99);
  const stamp = (la, lo, rkm, floorAlb = 1) => {
    const rDeg = rkm / kmPerDeg, rLat = rDeg * 1.6, rLon = Math.min(180, rLat / Math.max(0.05, Math.cos(la * D2R)));
    const j0 = Math.max(0, Math.floor((90 - la - rLat) / 180 * h)), j1 = Math.min(h - 1, Math.ceil((90 - la + rLat) / 180 * h));
    const depth = Math.min(4, 0.9 * Math.pow(rkm, 0.55));
    for (let j = j0; j <= j1; j++) {
      const lat = 90 - (j + 0.5) * 180 / h;
      const n = Math.ceil(rLon / 360 * w) + 1, ic = Math.floor((lo + 180) / 360 * w);
      for (let q = -n; q <= n; q++) {
        const i = ((ic + q) % w + w) % w, lon = (i + 0.5) * 360 / w - 180;
        const d = Math.hypot(lat - la, A.norm180(lon - lo) * Math.cos(lat * D2R)) / rDeg; if (d > 1.6) continue;
        const k = j * w + i;
        if (d < 1) { hgt[k] += -depth * (1 - d * d) + depth * 0.25 * smoothstep(0.75, 1, d); if (floorAlb !== 1) alb[k] *= 1 + (floorAlb - 1) * smoothstep(0.9, 0.6, d); }
        else hgt[k] += depth * 0.35 * Math.pow(1 - (d - 1) / 0.6, 2);
      }
    }
  };
  for (let c = 0; c < 2600; c++) {
    const la = Math.asin(rnd() * 2 - 1) / D2R, lo = rnd() * 360 - 180;
    const rk = 6 * Math.pow(rnd(), -0.55); if (rk > 140) continue;
    const i = Math.floor((lo + 180) / 360 * w), j = Math.floor((90 - la) / 180 * h);
    if (alb[j * w + i] < 0.7 && rnd() < 0.75) continue; // maria are younger: fewer craters
    stamp(la, lo, rk);
  }
  for (const [la, lo, r, , fa] of CRATERS) stamp(la, lo, r, fa);
  // ray systems
  for (const [la, lo, r, ray] of CRATERS) {
    if (!ray) continue;
    const rr = mulberry32(Math.round(la * 100 + lo));
    const spokes = Array.from({ length: 28 }, () => [rr() * Math.PI * 2, 0.4 + rr() * 0.8, 0.02 + rr() * 0.05]);
    const reach = r * 30;
    for (let j = 0; j < h; j++) {
      const lat = 90 - (j + 0.5) * 180 / h;
      if (Math.abs(lat - la) * kmPerDeg > reach) continue;
      for (let i = 0; i < w; i++) {
        const lon = (i + 0.5) * 360 / w - 180;
        const dy = (lat - la) * kmPerDeg, dx = A.norm180(lon - lo) * kmPerDeg * Math.cos(lat * D2R), d = Math.hypot(dx, dy);
        if (d > reach || d < r) continue;
        const th = Math.atan2(dy, dx); let s = 0;
        for (const [a, len, wd] of spokes) { const da = Math.abs(A.norm180((th - a) / D2R)) * D2R; if (d < reach * len) s = Math.max(s, Math.exp(-(da * da) / (wd * wd))); }
        alb[j * w + i] *= 1 + ray * 0.45 * s * Math.exp(-d / (reach * 0.45)) + ray * 0.4 * Math.exp(-(((d - r) / (r * 1.2)) ** 2));
      }
    }
  }
  return { w, h, alb, hgt, kmPx: (2 * Math.PI * R) / w };
}
function sampleMoon(m, lat, lon, out) {
  const fx = ((A.norm180(lon) + 180) / 360) * m.w - 0.5, fy = ((90 - lat) / 180) * m.h - 0.5;
  let x0 = Math.floor(fx), y0 = Math.max(0, Math.min(m.h - 2, Math.floor(fy))); const u = fx - x0, v = Math.max(0, Math.min(1, fy - y0));
  const x1 = (x0 + 1 + m.w) % m.w; x0 = (x0 + m.w) % m.w;
  const i00 = y0 * m.w + x0, i10 = y0 * m.w + x1, i01 = i00 + m.w, i11 = i10 + m.w;
  out[0] = m.alb[i00] * (1 - u) * (1 - v) + m.alb[i10] * u * (1 - v) + m.alb[i01] * (1 - u) * v + m.alb[i11] * u * v;
  // height gradient (east, north) in height units per pixel
  out[1] = (m.hgt[i10] - m.hgt[i00]) * (1 - v) + (m.hgt[i11] - m.hgt[i01]) * v;
  out[2] = (m.hgt[i00] - m.hgt[i01]) * (1 - u) + (m.hgt[i10] - m.hgt[i11]) * u;
  return out;
}

function getMap(name) {
  if (maps[name]) return maps[name];
  const mk = { Jupiter: jupiterMap, Saturn: saturnMap, Mars: marsMap, Moon: moonMaps, Venus: () => plainMap([1, 0.96, 0.86], 0.04, 5), Mercury: () => plainMap([0.75, 0.72, 0.68], 0.35, 6, 14), Uranus: () => plainMap([0.72, 0.93, 0.98], 0.03, 7), Neptune: () => plainMap([0.5, 0.66, 1], 0.08, 8) }[name];
  maps[name] = mk ? mk() : plainMap([1, 1, 1], 0, 1);
  return maps[name];
}

// Intensity of a body at sky offset (e, n) in body radii (east, north). Returns relative RGB radiance (0 = off-body).
function makeShader(b) {
  const map = getMap(b.name);
  const isMoon = b.name === 'Moon';
  const B = b.subLat * D2R, pa = b.polePA * D2R;
  // pole and sub-observer frame in (e, n, z→observer)
  const p = [Math.cos(B) * Math.sin(pa), Math.cos(B) * Math.cos(pa), Math.sin(B)];
  const z = [0, 0, 1];
  let m0 = [z[0] - p[2] * p[0], z[1] - p[2] * p[1], z[2] - p[2] * p[2]]; const ml = Math.hypot(...m0) || 1; m0 = m0.map((x) => x / ml);
  const q = [p[1] * m0[2] - p[2] * m0[1], p[2] * m0[0] - p[0] * m0[2], p[0] * m0[1] - p[1] * m0[0]]; // east-on-body at the CM
  // direction to the Sun
  const al = b.alpha * D2R, lp = b.limbPA * D2R;
  const s = [Math.sin(al) * Math.sin(lp), Math.sin(al) * Math.cos(lp), Math.cos(al)];
  const flat = b.flat || 0, squash = 1 - flat * Math.cos(B) ** 2;
  const ax = [Math.sin(pa), Math.cos(pa)]; // projected pole axis on the sky
  const k = { Jupiter: 0.88, Saturn: 0.9, Uranus: 0.85, Neptune: 0.85, Mars: 0.75, Venus: 0.65, Mercury: 0.7 }[b.name] || 0.8;
  const tmp = [0, 0, 0];
  const ringed = b.name === 'Saturn';
  const ringAlb = (r) => (r < 1.24 ? 0 : r < 1.53 ? 0.12 : r < 1.95 ? 0.95 - 0.25 * Math.abs(r - 1.75) : r < 2.03 ? 0.04 : r < 2.27 ? (Math.abs(r - 2.214) < 0.006 ? 0.1 : 0.62) : 0);
  const ringOp = (r) => (r < 1.24 ? 0 : r < 1.53 ? 0.12 : r < 1.95 ? 0.92 : r < 2.03 ? 0.05 : r < 2.27 ? 0.6 : 0);
  const ringLight = Math.min(1, 0.25 + 3.2 * Math.abs(Math.sin(B)));
  const col = b.col;
  // Galilean moon shadows on Jupiter's cloud tops (cast along the Sun's direction)
  const shadows = [];
  if (b.moons) {
    const th = b.polePA * D2R, ta = Math.tan(al);
    for (const m of b.moons) {
      const e0 = m.x * -Math.cos(th) + m.y * Math.sin(th), n0 = m.x * Math.sin(th) + m.y * Math.cos(th);
      const se = e0 - m.z * ta * Math.sin(lp), sn = n0 - m.z * ta * Math.cos(lp);
      if (se * se + sn * sn < 1.05 && m.z > -2) shadows.push([se, sn, { Io: 0.0255, Europa: 0.0218, Ganymede: 0.0368, Callisto: 0.0337 }[m.name] * 1.15]);
    }
  }
  return function shade(e, n, out) {
    out[0] = out[1] = out[2] = 0;
    for (const [se, sn, sr] of shadows) { const d = Math.hypot(e - se, n - sn) / sr; if (d < 1.25) { const k = d < 0.8 ? 0.03 : 0.03 + 0.97 * (d - 0.8) / 0.45; if (k < 1) { const r = shade0(e, n, out); out[0] = r[0] * k; out[1] = r[1] * k; out[2] = r[2] * k; return out; } } }
    return shade0(e, n, out);
  };
  function shade0(e, n, out) {
    out[0] = out[1] = out[2] = 0;
    // oblate globe: stretch along the projected pole
    const a = e * ax[0] + n * ax[1], c = e * ax[1] - n * ax[0];
    const a2 = a / squash, r2 = a2 * a2 + c * c;
    let globe = false, gz = -9;
    if (r2 < 1) {
      globe = true; gz = Math.sqrt(1 - r2);
      const E = e + (a2 - a) * ax[0], N = n + (a2 - a) * ax[1]; // normal on the unit sphere
      const nx = E, ny = N, nzv = gz;
      const mu = nzv, mu0 = nx * s[0] + ny * s[1] + nzv * s[2];
      if (mu0 > 0) {
        const lat = Math.asin(Math.max(-1, Math.min(1, nx * p[0] + ny * p[1] + nzv * p[2]))) / D2R;
        const lon = Math.atan2(nx * q[0] + ny * q[1] + nzv * q[2], nx * m0[0] + ny * m0[1] + nzv * m0[2]) / D2R;
        if (isMoon) {
          sampleMoon(map, lat, -lon, tmp); // selenographic east is toward the sky's west
          // perturb the normal by the height-map slope (km/km) for terminator relief
          const relief = 1.6 / map.kmPx;
          let ex = [p[1] * nzv - p[2] * ny, p[2] * nx - p[0] * nzv, p[0] * ny - p[1] * nx]; // local sky-east tangent
          const el = Math.hypot(...ex) || 1; ex = [ex[0] / el, ex[1] / el, ex[2] / el];
          const no = [ny * ex[2] - nzv * ex[1], nzv * ex[0] - nx * ex[2], nx * ex[1] - ny * ex[0]]; // local north tangent
          const ge = -tmp[1] * relief, gn = tmp[2] * relief; // map east = sky west
          const nlocal = [nx - ge * ex[0] - gn * no[0], ny - ge * ex[1] - gn * no[1], nzv - ge * ex[2] - gn * no[2]];
          const nl = Math.hypot(...nlocal);
          const m0p = Math.max(0, (nlocal[0] * s[0] + nlocal[1] * s[1] + nlocal[2] * s[2]) / nl);
          const ls = m0p / (m0p + mu + 1e-3) * (1 + 0.7 * Math.exp(-b.alpha / 6)); // Lommel–Seeliger + opposition surge
          const v = tmp[0] * ls;
          out[0] = v * col[0]; out[1] = v * col[1]; out[2] = v * col[2];
        } else {
          sampleMap(map, lat, A.norm360(b.cm - lon), tmp);
          const v = Math.pow(mu0, k) * Math.pow(Math.max(mu, 0.02), k - 1);
          out[0] = tmp[0] * v * col[0]; out[1] = tmp[1] * v * col[1]; out[2] = tmp[2] * v * col[2];
        }
      }
    }
    if (ringed && Math.abs(p[2]) > 1e-4) {
      const zr = -(p[0] * e + p[1] * n) / p[2];
      const rr = Math.hypot(e, n, zr), alb = ringAlb(rr);
      if (alb > 0) {
        const front = !globe || zr > gz;
        // globe shadow on the rings (behind the planet, opposite the Sun)
        let lit = ringLight;
        const along = e * s[0] + n * s[1] + zr * s[2];
        if (along < 0 && Math.hypot(e - along * s[0], n - along * s[1], zr - along * s[2]) < 1) lit *= 0.04;
        if (front) {
          const op = ringOp(rr);
          for (let i = 0; i < 3; i++) out[i] = out[i] * (1 - op) + alb * lit * [0.93, 0.86, 0.72][i] * 0.95;
        }
      }
    }
    return out;
  }
}

// --- main entry: deposit bodies into the object electron arrays (before the PSF) ---
// ctx: { W, H, nc, mono, scale, toPix(ra,dec,pathPt) -> [x,y], pathAt, rand, gauss, flt, qeBand, qe, photons (area*thr*t), extAt(c, alt), transAt(x,y), altAt(x,y), zenPA, adc, lucky }
export function drawBodies(objE, bodies, ctx) {
  const { W, H, nc, scale } = ctx;
  const info = [];
  for (const b of bodies) {
    const sub = [b];
    if (b.moons) for (const m of b.moons) if (!m.hidden && !(m.z > 0 && Math.hypot(m.x, m.y) < 1.0)) sub.push({ name: m.name, sat: true, parent: b, x: m.x, y: m.y, mag: m.mag, diam: b.diam * { Io: 0.0255, Europa: 0.0218, Ganymede: 0.0368, Callisto: 0.0337 }[m.name], col: m.name === 'Io' ? [1, 0.92, 0.7] : [0.95, 0.93, 0.9], alpha: b.alpha, limbPA: b.limbPA, polePA: 0, subLat: 0, cm: 0 });
    for (const body of sub) drawOne(objE, body, ctx, info);
  }
  void W; void H; void nc; void scale;
  return info;
}

function drawOne(objE, b, ctx, info) {
  const { W, H, nc, mono, scale, flt } = ctx;
  // sky position (moons are offsets from their planet in equatorial radii)
  let ra = b.ra, dec = b.dec;
  if (b.sat) {
    const P = b.parent, th = P.polePA * D2R, rArc = P.diam / 2 / 3600;
    const eOff = (b.x * -Math.cos(th) + b.y * Math.sin(th)) * rArc, nOff = (b.x * Math.sin(th) + b.y * Math.cos(th)) * rArc;
    const pt = A.offsetPA(P.ra, P.dec, Math.hypot(eOff, nOff), Math.atan2(eOff, nOff) / D2R);
    ra = pt.ra; dec = pt.dec;
  }
  const [x0, y0] = ctx.toPix(ra, dec, ctx.pathAt(0.5));
  const rPix = b.diam / 2 / scale;
  const ext = (b.name === 'Saturn' ? 2.35 : 1.05) * rPix + 3;
  // path extent (pixels)
  let pext = 0; const nPath = 9; const pts = [];
  for (let i = 0; i < nPath; i++) { const p = ctx.toPix(ra, dec, ctx.pathAt(nPath === 1 ? 0.5 : i / (nPath - 1))); pts.push([p[0] - x0, p[1] - y0]); pext = Math.max(pext, Math.hypot(p[0] - x0, p[1] - y0)); }
  if (x0 + ext + pext < -2 || y0 + ext + pext < -2 || x0 - ext - pext > W + 2 || y0 - ext - pext > H + 2) return;
  // total electrons per channel from the visual magnitude
  const alt = ctx.altAt(Math.max(0, Math.min(W - 1, x0)), Math.max(0, Math.min(H - 1, y0)));
  const trans = ctx.transAt(Math.max(0, Math.min(W - 1, x0)), Math.max(0, Math.min(H - 1, y0)));
  if (alt < -1) return;
  const phot = 1.0e6 * Math.pow(10, -0.4 * b.mag) * ctx.photons * trans;
  const cn = [b.col[0] / b.col[1], 1, b.col[2] / b.col[1]];
  const tot = [];
  if (mono) { let s = 0; for (let c = 0; c < 3; c++) s += (flt ? flt.cont[c] : 1) * cn[c] * ctx.extAt(c, alt); tot.push(phot * s * ctx.qe); }
  else for (let c = 0; c < 3; c++) tot.push(phot * (flt ? flt.cont[c] : 1) * cn[c] * ctx.extAt(c, alt) * ctx.qeBand[c]);
  info.push({ name: b.name, x: x0, y: y0, rPix, e: tot.reduce((a, v) => a + v, 0) });
  // atmospheric dispersion: blue lifted toward the zenith, red pushed down (arcsec, R–B ≈ 1.5·tan z)
  const disp = ctx.adc || mono ? 0 : 1.5 * Math.tan(Math.min(85, 90 - Math.max(alt, 3)) * D2R) / scale;
  const zp = ctx.zenDir(ra, dec); // unit vector toward the zenith in frame pixels
  const chShift = [[-zp[0] * disp * 0.45, -zp[1] * disp * 0.45], [0, 0], [zp[0] * disp * 0.55, zp[1] * disp * 0.55]];
  // short-exposure seeing: tip-tilt image motion is already in the tracking path
  if (rPix < 0.6) { // point source
    for (let c = 0; c < nc; c++) {
      const cc = mono ? 0 : c;
      for (const [dx, dy] of pts) depositPoint(objE[c], W, H, x0 + dx + chShift[mono ? 1 : cc][0], y0 + dy + chShift[mono ? 1 : cc][1], tot[c] / nPath);
    }
    return;
  }
  // radiance map over the visible region (in frame pixels around x0,y0)
  const shade = makeShader(b);
  const rArcPx = rPix; // pixels per body radius
  const X0 = Math.max(Math.floor(x0 - ext - pext - 2), -2), X1 = Math.min(Math.ceil(x0 + ext + pext + 2), W + 1);
  const Y0 = Math.max(Math.floor(y0 - ext - pext - 2), -2), Y1 = Math.min(Math.ceil(y0 + ext + pext + 2), H + 1);
  const LW = X1 - X0 + 1, LH = Y1 - Y0 + 1;
  if (LW <= 0 || LH <= 0 || LW * LH > 2.2e7) return;
  const ss = rPix < 6 ? 4 : rPix < 25 ? 2 : 1;
  // frame → sky orientation (pixel x is west, y south after rotation th)
  const ue = ctx.pixToEN; // (dx, dy) pixels → [east, north] arcsec
  const loc = [new Float32Array(LW * LH), new Float32Array(LW * LH), new Float32Array(LW * LH)];
  const tmp = [0, 0, 0];
  for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) {
    let r = 0, g = 0, bl = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const dx = X0 + i + (sx + 0.5) / ss - 0.5 - x0, dy = Y0 + j + (sy + 0.5) / ss - 0.5 - y0;
      const en = ue(dx, dy);
      const e = en[0] / scale / rArcPx, n = en[1] / scale / rArcPx;
      if (e * e + n * n > 6) continue;
      shade(e, n, tmp); r += tmp[0]; g += tmp[1]; bl += tmp[2];
    }
    const k = j * LW + i, f = 1 / (ss * ss);
    loc[0][k] = r * f; loc[1][k] = g * f; loc[2][k] = bl * f;
  }
  // normalisation: integral of the radiance over the whole body (coarse grid, independent of framing)
  const S = [0, 0, 0]; const G = 140, d = 4.8 / G;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { shade(-2.4 + (i + 0.5) * d, -2.4 + (j + 0.5) * d, tmp); S[0] += tmp[0]; S[1] += tmp[1]; S[2] += tmp[2]; }
  const pxArea = 1 / (rArcPx * rArcPx); // body-radius² per pixel
  for (let c = 0; c < 3; c++) S[c] = S[c] * d * d / pxArea; // = sum over pixels
  // deposit along the path (bilinear shifts), per channel
  for (let c = 0; c < nc; c++) {
    const srcC = mono ? null : loc[c];
    const norm = mono ? tot[0] / Math.max(1e-9, S[0] + S[1] + S[2]) : tot[c] / Math.max(1e-9, S[c]);
    const sh = chShift[mono ? 1 : c];
    for (const [pdx, pdy] of pts) {
      const ox = pdx + sh[0], oy = pdy + sh[1], ix = Math.floor(ox), iy = Math.floor(oy), fx = ox - ix, fy = oy - iy;
      const w = norm / pts.length;
      const a = objE[c];
      for (let j = 0; j < LH; j++) {
        for (let i = 0; i < LW; i++) {
          const k = j * LW + i;
          const v = (mono ? loc[0][k] + loc[1][k] + loc[2][k] : srcC[k]) * w; if (!v) continue;
          const X = X0 + i + ix, Y = Y0 + j + iy;
          if (X >= 0 && Y >= 0 && X < W && Y < H) a[Y * W + X] += v * (1 - fx) * (1 - fy);
          if (X + 1 >= 0 && Y >= 0 && X + 1 < W && Y < H) a[Y * W + X + 1] += v * fx * (1 - fy);
          if (X >= 0 && Y + 1 >= 0 && X < W && Y + 1 < H) a[(Y + 1) * W + X] += v * (1 - fx) * fy;
          if (X + 1 >= 0 && Y + 1 >= 0 && X + 1 < W && Y + 1 < H) a[(Y + 1) * W + X + 1] += v * fx * fy;
        }
      }
    }
  }
}
function depositPoint(a, W, H, x, y, v) {
  const ix = Math.floor(x - 0.5), iy = Math.floor(y - 0.5), fx = x - 0.5 - ix, fy = y - 0.5 - iy;
  const put = (X, Y, w) => { if (X >= 0 && Y >= 0 && X < W && Y < H) a[Y * W + X] += v * w; };
  put(ix, iy, (1 - fx) * (1 - fy)); put(ix + 1, iy, fx * (1 - fy)); put(ix, iy + 1, (1 - fx) * fy); put(ix + 1, iy + 1, fx * fy);
}

// Lucky imaging: effective residual seeing after keeping the best `frac` of frames (with multi-point alignment)
export function luckySeeing(seeing, Dmm, frac) {
  const r0cm = 10.1 / Math.max(0.3, seeing); // Fried parameter at 500 nm
  const DoR = Dmm / 10 / r0cm;
  const tilt = 1 - Math.exp(-DoR / 3); // small apertures see mostly tip-tilt, which alignment removes
  return seeing * tilt * (0.22 + 0.55 * Math.sqrt(Math.max(0.005, Math.min(1, frac))));
}
