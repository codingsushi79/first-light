// Atlas — pick an observing site anywhere on Earth on a real NASA night-lights map.
import { h, toast, confirmDlg } from '../wm.js';
import { Viewer } from '../components.js';
import * as A from '../astro.js';
import { G, emit, save, fmtTime, localParts, localMs, dayIndexOf } from '../state.js';
import { LOC, LOCATIONS, registerLocation, money } from '../gear.js';
import { gibsUrl, estimateSite, travelCost, distanceKm, HOME, sqmToBortle } from '../geo.js';
import { actualWeather, forecast } from '../weather.js';
import * as S from '../session.js';

const BIOME_LABEL = { suburb: 'Suburbs', city: 'City rooftop', forest: 'Forest clearing', field: 'Open field', mountain: 'Mountains', observatory: 'Observatory summit', desert: 'Desert', snow: 'Snow / tundra', coast: 'Coastline', water: 'Open water' };

export const atlasApp = {
  title: 'Atlas', width: 1180, height: 720, minW: 760, minH: 480,
  icon: `<svg viewBox="0 0 40 40"><defs><radialGradient id="ga" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#2d4c8a"/><stop offset="1" stop-color="#050a1a"/></radialGradient></defs><rect width="40" height="40" rx="9" fill="#08101f"/><circle cx="20" cy="20" r="13" fill="url(#ga)"/><path d="M11 16c4-3 6 1 9-1s5-4 8-1M10 23c3 2 6-1 9 1s6 3 10 0" stroke="#ffd27a" stroke-width="1.4" fill="none" opacity=".9"/><circle cx="25" cy="15" r="1.2" fill="#ffe9a8"/><circle cx="15" cy="24" r="1" fill="#ffe9a8"/></svg>`,
  open(body) {
    let mapImg = null; const MW = 4096, MH = 2048;
    let sel = null; // {lat, lon, est?, loc?}
    const viewer = new Viewer({ placeholder: 'Loading NASA Black Marble night-lights map…', drawOverlay, onClick: (x, y) => pick(x, y) });
    const side = h('div', { class: 'at-side' });
    body.append(h('div', { class: 'at-root' }, viewer.el, side));
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { const c = document.createElement('canvas'); c.width = MW; c.height = MH; c.getContext('2d').drawImage(img, 0, 0, MW, MH); mapImg = c; viewer.setImage(c); };
    img.onerror = () => { viewer.placeholder = 'Map unavailable (offline?). You can still pick from the list.'; viewer.draw(); };
    img.src = gibsUrl('VIIRS_Black_Marble', -90, -180, 90, 180, MW, MH);
    const toXY = (lat, lon) => [((lon + 180) / 360) * MW, ((90 - lat) / 180) * MH];
    function drawOverlay(o, v) {
      if (!mapImg) return;
      const P = (lat, lon) => { const [x, y] = toXY(lat, lon); return [v.ox + x * v.s, v.oy + y * v.s]; };
      o.font = '11px system-ui';
      for (const l of LOCATIONS) {
        const [x, y] = P(l.lat, l.lon);
        const col = l.bortle <= 2 ? '#5cf08f' : l.bortle <= 4 ? '#b6e05c' : l.bortle <= 6 ? '#ffc34d' : '#ff6464';
        o.fillStyle = col; o.strokeStyle = '#000'; o.lineWidth = 2; o.beginPath(); o.arc(x, y, l.id === G.s.location && G.s.night ? 7 : 4.5, 0, 7); o.stroke(); o.fill();
        if (v.s > 0.35 || l.id === 'backyard') { o.fillStyle = '#e8eef8'; o.strokeText(l.name, x + 7, y + 4); o.fillText(l.name, x + 7, y + 4); }
      }
      const [hx, hy] = P(HOME.lat, HOME.lon); o.fillStyle = '#7fb2ff'; o.font = '14px system-ui'; o.fillText('⌂', hx - 4, hy - 7);
      if (sel) { const [x, y] = P(sel.lat, sel.lon); o.strokeStyle = '#fff'; o.lineWidth = 2; o.beginPath(); o.arc(x, y, 10, 0, 7); o.moveTo(x - 16, y); o.lineTo(x - 5, y); o.moveTo(x + 5, y); o.lineTo(x + 16, y); o.moveTo(x, y - 16); o.lineTo(x, y - 5); o.moveTo(x, y + 5); o.lineTo(x, y + 16); o.stroke(); }
      // day/night terminator for the current moment
      o.fillStyle = 'rgba(255,255,255,0.05)';
      const sun = A.sunRaDec(G.s.time); const gm = A.gmst(A.jd(G.s.time)); const subLon = A.norm180(sun.ra - gm), subLat = sun.dec;
      o.beginPath();
      for (let lon = -180; lon <= 180; lon += 3) { const lat = Math.atan(-Math.cos((lon - subLon) * A.D2R) / Math.tan(subLat * A.D2R)) * A.R2D; const [x, y] = P(lat, lon); lon === -180 ? o.moveTo(x, y) : o.lineTo(x, y); }
      const [ex, ey] = P(subLat > 0 ? -90 : 90, 180), [sx, sy] = P(subLat > 0 ? -90 : 90, -180); o.lineTo(ex, ey); o.lineTo(sx, sy); o.closePath();
      o.fillStyle = 'rgba(0,0,20,0.25)'; o.fill();
    }
    async function pick(x, y) {
      const lon = (x / MW) * 360 - 180, lat = 90 - (y / MH) * 180;
      if (lat < -85 || lat > 85) return;
      // snap to a known site if clicked close
      const known = LOCATIONS.map((l) => ({ l, d: distanceKm(lat, lon, l.lat, l.lon) })).sort((a, b) => a.d - b.d)[0];
      const kmPerPx = 40075 / MW / viewer.zoomScale();
      if (known && known.d < kmPerPx * 9) { sel = { lat: known.l.lat, lon: known.l.lon, loc: known.l }; viewer.draw(); render(); return; }
      sel = { lat: +lat.toFixed(3), lon: +lon.toFixed(3), loading: true }; viewer.draw(); render();
      try { sel.est = await estimateSite(sel.lat, sel.lon); } catch (e) { sel.err = e.message; }
      sel.loading = false; render();
    }
    function siteCard(loc) {
      const home = LOC.backyard; const today = dayIndexOf(G.s.time, home.tz);
      const p = localParts(G.s.time, loc.tz); const noon = localMs(p.y, p.mo, p.d, 12, 0, loc.tz);
      const ev = A.nightEvents(noon, loc.lat, loc.lon);
      const fc = forecast(loc.id, today, today);
      const clouds = fc.clouds.slice(2, 12).reduce((a, b) => a + b, 0) / 10;
      const kv = (k, v) => h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, v));
      const card = h('div', { class: 'card' }, h('div', { class: 'at-title' }, loc.name), h('div', { class: 'muted small' }, `${loc.region || ''}`), h('div', { class: 'small', style: { margin: '6px 0' } }, loc.desc || ''),
        kv('Coordinates', `${Math.abs(loc.lat).toFixed(2)}°${loc.lat >= 0 ? 'N' : 'S'}  ${Math.abs(loc.lon).toFixed(2)}°${loc.lon >= 0 ? 'E' : 'W'}`),
        kv('Sky quality', `${loc.sqm.toFixed(2)} mag/arcsec² · Bortle ${loc.bortle}`), kv('Terrain', BIOME_LABEL[loc.biome] || loc.biome), loc.elev ? kv('Elevation', `${loc.elev} m`) : null,
        kv('Local time', `${fmtTime(G.s.time, loc.tz)} (UTC${loc.tz >= 0 ? '+' : ''}${loc.tz})`),
        kv('Astronomical night', ev.astroStart && ev.astroEnd ? `${fmtTime(ev.astroStart, loc.tz)} – ${fmtTime(ev.astroEnd, loc.tz)}` : ev.sunStart ? 'never fully dark (twilight all night)' : 'no darkness (midnight sun)'),
        kv('Tonight’s clouds (forecast)', `${Math.round(clouds * 100)}%`), kv('Typical clear nights', `${Math.round(loc.clear * 100)}%`),
        kv('Distance from home', `${Math.round(distanceKm(HOME.lat, HOME.lon, loc.lat, loc.lon)).toLocaleString()} km`), kv('Trip cost', loc.travel ? money(loc.travel) : 'free'));
      const n = S.night();
      const go = h('button', { class: 'btn primary big', disabled: !!n || G.s.money < loc.travel, onclick: async () => {
        if (!(await confirmDlg('Travel', `Travel to ${loc.name}${loc.travel ? ' for ' + money(loc.travel) : ''} and set up tonight?`, 'Go'))) return;
        const r = S.startNight(loc.id); if (r.error) toast(r.error, 'warn'); else { toast(`Arrived at ${loc.name}. Setting up as the sun goes down…`); emit('wentOut'); }
      } }, n ? 'Already out observing' : G.s.money < loc.travel ? `Need ${money(loc.travel)}` : `🌙 Go observe here tonight`);
      card.append(h('div', { class: 'row wrap', style: { marginTop: '8px' } }, go, h('button', { class: 'btn', onclick: () => { G.s.wxLoc = loc.id; save(); toast('Selected in the Weather app.'); } }, 'Show forecast')));
      return card;
    }
    function render() {
      side.innerHTML = '';
      side.append(h('div', { class: 'card' }, h('h3', {}, 'Scout a site'), h('div', { class: 'small muted' }, 'Click anywhere on Earth. Sky brightness is estimated from real VIIRS satellite night-light data; terrain from NASA Blue Marble. Scroll to zoom, drag to pan.'),
        h('div', { class: 'small', style: { marginTop: '6px' } }, h('span', { style: { color: '#5cf08f' } }, '●'), ' Bortle 1–2  ', h('span', { style: { color: '#b6e05c' } }, '●'), ' 3–4  ', h('span', { style: { color: '#ffc34d' } }, '●'), ' 5–6  ', h('span', { style: { color: '#ff6464' } }, '●'), ' 7–9')));
      if (sel) {
        if (sel.loc) side.append(siteCard(sel.loc));
        else if (sel.loading) side.append(h('div', { class: 'card' }, h('div', {}, `${sel.lat.toFixed(3)}, ${sel.lon.toFixed(3)}`), h('div', { class: 'muted' }, 'Measuring night-sky brightness from satellite data…')));
        else if (sel.err) side.append(h('div', { class: 'card' }, h('div', { class: 'warnline' }, 'Could not reach NASA GIBS: ' + sel.err)));
        else if (sel.est) {
          const e = sel.est;
          if (e.biome === 'water') side.append(h('div', { class: 'card' }, h('b', {}, 'That’s open water.'), h('div', { class: 'muted small' }, 'Telescopes need solid ground (and boats wobble). Pick a spot on land.')));
          else {
            const id = `c_${sel.lat.toFixed(2)}_${sel.lon.toFixed(2)}`.replace(/\./g, 'p').replace(/-/g, 'm');
            const nameIn = h('input', { class: 'inp', value: `Site ${Math.abs(sel.lat).toFixed(1)}°${sel.lat >= 0 ? 'N' : 'S'} ${Math.abs(sel.lon).toFixed(1)}°${sel.lon >= 0 ? 'E' : 'W'}`, style: { width: '100%' } });
            const loc = registerLocation({ id, name: nameIn.value, region: 'Custom site', lat: sel.lat, lon: sel.lon, tz: e.tz, elev: 0, sqm: e.sqm, biome: e.biome, clear: e.clear, lpAz: e.lpAz, desc: `Scouted on the map. Estimated sky brightness ${e.sqm.toFixed(2)} mag/arcsec²${e.core > 0.3 ? ' — you are in a city core' : ''}.`, custom: true });
            side.append(h('div', { class: 'card' }, h('h3', {}, 'Name this site'), nameIn, h('button', { class: 'btn small', style: { marginTop: '6px' }, onclick: () => {
              loc.name = nameIn.value || loc.name;
              G.s.customSites = (G.s.customSites || []).filter((c) => c.id !== loc.id);
              G.s.customSites.push({ id: loc.id, name: loc.name, region: loc.region, lat: loc.lat, lon: loc.lon, tz: loc.tz, elev: 0, sqm: loc.sqm, biome: loc.biome, clear: loc.clear, lpAz: loc.lpAz, desc: loc.desc, custom: true });
              save(); toast('Site saved to your atlas.'); viewer.draw(); render();
            } }, '★ Save site')), siteCard(loc));
          }
        }
      }
      // list of sites sorted by darkness
      const list = h('div', { class: 'card' }, h('h3', {}, 'Famous & saved sites'));
      for (const l of [...LOCATIONS].sort((a, b) => b.sqm - a.sqm)) list.append(h('div', { class: 'at-item', onclick: () => { sel = { lat: l.lat, lon: l.lon, loc: l }; viewer.centerOn(...toXY(l.lat, l.lon), 1.2); render(); } },
        h('span', { class: 'at-b b' + l.bortle }, l.bortle), h('span', {}, l.name), h('span', { class: 'muted small' }, l.travel ? money(l.travel) : 'free')));
      side.append(list);
    }
    render();
    return { onResize() { viewer.draw(); } };
  },
};
void actualWeather; void sqmToBortle; void travelCost;
