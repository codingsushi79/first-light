// Client-side HiPS reprojection: builds a TAN-projected survey image straight from
// HEALPix tiles. Used when the CDS hips2fits cutout service is unreachable.
const TILE_ORDER = 9, TW = 1 << TILE_ORDER; // 512×512 pixel tiles
const ORDER_MAX = 9;                         // DSS2 color is published down to order 9 (0.8"/px)
const PX0 = 2.236e-4 * 3600;                 // arcsec/px at ORDER_MAX

// HEALPix nested ang2pix, returning face and in-face (ix, iy) at nside = 2^order.
export function ang2xy(order, z, phi, out) {
  const nside = 1 << order;
  const za = Math.abs(z);
  let tt = (phi * 2) / Math.PI; tt -= Math.floor(tt / 4) * 4; // [0,4)
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt), t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / nside), ifm = Math.floor(jm / nside);
    out.face = ifp === ifm ? (ifp | 4) : ifp < ifm ? ifp : ifm + 8;
    out.ix = jm & (nside - 1); out.iy = nside - (jp & (nside - 1)) - 1;
  } else {
    const ntt = Math.min(3, Math.floor(tt)), tp = tt - ntt;
    const tmp = nside * Math.sqrt(3 * (1 - za));
    const jp = Math.min(nside - 1, Math.floor(tp * tmp)), jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
    if (z >= 0) { out.face = ntt; out.ix = nside - jm - 1; out.iy = nside - jp - 1; }
    else { out.face = ntt + 8; out.ix = jp; out.iy = jm; }
  }
  return out;
}

function interleave(x, y) {
  let r = 0;
  for (let b = 0; b < 16; b++) r += (((x >> b) & 1) << (2 * b)) + (((y >> b) & 1) << (2 * b + 1));
  return r >>> 0;
}

// Tile order whose pixels are no coarser than the requested scale.
export function pickOrder(scaleArcsec) {
  const k = Math.ceil(ORDER_MAX - Math.log2(Math.max(1e-6, scaleArcsec / PX0)) - 1e-9);
  return Math.max(0, Math.min(ORDER_MAX, k));
}

export const tileUrl = (base, order, ipix) => `${base}/Norder${order}/Dir${Math.floor(ipix / 10000) * 10000}/Npix${ipix}.jpg`;

// Render an N×N RGBA image (north up, east left) centred on (ra, dec) spanning fovDeg.
// loadTile(order, ipix) → Promise<Uint8ClampedArray | null> of TW×TW RGBA pixels.
export async function renderHips(ra, dec, fovDeg, N, loadTile) {
  const D2R = Math.PI / 180, sc = (fovDeg * D2R) / N;
  const order = pickOrder((fovDeg * 3600) / N), sub = order + TILE_ORDER, mask = TW - 1;
  const a0 = ra * D2R, d0 = dec * D2R;
  const C = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
  const E = [-Math.sin(a0), Math.cos(a0), 0];
  const No = [-Math.sin(d0) * Math.cos(a0), -Math.sin(d0) * Math.sin(a0), Math.cos(d0)];
  const hp = { face: 0, ix: 0, iy: 0 };
  const locate = (x, y) => {
    const xi = (N / 2 - x - 0.5) * sc, eta = (N / 2 - y - 0.5) * sc;
    const vx = C[0] + xi * E[0] + eta * No[0], vy = C[1] + xi * E[1] + eta * No[1], vz = C[2] + xi * E[2] + eta * No[2];
    return ang2xy(sub, vz / Math.hypot(vx, vy, vz), Math.atan2(vy, vx), hp);
  };
  const tileId = () => hp.face * 4 ** order + interleave(hp.ix >> TILE_ORDER, hp.iy >> TILE_ORDER);
  // pass 1: which tiles are needed
  const need = new Set();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { locate(x, y); need.add(tileId()); }
  const tiles = new Map(), ids = [...need];
  let next = 0;
  const worker = async () => { while (next < ids.length) { const id = ids[next++]; tiles.set(id, await loadTile(order, id)); } };
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
  if (![...tiles.values()].some(Boolean)) throw new Error('no survey tiles');
  // pass 2: sample (tile rows run along ix, columns along iy)
  const img = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    locate(x, y);
    const t = tiles.get(tileId()), o = (y * N + x) * 4;
    img[o + 3] = 255;
    if (!t) continue;
    const s = ((hp.ix & mask) * TW + (hp.iy & mask)) * 4;
    img[o] = t[s]; img[o + 1] = t[s + 1]; img[o + 2] = t[s + 2];
  }
  return img;
}
