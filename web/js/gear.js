// Gear catalog, locations and rig calculations.
import { WORLD_SITES, siteFromRow, makeLocation } from './geo.js';
// Real-world products (names & brands) with simulation specs modelled on their published data.

export const CAMERAS = [
  { id: 'dslr_stock', kind: 'camera', name: 'Canon EOS Rebel T7 (2000D)', brand: 'Canon', price: 450, weight: 0.68, type: 'dslr', mono: false,
    w: 6000, h: 4000, pix: 3.72, qe: 0.42, qeRGB: [0.85, 1, 0.8], haFactor: 0.22, bits: 14, fw: 26000,
    isos: [100, 200, 400, 800, 1600, 3200, 6400, 12800], baseISO: 100, unityISO: 600, rnLow: 18, rnHigh: 2.4, offset: 2048,
    cooled: false, dark25: 0.12, hot: 0.0009, ampGlow: 0, banding: 0.5,
    desc: 'Your trusty entry-level APS-C DSLR. Stock IR-cut filter blocks ~78% of hydrogen-alpha light, so red emission nebulae look faint.' },
  { id: 'dslr_mod', kind: 'camera', name: 'Canon EOS Rebel T7 — astro-modified', brand: 'Canon', price: 690, weight: 0.68, type: 'dslr', mono: false,
    w: 6000, h: 4000, pix: 3.72, qe: 0.42, qeRGB: [0.95, 1, 0.8], haFactor: 1.0, bits: 14, fw: 26000,
    isos: [100, 200, 400, 800, 1600, 3200, 6400, 12800], baseISO: 100, unityISO: 600, rnLow: 18, rnHigh: 2.4, offset: 2048,
    cooled: false, dark25: 0.12, hot: 0.0009, ampGlow: 0, banding: 0.5,
    desc: 'Same body with the IR-cut filter replaced by a full-Hα one. Red nebulae pop. Daytime photos come out pink.' },
  { id: 'ff_mirrorless', kind: 'camera', name: 'Sony α7 III', brand: 'Sony', price: 1700, weight: 0.65, type: 'dslr', mono: false,
    w: 6000, h: 4000, pix: 5.95, qe: 0.52, qeRGB: [0.85, 1, 0.82], haFactor: 0.3, bits: 14, fw: 51000,
    isos: [100, 200, 400, 640, 800, 1600, 3200, 6400, 12800], baseISO: 100, unityISO: 640, rnLow: 6, rnHigh: 1.6, offset: 512,
    cooled: false, dark25: 0.06, hot: 0.0004, ampGlow: 0, banding: 0.15,
    desc: 'Full-frame mirrorless, nearly ISO-invariant BSI sensor. Huge field of view on camera lenses.' },
  { id: 'guide_cam', kind: 'camera', name: 'ZWO ASI120MM Mini', brand: 'ZWO', price: 150, weight: 0.12, type: 'astro', mono: true, guideOnly: true,
    w: 1280, h: 960, pix: 3.75, qe: 0.75, bits: 12, fw: 13000, gainMax: 100, e0: 0.2, hcg: 999, rnLCG: 4.0, rnHCG: 4.0, offset: 10,
    cooled: false, dark25: 0.02, hot: 0.002, ampGlow: 1.5, desc: 'Small mono camera for autoguiding. Comes as part of a guide kit.' },
  { id: 'osc_294', kind: 'camera', name: 'ZWO ASI294MC Pro', brand: 'ZWO', price: 999, weight: 0.42, type: 'astro', mono: false,
    w: 4144, h: 2822, pix: 4.63, qe: 0.75, qeRGB: [0.92, 1, 0.82], haFactor: 1.0, bits: 14, fw: 63700, gainMax: 570, e0: 1.0, hcg: 120, rnLCG: 3.6, rnHCG: 1.3, offset: 30,
    cooled: true, deltaT: 35, dark25: 0.09, hot: 0.0006, ampGlow: 25,
    desc: 'Budget cooled one-shot-color camera. Big pixels, high QE — but notable amp glow you MUST calibrate with darks.' },
  { id: 'osc_533', kind: 'camera', name: 'ZWO ASI533MC Pro', brand: 'ZWO', price: 889, weight: 0.47, type: 'astro', mono: false,
    w: 3008, h: 3008, pix: 3.76, qe: 0.8, qeRGB: [0.9, 1, 0.83], haFactor: 1.0, bits: 14, fw: 50000, gainMax: 300, e0: 0.76, hcg: 100, rnLCG: 3.8, rnHCG: 1.4, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.04, hot: 0.0002, ampGlow: 0,
    desc: 'Square 1" sensor, zero amp glow, TEC cooling to 35°C below ambient. A community favourite.' },
  { id: 'osc_2600', kind: 'camera', name: 'ZWO ASI2600MC Pro', brand: 'ZWO', price: 1599, weight: 0.7, type: 'astro', mono: false,
    w: 6248, h: 4176, pix: 3.76, qe: 0.8, qeRGB: [0.9, 1, 0.83], haFactor: 1.0, bits: 16, fw: 50000, gainMax: 300, e0: 0.78, hcg: 100, rnLCG: 3.3, rnHCG: 1.0, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.04, hot: 0.0002, ampGlow: 0,
    desc: 'APS-C 26 MP, 16-bit, ultra-low read noise. The workhorse of modern amateur astrophotography.' },
  { id: 'mono_2600', kind: 'camera', name: 'ZWO ASI2600MM Pro', brand: 'ZWO', price: 2199, weight: 0.7, type: 'astro', mono: true,
    w: 6248, h: 4176, pix: 3.76, qe: 0.87, bits: 16, fw: 50000, gainMax: 300, e0: 0.78, hcg: 100, rnLCG: 3.3, rnHCG: 1.0, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.04, hot: 0.0002, ampGlow: 0,
    desc: 'Monochrome APS-C. Every pixel sees every photon. Needs filters (and ideally a filter wheel) for color. Narrowband king.' },
  { id: 'mono_6200', kind: 'camera', name: 'ZWO ASI6200MM Pro', brand: 'ZWO', price: 3999, weight: 0.85, type: 'astro', mono: true,
    w: 9576, h: 6388, pix: 3.76, qe: 0.91, bits: 16, fw: 51400, gainMax: 300, e0: 0.78, hcg: 100, rnLCG: 3.5, rnHCG: 1.2, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.035, hot: 0.0002, ampGlow: 0,
    desc: '61 MP full-frame cooled mono. Needs a big image circle and 2"/50mm filters.' },
  { id: 'planet_462', kind: 'camera', name: 'ZWO ASI462MC', brand: 'ZWO', price: 249, weight: 0.12, type: 'astro', mono: false, planetary: true,
    w: 1936, h: 1096, pix: 2.9, qe: 0.8, qeRGB: [1, 0.95, 0.8], haFactor: 1.0, bits: 12, fw: 15000, gainMax: 600, e0: 0.23, hcg: 80, rnLCG: 2.5, rnHCG: 0.7, offset: 10,
    cooled: false, dark25: 0.15, hot: 0.0006, ampGlow: 4, fpsMax: 136,
    desc: 'Tiny, fast uncooled color camera for lucky imaging of planets and the Moon. 136 fps, sub-electron read noise, very IR-sensitive.' },
  { id: 'planet_678', kind: 'camera', name: 'ZWO ASI678MC', brand: 'ZWO', price: 259, weight: 0.13, type: 'astro', mono: false, planetary: true,
    w: 3840, h: 2160, pix: 2.0, qe: 0.83, qeRGB: [0.95, 1, 0.85], haFactor: 1.0, bits: 12, fw: 11300, gainMax: 600, e0: 0.17, hcg: 100, rnLCG: 1.9, rnHCG: 0.6, offset: 10,
    cooled: false, dark25: 0.1, hot: 0.0004, ampGlow: 2, fpsMax: 47,
    desc: '8 MP planetary camera with tiny 2µm pixels: lunar mosaics and planets at shorter f-ratios.' },
  { id: 'planet_290', kind: 'camera', name: 'ZWO ASI290MM Mini', brand: 'ZWO', price: 299, weight: 0.12, type: 'astro', mono: true, planetary: true,
    w: 1936, h: 1096, pix: 2.9, qe: 0.8, bits: 12, fw: 14600, gainMax: 600, e0: 0.22, hcg: 80, rnLCG: 2.5, rnHCG: 0.75, offset: 10,
    cooled: false, dark25: 0.15, hot: 0.0006, ampGlow: 3, fpsMax: 170,
    desc: 'Mono planetary sensor: maximum resolution on the Moon, RGB or IR imaging of planets with a filter wheel.' },
  { id: 'nikon_d5300', kind: 'camera', brand: 'Nikon', name: 'Nikon D5300', price: 449, weight: 0.53, type: 'dslr', mono: false,
    w: 6000, h: 4000, pix: 3.89, qe: 0.45, qeRGB: [0.88, 1, 0.8], haFactor: 0.32, bits: 14, fw: 30000,
    isos: [100, 200, 400, 800, 1600, 3200, 6400, 12800], baseISO: 100, unityISO: 400, rnLow: 6, rnHigh: 2.2, offset: 600,
    cooled: false, dark25: 0.08, hot: 0.0006, ampGlow: 0, banding: 0.25,
    desc: 'A cult classic for astro: no anti-alias filter, low read noise, slightly better Hα than most stock DSLRs.' },
  { id: 'canon_ra', kind: 'camera', brand: 'Canon', name: 'Canon EOS Ra (astro full-frame)', price: 2499, weight: 0.66, type: 'dslr', mono: false,
    w: 6720, h: 4480, pix: 5.36, qe: 0.5, qeRGB: [0.95, 1, 0.82], haFactor: 1.0, bits: 14, fw: 45000,
    isos: [100, 200, 400, 800, 1600, 3200, 6400, 12800], baseISO: 100, unityISO: 800, rnLow: 8, rnHigh: 2.0, offset: 512,
    cooled: false, dark25: 0.07, hot: 0.0004, ampGlow: 0, banding: 0.2,
    desc: 'Canon’s factory astro mirrorless: full Hα sensitivity and a 30× magnified live view for focusing.' },
  { id: 'sony_a7s3', kind: 'camera', brand: 'Sony', name: 'Sony α7S III', price: 3499, weight: 0.7, type: 'dslr', mono: false,
    w: 4240, h: 2832, pix: 8.4, qe: 0.58, qeRGB: [0.85, 1, 0.82], haFactor: 0.3, bits: 14, fw: 95000,
    isos: [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600], baseISO: 100, unityISO: 1600, rnLow: 4, rnHigh: 1.1, offset: 512,
    cooled: false, dark25: 0.05, hot: 0.0002, ampGlow: 0, banding: 0.1,
    desc: '12 MP with huge 8.4µm pixels: unbeatable low-light sensitivity for nightscapes and auroras.' },
  { id: 'zwo_585mc', kind: 'camera', brand: 'ZWO', name: 'ZWO ASI585MC', price: 399, weight: 0.13, type: 'astro', mono: false, planetary: true,
    w: 3840, h: 2160, pix: 2.9, qe: 0.91, qeRGB: [1, 0.95, 0.8], haFactor: 1.0, bits: 12, fw: 40000, gainMax: 570, e0: 0.61, hcg: 252, rnLCG: 2.6, rnHCG: 0.8, offset: 10,
    cooled: false, dark25: 0.1, hot: 0.0004, ampGlow: 0, fpsMax: 47,
    desc: 'Big 1/1.2" STARVIS 2 sensor, zero amp glow: planets, the Moon and live stacking (EAA).' },
  { id: 'zwo_183mm', kind: 'camera', brand: 'ZWO', name: 'ZWO ASI183MM Pro (cooled mono)', price: 1099, weight: 0.41, type: 'astro', mono: true,
    w: 5496, h: 3672, pix: 2.4, qe: 0.84, bits: 12, fw: 15000, gainMax: 300, e0: 0.23, hcg: 999, rnLCG: 3.0, rnHCG: 1.6, offset: 10,
    cooled: true, deltaT: 40, dark25: 0.03, hot: 0.0004, ampGlow: 22,
    desc: '20 MP, tiny 2.4µm pixels — great on short refractors. Amp glow needs darks.' },
  { id: 'zwo_533mm', kind: 'camera', brand: 'ZWO', name: 'ZWO ASI533MM Pro (cooled mono)', price: 1149, weight: 0.47, type: 'astro', mono: true,
    w: 3008, h: 3008, pix: 3.76, qe: 0.88, bits: 14, fw: 50000, gainMax: 300, e0: 0.76, hcg: 100, rnLCG: 3.8, rnHCG: 1.4, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.04, hot: 0.0002, ampGlow: 0,
    desc: 'Square mono sensor with no amp glow; pairs with 1.25" or 31mm filters.' },
  { id: 'zwo_2400mc', kind: 'camera', brand: 'ZWO', name: 'ZWO ASI2400MC Pro (full-frame color)', price: 3299, weight: 0.85, type: 'astro', mono: false,
    w: 6072, h: 4042, pix: 5.94, qe: 0.8, qeRGB: [0.9, 1, 0.82], haFactor: 1.0, bits: 14, fw: 100000, gainMax: 300, e0: 1.53, hcg: 139, rnLCG: 3.0, rnHCG: 1.1, offset: 50,
    cooled: true, deltaT: 30, dark25: 0.03, hot: 0.0002, ampGlow: 0,
    desc: 'Full-frame one-shot-color with huge pixels and full well. Wide fields on fast astrographs.' },
  { id: 'qhy_268m', kind: 'camera', brand: 'QHYCCD', name: 'QHYCCD QHY268M (cooled mono)', price: 2299, weight: 0.8, type: 'astro', mono: true,
    w: 6280, h: 4210, pix: 3.76, qe: 0.88, bits: 16, fw: 51000, gainMax: 140, e0: 0.78, hcg: 56, rnLCG: 3.5, rnHCG: 1.1, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.04, hot: 0.0002, ampGlow: 0,
    desc: 'The QHY take on the IMX571 APS-C mono sensor, with an extended full-well mode.' },
  { id: 'p1_poseidon', kind: 'camera', brand: 'Player One', name: 'Player One Poseidon-C Pro', price: 1499, weight: 0.68, type: 'astro', mono: false,
    w: 6252, h: 4176, pix: 3.76, qe: 0.8, qeRGB: [0.9, 1, 0.83], haFactor: 1.0, bits: 16, fw: 51000, gainMax: 450, e0: 0.78, hcg: 125, rnLCG: 3.3, rnHCG: 1.0, offset: 50,
    cooled: true, deltaT: 35, dark25: 0.04, hot: 0.0002, ampGlow: 0,
    desc: 'APS-C IMX571 color camera with DPS hot-pixel correction.' },
];

export const OPTICS = [
  { id: 'lens_kit', kind: 'optic', name: 'Canon EF-S 18–55mm f/3.5–5.6 kit zoom', brand: 'Canon', price: 0, weight: 0.21, type: 'lens',
    zoom: [18, 55], fMinAt: [3.5, 5.6], stops: [3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 16, 22], fMax: 22,
    vig: 0.45, ab: 14, edgeAb: 55, ca: 10, blades: 7, imageCircle: 28, focusUmPerDeg: 9, tempCoeff: 1.2, sell: 20,
    desc: 'The lens that came with your camera. Soft and full of color fringes wide open; stop down to f/5.6–8 for sharper stars.' },
  { id: 'lens_14', kind: 'optic', name: 'Samyang 14mm f/2.8 ED AS IF UMC', brand: 'Samyang', price: 349, weight: 0.5, type: 'lens',
    focal: 14, fMin: 2.8, stops: [2.8, 3.2, 3.5, 4, 4.5, 5.6, 8, 11, 16], fMax: 16,
    vig: 0.7, ab: 8, edgeAb: 70, ca: 6, blades: 9, imageCircle: 44, focusUmPerDeg: 6, tempCoeff: 0.8,
    desc: 'Rectilinear 14mm. Milky Way landscapes and star trails. Coma in the corners wide open.' },
  { id: 'lens_50', kind: 'optic', name: 'Canon EF 50mm f/1.8 STM', brand: 'Canon', price: 125, weight: 0.16, type: 'lens',
    focal: 50, fMin: 1.8, stops: [1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5.6, 8, 11, 16, 22], fMax: 22,
    vig: 0.65, ab: 22, edgeAb: 60, ca: 9, blades: 7, imageCircle: 44, focusUmPerDeg: 10, tempCoeff: 1.2,
    desc: 'Cheap and fast "nifty fifty". Terrible wide open (coma, purple halos), lovely at f/2.8–4.' },
  { id: 'lens_135', kind: 'optic', name: 'Samyang 135mm f/2 ED UMC', brand: 'Samyang', price: 499, weight: 0.83, type: 'lens',
    focal: 135, fMin: 2, stops: [2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 5.6, 8, 11, 16, 22], fMax: 22,
    vig: 0.4, ab: 9, edgeAb: 16, ca: 2, blades: 9, imageCircle: 44, focusUmPerDeg: 14, tempCoeff: 2.0,
    desc: 'Legendary astro lens. Nearly apochromatic; sharp to the corners at f/2.8.' },
  { id: 'lens_200', kind: 'optic', name: 'Canon EF 200mm f/2.8L II USM', brand: 'Canon', price: 799, weight: 1.25, type: 'lens',
    focal: 200, fMin: 2.8, stops: [2.8, 3.2, 3.5, 4, 5.6, 8, 11, 16, 22], fMax: 22,
    vig: 0.35, ab: 10, edgeAb: 18, ca: 4, blades: 8, imageCircle: 44, focusUmPerDeg: 16, tempCoeff: 2.4,
    desc: 'Fast telephoto, great for Andromeda, the Pleiades and big nebula complexes.' },
  { id: 'ref_61', kind: 'optic', name: 'William Optics ZenithStar 61 II (360mm f/5.9)', brand: 'William Optics', price: 599, weight: 1.6, type: 'refractor',
    focal: 360, D: 61, obstruction: 0, vig: 0.25, ab: 5, edgeAb: 40, ca: 2, imageCircle: 44, needs: 'flattener', focusUmPerStep: 4, tempCoeff: 3,
    desc: 'Small triplet APO. Needs a field flattener for round stars to the corners.' },
  { id: 'ref_72', kind: 'optic', name: 'Sky-Watcher Evostar 72ED (420mm f/5.8)', brand: 'Sky-Watcher', price: 439, weight: 2.0, type: 'refractor',
    focal: 420, D: 72, obstruction: 0, vig: 0.25, ab: 7, edgeAb: 45, ca: 8, imageCircle: 40, needs: 'flattener', focusUmPerStep: 4, tempCoeff: 3,
    desc: 'ED doublet. Slight blue halos around bright stars. Classic first telescope for imaging.' },
  { id: 'newt_130', kind: 'optic', name: 'Sky-Watcher Explorer 130PDS (650mm f/5)', brand: 'Sky-Watcher', price: 299, weight: 5.0, type: 'newtonian',
    focal: 650, D: 130, obstruction: 0.33, vig: 0.3, ab: 6, edgeAb: 75, ca: 0, spikes: 4, imageCircle: 36, needs: 'coma', focusUmPerStep: 4, tempCoeff: 4,
    desc: 'Lots of aperture for the money. Diffraction spikes, needs a coma corrector, needs collimation.' },
  { id: 'ref_102', kind: 'optic', name: 'Explore Scientific ED102 FCD-100 (714mm f/7)', brand: 'Explore Scientific', price: 1499, weight: 3.8, type: 'refractor',
    focal: 714, D: 102, obstruction: 0, vig: 0.2, ab: 5, edgeAb: 40, ca: 1.5, imageCircle: 44, needs: 'flattener', focusUmPerStep: 4, tempCoeff: 3.5,
    desc: 'Premium triplet APO. Color-free, pin-sharp stars.' },
  { id: 'newt_200', kind: 'optic', name: 'Sky-Watcher Quattro 200P (800mm f/4)', brand: 'Sky-Watcher', price: 799, weight: 9.0, type: 'newtonian',
    focal: 800, D: 200, obstruction: 0.38, vig: 0.3, ab: 6, edgeAb: 95, ca: 0, spikes: 4, imageCircle: 44, needs: 'coma', focusUmPerStep: 4, tempCoeff: 5,
    desc: 'Fast, big, heavy. Photon bucket for galaxies. Needs a serious mount and a coma corrector.' },
  { id: 'rasa_8', kind: 'optic', name: 'Celestron RASA 8 (400mm f/2)', brand: 'Celestron', price: 1999, weight: 7.5, type: 'rasa',
    focal: 400, D: 203, obstruction: 0.55, vig: 0.25, ab: 9, edgeAb: 12, ca: 0, imageCircle: 32, focusUmPerStep: 3, tempCoeff: 6, colorOnly: true,
    desc: 'f/2 Schmidt astrograph — 10× faster than f/6. Camera sits in front of the corrector. Critical focus zone is tiny.' },
  { id: 'petz_100', kind: 'optic', name: 'Sky-Watcher Esprit 100ED (550mm f/5.5)', brand: 'Sky-Watcher', price: 2999, weight: 4.6, type: 'refractor',
    focal: 550, D: 100, obstruction: 0, vig: 0.12, ab: 4, edgeAb: 6, ca: 0.8, imageCircle: 55, focusUmPerStep: 4, tempCoeff: 3,
    desc: 'Built-in flat field for full-frame sensors. Premium, pin-point stars everywhere.' },
  { id: 'sct_8', kind: 'optic', name: 'Celestron C8 SCT (2032mm f/10)', brand: 'Celestron', price: 1399, weight: 5.7, type: 'sct',
    focal: 2032, D: 203, obstruction: 0.34, vig: 0.3, ab: 10, edgeAb: 30, ca: 0, imageCircle: 30, focusUmPerStep: 12, tempCoeff: 8,
    desc: 'Long focal length for small galaxies and planetary nebulae. Slow at f/10 — consider the 0.63× reducer.' },
  { id: 'rc_8', kind: 'optic', name: 'GSO 8" Ritchey-Chrétien (1624mm f/8)', brand: 'GSO', price: 1199, weight: 7.0, type: 'rc',
    focal: 1624, D: 203, obstruction: 0.47, vig: 0.25, ab: 6, edgeAb: 30, ca: 0, spikes: 4, imageCircle: 30, needs: 'flattener', focusUmPerStep: 4, tempCoeff: 6,
    desc: 'Coma-free reflector for galaxies. Big central obstruction, crisp spikes.' },
  { id: 'redcat51', kind: 'optic', brand: 'William Optics', name: 'William Optics RedCat 51 (250mm f/4.9)', price: 749, weight: 1.6, type: 'refractor',
    focal: 250, D: 51, obstruction: 0, vig: 0.15, ab: 4, edgeAb: 6, ca: 1, imageCircle: 44, focusUmPerStep: 4, tempCoeff: 2.5,
    desc: 'Tiny Petzval astrograph with a built-in flat field: pin-sharp to the corners of full frame. The classic grab-and-go.' },
  { id: 'askar_fra400', kind: 'optic', brand: 'Askar', name: 'Askar FRA400 (400mm f/5.6)', price: 1099, weight: 3.2, type: 'refractor',
    focal: 400, D: 72, obstruction: 0, vig: 0.12, ab: 4.5, edgeAb: 8, ca: 1.5, imageCircle: 44, focusUmPerStep: 4, tempCoeff: 3,
    desc: 'Five-element flat-field astrograph — no flattener needed.' },
  { id: 'fsq106', kind: 'optic', brand: 'Takahashi', name: 'Takahashi FSQ-106EDX4 (530mm f/5)', price: 6600, weight: 6.6, type: 'refractor',
    focal: 530, D: 106, obstruction: 0, vig: 0.06, ab: 3, edgeAb: 3, ca: 0.4, imageCircle: 88, focusUmPerStep: 4, tempCoeff: 2,
    desc: 'The legendary Petzval. 88mm image circle, essentially perfect stars on any sensor.' },
  { id: 'esprit150', kind: 'optic', brand: 'Sky-Watcher', name: 'Sky-Watcher Esprit 150ED (1050mm f/7)', price: 4999, weight: 12.5, type: 'refractor',
    focal: 1050, D: 150, obstruction: 0, vig: 0.15, ab: 4, edgeAb: 7, ca: 0.8, imageCircle: 44, focusUmPerStep: 4, tempCoeff: 4,
    desc: '6" triplet APO with its dedicated flattener — galaxies and planetary nebulae with refractor stars.' },
  { id: 'quattro250', kind: 'optic', brand: 'Sky-Watcher', name: 'Sky-Watcher Quattro 250P (1000mm f/4)', price: 1199, weight: 13, type: 'newtonian',
    focal: 1000, D: 254, obstruction: 0.37, vig: 0.3, ab: 6, edgeAb: 95, ca: 0, spikes: 4, imageCircle: 44, needs: 'coma', focusUmPerStep: 4, tempCoeff: 5,
    desc: '10" f/4 imaging Newtonian. Massive light grasp — needs a serious mount and a coma corrector.' },
  { id: 'edge8', kind: 'optic', brand: 'Celestron', name: 'Celestron EdgeHD 8 (2032mm f/10)', price: 1999, weight: 6.4, type: 'sct',
    focal: 2032, D: 203, obstruction: 0.36, vig: 0.25, ab: 8, edgeAb: 7, ca: 0, imageCircle: 42, focusUmPerStep: 12, tempCoeff: 8,
    desc: 'Aplanatic SCT with a flat field — round stars to the edge. Galaxies at f/7 with the 0.7× reducer, planets with a Barlow.' },
  { id: 'edge11', kind: 'optic', brand: 'Celestron', name: 'Celestron EdgeHD 11 (2800mm f/10)', price: 3999, weight: 12.6, type: 'sct',
    focal: 2800, D: 280, obstruction: 0.36, vig: 0.25, ab: 8, edgeAb: 7, ca: 0, imageCircle: 42, focusUmPerStep: 12, tempCoeff: 9,
    desc: '11" flat-field SCT. Small galaxies and superb planetary detail.' },
  { id: 'c11', kind: 'optic', brand: 'Celestron', name: 'Celestron C11 SCT (2800mm f/10)', price: 2699, weight: 12.3, type: 'sct',
    focal: 2800, D: 280, obstruction: 0.35, vig: 0.3, ab: 10, edgeAb: 32, ca: 0, imageCircle: 30, focusUmPerStep: 12, tempCoeff: 9,
    desc: 'The planetary imager’s favourite: 280mm aperture in a manageable tube.' },
  { id: 'mak127', kind: 'optic', brand: 'Sky-Watcher', name: 'Sky-Watcher Skymax 127 Maksutov (1500mm f/11.8)', price: 449, weight: 3.6, type: 'mak',
    focal: 1500, D: 127, obstruction: 0.3, vig: 0.3, ab: 8, edgeAb: 25, ca: 0, imageCircle: 25, focusUmPerStep: 10, tempCoeff: 7,
    desc: 'Compact, cheap and sharp: an ideal first planetary and lunar scope. Slow for deep sky.' },
  { id: 'sigma105', kind: 'optic', brand: 'Sigma', name: 'Sigma 105mm f/1.4 DG HSM Art', price: 1599, weight: 1.65, type: 'lens',
    focal: 105, fMin: 1.4, stops: [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 4, 5.6, 8, 11, 16], fMax: 16,
    vig: 0.55, ab: 7, edgeAb: 9, ca: 1.5, blades: 9, imageCircle: 44, focusUmPerDeg: 12, tempCoeff: 1.6,
    desc: 'The “Bokeh Master”, sharp wide open — astro photographers’ favourite fast telephoto.' },
  { id: 'rokinon24', kind: 'optic', brand: 'Samyang', name: 'Samyang 24mm f/1.4 ED AS UMC', price: 499, weight: 0.68, type: 'lens',
    focal: 24, fMin: 1.4, stops: [1.4, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 4, 5.6, 8, 11, 16], fMax: 16,
    vig: 0.75, ab: 14, edgeAb: 55, ca: 5, blades: 8, imageCircle: 44, focusUmPerDeg: 8, tempCoeff: 0.9,
    desc: 'Fast wide-angle for Milky Way nightscapes. Coma in the corners until f/2.2.' },
];

export const CORRECTORS = [
  { id: 'flattener', kind: 'corrector', name: 'Sky-Watcher field flattener 1.0×', brand: 'Sky-Watcher', price: 139, weight: 0.3, forTypes: ['refractor', 'rc'], factor: 1.0, fixes: 'flattener', edgeMul: 0.15, desc: 'Flattens the field of refractors / RCs for round corner stars.' },
  { id: 'reducer08', kind: 'corrector', name: 'Sky-Watcher 0.85× reducer/flattener', brand: 'Sky-Watcher', price: 249, weight: 0.35, forTypes: ['refractor'], factor: 0.8, fixes: 'flattener', edgeMul: 0.25, desc: 'Faster f-ratio and wider field for refractors.' },
  { id: 'coma', kind: 'corrector', name: 'Baader MPCC Mark III coma corrector', brand: 'Baader', price: 199, weight: 0.3, forTypes: ['newtonian'], factor: 1.0, fixes: 'coma', edgeMul: 0.12, desc: 'Removes comet-shaped stars at the edges of fast Newtonians.' },
  { id: 'barlow2', kind: 'corrector', name: 'Celestron X-Cel LX 2× Barlow', brand: 'Celestron', price: 89, weight: 0.15, forTypes: ['refractor', 'newtonian', 'sct', 'rc', 'rasa', 'mak'], factor: 2, barlow: true, edgeMul: 1, desc: 'Doubles the focal length. For planets aim for f-ratio ≈ 5× the pixel size in µm (f/15 for 2.9µm pixels).' },
  { id: 'barlow3', kind: 'corrector', name: 'Explore Scientific 3× Focal Extender', brand: 'Explore Scientific', price: 149, weight: 0.18, forTypes: ['refractor', 'newtonian', 'sct', 'rc', 'rasa', 'mak'], factor: 3, barlow: true, edgeMul: 1, desc: 'Triples the focal length. Great for fast Newtonians on planets.' },
  { id: 'powermate5', kind: 'corrector', name: 'Tele Vue 5× Powermate', brand: 'Tele Vue', price: 299, weight: 0.3, forTypes: ['refractor', 'newtonian', 'sct', 'rc', 'mak'], factor: 5, barlow: true, edgeMul: 1, desc: 'Huge magnification for tiny planets (Mars, Uranus) and lunar close-ups — needs excellent seeing.' },
  { id: 'sct_red', kind: 'corrector', name: 'Celestron 0.63× reducer/corrector', brand: 'Celestron', price: 179, weight: 0.2, forTypes: ['sct'], factor: 0.63, fixes: 'flattener', edgeMul: 0.4, desc: 'Turns an f/10 SCT into f/6.3 (2.5× faster).' },
  { id: 'edge_red', kind: 'corrector', brand: 'Celestron', name: 'Celestron EdgeHD 0.7× reducer', price: 499, weight: 0.4, forTypes: ['sct'], factor: 0.7, fixes: 'flattener', edgeMul: 0.3, desc: 'Turns an EdgeHD into a flat-field f/7 astrograph.' },
  { id: 'redcat_red', kind: 'corrector', brand: 'Askar', name: 'Askar 0.7× full-frame reducer', price: 249, weight: 0.3, forTypes: ['refractor'], factor: 0.7, fixes: 'flattener', edgeMul: 0.35, desc: 'Faster, wider field for small refractors.' },
];

export const MOUNTS = [
  { id: 'tripod', kind: 'mount', name: 'Manfrotto photo tripod + ball head', brand: 'Manfrotto', price: 0, weight: 0, type: 'fixed', payload: 3,
    goto: false, computer: false, polarScope: false, pe: 0, pePeriod: 1, guideRms: 0, jitter: 0.3, slew: 0, sell: 15,
    desc: 'No tracking. The Earth rotates under you — 500-rule territory.' },
  { id: 'tracker', kind: 'mount', name: 'Sky-Watcher Star Adventurer 2i', brand: 'Sky-Watcher', price: 379, weight: 1.3, type: 'eq', payload: 5,
    goto: false, computer: false, polarScope: true, pe: 22, pePeriod: 478, guideRms: 1.6, guideAxes: 'ra', jitter: 0.6, slew: 0,
    desc: 'Portable equatorial tracker. Polar-align with the polar scope, aim by hand. ST-4 port for RA guiding.' },
  { id: 'azgti', kind: 'mount', name: 'Sky-Watcher AZ-GTi', brand: 'Sky-Watcher', price: 449, weight: 2.0, type: 'altaz', payload: 5,
    goto: true, computer: true, polarScope: false, pe: 18, pePeriod: 640, guideRms: 1.4, jitter: 0.6, slew: 4,
    desc: 'Light alt-az GoTo mount. Easy to set up — but field rotation limits exposure length.' },
  { id: 'eq5', kind: 'mount', name: 'Sky-Watcher EQ5 Pro GoTo', brand: 'Sky-Watcher', price: 999, weight: 13, type: 'eq', payload: 9,
    goto: true, computer: true, polarScope: true, pe: 16, pePeriod: 638, guideRms: 1.0, jitter: 0.45, slew: 3.5, meridian: true,
    desc: 'Mid-size German equatorial with counterweights. Guided, it handles small refractors well.' },
  { id: 'eq6', kind: 'mount', name: 'Sky-Watcher EQ6-R Pro', brand: 'Sky-Watcher', price: 1999, weight: 25, type: 'eq', payload: 20,
    goto: true, computer: true, polarScope: true, pe: 12, pePeriod: 479, guideRms: 0.65, jitter: 0.3, slew: 4, meridian: true,
    desc: 'The classic heavy-duty amateur GEM. Carries 8" Newtonians with ease.' },
  { id: 'harmonic', kind: 'mount', name: 'ZWO AM5 harmonic mount', brand: 'ZWO', price: 1999, weight: 7.5, type: 'eq', payload: 13,
    goto: true, computer: true, polarScope: false, pe: 35, pePeriod: 290, guideRms: 0.55, jitter: 0.35, slew: 6, meridian: true,
    desc: 'Compact harmonic drive with no counterweights. Large, fast periodic error — guiding is mandatory.' },
  { id: 'observatory', kind: 'mount', name: '10Micron GM1000 HPS', brand: '10Micron', price: 9900, weight: 35, type: 'eq', payload: 35,
    goto: true, computer: true, polarScope: false, pe: 0.8, pePeriod: 600, guideRms: 0.3, jitter: 0.15, slew: 5, meridian: true,
    desc: 'Absolute encoders on both axes. Unguided 10-minute subs at 2000mm.' },
  { id: 'sa_gti', kind: 'mount', brand: 'Sky-Watcher', name: 'Sky-Watcher Star Adventurer GTi', price: 575, weight: 1.9, type: 'eq', payload: 5,
    goto: true, computer: true, polarScope: true, pe: 20, pePeriod: 478, guideRms: 1.2, jitter: 0.55, slew: 3,
    desc: 'A star tracker with GoTo and PC control. Light enough to fly with.' },
  { id: 'gem28', kind: 'mount', brand: 'iOptron', name: 'iOptron GEM28', price: 1149, weight: 4.4, type: 'eq', payload: 12,
    goto: true, computer: true, polarScope: true, pe: 9, pePeriod: 600, guideRms: 0.6, jitter: 0.35, slew: 4, meridian: true,
    desc: 'Compact German equatorial with a low periodic error for its price.' },
  { id: 'cem40', kind: 'mount', brand: 'iOptron', name: 'iOptron CEM40', price: 2599, weight: 7.2, type: 'eq', payload: 18,
    goto: true, computer: true, polarScope: false, pe: 7, pePeriod: 400, guideRms: 0.45, jitter: 0.25, slew: 4.5, meridian: true,
    desc: 'Center-balanced design: carries 18 kg on a 7 kg head.' },
  { id: 'rst135', kind: 'mount', brand: 'Rainbow Astro', name: 'Rainbow Astro RST-135E', price: 3899, weight: 3.4, type: 'eq', payload: 13,
    goto: true, computer: true, polarScope: false, pe: 20, pePeriod: 290, guideRms: 0.45, jitter: 0.3, slew: 6, meridian: true,
    desc: 'Featherweight strain-wave mount with encoders on RA. No counterweights.' },
  { id: 'cgx', kind: 'mount', brand: 'Celestron', name: 'Celestron CGX', price: 3199, weight: 20, type: 'eq', payload: 25,
    goto: true, computer: true, polarScope: false, pe: 10, pePeriod: 480, guideRms: 0.5, jitter: 0.25, slew: 4, meridian: true,
    desc: 'Heavy-duty GEM for 11" SCTs and big refractors.' },
  { id: 'eq8', kind: 'mount', brand: 'Sky-Watcher', name: 'Sky-Watcher EQ8-R Pro', price: 4599, weight: 25, type: 'eq', payload: 50,
    goto: true, computer: true, polarScope: false, pe: 8, pePeriod: 480, guideRms: 0.4, jitter: 0.2, slew: 4, meridian: true,
    desc: 'Observatory-class payload. Nothing you can lift will overload it.' },
];

// Filter definitions: cont = continuum transmission per R,G,B band; lines = narrowband transmission
export const FILTERS = [
  { id: 'f_lp', kind: 'filter', name: 'Optolong L-Pro', brand: 'Optolong', price: 179, weight: 0.02, cont: [0.85, 0.72, 0.85], skyCont: [0.45, 0.42, 0.6], ha: 0.95, oiii: 0.95, sii: 0.9, desc: 'Notches out sodium & mercury lines. Modest help in the suburbs; useless for galaxies under LED lights.' },
  { id: 'f_dual', kind: 'filter', name: 'Optolong L-eXtreme 7nm dual-band', brand: 'Optolong', price: 299, weight: 0.02, cont: [0.07, 0.06, 0.06], skyCont: [0.06, 0.05, 0.05], ha: 0.92, oiii: 0.92, sii: 0.0, desc: 'Passes only Hα and OIII. Shoot emission nebulae from the city, even under a bright moon.' },
  { id: 'f_L', kind: 'filter', name: 'ZWO Luminance (L) 36mm', brand: 'ZWO', price: 109, weight: 0.02, cont: [1, 1, 1], skyCont: [1, 1, 1], ha: 1, oiii: 1, sii: 1, monoOnly: true, desc: 'Clear filter with UV/IR cut. Collects all visible light (detail layer).' },
  { id: 'f_R', kind: 'filter', name: 'ZWO Red (R) 36mm', brand: 'ZWO', price: 109, weight: 0.02, cont: [1, 0, 0], skyCont: [1, 0, 0], ha: 1, oiii: 0, sii: 1, monoOnly: true, desc: 'Red filter for LRGB.' },
  { id: 'f_G', kind: 'filter', name: 'ZWO Green (G) 36mm', brand: 'ZWO', price: 109, weight: 0.02, cont: [0, 1, 0], skyCont: [0, 1, 0], ha: 0, oiii: 0.6, sii: 0, monoOnly: true, desc: 'Green filter for LRGB.' },
  { id: 'f_B', kind: 'filter', name: 'ZWO Blue (B) 36mm', brand: 'ZWO', price: 109, weight: 0.02, cont: [0, 0, 1], skyCont: [0, 0, 1], ha: 0, oiii: 0.4, sii: 0, monoOnly: true, desc: 'Blue filter for LRGB.' },
  { id: 'f_ha', kind: 'filter', name: 'ZWO Hα 7nm 36mm', brand: 'ZWO', price: 209, weight: 0.02, cont: [0.07, 0, 0], skyCont: [0.06, 0, 0], ha: 0.93, oiii: 0, sii: 0, desc: 'Hydrogen-alpha 656nm. Cuts through light pollution and moonlight.' },
  { id: 'f_oiii', kind: 'filter', name: 'ZWO OIII 7nm 36mm', brand: 'ZWO', price: 209, weight: 0.02, cont: [0, 0.035, 0.035], skyCont: [0, 0.035, 0.035], ha: 0, oiii: 0.93, sii: 0, desc: 'Doubly-ionized oxygen 501nm. Planetary nebulae and supernova remnants.' },
  { id: 'f_sii', kind: 'filter', name: 'ZWO SII 7nm 36mm', brand: 'ZWO', price: 209, weight: 0.02, cont: [0.07, 0, 0], skyCont: [0.06, 0, 0], ha: 0, oiii: 0, sii: 0.93, desc: 'Sulphur-II 672nm. The "S" in the Hubble palette (SHO).' },
  { id: 'f_lenhance', kind: 'filter', brand: 'Optolong', name: 'Optolong L-eNhance tri-band', price: 229, weight: 0.02, cont: [0.14, 0.12, 0.12], skyCont: [0.11, 0.1, 0.1], ha: 0.9, oiii: 0.9, sii: 0.0, desc: 'Hα, Hβ and OIII windows for color cameras — a gentler (wider) dual-band.' },
  { id: 'f_ultimate', kind: 'filter', brand: 'Optolong', name: 'Optolong L-Ultimate 3nm dual-band', price: 399, weight: 0.02, cont: [0.035, 0.03, 0.03], skyCont: [0.028, 0.024, 0.024], ha: 0.9, oiii: 0.9, sii: 0.0, desc: 'Ultra-narrow dual-band for color cameras: punches through city skies and full moon.' },
  { id: 'f_ha3', kind: 'filter', brand: 'Antlia', name: 'Antlia 3nm Hα Pro', price: 459, weight: 0.02, cont: [0.03, 0, 0], skyCont: [0.025, 0, 0], ha: 0.9, oiii: 0, sii: 0, desc: '3nm Hα: higher contrast and smaller star halos than 7nm.' },
  { id: 'f_oiii3', kind: 'filter', brand: 'Antlia', name: 'Antlia 3nm OIII Pro', price: 459, weight: 0.02, cont: [0, 0.015, 0.015], skyCont: [0, 0.015, 0.015], ha: 0, oiii: 0.9, sii: 0, desc: '3nm OIII for faint shells and supernova remnants.' },
  { id: 'f_sii3', kind: 'filter', brand: 'Antlia', name: 'Antlia 3nm SII Pro', price: 459, weight: 0.02, cont: [0.03, 0, 0], skyCont: [0.025, 0, 0], ha: 0, oiii: 0, sii: 0.9, desc: '3nm SII for the Hubble palette.' },
];

export const ACCESSORIES = [
  { id: 'dew', kind: 'acc', name: 'Pegasus Astro dew strap + controller', brand: 'Pegasus Astro', price: 89, weight: 0.1, desc: 'Keeps your front lens/corrector above the dew point. Without it, optics fog up on humid nights.' },
  { id: 'bahtinov', kind: 'acc', name: 'Astrozap Bahtinov focus mask', brand: 'Astrozap', price: 25, weight: 0.05, desc: 'Produces a diffraction pattern; when the middle spike is centered, you are in focus.' },
  { id: 'guidekit', kind: 'acc', name: 'ZWO 30F4 mini guide scope + ASI120MM Mini', brand: 'ZWO', price: 269, weight: 0.45, desc: 'Lets GuideMaster correct tracking errors every 2 seconds. Required for long exposures at long focal lengths.' },
  { id: 'autofocus', kind: 'acc', name: 'ZWO EAF electronic auto-focuser', brand: 'ZWO', price: 249, weight: 0.3, desc: 'Motorizes your focuser so AstroCap can run autofocus (V-curve). Telescopes only.' },
  { id: 'wheel', kind: 'acc', name: 'ZWO EFW 7×36mm filter wheel', brand: 'ZWO', price: 349, weight: 0.45, desc: 'Swap filters from the laptop. Mono cameras only.' },
  { id: 'panel', kind: 'acc', name: 'Pegasus Astro FlatMaster 150 flat panel', brand: 'Pegasus Astro', price: 219, weight: 0.5, desc: 'Even light source for taking flat frames any time.' },
  { id: 'power', kind: 'acc', name: 'Jackery Explorer 500 power station', brand: 'Jackery', price: 499, weight: 5.5, desc: 'Powers laptop, mount, camera cooler and dew heater all night.' },
  { id: 'hairdryer', kind: 'acc', handheld: true, name: '12V travel hair dryer (dew zapper)', brand: 'Generic', price: 30, weight: 0.4, desc: 'Blast dewed-up optics clear in a minute; the glass stays warm for a while. Shakes the rig — not mid-exposure!' },
  { id: 'adc', kind: 'acc', name: 'ZWO atmospheric dispersion corrector', brand: 'ZWO', price: 149, weight: 0.2, desc: 'Prisms that cancel the atmosphere’s rainbow smear (blue top, red bottom) on planets low in the sky.' },
  { id: 'sqm', kind: 'acc', name: 'Unihedron SQM-L sky quality meter', brand: 'Unihedron', price: 139, weight: 0.1, desc: 'Measures sky darkness in mag/arcsec².' },

];

// Storage for the laptop (frames, videos and stacks are big)
export const STORAGE = [
  { id: 'ssd1', kind: 'storage', name: 'Samsung T7 portable SSD 1 TB', brand: 'Samsung', price: 90, bytes: 1e12, desc: 'Room for ~20,000 DSLR raws or a few hundred planetary videos.' },
  { id: 'ssd2', kind: 'storage', name: 'Samsung T7 Shield 2 TB', brand: 'Samsung', price: 160, bytes: 2e12, desc: 'Fast, rugged, fits in the eyepiece case.' },
  { id: 'nvme4', kind: 'storage', name: 'WD_BLACK SN850X 4 TB (internal)', brand: 'WD', price: 320, bytes: 4e12, desc: 'Swap the laptop’s SSD for a 4 TB one (the old drive becomes a backup).' },
  { id: 'nas16', kind: 'storage', name: 'Synology DS224+ NAS 16 TB', brand: 'Synology', price: 950, bytes: 16e12, desc: 'Network storage for a lifetime of 60-megapixel FITS files.' },
  { id: 'ssd4', kind: 'storage', brand: 'Samsung', name: 'Samsung T9 portable SSD 4 TB', price: 289, bytes: 4e12, desc: 'USB 20 Gbps — copies a night of subs in a minute.' },
  { id: 'nas40', kind: 'storage', brand: 'Synology', name: 'Synology DS923+ NAS 40 TB', price: 1899, bytes: 40e12, desc: 'Four-bay RAID for the full-frame-mono-narrowband lifestyle.' },
];
export const ALL_GEAR = [...CAMERAS, ...OPTICS, ...CORRECTORS, ...MOUNTS, ...FILTERS, ...ACCESSORIES, ...STORAGE];
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
  if (opt.needs && !(corrOK && corr.fixes === opt.needs) && !(corrOK && corr.barlow)) {
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
    hasBahtinov: (rig.acc || []).includes('bahtinov'), hasPanel: (rig.acc || []).includes('panel'), hasPower: (rig.acc || []).includes('power'), hasADC: (rig.acc || []).includes('adc'), barlow: corrOK && corr.barlow ? corr.factor : 1,
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
