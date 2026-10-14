// Imaging simulation worker.
// Turns a frame "recipe" (pointing, optics, camera, exposure, environment, tracking path)
// into a raw sensor frame using real sky survey imagery as the photon source.
import * as A from './astro.js';
import { mulberry32, gaussFactory, makeNoise, hashStr, smoothstep } from './util.js';
import { horizonAlt } from './gear.js';

const HIPS_DSS = 'CDS/P/DSS2/color', HIPS_MEL = 'CDS/P/Mellinger/color';
const K_OBJ = 0.251;      // photons/s/cm²/arcsec² per band at survey flux F=1 (≈16.5 mag/arcsec²)
const PHI0 = 1.0e6;       // photons/s/cm² per band for a mag 0 source
const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) LUT[i] = Math.pow(i / 255, 2.5);

const skyCache = [];      // fetched survey images
const frameCache = new Map(); // id -> rendered frame (LRU)
let FRAME_CACHE_BUDGET = 260e6, frameCacheBytes = 0;
let starCat = [];         // fallback bright-star catalog
let offline = false;

// ---------- survey fetch ----------
async function fetchSurvey(ra, dec, fovDeg, N) {
  const hips = fovDeg > 28 ? HIPS_MEL : HIPS_DSS;
  const fov = Math.min(fovDeg, 150);
  const url = `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=${encodeURIComponent(hips)}&width=${N}&height=${N}&fov=${fov.toFixed(5)}&projection=TAN&coordsys=icrs&rotation_angle=0&ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&format=jpg`;
  const entry = { ra, dec, fov, N, hips, scale: (fov * 3600) / N, ready: null, key: url };
  entry.ready = (async () => {
    let img;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const bmp = await createImageBitmap(await r.blob());
      const c = new OffscreenCanvas(N, N); const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0, N, N);
      img = g.getImageData(0, 0, N, N).data;
      offline = false;
    } catch (e) {
      offline = true;
      img = syntheticSky(ra, dec, fov, N);
      entry.synthetic = true;
    }
    linearize(entry, img);
    return entry;
  })();
  skyCache.push(entry);
  while (skyCache.length > 6) skyCache.shift();
  return entry.ready;
}

function linearize(entry, img) {
  const N = entry.N, n = N * N;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  // per-channel background (low percentile)
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < n; i += 3) { hist[0][img[i * 4]]++; hist[1][img[i * 4 + 1]]++; hist[2][img[i * 4 + 2]]++; }
  const bg = hist.map((h) => { let s = 0; const tot = h.reduce((a, b) => a + b, 0); for (let v = 0; v < 256; v++) { s += h[v]; if (s > tot * 0.3) return v; } return 0; });
  const bgL = bg.map((v) => LUT[v]);
  const melFactor = entry.hips === HIPS_MEL ? 0.6 : 1;
  for (let i = 0; i < n; i++) {
    const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2];
    let fr = Math.max(0, LUT[r] - bgL[0] * 0.97), fg = Math.max(0, LUT[g] - bgL[1] * 0.97), fb = Math.max(0, LUT[b] - bgL[2] * 0.97);
    const mx = Math.max(r, g, b);
    if (mx > 236) { const boost = 1 + ((mx - 236) / 19) ** 2 * 14; fr *= boost; fg *= boost; fb *= boost; }
    R[i] = fr * melFactor; G[i] = fg * melFactor; B[i] = fb * melFactor;
  }
  entry.R = R; entry.G = G; entry.B = B;
  // bright star list for diffraction spikes / bahtinov patterns
  const stars = [];
  for (let y = 3; y < N - 3; y++) for (let x = 3; x < N - 3; x++) {
    const i = y * N + x; const v = G[i] + R[i] + B[i];
    if (v < 2.2) continue;
    if (v >= G[i - 1] + R[i - 1] + B[i - 1] && v > G[i + 1] + R[i + 1] + B[i + 1] && v >= G[i - N] + R[i - N] + B[i - N] && v > G[i + N] + R[i + N] + B[i + N]) {
      let s = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = i + dy * N + dx; s += R[j] + G[j] + B[j]; }
      stars.push({ x, y, f: s });
    }
  }
  stars.sort((a, b) => b.f - a.f);
  entry.stars = stars.slice(0, 120);
}

// Offline fallback: point sources from the bright star catalog.
function syntheticSky(ra0, dec0, fov, N) {
  const img = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) { img[i * 4] = 18; img[i * 4 + 1] = 18; img[i * 4 + 2] = 22; img[i * 4 + 3] = 255; }
  const sc = (fov * A.D2R) / N;
  const rnd = mulberry32(hashStr(`${ra0.toFixed(2)},${dec0.toFixed(2)}`));
  const plot = (x, y, m, col) => {
    const amp = Math.min(255, 255 * Math.pow(10, -0.4 * (m - 4)) * 6);
    const rad = Math.max(1, 3.2 - m * 0.3);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const w = Math.exp(-(dx * dx + dy * dy) / (rad * rad)); const k = (yy * N + xx) * 4;
      img[k] = Math.min(255, img[k] + amp * w * col[0]); img[k + 1] = Math.min(255, img[k + 1] + amp * w * col[1]); img[k + 2] = Math.min(255, img[k + 2] + amp * w * col[2]);
    }
  };
  for (const s of starCat) {
    const p = A.tanProject(ra0, dec0, s.ra, s.dec); if (!p.front) continue;
    const x = N / 2 - p.xi / sc, y = N / 2 - p.eta / sc;
    if (x < -5 || y < -5 || x > N + 5 || y > N + 5) continue;
    plot(x, y, s.mag, s.c);
  }
  // faint random field stars so the frame is not empty
  const density = Math.min(30000, (fov * fov) * 400 / Math.max(1, fov / 2));
  for (let i = 0; i < density; i++) plot(rnd() * N, rnd() * N, 7 + rnd() * 6, [1, 1, 1]);
  return img;
}

function findSky(ra, dec, scale, needFovDeg) {
  for (const e of skyCache) {
    if (Math.abs(e.scale / scale - 1) > 0.08 && !(e.scale > scale && e.N >= 2400 && Math.abs(e.scale / scale - 1) < 0.5)) continue;
    const d = A.sep(ra, dec, e.ra, e.dec);
    if (d + needFovDeg / 2 <= e.fov / 2 * 0.98) return e.ready;
  }
  return null;
}

async function getSky(ra, dec, scale, needFovDeg) {
  const hit = findSky(ra, dec, scale, needFovDeg);
  if (hit) return hit;
  const fov = Math.min(150, needFovDeg * 1.25);
  let N = Math.ceil((fov * 3600) / scale);
  N = Math.min(N, 2400); N = Math.max(N, 64);
  return fetchSurvey(ra, dec, fov, N);
}

// ---------- geometry ----------
function geometry(r) {
  const cam = r.cam, bin = r.bin || 1;
  const Ws = Math.floor(cam.w / bin), Hs = Math.floor(cam.h / bin), pixEff = cam.pix * bin;
  let W, H, k, offX = 0, offY = 0;
  if (r.roi) { W = r.roi.w; H = r.roi.h; k = 1; offX = r.roi.cx - Ws / 2; offY = r.roi.cy - Hs / 2; }
  else {
    const Q = r.quality || 1024;
    if (Ws >= Hs) { W = Math.min(Q, Ws); k = Ws / W; H = Math.round(Hs / k); }
    else { H = Math.min(Q, Hs); k = Hs / H; W = Math.round(Ws / k); }
  }
  const scale = (206.265 * pixEff * k) / r.opt.focal; // arcsec per render pixel
  return { W, H, k, scale, Ws, Hs, pixEff, offX, offY, fullW: Ws / k, fullH: Hs / k };
}

// path: array of [dE", dN", dRot°] (relative to start), uniform in time
function pathAt(path, t) {
  if (!path || path.length === 0) return [0, 0, 0];
  if (path.length === 1) return path[0];
  const f = t * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)), u = f - i;
  const a = path[i], b = path[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function boxBlur(src, W, H, r, tmp) {
  if (r < 1) return;
  const out = tmp || new Float32Array(src.length);
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < H; y++) {
    const row = y * W; let acc = src[row] * (r + 1);
    for (let j = 0; j < r; j++) acc += src[row + Math.min(j, W - 1)];
    for (let x = 0; x < W; x++) {
      acc += src[row + Math.min(x + r, W - 1)] - src[row + Math.max(x - r - 1, 0)];
      out[row + x] = acc * iarr;
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = out[x] * (r + 1);
    for (let j = 0; j < r; j++) acc += out[Math.min(j, H - 1) * W + x];
    for (let y = 0; y < H; y++) {
      acc += out[Math.min(y + r, H - 1) * W + x] - out[Math.max(y - r - 1, 0) * W + x];
      src[y * W + x] = acc * iarr;
    }
  }
}
// Gaussian blur via 3 box passes (sigma in px)
function gaussBlur(a, W, H, sigma, tmp) {
  if (sigma < 0.35) return;
  if (sigma < 0.9) { // small: 3x3 kernel
    const w1 = Math.exp(-1 / (2 * sigma * sigma)), n = 1 + 2 * w1, c0 = 1 / n, c1 = w1 / n;
    const t = tmp || new Float32Array(a.length);
    for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) t[row + x] = a[row + x] * c0 + (a[row + Math.max(0, x - 1)] + a[row + Math.min(W - 1, x + 1)]) * c1; }
    for (let y = 0; y < H; y++) { const up = Math.max(0, y - 1) * W, dn = Math.min(H - 1, y + 1) * W, row = y * W; for (let x = 0; x < W; x++) a[row + x] = t[row + x] * c0 + (t[up + x] + t[dn + x]) * c1; }
    return;
  }
  const n = 3, wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  for (let i = 0; i < n; i++) boxBlur(a, W, H, ((i < m ? wl : wl + 2) - 1) / 2, tmp);
}

// Sparse kernel convolution (defocus disk / donut)
function diskConvolve(a, W, H, radius, obst, tmp) {
  const taps = [];
  const rings = Math.max(2, Math.min(5, Math.round(radius / 2)));
  for (let ri = 0; ri < rings; ri++) {
    const rr = radius * Math.sqrt(obst * obst + (1 - obst * obst) * ((ri + 0.5) / rings));
    const nT = Math.max(6, Math.round(rr * 2.2)); const n = Math.min(nT, 28);
    for (let j = 0; j < n; j++) { const th = (j / n) * Math.PI * 2 + ri * 0.7; taps.push([Math.round(Math.cos(th) * rr), Math.round(Math.sin(th) * rr)]); }
  }
  const w = 1 / taps.length, out = tmp || new Float32Array(a.length);
  out.fill(0);
  for (const [dx, dy] of taps) {
    for (let y = 0; y < H; y++) {
      const sy = Math.min(H - 1, Math.max(0, y + dy)) * W, row = y * W;
      for (let x = 0; x < W; x++) { const sx = Math.min(W - 1, Math.max(0, x + dx)); out[row + x] += a[sy + sx] * w; }
    }
  }
  a.set(out);
}

// Radial smear towards the edges (coma / field curvature / tilt)
function radialSmear(a, W, H, amountPx, tmp) {
  if (amountPx < 0.7) return;
  const out = tmp || new Float32Array(a.length);
  const cx = W / 2, cy = H / 2, rc = Math.hypot(cx, cy), taps = 6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / rc;
    const L = amountPx * r * r;
    if (L < 0.5) { out[y * W + x] = a[y * W + x]; continue; }
    const ux = dx / (r * rc + 1e-6), uy = dy / (r * rc + 1e-6);
    let s = 0, ws = 0;
    for (let t = 0; t < taps; t++) {
      const f = t / (taps - 1), d = -L * f; // flare points outward (comet tails toward edge)
      const sx = Math.round(x + ux * d), sy = Math.round(y + uy * d);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const wt = 1 - f * 0.75; s += a[sy * W + sx] * wt; ws += wt;
    }
    out[y * W + x] = s / ws;
  }
  a.set(out);
}

function drawLine(arr, W, H, x0, y0, x1, y1, val, width = 1) {
  const len = Math.hypot(x1 - x0, y1 - y0); const n = Math.ceil(len * 1.5) + 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    for (let w = -Math.floor(width / 2); w <= Math.floor(width / 2); w++) {
      const xi = Math.round(x + (Math.abs(y1 - y0) > Math.abs(x1 - x0) ? w : 0)), yi = Math.round(y + (Math.abs(y1 - y0) > Math.abs(x1 - x0) ? 0 : w));
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) arr[yi * W + xi] += val / (1 + Math.abs(w));
    }
  }
}

// ---------- main render ----------
async function renderFrame(r, opts = {}) {
  const g = geometry(r), { W, H, k, scale } = g, N = W * H;
  const cam = r.cam, opt = r.opt, mono = !!cam.mono, nc = mono ? 1 : 3;
  const rand = mulberry32(r.seed >>> 0), gauss = gaussFactory(rand);
  const t = r.exp;
  const isDarkish = r.capOn || r.type === 'bias';
  const usePanel = r.type === 'flat' && r.flatSrc === 'panel';
  const area = Math.PI * (opt.D / 20) ** 2 * (1 - (opt.obstruction || 0) ** 2); // cm²
  const pixArea = (206.265 * g.pixEff / opt.focal) ** 2; // arcsec² per (binned) sensor pixel
  const throughput = (opt.type === 'lens' ? 0.88 : opt.obstruction ? 0.8 : 0.92) * (1 - 0.7 * (r.env.dew || 0)) * (1 - 0.08 * (r.env.smudge || 0)) * (r.bahtinov ? 0.55 : 1);
  const P = K_OBJ * area * pixArea * throughput * t; // e- per sensor pixel per unit F per unit QE
  const out = { W, H, nc, k, scale, warnings: [] };

  // band arrays (object signal in survey units F)
  let R = null, Gc = null, Bc = null;
  const mid = pathAt(r.path, 0.5);
  const lstMid = A.lst(r.t0 + t * 500, r.env.lon);

  // --- object light from survey ---
  if (!isDarkish && !usePanel) {
    // frame extent incl. path for coverage
    let pathExt = 0; for (const p of r.path || []) pathExt = Math.max(pathExt, Math.hypot(p[0], p[1]) / 3600 + Math.abs(p[2]) * A.D2R * Math.hypot(g.fullW, g.fullH) * scale / 7200);
    const roiOff = Math.hypot(g.offX, g.offY) * scale / 3600 / k;
    const diag = (Math.hypot(W, H) * scale) / 3600;
    const need = diag + 2 * pathExt + 2 * roiOff;
    const sky = await getSky(r.ra, r.dec, scale, need);
    if (sky.synthetic) out.warnings.push('offline');
    const s = scale / sky.scale; // base px per render px
    // frame center (incl ROI offset) in base pixels
    const proj = A.tanProject(sky.ra, sky.dec, r.ra, r.dec);
    const bs = sky.scale * A.D2R / 3600;
    const bcx = sky.N / 2 - proj.xi / bs, bcy = sky.N / 2 - proj.eta / bs;
    const npt = A.offsetPA(r.ra, r.dec, 0.01, 0); const pn = A.tanProject(sky.ra, sky.dec, npt.ra, npt.dec);
    const gamma = Math.atan2(-(pn.xi - proj.xi), pn.eta - proj.eta); // local north PA in base frame
    // decide substeps from motion extent
    const P0 = pathAt(r.path, 0), P1 = pathAt(r.path, 1);
    let maxDisp = 0;
    const cornerR = Math.hypot(g.fullW, g.fullH) / 2;
    for (let i = 1; i <= 8; i++) { const p = pathAt(r.path, i / 8); maxDisp = Math.max(maxDisp, Math.hypot(p[0] - P0[0], p[1] - P0[1]) / scale + Math.abs(p[2] - P0[2]) * A.D2R * cornerR); }
    let pathLen = 0; { let prev = P0; for (let i = 1; i <= 32; i++) { const p = pathAt(r.path, i / 32); pathLen += Math.hypot(p[0] - prev[0], p[1] - prev[1]) / scale + Math.abs(p[2] - prev[2]) * A.D2R * cornerR; prev = p; } }
    const nSub = Math.max(1, Math.min(opts.fast ? 24 : 200, Math.ceil(Math.max(maxDisp, pathLen) * 1.3)));
    out.trailPx = pathLen; void P1;
    R = new Float32Array(N); Gc = new Float32Array(N); Bc = new Float32Array(N);
    const SR = sky.R, SG = sky.G, SB = sky.B, SN = sky.N;
    const wgt = 1 / nSub;
    for (let si = 0; si < nSub; si++) {
      const p = pathAt(r.path, nSub === 1 ? 0.5 : si / (nSub - 1));
      const th = (r.rot + p[2]) * A.D2R + gamma;
      const cs = Math.cos(th) * s, sn = Math.sin(th) * s;
      // pointing offset in base px (east=-x, north=-y, rotated by gamma)
      const dE = p[0] / sky.scale, dN = p[1] / sky.scale;
      const ex = -Math.cos(gamma), ey = Math.sin(gamma), nx = -Math.sin(gamma), ny = -Math.cos(gamma);
      // ROI offset is in frame pixels; include in u,v
      const cx = bcx + dE * ex + dN * nx, cy = bcy + dE * ey + dN * ny;
      for (let y = 0; y < H; y++) {
        const v = y - H / 2 + g.offY / (r.roi ? 1 : k) + 0.5;
        let bx = cx + (-W / 2 + g.offX + 0.5) * cs + v * sn;
        let by = cy - (-W / 2 + g.offX + 0.5) * sn + v * cs;
        const row = y * W;
        for (let x = 0; x < W; x++, bx += cs, by -= sn) {
          const x0 = Math.floor(bx), y0 = Math.floor(by);
          if (x0 < 0 || y0 < 0 || x0 >= SN - 1 || y0 >= SN - 1) continue;
          const fx = bx - x0, fy = by - y0, i0 = y0 * SN + x0;
          const w00 = (1 - fx) * (1 - fy) * wgt, w10 = fx * (1 - fy) * wgt, w01 = (1 - fx) * fy * wgt, w11 = fx * fy * wgt;
          R[row + x] += SR[i0] * w00 + SR[i0 + 1] * w10 + SR[i0 + SN] * w01 + SR[i0 + SN + 1] * w11;
          Gc[row + x] += SG[i0] * w00 + SG[i0 + 1] * w10 + SG[i0 + SN] * w01 + SG[i0 + SN + 1] * w11;
          Bc[row + x] += SB[i0] * w00 + SB[i0 + 1] * w10 + SB[i0 + SN] * w01 + SB[i0 + SN + 1] * w11;
        }
      }
    }
    // bright stars positions (mid-exposure) for spikes
    out._stars = [];
    {
      const th = (r.rot + mid[2]) * A.D2R + gamma, cs = Math.cos(th) * s, sn = Math.sin(th) * s;
      const dE = mid[0] / sky.scale, dN = mid[1] / sky.scale;
      const cx = bcx + dE * -Math.cos(gamma) + dN * -Math.sin(gamma), cy = bcy + dE * Math.sin(gamma) + dN * -Math.cos(gamma);
      const det = cs * cs + sn * sn;
      for (const st of sky.stars) {
        const dx = st.x - cx, dy = st.y - cy;
        // invert [bx-cx, by-cy] = [u*cs + v*sn, -u*sn + v*cs]
        const u = (dx * cs - dy * sn) / det, v = (dx * sn + dy * cs) / det;
        const fx = u + W / 2 - g.offX - 0.5, fy = v + H / 2 - g.offY / (r.roi ? 1 : k) - 0.5;
        if (fx > -20 && fy > -20 && fx < W + 20 && fy < H + 20) out._stars.push({ x: fx, y: fy, f: st.f });
      }
    }
  }

  // --- environment grid: altitude/azimuth per pixel (coarse) ---
  const GX = 17, GY = 12;
  const altG = new Float32Array(GX * GY), azG = new Float32Array(GX * GY);
  {
    const th = (r.rot + mid[2]) * A.D2R; const cs = Math.cos(th), sn = Math.sin(th);
    const ctr = A.offsetPA(r.ra, r.dec, Math.hypot(mid[0], mid[1]) / 3600, Math.atan2(mid[0], mid[1]) * A.R2D);
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
      const u = (i / (GX - 1) - 0.5) * W + g.offX, v = (j / (GY - 1) - 0.5) * H + g.offY / (r.roi ? 1 : k);
      // frame -> sky offsets (arcsec): right=(cos th west, ...) ; east offset = -(u*cs + v*sn), north = -( -u*sn + v*cs)
      const bx = u * cs + v * sn, by = -u * sn + v * cs; // in "base" orientation (x=west, y=south)
      const xi = (-bx * scale / 3600) * A.D2R, eta = (-by * scale / 3600) * A.D2R;
      const p = A.tanDeproject(ctr.ra, ctr.dec, xi, eta);
      const aa = A.radec2altaz(p.ra, p.dec, lstMid, r.env.lat);
      altG[j * GX + i] = aa.alt; azG[j * GX + i] = aa.az;
    }
  }
  const sampleGrid = (G, x, y) => {
    const gx = (x / (W - 1)) * (GX - 1), gy = (y / (H - 1)) * (GY - 1);
    const i = Math.min(GX - 2, Math.floor(gx)), j = Math.min(GY - 2, Math.floor(gy)), u = gx - i, v = gy - j;
    const a = G[j * GX + i], b = G[j * GX + i + 1], c = G[(j + 1) * GX + i], d = G[(j + 1) * GX + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  const sampleAz = (x, y) => { // handle wrap
    const gx = (x / (W - 1)) * (GX - 1), gy = (y / (H - 1)) * (GY - 1);
    const i = Math.min(GX - 2, Math.floor(gx)), j = Math.min(GY - 2, Math.floor(gy)), u = gx - i, v = gy - j;
    const a0 = azG[j * GX + i]; const f = (q) => a0 + A.norm180(q - a0);
    const b = f(azG[j * GX + i + 1]), c = f(azG[(j + 1) * GX + i]), d = f(azG[(j + 1) * GX + i + 1]);
    return A.norm360(a0 * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v);
  };

  // --- sky brightness at grid nodes, per band, e-/s per sensor px per QE ---
  const env = r.env;
  const loc = env.loc;
  const skyGrid = [new Float32Array(GX * GY), new Float32Array(GX * GY), new Float32Array(GX * GY)];
  const groundGrid = new Float32Array(GX * GY);
  if (!isDarkish && !usePanel) {
    for (let q = 0; q < GX * GY; q++) {
      const alt = altG[q], az = azG[q];
      const X = A.airmass(Math.max(alt, 0.5));
      // natural sky + light pollution dome
      const natural = A.magToNL(21.95) * (0.4 + 0.6 * X);
      const lpZen = Math.max(0, A.magToNL(loc.sqm) - A.magToNL(21.95));
      const lpDir = 1 + loc.lpStrength * Math.pow(Math.max(0, Math.cos((az - loc.lpAz) * A.D2R)), 2) * Math.exp(-Math.max(alt, 0) / 18);
      const lp = lpZen * Math.pow(X, 0.75) * lpDir;
      const moon = env.moonAlt > -2 ? A.moonSkyNL(env.moonPhase, env.moonAlt, alt, sepAA(alt, az, env.moonAlt, env.moonAz)) : 0;
      const tw = A.twilightNL(env.sunAlt, sepAA(alt, az, env.sunAlt, env.sunAz));
      const cloudGlow = env.clouds > 0 ? env.clouds * (lpZen * 2.2 + natural * 0.3) : 0;
      const haze = (1 - env.transp) * (lpZen * 1.2 + moon * 0.6);
      // colors (relative band weights)
      const cN = [0.85, 1, 0.75], cLP = loc.bortle >= 5 ? [1.25, 1, 0.62] : [1.1, 1, 0.75], cM = [0.82, 1, 1.25], cT = [0.6, 0.95, 1.5];
      for (let c = 0; c < 3; c++) {
        const nl = natural * cN[c] + (lp + cloudGlow + haze) * cLP[c] + moon * cM[c] + tw * cT[c];
        // nL -> V mag/arcsec² -> photons/s/cm²/arcsec² per band
        skyGrid[c][q] = PHI0 * Math.pow(10, -0.4 * A.nlToMag(Math.max(nl, 1e-3)));
      }
      groundGrid[q] = alt < horizonAlt(loc, az) ? 1 : 0;
    }
  }

  // --- assemble per-channel electrons (object part, before PSF) ---
  const qeBand = mono ? [cam.qe, cam.qe, cam.qe] : [cam.qe * cam.qeRGB[0], cam.qe * cam.qeRGB[1], cam.qe * cam.qeRGB[2]];
  const flt = r.filter || { cont: [1, 1, 1], skyCont: [1, 1, 1], ha: 1, oiii: 1, sii: 1, broadband: true };
  const broadband = flt.cont[0] > 0.3 || flt.cont[1] > 0.3 || flt.cont[2] > 0.3;
  const haF = cam.haFactor ?? 1;
  const ext = [0.11, 0.17, 0.27]; // extinction coeff mag/airmass per band
  const objE = [];
  for (let c = 0; c < nc; c++) objE.push(new Float32Array(N));
  if (R) {
    const cloudsOn = env.clouds > 0.02;
    const nz = cloudsOn ? makeNoise(env.cloudSeed) : null;
    const tw = env.windDir * A.D2R, ws = env.cloudDrift; // cloud drift (layer units)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const alt = sampleGrid(altG, x, y);
      const X = A.airmass(Math.max(alt, 0.5));
      let trans = env.transp;
      if (cloudsOn && alt > 0) {
        const az = sampleAz(x, y) * A.D2R, ct = 1 / Math.tan(Math.max(alt, 4) * A.D2R);
        const px = ct * Math.sin(az) * 1.6 + Math.cos(tw) * ws, py = ct * Math.cos(az) * 1.6 + Math.sin(tw) * ws;
        const d = smoothstep(1 - env.clouds - 0.12, 1 - env.clouds + 0.18, nz.fbm(px, py, 5));
        trans *= 1 - 0.985 * d;
      }
      const r0 = R[i], g0 = Gc[i], b0 = Bc[i];
      const ha = Math.max(0, r0 - 0.85 * g0), oiii = Math.max(0, 0.5 * (g0 + b0) - 0.95 * r0) * 1.2, sii = ha * 0.3;
      const e0 = Math.pow(10, -0.4 * ext[0] * X) * trans, e1 = Math.pow(10, -0.4 * ext[1] * X) * trans, e2 = Math.pow(10, -0.4 * ext[2] * X) * trans;
      if (mono) {
        let v = flt.cont[0] * r0 * e0 + flt.cont[1] * g0 * e1 + flt.cont[2] * b0 * e2;
        if (!broadband) v += (flt.ha * ha + flt.sii * sii) * e0 + flt.oiii * oiii * e1;
        objE[0][i] = v * P * cam.qe;
      } else {
        const rr = broadband ? flt.cont[0] * (r0 - ha * (1 - haF)) : flt.cont[0] * r0 + (flt.ha * ha * haF) + flt.sii * sii * haF;
        const gg = broadband ? flt.cont[1] * g0 : flt.cont[1] * g0 + flt.oiii * oiii * 0.6;
        const bb = broadband ? flt.cont[2] * b0 : flt.cont[2] * b0 + flt.oiii * oiii * 0.45;
        objE[0][i] = Math.max(0, rr) * e0 * P * qeBand[0];
        objE[1][i] = gg * e1 * P * qeBand[1];
        objE[2][i] = bb * e2 * P * qeBand[2];
      }
    }
    R = Gc = Bc = null;
  }

  // --- PSF ---
  const tmp = new Float32Array(N);
  if (R === null && out._stars) {
    const fwhmSeeing = env.seeing * Math.pow(A.airmass(Math.max(sampleGrid(altG, W / 2, H / 2), 5)), 0.6);
    const fwhmDiff = 116 / opt.D * 1.0;
    const fwhmGuide = 2.355 * (r.jitter || 0);
    const pixUm = g.pixEff * (r.roi ? 1 : k);
    const fwhmAb = (opt.ab || 0) / pixUm * scale;
    const baseFWHM = 3.2; // survey's own PSF (arcsec) — subtract in quadrature
    const surveyF = Math.max(baseFWHM, 0);
    for (let c = 0; c < nc; c++) {
      const caUm = mono ? (opt.ca || 0) * 0.4 : (c === 2 ? (opt.ca || 0) : c === 0 ? (opt.ca || 0) * 0.5 : 0);
      const fwhmCA = caUm / pixUm * scale;
      let tot2 = fwhmSeeing ** 2 + fwhmDiff ** 2 + fwhmGuide ** 2 + fwhmAb ** 2 + fwhmCA ** 2 - surveyF ** 2;
      const sigPx = Math.sqrt(Math.max(0, tot2)) / 2.355 / scale;
      gaussBlur(objE[c], W, H, sigPx, tmp);
      // defocus
      const fr = opt.focal / opt.D;
      const blurUm = Math.abs(r.focusDelta || 0) / fr;
      const blurPx = blurUm / pixUm / 2; // radius
      if (blurPx > 1.1) diskConvolve(objE[c], W, H, Math.min(blurPx, 140), Math.max(opt.obstruction || 0, 0.12), tmp);
      else if (blurPx > 0.3) gaussBlur(objE[c], W, H, blurPx * 0.8, tmp);
      // edge aberrations
      const edgePx = (opt.edgeAb || 0) / pixUm;
      if (!r.roi) radialSmear(objE[c], W, H, edgePx, tmp);
      // dew halo
      const haloD = Math.min(1, (env.dew || 0) + (env.smudge || 0) * 0.55);
      if (haloD > 0.05) {
        const halo = objE[c].slice(); boxBlur(halo, W, H, Math.round(W / 40)); boxBlur(halo, W, H, Math.round(W / 40));
        const d = haloD; for (let i = 0; i < N; i++) objE[c][i] = objE[c][i] * (1 - 0.6 * d) + halo[i] * 0.9 * d;
      }
    }
    // diffraction spikes & bahtinov pattern
    const spikes = opt.spikes || opt.blades ? (opt.spikes || (opt.blades % 2 ? opt.blades * 2 : opt.blades)) : 0;
    if ((spikes || r.bahtinov) && out._stars.length) {
      const bright = out._stars.slice(0, r.bahtinov ? 6 : 40);
      for (const st of bright) {
        const fe = st.f * P * cam.qe;
        if (fe < 400 && !r.bahtinov) continue;
        const L = Math.min(W / 3, (r.bahtinov ? 14 : 3) * Math.sqrt(fe) / Math.sqrt(scale) / 6 + 6);
        const rotA = (r.rot + mid[2]) * A.D2R;
        const amp = fe / L * (r.bahtinov ? 0.06 : 0.015);
        for (let c = 0; c < nc; c++) {
          const a = objE[c];
          if (r.bahtinov) {
            const off = (r.focusDelta || 0) / (pixUm * 2) * 0.9;
            const ang = [0.35, -0.35, Math.PI / 2];
            for (let q = 0; q < 3; q++) {
              const th = ang[q], dx = Math.cos(th), dy = Math.sin(th);
              const ox = q === 2 ? off : 0;
              drawLine(a, W, H, st.x - dx * L + ox, st.y - dy * L, st.x + dx * L + ox, st.y + dy * L, amp, 1);
            }
          } else {
            for (let q = 0; q < spikes; q++) {
              const th = rotA * (opt.spikes ? 0 : 1) + (q / spikes) * Math.PI * 2 + (opt.spikes ? 0 : 0.3);
              drawLine(a, W, H, st.x, st.y, st.x + Math.cos(th) * L, st.y + Math.sin(th) * L, amp, 1);
            }
          }
        }
      }
    }
    delete out._stars;
  }

  // --- vignetting & dust (the flat field), fixed to the sensor ---
  const flatField = makeFlatField(r, W, H, g);

  // --- satellites & planes (random) ---
  if (r.type === 'light' && !isDarkish && objE[0] && env.sunAlt < -12) {
    const fovDeg2 = (W * scale / 3600) * (H * scale / 3600);
    const lam = Math.min(4, 0.0009 * fovDeg2 * t / 60 * (env.sunAlt > -24 ? 3 : 1) + 0.0003 * t);
    let nSat = 0; { let L = Math.exp(-lam), p = 1; do { nSat++; p *= rand(); } while (p > L); nSat--; }
    for (let s = 0; s < nSat; s++) {
      const x0 = rand() * W, y0 = rand() * H, th = rand() * Math.PI, L = Math.hypot(W, H);
      const plane = rand() < 0.15;
      const br = (plane ? 900 : 150 + rand() * 600) * Math.min(1, area / 30) * (t > 1 ? 1 : t);
      for (let c = 0; c < nc; c++) {
        if (plane) { for (let q = -12; q < 12; q++) if (q % 2 === 0) drawLine(objE[c], W, H, x0 + Math.cos(th) * L * q / 24, y0 + Math.sin(th) * L * q / 24, x0 + Math.cos(th) * L * (q + 0.6) / 24, y0 + Math.sin(th) * L * (q + 0.6) / 24, br * (c === 0 ? 1.3 : 0.8), 2); }
        else drawLine(objE[c], W, H, x0 - Math.cos(th) * L, y0 - Math.sin(th) * L, x0 + Math.cos(th) * L, y0 + Math.sin(th) * L, br, 1);
      }
    }
  }

  // --- sensor ---
  const sens = r.sensor; // {gainE, rn, maxADU, fwEff, offsetADU}
  const temp = r.sensorTemp ?? 20;
  const darkRate = cam.dark25 * Math.pow(2, (temp - 25) / 6.3);
  const hot = hotPixels(cam, r.camSerial || 1, W, H, k, temp);
  const ampGlow = cam.ampGlow || 0;
  const banding = cam.banding || 0;
  const colOff = new Float32Array(W);
  { const cr = mulberry32(hashStr('bias' + cam.id + (r.camSerial || 1))); const cg = gaussFactory(cr); for (let x = 0; x < W; x++) colOff[x] = cg() * 0.35 * banding * sens.rn / Math.max(1, sens.gainE) * 2; }
  const rowOff = new Float32Array(H); for (let y = 0; y < H; y++) rowOff[y] = gauss() * banding * sens.rn * 0.5 / Math.max(1, Math.sqrt(k)) / Math.max(0.1, sens.gainE);
  const pedestal = cam.type === 'dslr' ? cam.offset : (r.offset ?? cam.offset) * 16;
  const data = [];
  const bayerFrac = mono ? [1] : [0.25, 0.5, 0.25];
  const panelRate = usePanel ? (r.panelLevel || 1) * 9000 / ((opt.focal / opt.D) ** 2) : 0;
  const quant = k < 1.5;
  for (let c = 0; c < nc; c++) {
    const arr = new Float32Array(N);
    const m = Math.max(1, (r.roi ? 1 : k * k) * bayerFrac[c]);
    const qe = mono ? cam.qe : qeBand[c];
    const flt2 = flt;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const ff = flatField[i];
        let e = 0;
        if (!isDarkish) {
          if (usePanel) e = panelRate * qe * t * (mono ? 1 : [0.9, 1, 1.1][c]);
          else {
            const gx = (x / (W - 1)) * (GX - 1), gy = (y / (H - 1)) * (GY - 1);
            const ii = Math.min(GX - 2, Math.floor(gx)), jj = Math.min(GY - 2, Math.floor(gy)), u = gx - ii, v = gy - jj;
            const q00 = jj * GX + ii;
            const ground = groundGrid[q00] * (1 - u) * (1 - v) + groundGrid[q00 + 1] * u * (1 - v) + groundGrid[q00 + GX] * (1 - u) * v + groundGrid[q00 + GX + 1] * u * v;
            let skyE;
            const sk = (b) => skyGrid[b][q00] * (1 - u) * (1 - v) + skyGrid[b][q00 + 1] * u * (1 - v) + skyGrid[b][q00 + GX] * (1 - u) * v + skyGrid[b][q00 + GX + 1] * u * v;
            if (mono) skyE = flt2.skyCont[0] * sk(0) + flt2.skyCont[1] * sk(1) + flt2.skyCont[2] * sk(2);
            else skyE = flt2.skyCont[c] * sk(c) * (c === 0 && broadband ? 1 : 1);
            skyE *= area * pixArea * throughput * t * qe;
            let objv = objE[c][i];
            if (ground > 0.5) { objv = 0; skyE *= (loc.bortle >= 5 ? 0.25 : 0.06) * (1 + (env.moonAlt > 0 ? env.moonIllum * 6 : 0)); }
            e = (objv + skyE) * ff;
          }
        }
        // dark current, hot pixels, amp glow
        let d = darkRate * t;
        const hp = hot.get(i); if (hp) d += hp * t;
        if (ampGlow) { const dx = Math.min(x, W - x) / W, dy = Math.min(y, H - y) / H; d += ampGlow * t * (Math.exp(-dx * 18) * 0.7 + Math.exp(-dy * 22) * 0.3) * Math.exp(-(Math.min(dx, dy)) * 10) * Math.pow(2, (temp - 25) / 8); }
        let mean = e + d;
        if (mean > sens.fwEff) mean = sens.fwEff;
        const ne = mean * m;
        let val;
        if (ne < 25) { // Poisson (Knuth)
          const L = Math.exp(-ne); let kk = 0, p = 1; do { kk++; p *= rand(); } while (p > L); val = (kk - 1) / m;
        } else val = mean + gauss() * Math.sqrt(mean / m);
        val += gauss() * sens.rn / Math.sqrt(m);
        let adu = val / sens.gainE + pedestal + colOff[x] + rowOff[y];
        if (quant) adu = Math.round(adu);
        arr[i] = adu < 0 ? 0 : adu > sens.maxADU ? sens.maxADU : adu;
      }
    }
    data.push(arr);
  }
  // moon in frame: saturate a disk
  if (!isDarkish && r.type === 'light' && env.moonAlt > -1) moonDisk(r, data, W, H, scale, mid, sens.maxADU, lstMid);
  out.data = data;
  out.pedestal = pedestal;
  out.maxADU = sens.maxADU;
  return out;
}

function sepAA(alt1, az1, alt2, az2) { return A.sep(az1, alt1, az2, alt2); }

function moonDisk(r, data, W, H, scale, mid, maxADU) {
  const env = r.env;
  const md = A.sep(r.ra, r.dec, env.moonRa, env.moonDec);
  const fovR = Math.hypot(W, H) * scale / 7200;
  if (md > fovR + 0.6) return;
  const pa = A.posAngle(r.ra, r.dec, env.moonRa, env.moonDec);
  const rel = (pa - r.rot - mid[2]) * A.D2R;
  const d = md * 3600 / scale;
  const mx = W / 2 - Math.sin(rel) * d, my = H / 2 - Math.cos(rel) * d;
  const rad = 0.26 * 3600 / scale;
  const glow = rad * 4;
  for (let y = Math.max(0, Math.floor(my - glow)); y < Math.min(H, my + glow); y++) for (let x = Math.max(0, Math.floor(mx - glow)); x < Math.min(W, mx + glow); x++) {
    const rr = Math.hypot(x - mx, y - my);
    const v = rr < rad ? maxADU : maxADU * 0.6 * Math.exp(-(rr - rad) / (rad * 0.6)) * env.moonIllum;
    for (const ch of data) { const i = y * W + x; ch[i] = Math.min(maxADU, Math.max(ch[i], v * (rr < rad ? (0.5 + env.moonIllum * 0.5) : 1))); }
  }
}

const hotCache = new Map();
function hotPixels(cam, serial, W, H, k, temp) {
  const key = `${cam.id}:${serial}:${W}x${H}`;
  let base = hotCache.get(key);
  if (!base) {
    base = [];
    const r = mulberry32(hashStr('hot' + key));
    const n = Math.round(W * H * (cam.hot || 0) * Math.min(6, Math.sqrt(k)) * 2);
    for (let i = 0; i < n; i++) { const idx = Math.floor(r() * W * H); base.push([idx, Math.pow(r(), 3) * 120 + 2]); }
    hotCache.set(key, base);
  }
  const m = new Map(); const f = Math.pow(2, (temp - 25) / 6.3) / Math.max(1, k * 0.8);
  for (const [i, a] of base) m.set(i, a * f);
  return m;
}

const flatCache = new Map();
function makeFlatField(r, W, H, g) {
  const opt = r.opt;
  const key = `${W}x${H}:${opt.id}:${opt.focal.toFixed(1)}:${(opt.focal / opt.D).toFixed(2)}:${opt.vig.toFixed(3)}:${r.cam.id}:${r.roi ? JSON.stringify(r.roi) : ''}:${r.dustSeed || 0}`;
  if (flatCache.has(key)) return flatCache.get(key);
  const ff = new Float32Array(W * H);
  const cx = W / 2 - (r.roi ? g.offX : 0), cy = H / 2 - (r.roi ? g.offY : 0);
  const rc = Math.hypot(g.fullW / 2, g.fullH / 2) * (r.roi ? g.k : 1);
  const vig = opt.vig;
  const dust = [];
  const dr = mulberry32(hashStr('dust' + (r.dustSeed || 0) + r.cam.id));
  const fr = opt.focal / opt.D;
  const nd = 3 + Math.floor(dr() * 5);
  for (let i = 0; i < nd; i++) {
    const rad = (0.5 + dr() * 1.5) / fr * 1000 / (g.pixEff * (r.roi ? 1 : g.k)); // mm shadow / f-ratio
    dust.push({ x: dr() * g.fullW * (r.roi ? g.k : 1) - (r.roi ? g.offX - W / 2 + g.fullW * g.k / 2 : 0), y: dr() * g.fullH * (r.roi ? g.k : 1) - (r.roi ? g.offY - H / 2 + g.fullH * g.k / 2 : 0), r: rad, a: 0.012 + dr() * 0.03 });
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const rr = Math.hypot(x - cx, y - cy) / rc;
    let v = 1 - vig * rr * rr * (0.75 + 0.25 * rr * rr);
    if (v < 0.03) v = 0.03;
    for (const d of dust) {
      const q = Math.hypot(x - d.x, y - d.y) / d.r;
      if (q < 1.15) v *= 1 - d.a * (q < 1 ? (0.55 + 0.45 * smoothstep(0.55, 1, q)) : (1.15 - q) / 0.15 * 0.9);
    }
    ff[y * W + x] = v;
  }
  flatCache.set(key, ff);
  if (flatCache.size > 12) flatCache.delete(flatCache.keys().next().value);
  return ff;
}

// ---------- analysis ----------
function analyze(fr) {
  const { W, H, nc, data } = fr;
  const N = W * H;
  // luminance-ish channel
  const L = nc === 1 ? data[0] : (() => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = (data[0][i] + data[1][i] + data[2][i]) / 3; return a; })();
  const samp = []; const step = Math.max(1, Math.floor(N / 40000));
  for (let i = 0; i < N; i += step) samp.push(L[i]);
  samp.sort((a, b) => a - b);
  const med = samp[samp.length >> 1];
  const devs = samp.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = devs[devs.length >> 1] * 1.4826 + 1e-6;
  const sat = samp.filter((v) => v >= fr.maxADU * 0.995).length / samp.length;
  // star detection: local maxima above 6 sigma
  const thr = med + 6 * mad;
  const stars = [];
  for (let y = 6; y < H - 6; y += 1) for (let x = 6; x < W - 6; x++) {
    const i = y * W + x, v = L[i];
    if (v < thr) continue;
    if (v < L[i - 1] || v < L[i + 1] || v < L[i - W] || v < L[i + W] || v < L[i - W - 1] || v < L[i + W + 1] || v < L[i - W + 1] || v < L[i + W - 1]) continue;
    if (v === L[i - 1] || v === L[i - W]) continue;
    stars.push({ x, y, v });
    if (stars.length > 4000) break;
  }
  stars.sort((a, b) => b.v - a.v);
  // HFR on the brightest unsaturated stars
  const hfrs = []; const ecc = [];
  for (const s of stars) {
    if (s.v > fr.maxADU * 0.9) continue;
    const R = 9;
    let tot = 0, sx = 0, sy = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = s.x + dx, yy = s.y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const f = L[yy * W + xx] - med - 2 * mad; if (f <= 0 || dx * dx + dy * dy > R * R) continue; tot += f; sx += f * dx; sy += f * dy;
    }
    if (tot <= 0) continue;
    const mx = sx / tot, my = sy / tot;
    let hr = 0, mxx = 0, myy = 0, mxy = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = s.x + dx, yy = s.y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const f = L[yy * W + xx] - med - 2 * mad; if (f <= 0 || dx * dx + dy * dy > R * R) continue;
      const ddx = dx - mx, ddy = dy - my;
      hr += f * Math.hypot(ddx, ddy); mxx += f * ddx * ddx; myy += f * ddy * ddy; mxy += f * ddx * ddy;
    }
    hfrs.push(hr / tot);
    mxx /= tot; myy /= tot; mxy /= tot;
    const tr = mxx + myy, det = mxx * myy - mxy * mxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
    ecc.push(Math.sqrt(1 - l2 / l1));
    if (hfrs.length >= 60) break;
  }
  const mid = (a) => { if (!a.length) return 0; const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  return { median: med, mad, saturated: sat, stars: stars.length, hfr: mid(hfrs), ecc: mid(ecc), bright: stars.slice(0, 40).map((s) => [s.x, s.y]) };
}

// Auto screen-transfer-function stretch -> RGBA preview
function preview(fr, opts = {}) {
  const { W, H, nc, data } = fr; const N = W * H;
  const outW = opts.maxW ? Math.min(W, opts.maxW) : W, sc = W / outW, outH = Math.round(H / sc);
  const rgba = new Uint8ClampedArray(outW * outH * 4);
  const params = [];
  for (let c = 0; c < nc; c++) {
    const a = data[c]; const samp = []; const step = Math.max(1, Math.floor(N / 30000));
    for (let i = 0; i < N; i += step) samp.push(a[i]); samp.sort((x, y) => x - y);
    const med = samp[samp.length >> 1]; const mad = samp.map((v) => Math.abs(v - med)).sort((x, y) => x - y)[samp.length >> 1] * 1.4826 + 1e-6;
    const max = fr.maxADU;
    const black = Math.max(0, med - 2.8 * mad), mN = (med - black) / (max - black);
    const target = 0.22;
    const mtf = mN <= 0 ? 0.5 : ((target - 1) * mN) / ((2 * target - 1) * mN - target);
    params.push({ black, max, mtf });
  }
  if (opts.linked && nc === 3) {
    const b = Math.min(...params.map((p) => p.black)); const m = params.reduce((s, p) => s + p.mtf, 0) / 3;
    for (const p of params) { p.black = b; p.mtf = m; }
  }
  if (opts.none) for (const p of params) { p.black = 0; p.mtf = 0.5; }
  const lut = (v, p) => { let x = (v - p.black) / (p.max - p.black); if (x <= 0) return 0; if (x >= 1) return 255; const m = p.mtf; return 255 * ((m - 1) * x) / ((2 * m - 1) * x - m); };
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const si = Math.min(H - 1, Math.floor(y * sc)) * W + Math.min(W - 1, Math.floor(x * sc));
    const o = (y * outW + x) * 4;
    if (nc === 1) { const v = lut(data[0][si], params[0]); rgba[o] = rgba[o + 1] = rgba[o + 2] = v; }
    else { rgba[o] = lut(data[0][si], params[0]); rgba[o + 1] = lut(data[1][si], params[1]); rgba[o + 2] = lut(data[2][si], params[2]); }
    rgba[o + 3] = 255;
  }
  return { rgba, w: outW, h: outH };
}

function histogram(fr) {
  const bins = 256, hist = []; const max = fr.maxADU;
  for (let c = 0; c < fr.nc; c++) {
    const h = new Uint32Array(bins); const a = fr.data[c]; const step = Math.max(1, Math.floor(a.length / 200000));
    for (let i = 0; i < a.length; i += step) h[Math.min(bins - 1, Math.floor((a[i] / max) * bins))]++;
    hist.push(h);
  }
  return hist;
}

// ---------- frame cache ----------
function cachePut(id, fr) {
  if (!id) return;
  const bytes = fr.data.length * fr.W * fr.H * 4;
  if (frameCache.has(id)) return;
  frameCache.set(id, fr); frameCacheBytes += bytes;
  while (frameCacheBytes > FRAME_CACHE_BUDGET && frameCache.size > 1) {
    const [k0, v0] = frameCache.entries().next().value; frameCache.delete(k0); frameCacheBytes -= v0.data.length * v0.W * v0.H * 4;
  }
}
async function getFrame(recipe) {
  if (recipe.id && frameCache.has(recipe.id)) { const f = frameCache.get(recipe.id); frameCache.delete(recipe.id); frameCache.set(recipe.id, f); return f; }
  const fr = await renderFrame(recipe);
  cachePut(recipe.id, fr);
  return fr;
}

// ---------- stacking ----------
function sampleBilinear(a, W, H, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) return NaN;
  const fx = x - x0, fy = y - y0, i = y0 * W + x0;
  return a[i] * (1 - fx) * (1 - fy) + a[i + 1] * fx * (1 - fy) + a[i + W] * (1 - fx) * fy + a[i + W + 1] * fx * fy;
}

// transform from reference-frame pixel to frame pixel, using true pointing at mid-exposure
function relTransform(ref, fr, W, H, scale) {
  const pr = midPointing(ref), pf = midPointing(fr);
  const p = A.tanProject(pr.ra, pr.dec, pf.ra, pf.dec);
  const dxi = p.xi * A.R2D * 3600 / scale, deta = p.eta * A.R2D * 3600 / scale; // arcsec->px, east/north
  const thR = pr.rot * A.D2R, thF = pf.rot * A.D2R;
  return (x, y) => {
    // ref pixel -> sky offset (base orientation x=west,y=south)
    const u = x - W / 2, v = y - H / 2;
    const bx = u * Math.cos(thR) + v * Math.sin(thR), by = -u * Math.sin(thR) + v * Math.cos(thR);
    // relative to frame center: frame center is at (bx,by)=(-dxi, -deta) in ref base orientation
    const qx = bx + dxi, qy = by + deta;
    const fu = qx * Math.cos(thF) - qy * Math.sin(thF), fv = qx * Math.sin(thF) + qy * Math.cos(thF);
    return [fu + W / 2, fv + H / 2];
  };
}
function midPointing(rec) {
  const m = pathAt(rec.path, 0.5);
  const c = A.offsetPA(rec.ra, rec.dec, Math.hypot(m[0], m[1]) / 3600, Math.atan2(m[0], m[1]) * A.R2D);
  return { ra: c.ra, dec: c.dec, rot: rec.rot + m[2] };
}

async function buildMaster(recipes, kind, progress, label) {
  if (!recipes || !recipes.length) return null;
  let acc = null, W, H, nc;
  for (let i = 0; i < recipes.length; i++) {
    progress(`${label}: frame ${i + 1}/${recipes.length}`, i / recipes.length);
    const fr = await renderFrame(recipes[i]);
    if (!acc) { W = fr.W; H = fr.H; nc = fr.nc; acc = fr.data.map(() => new Float32Array(W * H)); }
    for (let c = 0; c < nc; c++) { const a = acc[c], d = fr.data[c]; for (let j = 0; j < a.length; j++) a[j] += d[j]; }
  }
  for (const a of acc) for (let j = 0; j < a.length; j++) a[j] /= recipes.length;
  return { W, H, nc, data: acc };
}

async function stack(job, progress) {
  const { lights, darks, flats, biases, flatDarks, method, kappa = 2.5, normalize = true, drizzle } = job;
  void drizzle;
  progress('Preparing…', 0);
  const mDark = await buildMaster(darks, 'dark', (s, f) => progress('Master dark — ' + s, f * 0.15), 'Dark');
  const mBias = await buildMaster(biases, 'bias', (s, f) => progress('Master bias — ' + s, 0.15 + f * 0.05), 'Bias');
  const mFlatDark = await buildMaster(flatDarks, 'dark', (s, f) => progress('Flat darks — ' + s, 0.2 + f * 0.03), 'Flat dark');
  let mFlat = await buildMaster(flats, 'flat', (s, f) => progress('Master flat — ' + s, 0.23 + f * 0.07), 'Flat');
  if (mFlat) {
    const sub = mFlatDark || mBias;
    for (let c = 0; c < mFlat.nc; c++) {
      const a = mFlat.data[c]; const ped = sub ? null : flats[0].cam.type === 'dslr' ? flats[0].cam.offset : (flats[0].offset ?? flats[0].cam.offset) * 16;
      for (let j = 0; j < a.length; j++) a[j] -= sub ? sub.data[c][j] : ped;
      // normalize by center median
      const W = mFlat.W, H = mFlat.H; const s = [];
      for (let y = Math.floor(H * 0.4); y < H * 0.6; y += 2) for (let x = Math.floor(W * 0.4); x < W * 0.6; x += 2) s.push(a[y * W + x]);
      s.sort((p, q) => p - q); const med = Math.max(1, s[s.length >> 1]);
      for (let j = 0; j < a.length; j++) a[j] = Math.max(0.02, a[j] / med);
    }
  }
  // reference = best (first given) light
  const ref = lights[0];
  const n = lights.length;
  let W, H, nc, scale;
  const calibrated = async (rec, i, phase) => {
    progress(`${phase}: light ${i + 1}/${n}`, phase === 'Registering' ? 0.3 + 0.35 * i / n : 0.65 + 0.33 * i / n);
    const fr = await getFrame(rec);
    W = fr.W; H = fr.H; nc = fr.nc; scale = fr.scale;
    const ped = fr.pedestal;
    const outCh = [];
    for (let c = 0; c < nc; c++) {
      const src = fr.data[c], o = new Float32Array(W * H);
      const dk = mDark && mDark.W === W && mDark.nc === nc ? mDark.data[c] : null;
      const bs = !dk && mBias && mBias.W === W ? mBias.data[c] : null;
      const fl = mFlat && mFlat.W === W && mFlat.nc === nc ? mFlat.data[c] : null;
      for (let j = 0; j < o.length; j++) {
        let v = src[j] - (dk ? dk[j] : bs ? bs[j] : ped);
        if (fl) v /= fl[j];
        o[j] = v;
      }
      outCh.push(o);
    }
    return { fr, ch: outCh };
  };
  // pass 1: register + normalization stats (+ Welford for kappa-sigma)
  let mean = null, m2 = null, cnt = null, normRef = null;
  const norms = [];
  const xform = [];
  let accMax = null;
  for (let i = 0; i < n; i++) {
    const { ch } = await calibrated(lights[i], i, 'Registering');
    if (!mean) { mean = ch.map(() => new Float32Array(W * H)); m2 = ch.map(() => new Float32Array(W * H)); cnt = new Uint16Array(W * H); accMax = ch.map(() => new Float32Array(W * H).fill(-1e9)); }
    const T = relTransform(ref, lights[i], W, H, scale);
    xform.push(T);
    // normalization: median of each channel
    const nm = ch.map((a) => { const s = []; for (let j = 0; j < a.length; j += 97) s.push(a[j]); s.sort((p, q) => p - q); return s[s.length >> 1]; });
    if (!normRef) normRef = nm;
    norms.push(nm);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [fx, fy] = T(x + 0.5, y + 0.5);
      const j = y * W + x;
      let ok = true; const vals = [];
      for (let c = 0; c < nc; c++) {
        let v = sampleBilinear(ch[c], W, H, fx - 0.5, fy - 0.5);
        if (Number.isNaN(v)) { ok = false; break; }
        if (normalize) v = v - nm[c] + normRef[c];
        vals.push(v);
      }
      if (!ok) continue;
      cnt[j]++;
      for (let c = 0; c < nc; c++) {
        const v = vals[c], d = v - mean[c][j];
        mean[c][j] += d / cnt[j]; m2[c][j] += d * (v - mean[c][j]);
        if (v > accMax[c][j]) accMax[c][j] = v;
      }
    }
  }
  let result;
  if (method === 'max') {
    result = accMax;
  } else if (method === 'average' || n < 3) {
    result = mean;
  } else {
    // pass 2: kappa-sigma clipping
    const sum = mean.map(() => new Float32Array(W * H)); const c2 = new Uint16Array(W * H);
    for (let i = 0; i < n; i++) {
      const { ch } = await calibrated(lights[i], i, 'Integrating');
      const T = xform[i], nm = norms[i];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const j = y * W + x; if (cnt[j] < 1) continue;
        const [fx, fy] = T(x + 0.5, y + 0.5);
        let reject = false; const vals = [];
        for (let c = 0; c < nc; c++) {
          let v = sampleBilinear(ch[c], W, H, fx - 0.5, fy - 0.5);
          if (Number.isNaN(v)) { reject = true; break; }
          if (normalize) v = v - nm[c] + normRef[c];
          const sd = Math.sqrt(m2[c][j] / Math.max(1, cnt[j] - 1));
          if (cnt[j] >= 3 && Math.abs(v - mean[c][j]) > kappa * sd) reject = true;
          vals.push(v);
        }
        if (reject) continue;
        c2[j]++; for (let c = 0; c < nc; c++) sum[c][j] += vals[c];
      }
    }
    for (let c = 0; c < nc; c++) for (let j = 0; j < W * H; j++) sum[c][j] = c2[j] ? sum[c][j] / c2[j] : mean[c][j];
    result = sum;
  }
  // normalize result to 0..1 range of ADC
  const maxADU = lights[0].sensor.maxADU;
  for (let c = 0; c < nc; c++) for (let j = 0; j < W * H; j++) {
    const v = result[c][j] / maxADU; result[c][j] = cnt[j] ? (v < 0 ? 0 : v) : 0;
  }
  progress('Done', 1);
  const cov = new Float32Array(W * H); for (let j = 0; j < W * H; j++) cov[j] = cnt[j] / n;
  return { W, H, nc, data: result, coverage: cov, refPointing: midPointing(ref), scale };
}

// ---------- framing assistant image ----------
async function framingImage(ra, dec, fovDeg, size) {
  const sky = await getSky(ra, dec, (fovDeg * 3600) / size, fovDeg * 0.8);
  // stretch the linear back into a nice display image
  const N = sky.N; const rgba = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const f = (v) => Math.min(255, Math.pow(Math.max(0, v), 1 / 2.5) * 255 * 1.05 + 4);
    rgba[i * 4] = f(sky.R[i]); rgba[i * 4 + 1] = f(sky.G[i]); rgba[i * 4 + 2] = f(sky.B[i]); rgba[i * 4 + 3] = 255;
  }
  return { rgba, N, ra: sky.ra, dec: sky.dec, fov: sky.fov, synthetic: !!sky.synthetic };
}

// ---------- message handling ----------
self.onmessage = async (e) => {
  const { id, cmd, args } = e.data;
  const post = (res, transfer = []) => self.postMessage({ id, ok: true, res }, transfer);
  try {
    if (cmd === 'init') { starCat = args.stars || []; FRAME_CACHE_BUDGET = args.budget || FRAME_CACHE_BUDGET; post(true); return; }
    if (cmd === 'render') {
      const fr = await renderFrame(args.recipe, args.opts || {});
      if (args.recipe.id && !args.noCache) cachePut(args.recipe.id, fr);
      const stats = analyze(fr);
      const pv = preview(fr, { linked: args.linked });
      const thumb = args.thumb ? preview(fr, { maxW: 240, linked: args.linked }) : null;
      const hist = histogram(fr);
      const res = { W: fr.W, H: fr.H, nc: fr.nc, stats, preview: pv, thumb, hist, maxADU: fr.maxADU, trailPx: fr.trailPx || 0, warnings: fr.warnings, scale: fr.scale };
      const tr = [pv.rgba.buffer]; if (thumb) tr.push(thumb.rgba.buffer);
      if (args.wantData) { res.data = fr.data.map((a) => a.slice()); tr.push(...res.data.map((a) => a.buffer)); }
      post(res, tr);
      return;
    }
    if (cmd === 'view') {
      const fr = await getFrame(args.recipe);
      const pv = preview(fr, { linked: args.linked, none: args.none });
      post({ W: fr.W, H: fr.H, preview: pv, stats: analyze(fr), hist: histogram(fr), maxADU: fr.maxADU }, [pv.rgba.buffer]);
      return;
    }
    if (cmd === 'stack') {
      const res = await stack(args, (msg, f) => self.postMessage({ id, progress: true, msg, f }));
      post(res, [...res.data.map((a) => a.buffer), res.coverage.buffer]);
      return;
    }
    if (cmd === 'framing') {
      const res = await framingImage(args.ra, args.dec, args.fov, args.size || 900);
      post(res, [res.rgba.buffer]);
      return;
    }
    if (cmd === 'status') { post({ offline, cached: skyCache.length, frames: frameCache.size }); return; }
    throw new Error('unknown cmd ' + cmd);
  } catch (err) {
    self.postMessage({ id, ok: false, err: String(err && err.stack || err) });
  }
};
