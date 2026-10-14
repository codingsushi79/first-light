// Deterministic weather per location & night, plus noisy forecasts.
import { makeNoise, mulberry32, hashStr, smoothstep } from './util.js';
import { LOC } from './gear.js';
import { climate } from './geo.js';
import { kpSeries } from './aurora.js';

export const NIGHT_START_HOUR = 17; // local
export const NIGHT_SLOTS = 16;      // 17:00 .. 08:00

const noises = {};
function noiseFor(id) { return noises[id] || (noises[id] = makeNoise(hashStr('wx:' + id))); }

// dayIndex = integer day count of the local evening date
export function actualWeather(locId, dayIndex) {
  const loc = LOC[locId] || LOC.backyard, nz = noiseFor(locId);
  const r = mulberry32(hashStr(`${locId}:${dayIndex}`));
  // season: northern-hemisphere-ish temperature swing using day of year
  const doy = ((dayIndex % 365) + 365) % 365;
  const P = climate(loc, doy);
  const regime = nz.fbm(dayIndex * 0.33, 3.7, 3); // slow fronts
  const clearBias = loc.clear - 0.5;
  const out = { clouds: [], seeing: [], transp: [], wind: [], temp: [], hum: [], dew: [], seed: hashStr(`clouds:${locId}:${dayIndex}`) };
  const seeingBase = P.seeing[0] + (P.seeing[1] - P.seeing[0]) * nz.fbm(dayIndex * 0.7 + 11, 1.1, 2);
  const windBase = P.wind * (0.4 + 1.2 * nz.fbm(dayIndex * 0.6 + 40, 2.2, 2));
  for (let h = 0; h < NIGHT_SLOTS; h++) {
    const t = dayIndex + h / 24;
    let c = (regime - 0.5) * 2.4 - clearBias * 1.4 + (nz.fbm(t * 4.0, 9.1, 3) - 0.5) * 1.4;
    c = smoothstep(-0.25, 0.65, c);
    if (c < 0.06) c = 0;
    out.clouds.push(+c.toFixed(2));
    const frac = h / (NIGHT_SLOTS - 1);
    const temp = P.tEve + (P.tDawn - P.tEve) * Math.sqrt(frac) + (nz.noise(t * 6, 5) - 0.5) * 2;
    out.temp.push(+temp.toFixed(1));
    const hum = Math.min(0.99, P.hum + frac * 0.12 + (nz.noise(t * 3, 17) - 0.5) * 0.15 + c * 0.1);
    out.hum.push(+hum.toFixed(2));
    // Magnus dew point
    const a = 17.62, b = 243.12, g = Math.log(hum) + (a * temp) / (b + temp);
    out.dew.push(+((b * g) / (a - g)).toFixed(1));
    const w = Math.max(0, windBase * (0.6 + 0.8 * nz.noise(t * 8, 23)) * (1 - frac * 0.3));
    out.wind.push(+w.toFixed(0));
    const s = seeingBase * (0.8 + 0.4 * nz.noise(t * 5, 31)) * (1 + w / 60);
    out.seeing.push(+s.toFixed(1));
    const tr = Math.max(0.35, 1 - 0.45 * nz.fbm(t * 2.5, 41, 2) * (0.5 + hum) - c * 0.2);
    out.transp.push(+tr.toFixed(2));
  }
  out.seeingBase = seeingBase;
  out.kp = kpSeries(dayIndex, NIGHT_SLOTS);
  out._r = r();
  return out;
}

export function forecast(locId, dayIndex, todayIndex) {
  const a = actualWeather(locId, dayIndex);
  const lead = Math.max(0, dayIndex - todayIndex);
  if (lead === 0) return { ...a, lead };
  const nz = noiseFor(locId + ':fc' + todayIndex);
  const f = JSON.parse(JSON.stringify(a));
  f.clouds = a.clouds.map((c, h) => {
    const e = (nz.noise(dayIndex * 3 + h * 0.2, 7) - 0.5) * 0.35 * lead;
    return +Math.max(0, Math.min(1, c + e)).toFixed(2);
  });
  f.seeing = a.seeing.map((s, h) => +(s * (1 + (nz.noise(h * 0.3, dayIndex) - 0.5) * 0.2 * lead)).toFixed(1));
  f.lead = lead;
  return f;
}

// Interpolate a weather series for a fractional hour offset from NIGHT_START_HOUR
export function wxAt(series, hourOffset) {
  const h = Math.max(0, Math.min(NIGHT_SLOTS - 1.001, hourOffset));
  const i = Math.floor(h), t = h - i;
  return series[i] * (1 - t) + series[Math.min(i + 1, series.length - 1)] * t;
}
