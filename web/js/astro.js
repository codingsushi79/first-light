// Astronomy math: time, coordinates, Sun & Moon, sky brightness.
// All catalog coordinates are treated as J2000 (precession ignored, consistently).
export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const SIDEREAL_RATE = 15.041067; // arcsec per second of time
export const OMEGA = 7.2921159e-5;      // rad/s

export const norm360 = (a) => ((a % 360) + 360) % 360;
export const norm180 = (a) => { a = norm360(a); return a > 180 ? a - 360 : a; };
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function jd(ms) { return ms / 86400000 + 2440587.5; }
export function gmst(J) {
  const d = J - 2451545.0, T = d / 36525;
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000);
}
export function lst(ms, lon) { return norm360(gmst(jd(ms)) + lon); }

// ra, dec, lst, lat in degrees. az from North through East.
export function radec2altaz(ra, dec, lstDeg, lat) {
  const H = (lstDeg - ra) * D2R, d = dec * D2R, p = lat * D2R;
  const sinAlt = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(p) * Math.cos(H);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(p) - Math.tan(d) * Math.cos(p)) + Math.PI;
  return { alt: alt * R2D, az: norm360(az * R2D) };
}
export function altaz2radec(alt, az, lstDeg, lat) {
  const a = alt * D2R, A = az * D2R, p = lat * D2R;
  const sinD = Math.sin(a) * Math.sin(p) + Math.cos(a) * Math.cos(p) * Math.cos(A);
  const dec = Math.asin(clamp(sinD, -1, 1));
  const H = Math.atan2(-Math.sin(A) * Math.cos(a), Math.sin(a) * Math.cos(p) - Math.cos(a) * Math.sin(p) * Math.cos(A));
  return { ra: norm360(lstDeg - H * R2D), dec: dec * R2D };
}

export function sep(ra1, dec1, ra2, dec2) {
  const a = Math.sin(dec1 * D2R) * Math.sin(dec2 * D2R) + Math.cos(dec1 * D2R) * Math.cos(dec2 * D2R) * Math.cos((ra1 - ra2) * D2R);
  return Math.acos(clamp(a, -1, 1)) * R2D;
}
// position angle of point 2 as seen from point 1, east of north (deg)
export function posAngle(ra1, dec1, ra2, dec2) {
  const da = (ra2 - ra1) * D2R, d1 = dec1 * D2R, d2 = dec2 * D2R;
  return norm360(Math.atan2(Math.sin(da) * Math.cos(d2), Math.cos(d1) * Math.sin(d2) - Math.sin(d1) * Math.cos(d2) * Math.cos(da)) * R2D);
}
// offset a point by distance (deg) along position angle (deg)
export function offsetPA(ra, dec, distDeg, paDeg) {
  const d = dec * D2R, r = distDeg * D2R, p = paDeg * D2R;
  const sd = Math.sin(d) * Math.cos(r) + Math.cos(d) * Math.sin(r) * Math.cos(p);
  const nd = Math.asin(clamp(sd, -1, 1));
  const dra = Math.atan2(Math.sin(p) * Math.sin(r) * Math.cos(d), Math.cos(r) - Math.sin(d) * sd);
  return { ra: norm360(ra + dra * R2D), dec: nd * R2D };
}
// Gnomonic (TAN) projection. Returns standard coords (xi east, eta north) in radians.
export function tanProject(ra0, dec0, ra, dec) {
  const a0 = ra0 * D2R, d0 = dec0 * D2R, a = ra * D2R, d = dec * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = Math.cos(d) * Math.sin(a - a0) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
  return { xi, eta, front: cosc > 0 };
}
export function tanDeproject(ra0, dec0, xi, eta) {
  const a0 = ra0 * D2R, d0 = dec0 * D2R;
  const rho = Math.hypot(xi, eta);
  if (rho === 0) return { ra: ra0, dec: dec0 };
  const c = Math.atan(rho);
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + eta * Math.sin(c) * Math.cos(d0) / rho);
  const ra = a0 + Math.atan2(xi * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - eta * Math.sin(d0) * Math.sin(c));
  return { ra: norm360(ra * R2D), dec: dec * R2D };
}

export function airmass(altDeg) {
  if (altDeg <= -1) return 40;
  const h = Math.max(altDeg, 0);
  return Math.min(40, 1 / (Math.sin(h * D2R) + 0.50572 * Math.pow(h + 6.07995, -1.6364)));
}
// Atmospheric refraction (deg) for apparent altitude
export function refraction(altDeg) {
  if (altDeg < -2) return 0;
  return (1.02 / Math.tan((altDeg + 10.3 / (altDeg + 5.11)) * D2R)) / 60;
}

export function sunRaDec(ms) {
  const n = jd(ms) - 2451545.0;
  const L = norm360(280.460 + 0.9856474 * n), g = norm360(357.528 + 0.9856003 * n) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  return { ra: norm360(Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * R2D), dec: Math.asin(Math.sin(eps) * Math.sin(lam)) * R2D, lon: lam * R2D };
}

export function moonRaDec(ms) {
  const d = jd(ms) - 2451545.0;
  const L = 218.316 + 13.176396 * d, M = (134.963 + 13.064993 * d) * D2R, F = (93.272 + 13.229350 * d) * D2R;
  const D = (297.850 + 12.190749 * d) * D2R, Ms = (357.529 + 0.98560028 * d) * D2R;
  const lam = L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D) - 0.186 * Math.sin(Ms) + 0.214 * Math.sin(2 * M) - 0.114 * Math.sin(2 * F);
  const bet = 5.128 * Math.sin(F) + 0.281 * Math.sin(M + F) + 0.278 * Math.sin(M - F);
  const dist = 385001 - 20905 * Math.cos(M);
  const eps = 23.439 * D2R, l = lam * D2R, b = bet * D2R;
  const ra = Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
  return { ra: norm360(ra * R2D), dec: dec * R2D, lon: norm360(lam), lat: bet, dist };
}
// Moon phase: illuminated fraction and phase angle (deg, 0 = full)
export function moonPhase(ms) {
  const s = sunRaDec(ms), m = moonRaDec(ms);
  const elong = Math.acos(Math.cos(m.lat * D2R) * Math.cos((m.lon - s.lon) * D2R)) * R2D;
  const phaseAngle = 180 - elong;
  const waxing = norm360(m.lon - s.lon) < 180;
  return { illum: (1 + Math.cos(phaseAngle * D2R)) / 2, phaseAngle, waxing, elong };
}
export function moonAltAz(ms, lat, lon) {
  const m = moonRaDec(ms), aa = radec2altaz(m.ra, m.dec, lst(ms, lon), lat);
  aa.alt -= 0.95 * Math.cos(aa.alt * D2R); // topocentric parallax
  return { ...aa, ra: m.ra, dec: m.dec };
}
export function sunAltAz(ms, lat, lon) {
  const s = sunRaDec(ms); return { ...radec2altaz(s.ra, s.dec, lst(ms, lon), lat), ra: s.ra, dec: s.dec };
}

// ---- Sky brightness (V mag / arcsec^2) ----
export const magToNL = (V) => 34.08 * Math.exp(20.7233 - 0.92104 * V);
export const nlToMag = (B) => (20.7233 - Math.log(B / 34.08)) / 0.92104;

// Krisciunas & Schaefer (1991) moonlight sky brightness, nanoLamberts
export function moonSkyNL(phaseAngle, moonAlt, targetAlt, rhoDeg, k = 0.172) {
  if (moonAlt < -1) return 0;
  const a = Math.abs(phaseAngle);
  const I = Math.pow(10, -0.4 * (3.84 + 0.026 * a + 4e-9 * Math.pow(a, 4)));
  const rho = Math.max(rhoDeg, 2);
  const f = Math.pow(10, 5.36) * (1.06 + Math.cos(rho * D2R) ** 2) + Math.pow(10, 6.15 - rho / 40);
  const X = (z) => Math.pow(1 - 0.96 * Math.sin(z * D2R) ** 2, -0.5);
  const zm = 90 - Math.max(moonAlt, 0), zt = 90 - clamp(targetAlt, 0, 90);
  const fade = clamp((moonAlt + 1) / 2, 0, 1);
  return fade * f * I * Math.pow(10, -0.4 * k * X(zm)) * (1 - Math.pow(10, -0.4 * k * X(zt)));
}
// Twilight contribution (nL) for sun altitude h and separation from sun
export function twilightNL(sunAlt, sunSep) {
  if (sunAlt < -18.5) return 0;
  const V = sunAlt > -6 ? Math.max(3.5, 11.6 + sunAlt * 0.95) : 23 - 0.95 * (sunAlt + 18);
  const dirBoost = 1 + 1.6 * Math.max(0, Math.cos(sunSep * D2R)) ** 3;
  return magToNL(V) * dirBoost;
}

// Find times where a function of time crosses a threshold, within [t0,t1]
export function findCrossings(fn, t0, t1, threshold, step = 600000) {
  const out = [];
  let tPrev = t0, vPrev = fn(t0) - threshold;
  for (let t = t0 + step; t <= t1 + 1; t += step) {
    const v = fn(t) - threshold;
    if ((v > 0) !== (vPrev > 0)) {
      let a = tPrev, b = t, va = vPrev;
      for (let i = 0; i < 18; i++) { const m = (a + b) / 2, vm = fn(m) - threshold; if ((vm > 0) === (va > 0)) { a = m; va = vm; } else b = m; }
      out.push({ t: (a + b) / 2, rising: v > 0 });
    }
    tPrev = t; vPrev = v;
  }
  return out;
}

// Night events for the night starting on the local date containing noonMs
export function nightEvents(noonMs, lat, lon) {
  const end = noonMs + 86400000;
  const sun = (t) => sunAltAz(t, lat, lon).alt;
  const ev = {};
  const pick = (thr, key) => {
    const c = findCrossings(sun, noonMs, end, thr, 300000);
    const set = c.find((x) => !x.rising), rise = c.find((x) => x.rising);
    ev[key + 'Start'] = set ? set.t : null; ev[key + 'End'] = rise ? rise.t : null;
  };
  pick(-0.833, 'sun'); pick(-6, 'civil'); pick(-12, 'naut'); pick(-18, 'astro');
  return ev; // sunStart=sunset, sunEnd=sunrise, astroStart=astronomical dusk ...
}

export function parallacticAngle(ra, dec, lstDeg, lat) {
  const H = (lstDeg - ra) * D2R, d = dec * D2R, p = lat * D2R;
  return Math.atan2(Math.sin(H), Math.tan(p) * Math.cos(d) - Math.sin(d) * Math.cos(H)) * R2D;
}

// formatting helpers
export function fmtRA(ra) {
  const h = norm360(ra) / 15; const hh = Math.floor(h); const m = (h - hh) * 60; const mm = Math.floor(m); const ss = (m - mm) * 60;
  return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${ss.toFixed(1).padStart(4, '0')}s`;
}
export function fmtDec(dec) {
  const s = dec < 0 ? '−' : '+'; const a = Math.abs(dec); const d = Math.floor(a); const m = (a - d) * 60; const mm = Math.floor(m); const ss = Math.round((m - mm) * 60);
  return `${s}${String(d).padStart(2, '0')}° ${String(mm).padStart(2, '0')}′ ${String(ss % 60).padStart(2, '0')}″`;
}
export function fmtDeg(d, digits = 1) { return `${d.toFixed(digits)}°`; }
export function fmtAngle(arcsec) {
  const a = Math.abs(arcsec);
  if (a < 60) return `${arcsec.toFixed(1)}″`;
  if (a < 3600) return `${(arcsec / 60).toFixed(1)}′`;
  return `${(arcsec / 3600).toFixed(2)}°`;
}
