// Gear catalog, locations and rig calculations.
import { WORLD_SITES, siteFromRow, makeLocation } from './geo.js';
// Brands are fictional; specs are modelled on typical real-world equipment.

export const CAMERAS = [
  { id: 'dslr_stock', kind: 'camera', name: 'Northlight D600 DSLR', brand: 'Northlight', price: 450, weight: 0.68, type: 'dslr', mono: false,
    w: 6000, h: 4000, pix: 3.72, qe: 0.42, qeRGB: [0.85, 1, 0.8], haFactor: 0.22, bits: 14, fw: 26000,
    isos: [100, 200, 400, 800, 1600, 3200, 6400, 12800], baseISO: 100, unityISO: 600, rnLow: 18, rnHigh: 2.4, offset: 2048,
    cooled: false, dark25: 0.12, hot: 0.0009, ampGlow: 0, banding: 0.5,
    desc: 'Your trusty entry-level APS-C DSLR. Stock IR-cut filter blocks ~78% of hydrogen-alpha light, so red emission nebulae look faint.' },
  { id: 'dslr_mod', kind: 'camera', name: 'Northlight D600a (astro-modified)', brand: 'Northlight', price: 690, weight: 0.68, type: 'dslr', mono: false,
    w: 6000, h: 4000, pix: 3.72, qe: 0.42, qeRGB: [0.95, 1, 0.8], haFactor: 1.0, bits: 14, fw: 26000,
    isos: [100, 200, 400, 800, 1600, 3200, 6400, 12800], baseISO: 100, unityISO: 600, rnLow: 18, rnHigh: 2.4, offset: 2048,
    cooled: false, dark25: 0.12, hot: 0.0009, ampGlow: 0, banding: 0.5,
    desc: 'Same body with the IR-cut filter replaced by a full-Hα one. Red nebulae pop. Daytime photos come out pink.' },
  { id: 'ff_mirrorless', kind: 'camera', name: 'Northlight Z24 Full-Frame', brand: 'Northlight', price: 1350, weight: 0.65, type: 'dslr', mono: false,
    w: 6000, h: 4000, pix: 5.95, qe: 0.52, qeRGB: [0.85, 1, 0.82], haFactor: 0.3, bits: 14, fw: 51000,
    isos: [100, 200, 400, 640, 800, 1600, 3200, 6400, 12800], baseISO: 100, unityISO: 640, rnLow: 6, rnHigh: 1.6, offset: 512,
    cooled: false, dark25: 0.06, hot: 0.0004, ampGlow: 0, banding: 0.15,
    desc: 'Full-frame mirrorless, nearly ISO-invariant BSI sensor. Huge field of view on camera lenses.' },
  { id: 'guide_cam', kind: 'camera', name: 'Aster G120MM mini (mono)', brand: 'Aster', price: 150, weight: 0.12, type: 'astro', mono: true, guideOnly: true,
    w: 1280, h: 960, pix: 3.75, qe: 0.75, bits: 12, fw: 13000, gainMax: 100, e0: 0.2, hcg: 999, rnLCG: 4.0, rnHCG: 4.0, offset: 10,
    cooled: false, dark25: 0.02, hot: 0.002, ampGlow: 1.5, desc: 'Small mono camera for autoguiding. Comes as part of a guide kit.' },
  { id: 'osc_294', kind: 'camera', name: 'Aster 294MC Pro (cooled color)', brand: 'Aster', price: 820, weight: 0.42, type: 'astro', mono: false,
    w: 4144, h: 2822, pix: 4.63, qe: 0.75, qeRGB: [0.92, 1, 0.82], haFactor: 1.0, bits: 14, fw: 63700, gainMax: 570, e0: 1.0, hcg: 120, rnLCG: 3.6, rnHCG: 1.3, offset: 30,
    cooled: true, deltaT: 35, dark25: 0.09, hot: 0.0006, ampGlow: 25,
    desc: 'Budget cooled one-shot-color camera. Big pixels, high QE — but notable amp glow you MUST calibrate with darks.' },
  { id: 'osc_533', kind: 'camera', name: 'Aster 533MC Pro (cooled color)', brand: 'Aster', price: 950, weight: 0.47, type: 'astro', mono: false,
    w: 3008, h: 3008, pix: 3.76, qe: 0.8, qeRGB: [0.9, 1, 0.83], haFactor: 1.0, bits: 14, fw: 50000, gainMax: 300, e0: 0.76, hcg: 100, rnLCG: 3.8, rnHCG: 1.4, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.04, hot: 0.0002, ampGlow: 0,
    desc: 'Square 1" sensor, zero amp glow, TEC cooling to 35°C below ambient. A community favourite.' },
  { id: 'osc_2600', kind: 'camera', name: 'Aster 2600MC Pro (cooled color)', brand: 'Aster', price: 1750, weight: 0.7, type: 'astro', mono: false,
    w: 6248, h: 4176, pix: 3.76, qe: 0.8, qeRGB: [0.9, 1, 0.83], haFactor: 1.0, bits: 16, fw: 50000, gainMax: 300, e0: 0.78, hcg: 100, rnLCG: 3.3, rnHCG: 1.0, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.04, hot: 0.0002, ampGlow: 0,
    desc: 'APS-C 26 MP, 16-bit, ultra-low read noise. The workhorse of modern amateur astrophotography.' },
  { id: 'mono_2600', kind: 'camera', name: 'Aster 2600MM Pro (cooled mono)', brand: 'Aster', price: 2350, weight: 0.7, type: 'astro', mono: true,
    w: 6248, h: 4176, pix: 3.76, qe: 0.87, bits: 16, fw: 50000, gainMax: 300, e0: 0.78, hcg: 100, rnLCG: 3.3, rnHCG: 1.0, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.04, hot: 0.0002, ampGlow: 0,
    desc: 'Monochrome APS-C. Every pixel sees every photon. Needs filters (and ideally a filter wheel) for color. Narrowband king.' },
  { id: 'mono_6200', kind: 'camera', name: 'Aster 6200MM Pro (full-frame mono)', brand: 'Aster', price: 4300, weight: 0.85, type: 'astro', mono: true,
    w: 9576, h: 6388, pix: 3.76, qe: 0.91, bits: 16, fw: 51400, gainMax: 300, e0: 0.78, hcg: 100, rnLCG: 3.5, rnHCG: 1.2, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.035, hot: 0.0002, ampGlow: 0,
    desc: '61 MP full-frame cooled mono. Needs a big image circle and 2"/50mm filters.' },
];

export const OPTICS = [
  { id: 'lens_kit', kind: 'optic', name: '18–55mm f/3.5–5.6 kit zoom', price: 0, weight: 0.21, type: 'lens',
    zoom: [18, 55], fMinAt: [3.5, 5.6], stops: [3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 16, 22], fMax: 22,
    vig: 0.45, ab: 14, edgeAb: 55, ca: 10, blades: 7, imageCircle: 28, focusUmPerDeg: 9, tempCoeff: 1.2, sell: 20,
    desc: 'The lens that came with your camera. Soft and full of color fringes wide open; stop down to f/5.6–8 for sharper stars.' },
  { id: 'lens_14', kind: 'optic', name: '14mm f/2.8 ultra-wide', price: 380, weight: 0.5, type: 'lens',
    focal: 14, fMin: 2.8, stops: [2.8, 3.2, 3.5, 4, 4.5, 5.6, 8, 11, 16], fMax: 16,
    vig: 0.7, ab: 8, edgeAb: 70, ca: 6, blades: 9, imageCircle: 44, focusUmPerDeg: 6, tempCoeff: 0.8,
    desc: 'Rectilinear 14mm. Milky Way landscapes and star trails. Coma in the corners wide open.' },
  { id: 'lens_50', kind: 'optic', name: '50mm f/1.8 prime', price: 130, weight: 0.16, type: 'lens',
    focal: 50, fMin: 1.8, stops: [1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5.6, 8, 11, 16, 22], fMax: 22,
    vig: 0.65, ab: 22, edgeAb: 60, ca: 9, blades: 7, imageCircle: 44, focusUmPerDeg: 10, tempCoeff: 1.2,
    desc: 'Cheap and fast "nifty fifty". Terrible wide open (coma, purple halos), lovely at f/2.8–4.' },
  { id: 'lens_135', kind: 'optic', name: '135mm f/2 APO prime', price: 780, weight: 0.83, type: 'lens',
    focal: 135, fMin: 2, stops: [2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 5.6, 8, 11, 16, 22], fMax: 22,
    vig: 0.4, ab: 9, edgeAb: 16, ca: 2, blades: 9, imageCircle: 44, focusUmPerDeg: 14, tempCoeff: 2.0,
    desc: 'Legendary astro lens. Nearly apochromatic; sharp to the corners at f/2.8.' },
  { id: 'lens_200', kind: 'optic', name: '200mm f/2.8 telephoto', price: 880, weight: 1.25, type: 'lens',
    focal: 200, fMin: 2.8, stops: [2.8, 3.2, 3.5, 4, 5.6, 8, 11, 16, 22], fMax: 22,
    vig: 0.35, ab: 10, edgeAb: 18, ca: 4, blades: 8, imageCircle: 44, focusUmPerDeg: 16, tempCoeff: 2.4,
    desc: 'Fast telephoto, great for Andromeda, the Pleiades and big nebula complexes.' },
  { id: 'ref_61', kind: 'optic', name: 'Meridian 61 APO f/5.9 (360mm)', price: 650, weight: 1.6, type: 'refractor',
    focal: 360, D: 61, obstruction: 0, vig: 0.25, ab: 5, edgeAb: 40, ca: 2, imageCircle: 44, needs: 'flattener', focusUmPerStep: 4, tempCoeff: 3,
    desc: 'Small triplet APO. Needs a field flattener for round stars to the corners.' },
  { id: 'ref_72', kind: 'optic', name: 'Meridian 72ED f/5.8 (420mm)', price: 460, weight: 2.0, type: 'refractor',
    focal: 420, D: 72, obstruction: 0, vig: 0.25, ab: 7, edgeAb: 45, ca: 8, imageCircle: 40, needs: 'flattener', focusUmPerStep: 4, tempCoeff: 3,
    desc: 'ED doublet. Slight blue halos around bright stars. Classic first telescope for imaging.' },
  { id: 'newt_130', kind: 'optic', name: 'Zenith 130/650 Newtonian f/5', price: 340, weight: 5.0, type: 'newtonian',
    focal: 650, D: 130, obstruction: 0.33, vig: 0.3, ab: 6, edgeAb: 75, ca: 0, spikes: 4, imageCircle: 36, needs: 'coma', focusUmPerStep: 4, tempCoeff: 4,
    desc: 'Lots of aperture for the money. Diffraction spikes, needs a coma corrector, needs collimation.' },
  { id: 'ref_102', kind: 'optic', name: 'Meridian 102 APO f/7 (714mm)', price: 1650, weight: 3.8, type: 'refractor',
    focal: 714, D: 102, obstruction: 0, vig: 0.2, ab: 5, edgeAb: 40, ca: 1.5, imageCircle: 44, needs: 'flattener', focusUmPerStep: 4, tempCoeff: 3.5,
    desc: 'Premium triplet APO. Color-free, pin-sharp stars.' },
  { id: 'newt_200', kind: 'optic', name: 'Zenith 200/800 Astrograph f/4', price: 780, weight: 9.0, type: 'newtonian',
    focal: 800, D: 200, obstruction: 0.38, vig: 0.3, ab: 6, edgeAb: 95, ca: 0, spikes: 4, imageCircle: 44, needs: 'coma', focusUmPerStep: 4, tempCoeff: 5,
    desc: 'Fast, big, heavy. Photon bucket for galaxies. Needs a serious mount and a coma corrector.' },
  { id: 'rasa_8', kind: 'optic', name: 'Hyperion 8" f/2 astrograph (400mm)', price: 2050, weight: 7.5, type: 'rasa',
    focal: 400, D: 203, obstruction: 0.55, vig: 0.25, ab: 9, edgeAb: 12, ca: 0, imageCircle: 32, focusUmPerStep: 3, tempCoeff: 6, colorOnly: true,
    desc: 'f/2 Schmidt astrograph — 10× faster than f/6. Camera sits in front of the corrector. Critical focus zone is tiny.' },
  { id: 'petz_100', kind: 'optic', name: 'Aurora 100 Petzval f/5.5 (550mm)', price: 2800, weight: 4.6, type: 'refractor',
    focal: 550, D: 100, obstruction: 0, vig: 0.12, ab: 4, edgeAb: 6, ca: 0.8, imageCircle: 55, focusUmPerStep: 4, tempCoeff: 3,
    desc: 'Built-in flat field for full-frame sensors. Premium, pin-point stars everywhere.' },
  { id: 'sct_8', kind: 'optic', name: '8" Schmidt-Cassegrain f/10 (2032mm)', price: 1400, weight: 5.7, type: 'sct',
    focal: 2032, D: 203, obstruction: 0.34, vig: 0.3, ab: 10, edgeAb: 30, ca: 0, imageCircle: 30, focusUmPerStep: 12, tempCoeff: 8,
    desc: 'Long focal length for small galaxies and planetary nebulae. Slow at f/10 — consider the 0.63× reducer.' },
  { id: 'rc_8', kind: 'optic', name: '8" Ritchey-Chrétien f/8 (1624mm)', price: 1300, weight: 7.0, type: 'rc',
    focal: 1624, D: 203, obstruction: 0.47, vig: 0.25, ab: 6, edgeAb: 30, ca: 0, spikes: 4, imageCircle: 30, needs: 'flattener', focusUmPerStep: 4, tempCoeff: 6,
    desc: 'Coma-free reflector for galaxies. Big central obstruction, crisp spikes.' },
];

export const CORRECTORS = [
  { id: 'flattener', kind: 'corrector', name: 'Refractor field flattener 1.0×', price: 160, weight: 0.3, forTypes: ['refractor', 'rc'], factor: 1.0, fixes: 'flattener', edgeMul: 0.15, desc: 'Flattens the field of refractors / RCs for round corner stars.' },
  { id: 'reducer08', kind: 'corrector', name: 'Reducer/flattener 0.8×', price: 260, weight: 0.35, forTypes: ['refractor'], factor: 0.8, fixes: 'flattener', edgeMul: 0.25, desc: 'Faster f-ratio and wider field for refractors.' },
  { id: 'coma', kind: 'corrector', name: 'Newtonian coma corrector', price: 190, weight: 0.3, forTypes: ['newtonian'], factor: 1.0, fixes: 'coma', edgeMul: 0.12, desc: 'Removes comet-shaped stars at the edges of fast Newtonians.' },
  { id: 'sct_red', kind: 'corrector', name: 'SCT reducer 0.63×', price: 180, weight: 0.2, forTypes: ['sct'], factor: 0.63, fixes: 'flattener', edgeMul: 0.4, desc: 'Turns an f/10 SCT into f/6.3 (2.5× faster).' },
];

export const MOUNTS = [
  { id: 'tripod', kind: 'mount', name: 'Photo tripod + ball head', price: 0, weight: 0, type: 'fixed', payload: 3,
    goto: false, computer: false, polarScope: false, pe: 0, pePeriod: 1, guideRms: 0, jitter: 0.3, slew: 0, sell: 15,
    desc: 'No tracking. The Earth rotates under you — 500-rule territory.' },
  { id: 'tracker', kind: 'mount', name: 'Star Voyager tracker', price: 380, weight: 1.3, type: 'eq', payload: 5,
    goto: false, computer: false, polarScope: true, pe: 22, pePeriod: 478, guideRms: 1.6, guideAxes: 'ra', jitter: 0.6, slew: 0,
    desc: 'Portable equatorial tracker. Polar-align with the polar scope, aim by hand. ST-4 port for RA guiding.' },
  { id: 'azgti', kind: 'mount', name: 'Wanderer Alt-Az GoTo', price: 420, weight: 2.0, type: 'altaz', payload: 5,
    goto: true, computer: true, polarScope: false, pe: 18, pePeriod: 640, guideRms: 1.4, jitter: 0.6, slew: 4,
    desc: 'Light alt-az GoTo mount. Easy to set up — but field rotation limits exposure length.' },
  { id: 'eq5', kind: 'mount', name: 'Equinox EQ5 Pro GoTo', price: 990, weight: 13, type: 'eq', payload: 9,
    goto: true, computer: true, polarScope: true, pe: 16, pePeriod: 638, guideRms: 1.0, jitter: 0.45, slew: 3.5, meridian: true,
    desc: 'Mid-size German equatorial with counterweights. Guided, it handles small refractors well.' },
  { id: 'eq6', kind: 'mount', name: 'Equinox EQ6-R Pro GoTo', price: 1990, weight: 25, type: 'eq', payload: 20,
    goto: true, computer: true, polarScope: true, pe: 12, pePeriod: 479, guideRms: 0.65, jitter: 0.3, slew: 4, meridian: true,
    desc: 'The classic heavy-duty amateur GEM. Carries 8" Newtonians with ease.' },
  { id: 'harmonic', kind: 'mount', name: 'Strainwave HW-26 harmonic mount', price: 3200, weight: 7.5, type: 'eq', payload: 13,
    goto: true, computer: true, polarScope: false, pe: 35, pePeriod: 290, guideRms: 0.55, jitter: 0.35, slew: 6, meridian: true,
    desc: 'Compact harmonic drive with no counterweights. Large, fast periodic error — guiding is mandatory.' },
  { id: 'observatory', kind: 'mount', name: 'Keystone 1100 encoder mount', price: 9500, weight: 35, type: 'eq', payload: 35,
    goto: true, computer: true, polarScope: false, pe: 0.8, pePeriod: 600, guideRms: 0.3, jitter: 0.15, slew: 5, meridian: true,
    desc: 'Absolute encoders on both axes. Unguided 10-minute subs at 2000mm.' },
];

// Filter definitions: cont = continuum transmission per R,G,B band; lines = narrowband transmission
export const FILTERS = [
  { id: 'f_lp', kind: 'filter', name: 'Light-pollution filter (broadband)', price: 120, weight: 0.02, cont: [0.85, 0.72, 0.85], skyCont: [0.45, 0.42, 0.6], ha: 0.95, oiii: 0.95, sii: 0.9, desc: 'Notches out sodium & mercury lines. Modest help in the suburbs; useless for galaxies under LED lights.' },
  { id: 'f_dual', kind: 'filter', name: 'Dual-band Hα/OIII 7nm (for color cams)', price: 290, weight: 0.02, cont: [0.07, 0.06, 0.06], skyCont: [0.06, 0.05, 0.05], ha: 0.92, oiii: 0.92, sii: 0.0, desc: 'Passes only Hα and OIII. Shoot emission nebulae from the city, even under a bright moon.' },
  { id: 'f_L', kind: 'filter', name: 'Luminance (L)', price: 110, weight: 0.02, cont: [1, 1, 1], skyCont: [1, 1, 1], ha: 1, oiii: 1, sii: 1, monoOnly: true, desc: 'Clear filter with UV/IR cut. Collects all visible light (detail layer).' },
  { id: 'f_R', kind: 'filter', name: 'Red (R)', price: 110, weight: 0.02, cont: [1, 0, 0], skyCont: [1, 0, 0], ha: 1, oiii: 0, sii: 1, monoOnly: true, desc: 'Red filter for LRGB.' },
  { id: 'f_G', kind: 'filter', name: 'Green (G)', price: 110, weight: 0.02, cont: [0, 1, 0], skyCont: [0, 1, 0], ha: 0, oiii: 0.6, sii: 0, monoOnly: true, desc: 'Green filter for LRGB.' },
  { id: 'f_B', kind: 'filter', name: 'Blue (B)', price: 110, weight: 0.02, cont: [0, 0, 1], skyCont: [0, 0, 1], ha: 0, oiii: 0.4, sii: 0, monoOnly: true, desc: 'Blue filter for LRGB.' },
  { id: 'f_ha', kind: 'filter', name: 'Hα 7nm narrowband', price: 210, weight: 0.02, cont: [0.07, 0, 0], skyCont: [0.06, 0, 0], ha: 0.93, oiii: 0, sii: 0, desc: 'Hydrogen-alpha 656nm. Cuts through light pollution and moonlight.' },
  { id: 'f_oiii', kind: 'filter', name: 'OIII 7nm narrowband', price: 210, weight: 0.02, cont: [0, 0.035, 0.035], skyCont: [0, 0.035, 0.035], ha: 0, oiii: 0.93, sii: 0, desc: 'Doubly-ionized oxygen 501nm. Planetary nebulae and supernova remnants.' },
  { id: 'f_sii', kind: 'filter', name: 'SII 7nm narrowband', price: 210, weight: 0.02, cont: [0.07, 0, 0], skyCont: [0.06, 0, 0], ha: 0, oiii: 0, sii: 0.93, desc: 'Sulphur-II 672nm. The "S" in the Hubble palette (SHO).' },
];

export const ACCESSORIES = [
  { id: 'dew', kind: 'acc', name: 'Dew heater strap + controller', price: 65, weight: 0.1, desc: 'Keeps your front lens/corrector above the dew point. Without it, optics fog up on humid nights.' },
  { id: 'bahtinov', kind: 'acc', name: 'Bahtinov focus mask', price: 25, weight: 0.05, desc: 'Produces a diffraction pattern; when the middle spike is centered, you are in focus.' },
  { id: 'guidekit', kind: 'acc', name: 'Guide kit (50mm guide scope + mono guide cam)', price: 270, weight: 0.45, desc: 'Lets GuideMaster correct tracking errors every 2 seconds. Required for long exposures at long focal lengths.' },
  { id: 'autofocus', kind: 'acc', name: 'Electronic auto-focuser motor', price: 320, weight: 0.3, desc: 'Motorizes your focuser so AstroCap can run autofocus (V-curve). Telescopes only.' },
  { id: 'wheel', kind: 'acc', name: '7-position electronic filter wheel', price: 290, weight: 0.45, desc: 'Swap filters from the laptop. Mono cameras only.' },
  { id: 'panel', kind: 'acc', name: 'LED flat panel', price: 180, weight: 0.5, desc: 'Even light source for taking flat frames any time.' },
  { id: 'power', kind: 'acc', name: 'Portable power station (500Wh)', price: 360, weight: 5.5, desc: 'Powers laptop, mount, camera cooler and dew heater all night.' },
  { id: 'hairdryer', kind: 'acc', handheld: true, name: '12V hair dryer (dew zapper)', price: 30, weight: 0.4, desc: 'Blast dewed-up optics clear in a minute; the glass stays warm for a while. Shakes the rig — not mid-exposure!' },
  { id: 'sqm', kind: 'acc', name: 'Sky Quality Meter', price: 140, weight: 0.1, desc: 'Measures sky darkness in mag/arcsec².' },
];

export const ALL_GEAR = [...CAMERAS, ...OPTICS, ...CORRECTORS, ...MOUNTS, ...FILTERS, ...ACCESSORIES];
export const GEAR = Object.fromEntries(ALL_GEAR.map((g) => [g.id, g]));

export const LOCATIONS = WORLD_SITES.map(siteFromRow);
export const LOC = Object.fromEntries(LOCATIONS.map((l) => [l.id, l]));
// custom sites picked on the world map
export function registerLocation(spec) {
  const loc = spec.horizon && spec.bortle ? spec : makeLocation(spec);
  LOC[loc.id] = loc; const i = LOCATIONS.findIndex((l) => l.id === loc.id);
  if (i >= 0) LOCATIONS[i] = loc; else LOCATIONS.push(loc);
  return loc;
}

export function horizonAlt(loc, az) {
  const h = loc.horizon;
  az = ((az % 360) + 360) % 360;
  for (let i = 0; i < h.length - 1; i++) {
    if (az >= h[i][0] && az <= h[i + 1][0]) {
      const t = (az - h[i][0]) / (h[i + 1][0] - h[i][0]);
      // add some small-scale bumps (trees)
      const bump = Math.sin(az * 0.9) * 0.6 + Math.sin(az * 2.7 + 1) * 0.4;
      return h[i][1] * (1 - t) + h[i + 1][1] * t + (loc.bortle >= 5 ? bump : bump * 0.3);
    }
  }
  return 0;
}

// ---------- Rig computations ----------
export function lensFMin(opt, focal) {
  if (!opt.zoom) return opt.fMin;
  const t = (focal - opt.zoom[0]) / (opt.zoom[1] - opt.zoom[0]);
  return Math.round((opt.fMinAt[0] + t * (opt.fMinAt[1] - opt.fMinAt[0])) * 10) / 10;
}

// rig = { mount, optic, camera, corrector, filter (OSC/single), wheelFilters[], acc:[] , zoom, fstop }
export function rigInfo(rig) {
  const cam = GEAR[rig.camera], opt = GEAR[rig.optic], mount = GEAR[rig.mount];
  const corr = rig.corrector ? GEAR[rig.corrector] : null;
  const info = { cam, opt: null, mount, corr, warnings: [] };
  if (!cam || !opt || !mount) return info;
  const isLens = opt.type === 'lens';
  let focal, D, fstop, obstruction = opt.obstruction || 0;
  if (isLens) {
    focal = opt.zoom ? Math.min(opt.zoom[1], Math.max(opt.zoom[0], rig.zoom || opt.zoom[0])) : opt.focal;
    const fMin = lensFMin(opt, focal);
    fstop = Math.max(fMin, Math.min(opt.fMax, rig.fstop || fMin));
    D = focal / fstop;
  } else {
    focal = opt.focal * (corr && corr.forTypes.includes(opt.type) ? corr.factor : 1);
    D = opt.D; fstop = focal / D;
  }
  const fMinNow = isLens ? lensFMin(opt, focal) : fstop;
  const stopRatio = isLens ? fMinNow / fstop : 1; // <1 when stopped down
  const sensorW = cam.w * cam.pix / 1000, sensorH = cam.h * cam.pix / 1000, diag = Math.hypot(sensorW, sensorH);
  const scale = 206.265 * cam.pix / focal; // arcsec/px
  const fovW = 2 * Math.atan(sensorW / 2 / focal) * 180 / Math.PI;
  const fovH = 2 * Math.atan(sensorH / 2 / focal) * 180 / Math.PI;
  // corrections
  let edgeAb = opt.edgeAb * Math.pow(stopRatio, 2.2);
  const corrOK = corr && corr.forTypes.includes(opt.type);
  if (corr && !corrOK) info.warnings.push(`${corr.name} does not fit a ${opt.type}.`);
  if (opt.needs && !(corrOK && corr.fixes === opt.needs)) {
    info.warnings.push(opt.needs === 'coma' ? 'No coma corrector: stars at the edges will look like comets.' : 'No field flattener: corner stars will be elongated.');
  } else if (corrOK) edgeAb *= corr.edgeMul;
  const circleRatio = diag / (opt.imageCircle || 44);
  if (circleRatio > 1.02) info.warnings.push(`Sensor (${diag.toFixed(0)}mm diagonal) is larger than the ${opt.imageCircle}mm image circle — dark corners.`);
  edgeAb *= Math.pow(Math.min(circleRatio, 1.6), 1.6);
  let vig = opt.vig * Math.pow(stopRatio, 1.6) * Math.pow(Math.min(circleRatio, 1.8), 1.4);
  if (circleRatio > 1.02) vig = Math.min(0.97, vig + (circleRatio - 1) * 1.4);
  const ab = opt.ab * Math.pow(stopRatio, 2.4) + (isLens && fstop > 11 ? (fstop - 11) * 0.8 : 0);
  if (opt.colorOnly && cam.type === 'dslr') info.warnings.push('A DSLR body blocks most of the f/2 astrograph aperture — use a small astro camera.');
  if (opt.colorOnly && rig.acc && rig.acc.includes('wheel')) info.warnings.push('No room for a filter wheel in front of an f/2 astrograph.');
  if (cam.guideOnly) info.warnings.push('This is a guide camera; its tiny sensor is a poor main imager.');
  const filter = currentFilterIds(rig);
  // weight / payload
  let weight = (opt.weight || 0) + (cam.weight || 0) + (corr ? corr.weight : 0);
  for (const a of rig.acc || []) if (GEAR[a] && a !== 'power' && a !== 'sqm' && a !== 'panel') weight += GEAR[a].weight;
  const load = weight / mount.payload;
  if (load > 1) info.warnings.push(`Overloaded mount: ${weight.toFixed(1)} kg on a ${mount.payload} kg mount — expect poor tracking.`);
  else if (load > 0.75 && mount.type !== 'fixed') info.warnings.push(`Heavy load (${Math.round(load * 100)}% of capacity). Astro rule of thumb: stay under ~70%.`);
  if (cam.mono && !filter.length) info.warnings.push('Mono camera with no filter: you will get luminance (grayscale) only.');
  Object.assign(info, {
    opt, isLens, focal, D, fstop, obstruction, fMin: fMinNow, stopRatio, scale, fovW, fovH, sensorW, sensorH, diag,
    edgeAb, vig, ab, ca: (opt.ca || 0) * Math.pow(stopRatio, 1.5), weight, load,
    spikes: opt.spikes || 0, blades: isLens && stopRatio < 0.8 ? opt.blades : 0,
    hasGuide: (rig.acc || []).includes('guidekit'), hasAF: (rig.acc || []).includes('autofocus') && !isLens,
    hasWheel: (rig.acc || []).includes('wheel') && cam.mono, hasDew: (rig.acc || []).includes('dew'),
    hasBahtinov: (rig.acc || []).includes('bahtinov'), hasPanel: (rig.acc || []).includes('panel'), hasPower: (rig.acc || []).includes('power'),
    filters: filter,
  });
  return info;
}
export function currentFilterIds(rig) {
  const cam = GEAR[rig.camera];
  if (cam && cam.mono && (rig.acc || []).includes('wheel')) return (rig.wheel || []).filter(Boolean);
  return rig.filter ? [rig.filter] : [];
}

// Read noise & gain model for a camera at a given gain/ISO setting
export function sensorAt(cam, setting) {
  if (cam.type === 'dslr') {
    const iso = setting || 800;
    const gainE = cam.unityISO / iso; // e-/ADU
    const rn = Math.sqrt(cam.rnHigh ** 2 + (cam.rnLow * cam.baseISO / iso) ** 2);
    const maxADU = 2 ** cam.bits - 1;
    const fwEff = Math.min(cam.fw, (maxADU - cam.offset) * gainE);
    return { gainE, rn, maxADU, fwEff, offsetADU: cam.offset, label: `ISO ${iso}` };
  }
  const g = setting ?? 100;
  const gainE = cam.e0 * Math.pow(10, -g / 200); // e-/ADU in 16-bit output units
  const hcg = g >= cam.hcg;
  const t = Math.min(1, g / Math.max(1, cam.hcg));
  const rn = hcg ? cam.rnHCG * (1 - Math.min(0.25, (g - cam.hcg) / 800)) : cam.rnLCG * (1 - t * 0.35);
  const maxADU = 65535; // astro cams scale output to 16-bit
  const offsetADU = 0; // set by the user's offset setting
  const fwEff = Math.min(cam.fw, maxADU * gainE);
  return { gainE, rn, maxADU, fwEff, offsetADU, label: `Gain ${g}` };
}

export function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
