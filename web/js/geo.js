// Observing sites anywhere on Earth.
// Curated famous sites carry published sky-quality values; for any other point we estimate
// sky brightness from NASA VIIRS "Black Marble" night lights (distance-weighted light sum,
// Walker's-law style falloff) and the terrain type from NASA Blue Marble land colour.
import { mulberry32, hashStr, makeNoise } from './util.js';

const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&STYLES=';
export const gibsUrl = (layer, latMin, lonMin, latMax, lonMax, w, h, fmt = 'image/png') => `${GIBS}&LAYERS=${layer}&BBOX=${latMin},${lonMin},${latMax},${lonMax}&WIDTH=${w}&HEIGHT=${h}&FORMAT=${encodeURIComponent(fmt)}`;

export const HOME = { lat: 40.05, lon: -75.2 };

// [id, name, region, lat, lon, tz(Oct), elev m, SQM, biome, clear-sky fraction, description]
export const WORLD_SITES = [
  ['backyard', 'Your backyard (suburbs)', 'Pennsylvania, USA', 40.05, -75.2, -4, 60, 18.9, 'suburb', 0.55, 'Street lights, the neighbour’s porch lamp and a big oak tree. But it’s free and 10 seconds from your couch.'],
  ['park', 'County park field', 'Pennsylvania, USA', 40.45, -75.6, -4, 150, 20.3, 'forest', 0.56, '45-minute drive. Rural-suburban transition, a tree line around the field.'],
  ['cherry', 'Cherry Springs State Park', 'Pennsylvania, USA', 41.66, -77.82, -4, 700, 21.7, 'field', 0.45, 'Gold-tier International Dark Sky Park on a hilltop clearing. The East Coast’s darkest skies.'],
  ['darksite', 'Spruce Knob dark site', 'West Virginia, USA', 38.7, -79.53, -4, 1480, 21.6, 'mountain', 0.5, 'Mountain-top club site. The Milky Way casts shadows.'],
  ['bigbend', 'Big Bend National Park', 'Texas, USA', 29.25, -103.25, -5, 1100, 21.9, 'desert', 0.72, 'Remote Chihuahuan desert; one of the darkest places in the lower 48.'],
  ['desert', 'Arizona desert ranch', 'Arizona, USA', 31.9, -110.9, -7, 1200, 21.9, 'desert', 0.75, 'Dark-sky ranch near Kitt Peak. Excellent seeing, usually clear.'],
  ['deathvalley', 'Death Valley (Badwater)', 'California, USA', 36.46, -116.87, -7, -50, 21.8, 'desert', 0.8, 'Below sea level, bone dry, Las Vegas glow on the eastern horizon.'],
  ['maunakea', 'Mauna Kea visitor station', 'Hawaii, USA', 19.76, -155.46, -10, 2800, 21.8, 'observatory', 0.7, 'Above the clouds with the world’s great telescopes. Superb seeing.'],
  ['jasper', 'Jasper Dark Sky Preserve', 'Alberta, Canada', 52.87, -118.08, -6, 1060, 21.6, 'snow', 0.45, 'Rocky Mountain lakeshore. Cold, often clear, sometimes auroras.'],
  ['megantic', 'Mont-Mégantic', 'Québec, Canada', 45.46, -71.15, -4, 1100, 21.3, 'forest', 0.45, 'The world’s first International Dark Sky Reserve.'],
  ['lapalma', 'Roque de los Muchachos', 'La Palma, Spain', 28.76, -17.89, 1, 2400, 21.9, 'observatory', 0.75, 'Above the trade-wind inversion at Europe’s premier observatory.'],
  ['teide', 'Teide National Park', 'Tenerife, Spain', 28.27, -16.64, 1, 2300, 21.7, 'mountain', 0.72, 'Volcanic moonscape above the clouds.'],
  ['picdumidi', 'Pic du Midi', 'Pyrenees, France', 42.94, 0.14, 2, 2870, 21.5, 'mountain', 0.5, 'Mountain-top observatory with legendary planetary seeing.'],
  ['exmoor', 'Exmoor National Park', 'England, UK', 51.1, -3.6, 1, 400, 21.2, 'field', 0.33, 'Europe’s first Dark Sky Reserve. Bring patience for the clouds.'],
  ['galloway', 'Galloway Forest Park', 'Scotland, UK', 55.1, -4.5, 1, 250, 21.6, 'forest', 0.32, 'Gold-tier dark sky park in the Scottish lowlands.'],
  ['abisko', 'Abisko', 'Lapland, Sweden', 68.35, 18.82, 2, 400, 21.7, 'snow', 0.45, 'Arctic lake country. Long nights, snow, maybe auroras.'],
  ['iceland', 'Þingvellir', 'Iceland', 64.26, -21.12, 0, 100, 21.6, 'snow', 0.33, 'Rift valley under subarctic skies.'],
  ['merzouga', 'Merzouga dunes', 'Sahara, Morocco', 31.1, -4.0, 1, 700, 21.8, 'desert', 0.82, 'Camp among the Erg Chebbi dunes.'],
  ['wadirum', 'Wadi Rum', 'Jordan', 29.58, 35.42, 3, 900, 21.7, 'desert', 0.85, 'Red-sand desert valley between sandstone mountains.'],
  ['namibrand', 'NamibRand Nature Reserve', 'Namibia', -25.0, 16.0, 2, 1000, 22.0, 'desert', 0.85, 'One of the darkest measured places on Earth. Southern Milky Way overhead.'],
  ['sutherland', 'Sutherland Karoo', 'South Africa', -32.38, 20.81, 2, 1760, 21.8, 'desert', 0.75, 'Semi-desert plateau home to SALT, Africa’s largest telescope.'],
  ['hanle', 'Hanle Dark Sky Reserve', 'Ladakh, India', 32.78, 78.96, 5.5, 4500, 21.9, 'mountain', 0.78, 'High-altitude cold desert at 4500 m. Thin, dry air.'],
  ['gobi', 'Gobi Desert camp', 'Mongolia', 43.5, 104.0, 8, 1500, 21.9, 'desert', 0.75, 'Endless steppe-desert under a vast sky.'],
  ['tekapo', 'Aoraki Mackenzie (Tekapo)', 'New Zealand', -44.0, 170.48, 13, 710, 21.7, 'mountain', 0.55, 'Southern Alps dark sky reserve. Magellanic Clouds and the galactic core.'],
  ['warrumbungle', 'Warrumbungle / Siding Spring', 'NSW, Australia', -31.27, 149.06, 11, 900, 21.8, 'forest', 0.65, 'Australia’s astronomy capital.'],
  ['uluru', 'Uluru outback', 'Northern Territory, Australia', -25.34, 131.04, 9.5, 500, 21.9, 'desert', 0.8, 'Red centre of Australia. The southern sky in all its glory.'],
  ['atacama', 'Atacama, Chile', 'Chile', -23.0, -68.2, -3, 2450, 22.0, 'desert', 0.9, 'The driest desert on Earth. Bucket-list trip.'],
  ['chalten', 'El Chaltén', 'Patagonia, Argentina', -49.33, -72.88, -3, 400, 21.8, 'mountain', 0.35, 'Under Mount Fitz Roy at the end of the world.'],
  ['nyc', 'Manhattan rooftop', 'New York, USA', 40.75, -73.98, -4, 10, 16.0, 'city', 0.5, 'Brightest sky you can imagine. Narrowband filters or bust.'],
  ['vegas', 'Las Vegas Strip', 'Nevada, USA', 36.17, -115.14, -7, 610, 16.2, 'city', 0.78, 'The sky glows orange. Clear though!'],
  ['london', 'London rooftop', 'England, UK', 51.5, -0.12, 1, 20, 16.6, 'city', 0.3, 'Bortle 9 and British weather. Hardcore mode.'],
  ['tokyo', 'Tokyo rooftop', 'Japan', 35.68, 139.76, 9, 40, 15.8, 'city', 0.45, 'Megacity skyline. Only the Moon and the brightest stars survive.'],
  ['hongkong', 'Hong Kong rooftop', 'China', 22.3, 114.17, 8, 30, 15.9, 'city', 0.45, 'Skyscraper canyon, neon everywhere.'],
];

export function sqmToBortle(s) { return s > 21.75 ? 1 : s > 21.5 ? 2 : s > 21.3 ? 3 : s > 20.4 ? 4 : s > 19.5 ? 5 : s > 18.94 ? 6 : s > 18.38 ? 7 : s > 17.5 ? 8 : 9; }

export function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, dl = (lat2 - lat1) * r, dn = (lon2 - lon1) * r;
  const a = Math.sin(dl / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dn / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
export function travelCost(lat, lon) {
  const d = distanceKm(HOME.lat, HOME.lon, lat, lon);
  if (d < 3) return 0;
  if (d < 600) return Math.round(10 + d * 0.22);            // driving, round trip gas
  if (d < 3000) return Math.round(220 + d * 0.11);          // domestic flight + rental + motel
  return Math.round(500 + d * 0.085);                       // international trip
}

// Procedural horizon profile for a biome (matches the 3D scenery)
function makeHorizon(biome, seed) {
  const r = mulberry32(seed), nz = makeNoise(seed);
  const base = { suburb: [5, 13], city: [16, 34], forest: [7, 15], field: [2, 7], mountain: [1, 6], observatory: [0, 3], desert: [0.5, 4], snow: [1, 6], coast: [0, 3] }[biome] || [2, 8];
  const pts = [];
  for (let az = 0; az <= 360; az += 15) {
    let h = base[0] + (base[1] - base[0]) * nz.fbm(az / 60, 3.3, 3);
    if (biome === 'mountain' || biome === 'snow') h += Math.max(0, nz.fbm(az / 25, 9, 2) - 0.55) * 18;
    if (biome === 'coast' && az > 90 && az < 270) h = 0.2;
    if (biome === 'city' && r() < 0.25) h += 10;
    pts.push([az, +h.toFixed(1)]);
  }
  pts[pts.length - 1][1] = pts[0][1];
  return pts;
}
export function climate(loc, doy) {
  const a = Math.abs(loc.lat), south = loc.lat < 0;
  const season = Math.cos(((doy - (south ? 20 : 200)) / 365) * 2 * Math.PI); // +1 = mid-summer
  const mean = 29 - 0.42 * a + season * Math.min(16, 0.33 * a) - 5 * (loc.elev || 0) / 1000;
  const dry = { desert: 1, observatory: 0.8, mountain: 0.5, city: 0.3, suburb: 0.3, field: 0.3, forest: 0.2, snow: 0.3, coast: 0 }[loc.biome] ?? 0.3;
  const hum = { desert: 0.22, observatory: 0.25, mountain: 0.5, city: 0.65, suburb: 0.76, field: 0.78, forest: 0.82, snow: 0.72, coast: 0.82 }[loc.biome] ?? 0.7;
  const high = (loc.elev || 0) > 2000;
  const seeing = high ? [0.6, 1.6] : loc.biome === 'desert' ? [1.0, 2.5] : loc.biome === 'city' ? [2.0, 4.5] : [1.6, 4.0];
  return { tEve: mean + 3 + 4 * dry, tDawn: mean - 3 - 6 * dry, hum, seeing, wind: loc.biome === 'mountain' || loc.biome === 'coast' || loc.biome === 'observatory' ? 18 : 10 };
}

export function makeLocation(spec) {
  const { id, name, region, lat, lon, tz, elev = 0, sqm, biome, clear = 0.55, desc = '', lpAz, lpStrength, custom } = spec;
  const seed = hashStr('loc:' + id);
  const horizon = spec.horizon || makeHorizon(biome, seed);
  return {
    id, name, region, lat, lon, tz, elev, sqm, biome, clear, desc, custom: !!custom,
    bortle: sqmToBortle(sqm), travel: travelCost(lat, lon),
    lpAz: lpAz ?? (mulberry32(seed)() * 360), lpStrength: lpStrength ?? Math.max(0.08, Math.min(2, (21.9 - sqm) / 2.2)),
    horizon,
  };
}
export function siteFromRow(r) {
  const [id, name, region, lat, lon, tz, elev, sqm, biome, clear, desc] = r;
  const extra = id === 'backyard' ? { lpAz: 200, lpStrength: 1.6, horizon: [[0, 9], [30, 14], [55, 17], [80, 7], [120, 5], [150, 8], [180, 5], [210, 6], [240, 12], [270, 14], [300, 8], [330, 6], [360, 9]] }
    : id === 'park' ? { lpAz: 150, lpStrength: 1.0, horizon: [[0, 6], [40, 9], [90, 5], [130, 7], [180, 4], [220, 8], [270, 6], [320, 9], [360, 6]] } : {};
  return makeLocation({ id, name, region, lat, lon, tz, elev, sqm, biome, clear, desc, ...extra });
}

// ------------------------------------------------------------ estimation for arbitrary points
async function loadImageData(url, w, h) {
  const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
  const bmp = await createImageBitmap(await r.blob());
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h); return g.getImageData(0, 0, w, h).data;
}
// Estimate zenith sky brightness (SQM) from the surrounding 4°×4° of VIIRS night lights.
export async function estimateSky(lat, lon) {
  const R = 2, N = 320;
  const d = await loadImageData(gibsUrl('VIIRS_Black_Marble', lat - R, lon - R, lat + R, lon + R, N, N), N, N);
  const kmy = (2 * R * 111) / N, kmx = kmy * Math.cos(lat * Math.PI / 180);
  let S = 0, vx = 0, vy = 0, sat = 0, satN = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4; const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    const dx = (x - N / 2) * kmx, dy = (N / 2 - y) * kmy, dist = Math.hypot(dx, dy);
    if (dist < 6) { satN++; if (lum > 190) sat++; }
    const L = lum - 55; if (L <= 2) continue;
    const w = Math.pow(L / 200, 2.2) * Math.pow(Math.max(dist, 4), -2.5) * kmx * kmy;
    S += w; if (dist > 4) { vx += w * dx / dist; vy += w * dy / dist; }
  }
  const core = satN ? sat / satN : 0;
  let sqm = 21.95 - 2.5 * Math.log10(1 + S * 8.8) - 0.9 * core * core;
  sqm = Math.max(15.5, Math.min(22.0, sqm));
  const lpAz = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
  return { sqm: +sqm.toFixed(2), lpAz, core };
}
// Terrain type from Blue Marble colour at the point
export async function estimateBiome(lat, lon, sqm) {
  const R = 0.15, N = 16;
  const d = await loadImageData(gibsUrl('BlueMarble_NextGeneration', lat - R, lon - R, lat + R, lon + R, N, N, 'image/jpeg'), N, N);
  let r = 0, g = 0, b = 0; for (let i = 0; i < N * N; i++) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; }
  r /= N * N; g /= N * N; b /= N * N;
  const ci = Math.floor(N / 2) * N + Math.floor(N / 2); const cr = d[ci * 4], cg = d[ci * 4 + 1], cb = d[ci * 4 + 2];
  const avg = (cr + cg + cb) / 3; const water = (cb > cr + 8 && cb >= cg && avg < 110) || avg < 22;
  if (water) return { biome: 'water', rgb: [r, g, b] };
  if (sqm < 17.6) return { biome: 'city', rgb: [r, g, b] };
  if (sqm < 19.6) return { biome: 'suburb', rgb: [r, g, b] };
  const bright = (r + g + b) / 3;
  if (bright > 175 && Math.abs(r - b) < 25) return { biome: 'snow', rgb: [r, g, b] };
  if (r > g && g > b && bright > 105) return { biome: 'desert', rgb: [r, g, b] };
  if (g >= r && bright < 95) return { biome: 'forest', rgb: [r, g, b] };
  if (bright < 80) return { biome: 'mountain', rgb: [r, g, b] };
  return { biome: 'field', rgb: [r, g, b] };
}
export async function estimateSite(lat, lon) {
  const sky = await estimateSky(lat, lon);
  const bio = await estimateBiome(lat, lon, sky.sqm);
  // rough cloudiness climatology: dry subtropics clear, mid-latitudes & tropics cloudier
  const a = Math.abs(lat);
  let clear = a < 12 ? 0.42 : a < 35 ? 0.62 : a < 55 ? 0.48 : 0.38;
  if (bio.biome === 'desert') clear = Math.max(clear, 0.78);
  return { ...sky, biome: bio.biome, clear, tz: Math.round(lon / 15 * 2) / 2 };
}
