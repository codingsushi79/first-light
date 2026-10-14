// The 3D observing site: real sky (catalog stars on a rotating celestial sphere, Milky Way,
// Moon, twilight, light-pollution glow, clouds), terrain matched to the site's horizon
// profile, your rig as a 3D model that physically slews, and the laptop on a camping table.
import * as THREE from 'three';
import * as A from './astro.js';
import { cat, bvToRGB } from './catalog.js';
import { GEAR, horizonAlt, rigInfo } from './gear.js';
import { G, on, off } from './state.js';
import * as S from './session.js';
import * as MET from './meteors.js';
import { makeNoise, mulberry32, hashStr } from './util.js';

const SKY_R = 900;
const wrapPi = (a) => (Number.isFinite(a) ? ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI : 0);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
export function altAzToVec(alt, az, r = 1) { const a = alt * A.D2R, z = az * A.D2R; return v3(r * Math.cos(a) * Math.sin(z), r * Math.sin(a), -r * Math.cos(a) * Math.cos(z)); }
export function vecToAltAz(v) { const n = v.clone().normalize(); return { alt: Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) * A.R2D, az: A.norm360(Math.atan2(n.x, -n.z) * A.R2D) }; }
const eqVec = (ra, dec) => { const a = ra * A.D2R, d = dec * A.D2R; return v3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)); };

export class World {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.03, 3000);
    this.player = { pos: v3(0, 1.65, 1.6), yaw: 0.35, pitch: 0.25, vel: v3(0, 0, 0) };
    this.keys = {};
    this.running = false;
    this.locId = null; this.rigKey = null;
    this.hover = null; this.grab = false; this.flashlight = false;
    this.listeners = {};
    this.clock = new THREE.Clock();
    this.buildStatic();
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, d) { for (const f of this.listeners[ev] || []) f(d); }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.starMat) this.starMat.uniforms.pxScale.value = this.renderer.getPixelRatio() * Math.max(0.8, h / 900);
  }

  // ------------------------------------------------------------ static scene
  buildStatic() {
    const sc = this.scene;
    // sky dome (world-fixed)
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { sunDir: { value: v3(0, -1, 0) }, moonDir: { value: v3(0, -1, 0) }, sunAlt: { value: -30 }, moonBright: { value: 0 }, lp: { value: 0.3 }, lpDir: { value: v3(0, 0, 1) }, lpColor: { value: new THREE.Color(0.85, 0.6, 0.42) }, cloud: { value: 0 }, natural: { value: 1 }, auStr: { value: 0 }, auPole: { value: 0 }, auArc: { value: 20 }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 sunDir, moonDir, lpDir, lpColor; uniform float sunAlt, moonBright, lp, cloud, natural, auStr, auPole, auArc, uTime;
        float h1(float x){ return fract(sin(x*127.1)*43758.5453); }
        float n1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(h1(i), h1(i+1.0), f); }
        float fb(float x){ return 0.5*n1(x) + 0.25*n1(x*2.03+7.0) + 0.125*n1(x*4.1+3.0) + 0.0625*n1(x*8.3+1.0); }
        vec3 aurora(vec3 d){
          if (auStr <= 0.0) return vec3(0.0);
          float al = asin(clamp(max(d.y, 0.0),-1.0,1.0)); float az = degrees(atan(d.x, -d.z));
          float da = radians(mod(az - auPole + 540.0, 360.0) - 180.0);
          float q = degrees(atan(sin(al), cos(al)*cos(da)));
          float sA = degrees(asin(clamp(cos(al)*sin(da), -1.0, 1.0)));
          float side = exp(-pow(sA/80.0, 2.0));
          float g = 0.0, r = 0.0;
          for (int k = 0; k < 2; k++) {
            float qa = auArc - float(k) * 28.0; float w = k == 0 ? 1.0 : 0.55;
            if (k == 1 && !(auStr > 0.6 && auArc > 40.0)) break;
            float up = qa < 90.0 ? 1.0 : -1.0;
            float x = (q - qa) * up + (fb(sA*0.04 + uTime/900.0 + qa) - 0.5) * 9.0;
            float lower = smoothstep(-4.0, 1.2, x);
            float ray = 0.3 + 0.7*pow(fb(sA*0.45 + uTime/240.0 + qa*1.3), 1.5)*1.7;
            g += w * lower * exp(-max(0.0, x)/10.0) * ray;
            r += w * lower * smoothstep(7.0, 20.0, x) * exp(-max(0.0, x-16.0)/24.0) * (0.4 + ray*0.5);
          }
          float pulse = 0.55 + 0.45*fb(uTime/600.0 + 3.3);
          float S = auStr * side * pulse * smoothstep(-0.02, 0.04, d.y);
          return (vec3(0.08,0.85,0.35) * g + vec3(0.7,0.06,0.18) * r * 0.5) * S * 0.42;
        }
        void main(){
          vec3 d = normalize(vDir); float alt = max(d.y, 0.0);
          float hz = exp(-alt * 6.0);
          vec3 night = mix(vec3(0.004,0.006,0.014), vec3(0.012,0.016,0.03), hz) * natural;
          // airglow band
          night += vec3(0.006,0.012,0.006) * exp(-alt*9.0) * natural;
          // light pollution dome
          vec2 dxz = normalize(d.xz + 1e-5); float toward = max(dot(dxz, normalize(lpDir.xz)), 0.0);
          vec3 lpc = lpColor * lp * (0.18 * exp(-alt*3.5) + 0.05) * (1.0 + 2.5 * pow(toward, 3.0) * exp(-alt*5.0));
          // twilight
          float t = clamp((sunAlt + 18.0) / 18.0, 0.0, 1.0);
          float sunSide = max(dot(dxz, normalize(sunDir.xz + 1e-5)), 0.0);
          vec3 day = mix(vec3(0.05,0.12,0.35), vec3(0.35,0.55,0.9), clamp((sunAlt)/20.0+0.5,0.0,1.0));
          vec3 tw = mix(vec3(0.02,0.04,0.12), day, smoothstep(-12.0, 2.0, sunAlt)) * pow(t, 2.2);
          tw += vec3(1.0,0.45,0.15) * pow(sunSide, 4.0) * exp(-alt*5.0) * smoothstep(-15.0, -2.0, sunAlt) * (1.0 - smoothstep(-1.0, 12.0, sunAlt)) * 0.9;
          // moonlight scattering
          float md = max(dot(d, moonDir), 0.0);
          vec3 moon = moonBright * (vec3(0.05,0.08,0.16) * (0.4 + 0.6*hz) + vec3(0.6,0.6,0.55) * pow(md, 60.0) + vec3(0.12,0.13,0.16) * pow(md, 8.0));
          vec3 col = night + lpc + tw + moon + aurora(d);
          col = mix(col, col * 0.5 + lpColor * lp * 0.12 + vec3(0.02) * moonBright, cloud * 0.6);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_R + 80, 48, 24), this.skyMat); sky.renderOrder = -10; sky.frustumCulled = false;
    sc.add(sky); this.sky = sky;

    // celestial sphere (stars + Milky Way) — rotated every frame to sidereal time
    this.celestial = new THREE.Group(); this.celestial.matrixAutoUpdate = false; sc.add(this.celestial);
    this.mwMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { map: { value: null }, strength: { value: 0 } },
      vertexShader: `varying vec3 vLocal; varying float vAlt; void main(){ vLocal = position; vec4 wp = modelMatrix*vec4(position,1.0); vAlt = normalize(wp.xyz).y; gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `varying vec3 vLocal; varying float vAlt; uniform sampler2D map; uniform float strength;
        void main(){ vec3 p = normalize(vLocal); float ra = atan(p.y, p.x); if (ra < 0.0) ra += 6.2831853; float dec = asin(clamp(p.z,-1.0,1.0));
          vec2 uv = vec2(ra/6.2831853, dec/3.14159265 + 0.5); vec3 c = texture2D(map, uv).rgb;
          float ext = smoothstep(0.0, 0.35, vAlt); gl_FragColor = vec4(c * strength * ext, 1.0); }`,
    });
    this.mw = new THREE.Mesh(new THREE.SphereGeometry(SKY_R + 20, 96, 48), this.mwMat); this.mw.renderOrder = -8; this.mw.frustumCulled = false;
    this.celestial.add(this.mw);

    // Moon
    this.moonCanvas = document.createElement('canvas'); this.moonCanvas.width = this.moonCanvas.height = 128;
    this.moonTex = new THREE.CanvasTexture(this.moonCanvas); this.moonTex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.moonTex, transparent: true, depthWrite: false, toneMapped: false }));
    this.moon.renderOrder = -6; sc.add(this.moon);
    // Sun (visible only near twilight edge)
    this.sun = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false }));
    sc.add(this.sun);

    // clouds
    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide,
      uniforms: { cover: { value: 0 }, time: { value: 0 }, lit: { value: new THREE.Color(0.1, 0.08, 0.07) }, wind: { value: new THREE.Vector2(1, 0.3) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir; uniform float cover, time; uniform vec3 lit; uniform vec2 wind;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
        void main(){ vec3 d = normalize(vDir); if (d.y < 0.01) discard; vec2 p = d.xz / (d.y + 0.08) * 1.6 + wind * time;
          float f = fbm(p); float dens = smoothstep(1.0 - cover - 0.12, 1.0 - cover + 0.2, f) * smoothstep(0.0, 0.12, d.y);
          gl_FragColor = vec4(lit * (0.6 + 0.6*f), dens * 0.97); }`,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(700, 48, 24), this.cloudMat); this.clouds.renderOrder = -4; sc.add(this.clouds);

    // lights
    this.hemi = new THREE.HemisphereLight(0x8a9ac0, 0x2a3024, 1); sc.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight(0xc8d0e8, 0); this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(1024, 1024); Object.assign(this.moonLight.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 80 });
    sc.add(this.moonLight); sc.add(this.moonLight.target);
    this.lpLight = new THREE.HemisphereLight(0xffa860, 0x000000, 0.0); sc.add(this.lpLight);
    this.flash = new THREE.SpotLight(0xff1a00, 0, 14, 0.55, 0.6, 1.5); sc.add(this.flash); sc.add(this.flash.target);

    // ground
    const gc = document.createElement('canvas'); gc.width = gc.height = 256; const g = gc.getContext('2d');
    const r = mulberry32(7); g.fillStyle = '#3c5230'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { const s = r(); g.fillStyle = `rgba(${20 + s * 50},${40 + s * 60},${15 + s * 25},${0.35 + r() * 0.4})`; g.fillRect(r() * 256, r() * 256, 1, 2 + r() * 3); }
    this.groundTex = new THREE.CanvasTexture(gc); this.groundTex.wrapS = this.groundTex.wrapT = THREE.RepeatWrapping; this.groundTex.repeat.set(120, 120); this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundMat = new THREE.MeshLambertMaterial({ map: this.groundTex, color: 0xffffff });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 64), this.groundMat); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground); this.ground = ground;

    // site-specific scenery & rig get built in update()
    this.siteGroup = new THREE.Group(); sc.add(this.siteGroup);
    this.rigGroup = new THREE.Group(); this.rigGroup.position.set(0, 0, -1.2); sc.add(this.rigGroup);
    this.buildTable();
  }

  buildStars() {
    if (this.stars || !cat.loaded) return;
    const n = cat.stars.length; const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mag = new Float32Array(n);
    cat.stars.forEach((s, i) => { const v = eqVec(s.ra, s.dec).multiplyScalar(SKY_R); pos.set([v.x, v.y, v.z], i * 3); const c = bvToRGB(s.bv); col.set(c, i * 3); mag[i] = s.mag; });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    this.starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { limMag: { value: 5 }, pxScale: { value: 1 }, time: { value: 0 }, seeing: { value: 2 } },
      vertexShader: `attribute float mag; attribute vec3 color; uniform float limMag, pxScale, time, seeing; varying vec3 vColor; varying float vA;
        void main(){ vec4 wp = modelMatrix*vec4(position,1.0); float alt = normalize(wp.xyz).y;
          float airm = 1.0/max(alt + 0.05, 0.05); float m = mag + 0.2*(airm-1.0);
          float b = pow(10.0, -0.4*(m - limMag));
          float tw = 1.0 + 0.35*sin(time*(9.0+mod(position.x,7.0)) + position.y) * clamp(seeing/3.0,0.2,1.2) * smoothstep(0.7,0.05,alt);
          vA = clamp(b * 0.9, 0.0, 1.0) * smoothstep(-0.01, 0.06, alt) * tw;
          vColor = color; gl_PointSize = clamp(1.6 + (limMag - m) * 0.85, 0.0, 7.5) * pxScale;
          gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `varying vec3 vColor; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c)*2.0; float a = exp(-r*r*3.5) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vColor * a * 1.6, 1.0); }`,
    });
    this.stars = new THREE.Points(geo, this.starMat); this.stars.frustumCulled = false; this.stars.renderOrder = -7;
    this.celestial.add(this.stars);
    // Milky Way texture from the catalog outline (equirectangular in RA/Dec)
    const W = 2048, H = 1024; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.filter = 'blur(9px)';
    for (const poly of cat.mw) {
      g.beginPath(); let prev = null;
      for (const [ra, dec] of poly.pts) { const x = (ra / 360) * W, y = ((dec + 90) / 180) * H; if (prev && Math.abs(x - prev) > W / 2) { g.moveTo(x, y); } else g.lineTo(x, y); prev = x; }
      g.closePath(); g.fillStyle = `rgba(165,172,200,${0.16 + poly.lvl * 0.03})`; g.fill('evenodd');
    }
    g.filter = 'none';
    // mottle
    const nz = makeNoise(11); const id = g.getImageData(0, 0, W, H); const d = id.data;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const i = (y * W + x) * 4; if (!d[i]) continue; const f = 0.55 + 0.9 * nz.fbm(x / 60, y / 60, 4); d[i] *= f; d[i + 1] *= f; d[i + 2] *= f * 1.05; }
    g.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
    this.mwMat.uniforms.map.value = tex;
  }

  buildTable() {
    const t = new THREE.Group(); t.position.set(1.35, 0, -0.6); t.rotation.y = -0.5;
    const wood = new THREE.MeshLambertMaterial({ color: 0x3a3632 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.6), wood); top.position.y = 0.72; top.castShadow = top.receiveShadow = true; t.add(top);
    for (const [x, z] of [[-0.4, -0.25], [0.4, -0.25], [-0.4, 0.25], [0.4, 0.25]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72), wood); l.position.set(x, 0.36, z); t.add(l); }
    // laptop
    const lap = new THREE.Group(); lap.position.set(0, 0.735, 0.03); t.add(lap);
    const alu = new THREE.MeshStandardMaterial({ color: 0x9a9ea6, metalness: 0.7, roughness: 0.35 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.016, 0.23), alu); base.position.y = 0.008; lap.add(base);
    const kb = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.1), new THREE.MeshLambertMaterial({ color: 0x111111 })); kb.rotation.x = -Math.PI / 2; kb.position.set(0, 0.0165, -0.01); lap.add(kb);
    const lid = new THREE.Group(); lid.position.set(0, 0.016, -0.115); lid.rotation.x = 0.28; lap.add(lid);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.008), alu); back.position.set(0, 0.11, -0.004); lid.add(back);
    this.screenCanvas = document.createElement('canvas'); this.screenCanvas.width = 640; this.screenCanvas.height = 400;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas); this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.194), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    screen.position.set(0, 0.112, 0.0005); lid.add(screen);
    for (const m of [base, back, screen, kb]) m.userData.action = 'laptop';
    this.screenLight = new THREE.PointLight(0x6080ff, 0.25, 2.5, 2); this.screenLight.position.set(0, 0.15, 0.15); lid.add(this.screenLight);
    // red headlamp on the table
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.02), new THREE.MeshBasicMaterial({ color: 0x550000 })); lamp.position.set(0.32, 0.75, 0.18); t.add(lamp);
    this.table = t; this.laptop = lap; this.laptopScreen = screen;
    this.scene.add(t);
  }

  // ------------------------------------------------------------ site
  buildSite(locId) {
    const loc = S.locNow();
    this.locId = locId;
    const grp = this.siteGroup; grp.clear();
    const rnd = mulberry32(hashStr('site' + locId));
    // horizon silhouette ring exactly matching the simulated horizon profile
    const D = 260, segs = 360; const posArr = []; const idx = [];
    for (let i = 0; i <= segs; i++) {
      const az = (i / segs) * 360; const h = Math.max(0.3, horizonAlt(loc, az)) + (loc.bortle >= 5 ? (rnd() - 0.5) * 0.8 : 0);
      const top = Math.tan(h * A.D2R) * D; const p0 = altAzToVec(0, az, D), x = p0.x, z = p0.z;
      posArr.push(x, -2, z, x, top, z);
      if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3)); hg.setIndex(idx); hg.computeVertexNormals();
    const silhouette = new THREE.Mesh(hg, new THREE.MeshLambertMaterial({ color: 0x0b120c, side: THREE.DoubleSide }));
    grp.add(silhouette);
    const biome = loc.biome || 'field';
    const GROUND = { suburb: 0x3c5230, city: 0x6a6a6e, forest: 0x34482a, field: 0x46582f, mountain: 0x5a5448, observatory: 0x6b5a4a, desert: 0xb59a6a, snow: 0xe8eef4, coast: 0x8c7d5c };
    this.groundMat.map = this.groundTexture(biome); this.groundMat.color.set(0xffffff); this.groundMat.needsUpdate = true; void GROUND;
    silhouette.material.color.set({ desert: 0x2a2018, observatory: 0x1e1814, mountain: 0x161614, snow: 0x30363e, city: 0x07080a, coast: 0x0b100c }[biome] || 0x0b120c);
    const treeMat = new THREE.MeshLambertMaterial({ color: biome === 'snow' ? 0x1a2a20 : 0x14200f }), trunkMat = new THREE.MeshLambertMaterial({ color: 0x2a1d14 });
    const snowCap = new THREE.MeshLambertMaterial({ color: 0xe8eef6 });
    const addTree = (x, z, hgt, snowy) => {
      const tr = new THREE.Group(); tr.position.set(x, 0, z);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, hgt * 0.35), trunkMat); trunk.position.y = hgt * 0.175; tr.add(trunk);
      for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(hgt * (0.32 - k * 0.07), hgt * 0.45, 9), k === 2 && snowy ? snowCap : treeMat); c.position.y = hgt * (0.4 + k * 0.18); c.castShadow = true; tr.add(c); }
      grp.add(tr);
    };
    const rockM = new THREE.MeshLambertMaterial({ color: biome === 'desert' ? 0x7a6448 : biome === 'snow' ? 0x5a5f66 : 0x55504a });
    const addRocks = (n, dmin, dmax, smax) => { for (let i = 0; i < n; i++) { const a = rnd() * 360, d = dmin + rnd() * (dmax - dmin); const p = altAzToVec(0, a, d); const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + rnd() * smax), rockM); r.position.set(p.x, 0.05, p.z); r.rotation.set(rnd(), rnd(), rnd()); r.castShadow = true; grp.add(r); } };
    const windowTex = (lit) => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
      g.fillStyle = '#121418'; g.fillRect(0, 0, 128, 256);
      for (let y = 6; y < 250; y += 12) for (let x = 6; x < 124; x += 12) { g.fillStyle = rnd() < lit ? `hsl(${35 + rnd() * 20},${60 + rnd() * 30}%,${55 + rnd() * 25}%)` : '#1c2026'; g.fillRect(x, y, 7, 8); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    if (biome === 'suburb') {
      // house with a porch light, fence, trees, street light glow
      const house = new THREE.Group(); const hp = altAzToVec(0, 45, 24); house.position.set(hp.x, 0, hp.z); house.lookAt(0, 0, 0);
      const wall = new THREE.MeshLambertMaterial({ color: 0x5a5550 }); const roofM = new THREE.MeshLambertMaterial({ color: 0x2a2626 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(12, 5.5, 8), wall); body.position.y = 2.75; body.castShadow = body.receiveShadow = true; house.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(8, 2.8, 4), roofM); roof.position.y = 6.9; roof.rotation.y = Math.PI / 4; roof.scale.set(1.05, 1, 0.72); house.add(roof);
      const winM = new THREE.MeshBasicMaterial({ color: 0xffc070, toneMapped: false });
      for (const [x, y] of [[-3, 1.6], [3.5, 1.6], [-3, 4.2], [2, 4.2]]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.1), rnd() > 0.4 ? winM : new THREE.MeshLambertMaterial({ color: 0x111418 })); w.position.set(x, y, 4.01); house.add(w); }
      const porch = new THREE.PointLight(0xffb060, 6, 30, 1.6); porch.position.set(0.5, 2.4, 4.6); house.add(porch);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08), new THREE.MeshBasicMaterial({ color: 0xfff0c0, toneMapped: false })); bulb.position.copy(porch.position); house.add(bulb);
      grp.add(house);
      const fenceM = new THREE.MeshLambertMaterial({ color: 0x3b3128 });
      for (let a = 100; a < 330; a += 2.2) { const p = altAzToVec(0, a, 14); const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 0.12), fenceM); post.position.set(p.x, 0.9, p.z); grp.add(post); }
      for (const a of [250, 280, 20, 140]) { const p = altAzToVec(0, a, 18 + rnd() * 10); addTree(p.x, p.z, 9 + rnd() * 6); }
      const sp = altAzToVec(0, loc.lpAz, 30); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7), new THREE.MeshLambertMaterial({ color: 0x222222 })); pole.position.set(sp.x, 3.5, sp.z); grp.add(pole);
      const sl = new THREE.PointLight(0xffaa55, 14, 45, 1.4); sl.position.set(sp.x, 7, sp.z); grp.add(sl);
      const lb = new THREE.Mesh(new THREE.SphereGeometry(0.25), new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false })); lb.position.copy(sl.position); grp.add(lb);
    } else if (biome === 'city') {
      // a flat rooftop with a parapet, AC units, and a ring of lit skyscrapers
      const para = new THREE.MeshLambertMaterial({ color: 0x4a4a50 });
      for (const [x, z, w, d] of [[0, -12, 24, 0.3], [0, 12, 24, 0.3], [-12, 0, 0.3, 24], [12, 0, 0.3, 24]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), para); m.position.set(x, 0.55, z); grp.add(m); }
      const acM = new THREE.MeshStandardMaterial({ color: 0x8a8d92, metalness: 0.6, roughness: 0.5 });
      for (const [x, z] of [[-7, 6], [-5, 6], [7, -7]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), acM); m.position.set(x, 0.6, z); m.castShadow = true; grp.add(m); }
      const stair = new THREE.Mesh(new THREE.BoxGeometry(3, 2.8, 3), para); stair.position.set(8, 1.4, 8); grp.add(stair);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false })); door.position.set(6.49, 1, 8); door.rotation.y = -Math.PI / 2; grp.add(door);
      const dl = new THREE.PointLight(0xffd9a0, 3, 12, 1.6); dl.position.set(6, 2.4, 8); grp.add(dl);
      const texs = [windowTex(0.35), windowTex(0.55), windowTex(0.2)];
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * 360 + rnd() * 5, d = 40 + rnd() * 90; const hgt = Math.tan(horizonAlt(loc, a) * A.D2R) * d * (0.8 + rnd() * 0.5) + 10;
        const w = 12 + rnd() * 18; const p = altAzToVec(0, a, d);
        const t = texs[i % 3].clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / 12, hgt / 24);
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, w), new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: 0xbbbbbb }));
        m.position.set(p.x, hgt / 2 - 20, p.z); m.lookAt(0, hgt / 2 - 20, 0); grp.add(m);
        if (rnd() < 0.3) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.4), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false })); b.position.set(p.x, hgt - 19.5, p.z); grp.add(b); }
      }
      silhouette.visible = false;
    } else if (biome === 'forest' || biome === 'field') {
      const n = biome === 'forest' ? 46 : 16;
      for (let i = 0; i < n; i++) { const a = rnd() * 360, d = (biome === 'forest' ? 22 : 45) + rnd() * 60; const p = altAzToVec(0, a, d); addTree(p.x, p.z, 8 + rnd() * 10); }
      this.addCar(grp, 6, 3);
    } else if (biome === 'mountain' || biome === 'snow') {
      addRocks(55, 6, 140, 1.8);
      for (let i = 0; i < (biome === 'snow' ? 30 : 10); i++) { const a = rnd() * 360, d = 25 + rnd() * 90; const p = altAzToVec(0, a, d); addTree(p.x, p.z, 5 + rnd() * 9, biome === 'snow' || loc.elev > 1500); }
      if (biome === 'snow') { const lake = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x0a1018, metalness: 0.9, roughness: 0.08 })); lake.rotation.x = -Math.PI / 2; const lp = altAzToVec(0, 200, 85); lake.position.set(lp.x, 0.02, lp.z); grp.add(lake); }
      this.addCar(grp, 7, 4);
    } else if (biome === 'observatory') {
      addRocks(45, 8, 120, 1.6);
      const domeM = new THREE.MeshStandardMaterial({ color: 0xe9ebef, metalness: 0.4, roughness: 0.35 });
      for (const [a, d, r] of [[60, 70, 9], [100, 110, 14], [140, 60, 6], [300, 90, 11], [330, 160, 18]]) {
        const p = altAzToVec(0, a, d); const b = new THREE.Group(); b.position.set(p.x, 0, p.z);
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.9, 40), domeM); cyl.position.y = r * 0.45; b.add(cyl);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), domeM); dome.position.y = r * 0.9; b.add(dome);
        const slit = new THREE.Mesh(new THREE.BoxGeometry(r * 0.35, r * 0.05, r * 2.02), new THREE.MeshBasicMaterial({ color: 0x050608 })); slit.position.y = r * 1.75; b.add(slit);
        grp.add(b);
      }
      this.addCar(grp, 7, 4);
    } else if (biome === 'desert') {
      addRocks(45, 8, 140, 1.5);
      if (loc.lon < -30 && loc.lat > 15) for (let i = 0; i < 14; i++) { const a = rnd() * 360, d = 12 + rnd() * 60; const p = altAzToVec(0, a, d); const c = new THREE.Group(); c.position.set(p.x, 0, p.z); const cm = new THREE.MeshLambertMaterial({ color: 0x24361e }); const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 3 + rnd() * 2), cm); t.position.y = 1.6; c.add(t); const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.2), cm); arm.position.set(0.45, 2, 0); c.add(arm); grp.add(c); }
      this.addCar(grp, 7, 4);
    } else if (biome === 'coast') {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 450), new THREE.MeshStandardMaterial({ color: 0x050c14, metalness: 0.85, roughness: 0.15 })); sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.05, 240); grp.add(sea);
      addRocks(20, 6, 40, 1.2); this.addCar(grp, 6, -4);
    }
  }
  groundTexture(biome) {
    this._gtex = this._gtex || {};
    if (this._gtex[biome]) return this._gtex[biome];
    const pal = { suburb: ['#3c5230', [20, 40, 15], [50, 60, 25]], forest: ['#34482a', [20, 35, 15], [45, 55, 25]], field: ['#4a5a30', [30, 40, 15], [60, 60, 25]],
      city: ['#55565a', [70, 70, 72], [25, 25, 25]], mountain: ['#5a5448', [60, 55, 48], [35, 32, 28]], observatory: ['#6b5444', [80, 60, 45], [30, 25, 20]],
      desert: ['#b09060', [170, 140, 95], [35, 30, 20]], snow: ['#dfe6ee', [215, 222, 232], [25, 25, 25]], coast: ['#8c7d5c', [140, 125, 92], [30, 28, 22]] }[biome] || ['#3c5230', [20, 40, 15], [50, 60, 25]];
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const r = mulberry32(hashStr('g' + biome));
    g.fillStyle = pal[0]; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { const s = r(); g.fillStyle = `rgba(${pal[1][0] + s * pal[2][0]},${pal[1][1] + s * pal[2][1]},${pal[1][2] + s * pal[2][2]},${0.3 + r() * 0.4})`; if (biome === 'suburb' || biome === 'forest' || biome === 'field') g.fillRect(r() * 256, r() * 256, 1, 2 + r() * 3); else g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2); }
    if (biome === 'city') { g.strokeStyle = 'rgba(30,30,32,.6)'; for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); } }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(biome === 'city' ? 40 : 120, biome === 'city' ? 40 : 120); t.colorSpace = THREE.SRGBColorSpace;
    return (this._gtex[biome] = t);
  }
  addCar(grp, x, z) {
    const car = new THREE.Group(); car.position.set(x, 0, z); car.rotation.y = 0.7;
    const m = new THREE.MeshStandardMaterial({ color: 0x223044, metalness: 0.6, roughness: 0.4 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.8, 1.8), m); b.position.y = 0.65; car.add(b);
    const t = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 1.7), m); t.position.set(-0.2, 1.35, 0); car.add(t);
    const wm = new THREE.MeshLambertMaterial({ color: 0x111111 });
    for (const [px, pz] of [[-1.4, 0.9], [1.4, 0.9], [-1.4, -0.9], [1.4, -0.9]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 16), wm); w.rotation.x = Math.PI / 2; w.position.set(px, 0.34, pz); car.add(w); }
    car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    grp.add(car);
  }

  // ------------------------------------------------------------ rig
  buildRig() {
    const rig = G.s.rig; const ri = rigInfo(rig);
    this.rigKey = JSON.stringify(rig);
    const R = this.rigGroup; R.clear();
    const mount = ri.mount; const loc = S.locNow();
    const black = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5, metalness: 0.3 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.4, metalness: 0.1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d94, roughness: 0.3, metalness: 0.85 });
    const red = new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.4, metalness: 0.3 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1d3f8a, roughness: 0.4, metalness: 0.4 });
    const tag = (m, a) => { m.userData.action = a; m.castShadow = true; return m; };
    const heavy = mount.type === 'eq' && mount.payload >= 9;
    const headH = mount.type === 'fixed' ? 1.35 : heavy ? 1.05 : 1.15;
    // tripod
    const legR = heavy ? 0.025 : 0.014;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3, spread = heavy ? 0.55 : 0.45;
      const foot = v3(Math.cos(a) * spread, 0, Math.sin(a) * spread), top = v3(Math.cos(a) * 0.06, headH - 0.06, Math.sin(a) * 0.06);
      const len = foot.distanceTo(top); const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR * 0.8, len, 8), heavy ? metal : black);
      leg.position.copy(foot.clone().add(top).multiplyScalar(0.5)); leg.lookAt(top); leg.rotateX(Math.PI / 2); R.add(tag(leg, 'mount'));
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(heavy ? 0.12 : 0.07, heavy ? 0.12 : 0.07, 0.06, 16), black); hub.position.y = headH - 0.03; R.add(tag(hub, 'mount'));
    const refs = { headH };
    // mount head
    const head = new THREE.Group(); head.position.y = headH; R.add(head);
    if (mount.type === 'eq') {
      const south = loc.lat < 0;
      const az = new THREE.Group(); az.rotation.y = south ? Math.PI : 0; head.add(az);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(heavy ? 0.1 : 0.06, heavy ? 0.11 : 0.07, 0.08, 20), white); base.position.y = 0.04; az.add(tag(base, 'polar'));
      const polar = new THREE.Group(); polar.position.y = 0.1; az.add(polar);
      polar.rotation.x = -(90 - Math.abs(loc.lat)) * A.D2R;
      const ra = new THREE.Mesh(new THREE.CylinderGeometry(heavy ? 0.075 : 0.045, heavy ? 0.075 : 0.045, heavy ? 0.32 : 0.2, 20), white); ra.position.y = heavy ? 0.12 : 0.08; polar.add(tag(ra, 'polar'));
      if (mount.polarScope) { const ps = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.06, 12), black); ps.position.y = -0.05; polar.add(tag(ps, 'polar')); }
      const raRot = new THREE.Group(); raRot.position.y = heavy ? 0.3 : 0.2; polar.add(raRot);
      const decH = new THREE.Mesh(new THREE.CylinderGeometry(heavy ? 0.065 : 0.04, heavy ? 0.065 : 0.04, heavy ? 0.3 : 0.18, 20), white); decH.rotation.z = Math.PI / 2; raRot.add(tag(decH, 'mount'));
      if (mount.payload >= 5 && mount.id !== 'harmonic') {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45), metal); shaft.rotation.z = Math.PI / 2; shaft.position.x = -0.3; raRot.add(shaft);
        const cw = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 20), metal); cw.rotation.z = Math.PI / 2; cw.position.x = -0.42; raRot.add(cw);
        refs.shaft = shaft; refs.cw = cw;
        if (mount.payload >= 5 && mount.type === 'eq' && mount.id === 'tracker') { shaft.scale.y = 0.6; cw.scale.set(0.5, 0.5, 0.5); }
      }
      const saddle = new THREE.Object3D(); saddle.position.x = heavy ? 0.2 : 0.12; raRot.add(saddle);
      refs.polar = polar; refs.raRot = raRot; refs.saddle = saddle; refs.south = south; refs.sadOff = saddle.position.x;
    } else if (mount.type === 'altaz') {
      const azRot = new THREE.Group(); head.add(azRot);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.08, 20), black); base.position.y = 0.04; azRot.add(tag(base, 'mount'));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.1), black); arm.position.set(0.08, 0.2, 0); azRot.add(tag(arm, 'mount'));
      const saddle = new THREE.Object3D(); saddle.position.set(0, 0.3, 0); azRot.add(saddle);
      refs.azRot = azRot; refs.saddle = saddle;
    } else {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), metal); ball.position.y = 0.04; head.add(tag(ball, 'mount'));
      const saddle = new THREE.Object3D(); saddle.position.y = 0.09; head.add(saddle); refs.saddle = saddle;
    }
    // optical tube / lens + camera, built along +Z
    const ota = new THREE.Group(); R.add(ota); refs.ota = ota;
    const opt = ri.opt, cam = ri.cam;
    let len, rad, frontZ;
    if (!opt) { len = 0.1; rad = 0.03; }
    else if (opt.type === 'lens') {
      len = 0.05 + ri.focal * 0.00055 + (opt.id === 'lens_200' ? 0.05 : 0); rad = Math.max(0.03, Math.min(0.055, ri.D / 2000 + 0.02));
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.9, len, 28), black); lens.rotation.x = Math.PI / 2; lens.position.z = len / 2 + 0.04; ota.add(tag(lens, 'focus'));
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.04, rad * 1.04, len * 0.3, 28), new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9 })); ring.rotation.x = Math.PI / 2; ring.position.z = len * 0.65 + 0.04; ota.add(tag(ring, 'focus'));
      if (opt.id === 'lens_135' || opt.id === 'lens_200') { const rl = new THREE.Mesh(new THREE.TorusGeometry(rad * 1.02, 0.002, 6, 32), red); rl.position.z = len + 0.035; ota.add(rl); }
      frontZ = len + 0.04;
    } else {
      const D = opt.D / 1000; const flen = ri.focal / 1000;
      const tubeMat = opt.type === 'refractor' ? white : opt.type === 'sct' || opt.type === 'rasa' || opt.type === 'mak' ? new THREE.MeshStandardMaterial({ color: 0x1c2a4a, metalness: 0.5, roughness: 0.4 }) : opt.type === 'rc' ? black : white;
      if (opt.type === 'refractor') { len = flen * 0.8; rad = D / 2 + 0.012; }
      else if (opt.type === 'newtonian') { len = flen * 1.02; rad = D / 2 + 0.02; }
      else if (opt.type === 'sct' || opt.type === 'rasa' || opt.type === 'mak') { len = D * (opt.type === 'mak' ? 2.6 : 2.1); rad = D / 2 + 0.015; }
      else { len = flen * 0.33; rad = D / 2 + 0.02; }
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 40, 1, opt.type === 'newtonian'), tubeMat); tube.rotation.x = Math.PI / 2; tube.position.z = len / 2 + 0.06; ota.add(tag(tube, 'scope'));
      if (opt.type === 'refractor') { const shield = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.06, rad * 1.06, D * 1.6, 40, 1, true), tubeMat); shield.rotation.x = Math.PI / 2; shield.position.z = len + 0.06 + D * 0.5; ota.add(tag(shield, 'scope')); }
      const glass = new THREE.Mesh(new THREE.CircleGeometry(rad * 0.92, 40), new THREE.MeshStandardMaterial({ color: 0x0a1020, metalness: 0.9, roughness: 0.05, envMapIntensity: 1 })); glass.position.z = opt.type === 'newtonian' ? 0.08 : len + 0.055; ota.add(glass);
      for (const s of [0.3, 0.7]) { const r2 = new THREE.Mesh(new THREE.TorusGeometry(rad + 0.012, 0.012, 8, 32), black); r2.position.z = 0.06 + len * s; ota.add(r2); }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, len * 0.6), metal); bar.position.set(0, -rad - 0.02, 0.06 + len * 0.5); ota.add(bar);
      frontZ = opt.type === 'refractor' ? len + 0.06 + D * 1.3 : len + 0.06;
      if (opt.type === 'newtonian') { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08), black); f.position.set(0, rad + 0.04, len * 0.85); ota.add(tag(f, 'focus')); }
      else { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 20), black); f.rotation.x = Math.PI / 2; f.position.z = 0.0; ota.add(tag(f, 'focus')); const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 16), metal); knob.rotation.z = Math.PI / 2; knob.position.z = 0.01; ota.add(tag(knob, 'focus')); }
      if (ri.hasAF) { const mot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), red); mot.position.set(0.05, -0.03, 0.01); ota.add(mot); }
    }
    // camera body
    if (cam) {
      if (cam.type === 'dslr') { const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.095, 0.075), black); body.position.set(0, 0.012, -0.0); ota.add(tag(body, 'camera')); const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.04), black); grip.position.set(-0.06, 0.008, 0.03); ota.add(grip); const prism = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05), black); prism.position.set(0, 0.07, 0); ota.add(prism); }
      else { const body = new THREE.Mesh(new THREE.CylinderGeometry(cam.w > 5000 ? 0.045 : 0.04, cam.w > 5000 ? 0.045 : 0.04, 0.07, 32), red); body.rotation.x = Math.PI / 2; body.position.z = -0.06; ota.add(tag(body, 'camera')); const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 24), metal); fin.rotation.x = Math.PI / 2; fin.position.z = -0.11; ota.add(fin); }
      if (ri.hasWheel) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 32), black); wh.rotation.x = Math.PI / 2; wh.position.set(0.03, 0, -0.015); ota.add(wh); }
    }
    // guide scope
    if (ri.hasGuide) { const gs = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 20), black); gs.rotation.x = Math.PI / 2; gs.position.set(0, (rad || 0.04) + 0.06, frontZ * 0.5); ota.add(tag(gs, 'scope')); const gc = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 16), red); gc.rotation.x = Math.PI / 2; gc.position.set(0, (rad || 0.04) + 0.06, frontZ * 0.5 - 0.12); ota.add(gc); }
    // dew strap, cap, bahtinov mask
    const dew = new THREE.Mesh(new THREE.CylinderGeometry((rad || 0.04) * 1.04, (rad || 0.04) * 1.04, 0.025, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x200000 }));
    dew.rotation.x = Math.PI / 2; dew.position.z = frontZ - 0.03; ota.add(tag(dew, 'dew')); refs.dew = dew;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry((rad || 0.04) * 1.08, (rad || 0.04) * 1.08, 0.012, 32), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.7 }));
    cap.rotation.x = Math.PI / 2; cap.position.z = frontZ + 0.006; ota.add(tag(cap, 'cap')); refs.cap = cap;
    const fog = new THREE.Mesh(new THREE.CircleGeometry((rad || 0.04) * 0.97, 32), new THREE.MeshBasicMaterial({ color: 0xd8e2ec, transparent: true, opacity: 0, depthWrite: false }));
    fog.position.z = frontZ + 0.003; ota.add(tag(fog, 'dew')); refs.fog = fog;
    const bc = document.createElement('canvas'); bc.width = bc.height = 128; const bg = bc.getContext('2d'); bg.fillStyle = '#222'; bg.beginPath(); bg.arc(64, 64, 62, 0, 7); bg.fill(); bg.fillStyle = '#000';
    for (let i = -60; i < 60; i += 8) { bg.fillRect(4, 64 + i, 56, 4); } bg.save(); bg.translate(96, 64); bg.rotate(0.35); for (let i = -60; i < 60; i += 8) bg.fillRect(-28, i, 56, 4); bg.restore();
    const bt = new THREE.CanvasTexture(bc);
    const baht = new THREE.Mesh(new THREE.CircleGeometry((rad || 0.04) * 1.1, 32), new THREE.MeshStandardMaterial({ map: bt, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })); baht.position.z = frontZ + 0.02; ota.add(tag(baht, 'bahtinov')); refs.baht = baht;
    // panel
    const panel = new THREE.Mesh(new THREE.CylinderGeometry((rad || 0.04) * 1.25, (rad || 0.04) * 1.25, 0.02, 32), new THREE.MeshBasicMaterial({ color: 0xf4f6ff, toneMapped: false })); panel.rotation.x = Math.PI / 2; panel.position.z = frontZ + 0.03; ota.add(panel); refs.panel = panel;
    // status LED
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.006), new THREE.MeshBasicMaterial({ color: 0xff0000, toneMapped: false })); led.position.set(0.04, 0.03, -0.03); ota.add(led); refs.led = led;
    this.otaLength = frontZ;
    this.rig = refs;
  }

  updateRig(t) {
    const n = G.s.night; if (!n || !this.rig) return;
    const p = S.pointing(); if (!p) return;
    const loc = S.locNow(); const mount = GEAR[G.s.rig.mount]; const refs = this.rig;
    const dir = altAzToVec(p.alt, p.az);
    this.rigGroup.updateMatrixWorld(true);
    if (mount.type === 'eq') {
      refs.polar.rotation.z = (n.mount.pa.az / 60) * A.D2R * 6; // exaggerated so you can see the bolts move
      refs.polar.rotation.x = -(90 - Math.abs(loc.lat) - (n.mount.pa.alt / 60) * 6) * A.D2R;
      refs.polar.updateMatrixWorld(true);
      // German equatorial geometry: the dec axis is perpendicular to both the polar axis and the optical axis
      const pq = new THREE.Quaternion(); refs.polar.getWorldQuaternion(pq);
      const poleW = v3(0, 1, 0).applyQuaternion(pq);
      let ax = poleW.clone().cross(dir); if (ax.lengthSq() < 1e-8) ax = v3(1, 0, 0).applyQuaternion(pq); ax.normalize();
      const aL = ax.applyQuaternion(pq.clone().invert());
      refs.raRot.rotation.y = Math.atan2(-aL.z, aL.x);
      refs.raRot.updateMatrixWorld(true);
      const rq = new THREE.Quaternion(); refs.raRot.getWorldQuaternion(rq);
      const side = v3(1, 0, 0).applyQuaternion(rq).y >= 0 ? 1 : -1; // counterweight hangs down
      refs.saddle.position.x = side * refs.sadOff;
      if (refs.shaft) { refs.shaft.position.x = -side * 0.3; refs.cw.position.x = -side * 0.42; }
    } else if (mount.type === 'altaz') refs.azRot.rotation.y = -p.az * A.D2R + Math.PI;
    // place the OTA at the saddle and aim it along the true optical axis
    const sp = new THREE.Vector3(); refs.saddle.getWorldPosition(sp);
    const local = this.rigGroup.worldToLocal(sp.clone());
    refs.ota.position.copy(local);
    const m = new THREE.Matrix4(); const up = Math.abs(dir.y) > 0.98 ? v3(0, 0, -1) : v3(0, 1, 0);
    m.lookAt(v3(0, 0, 0), dir.clone().negate(), up); // lookAt makes -Z face the target; we built along +Z
    refs.ota.quaternion.setFromRotationMatrix(m);
    refs.cap.visible = n.capOn; refs.baht.visible = n.bahtinov; refs.panel.visible = n.panelOn;
    refs.dew.material.emissive.setHex(n.dewHeater ? 0x400000 : 0x000000);
    const fogA = Math.min(0.85, n.dew * 0.9 + (n.smudge || 0) * 0.25);
    refs.fog.visible = !n.capOn && fogA > 0.02; refs.fog.material.opacity = fogA;
    refs.led.material.color.setHex(S.T.exposure ? (Math.floor(t * 2) % 2 ? 0xff2020 : 0x400000) : 0x00ff40);
  }

  // ------------------------------------------------------------ other players (multiplayer)
  setRemotePlayers(list) {
    this.avatars = this.avatars || new Map();
    const seen = new Set();
    for (const p of list) {
      if (!p.pose) continue;
      seen.add(p.id);
      let a = this.avatars.get(p.id);
      if (!a) { a = this.makeAvatar(p); this.avatars.set(p.id, a); this.scene.add(a.g); }
      a.target = p.pose; a.name = p.name;
    }
    for (const [id, a] of this.avatars) if (!seen.has(id)) { this.scene.remove(a.g); this.avatars.delete(id); }
  }
  makeAvatar(p) {
    const g = new THREE.Group();
    const col = new THREE.Color(p.color || '#8fd3ff');
    const jacket = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.55) });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 1.05, 14), jacket); body.position.y = 0.95; body.castShadow = true; g.add(body);
    for (const x of [-0.09, 0.09]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 8), new THREE.MeshLambertMaterial({ color: 0x22252b })); leg.position.set(x, 0.22, 0); g.add(leg); }
    const headPivot = new THREE.Group(); headPivot.position.y = 1.58; g.add(headPivot);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshLambertMaterial({ color: 0xc8a48a })); headPivot.add(head);
    const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: col })); beanie.position.y = 0.02; headPivot.add(beanie);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.025), new THREE.MeshBasicMaterial({ color: 0xff2010, toneMapped: false })); lamp.position.set(0, 0.06, -0.13); headPivot.add(lamp);
    const beam = new THREE.SpotLight(0xff1a00, 0, 10, 0.5, 0.6, 1.5); beam.position.copy(lamp.position); headPivot.add(beam); beam.target.position.set(0, -0.2, -2); headPivot.add(beam.target);
    // name tag
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d');
    x.font = '500 26px "IBM Plex Sans Condensed", system-ui'; x.textAlign = 'center'; x.fillStyle = 'rgba(0,0,0,.55)'; const w = Math.min(250, x.measureText(p.name).width + 24); x.fillRect(128 - w / 2, 4, w, 38);
    x.fillStyle = p.color || '#8fd3ff'; x.fillText(p.name.toUpperCase(), 128, 33);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); tag.scale.set(0.9, 0.17, 1); tag.position.y = 2.0; g.add(tag);
    return { g, headPivot, lamp, beam, cur: null, target: null };
  }
  updateAvatars(dt) {
    if (!this.avatars) return;
    for (const a of this.avatars.values()) {
      const t = a.target; if (!t) continue;
      const tp = v3(t.pos[0], 0, t.pos[2]);
      if (!a.cur) a.cur = { pos: tp.clone(), yaw: t.yaw, pitch: t.pitch };
      const k = Math.min(1, dt * 10);
      a.cur.pos.lerp(tp, k);
      const dy = wrapPi(t.yaw - a.cur.yaw);
      a.cur.yaw += dy * k; a.cur.pitch += (t.pitch - a.cur.pitch) * k;
      a.g.position.copy(a.cur.pos); a.g.rotation.y = a.cur.yaw;
      a.headPivot.rotation.x = THREE.MathUtils.clamp(a.cur.pitch, -0.9, 0.9);
      a.g.scale.y = t.at === 'laptop' ? 0.82 : 1; // sitting at the table
      a.lamp.visible = !!t.lamp; a.beam.intensity = t.lamp ? 2.5 : 0;
    }
  }

  // ------------------------------------------------------------ laptop screen texture
  drawScreen() {
    const c = this.screenCanvas, g = c.getContext('2d'); const W = c.width, H = c.height;
    const red = G.s.settings.nightMode;
    const gr = g.createRadialGradient(W * 0.7, H * 0.2, 10, W * 0.5, H * 0.5, W); gr.addColorStop(0, '#23305a'); gr.addColorStop(1, '#05070f');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,15,22,.9)'; g.fillRect(0, 0, W, 18); g.fillStyle = '#cfd8e6'; g.font = '11px system-ui'; g.fillText('AstroOS   AstroCap', 8, 13);
    const loc = S.locNow(); const p = new Date(G.s.time + loc.tz * 3600000); g.textAlign = 'right'; g.fillText(`${String(p.getUTCHours()).padStart(2, '0')}:${String(p.getUTCMinutes()).padStart(2, '0')}`, W - 8, 13); g.textAlign = 'left';
    // capture window
    g.fillStyle = '#0b0e13'; g.fillRect(20, 30, W - 40, H - 70); g.fillStyle = '#1c2330'; g.fillRect(20, 30, W - 40, 16);
    const lf = S.T.lastFrame;
    if (lf) {
      if (!this._lfCanvas || this._lfId !== lf) { this._lfId = lf; const pv = lf.res.preview; const cc = document.createElement('canvas'); cc.width = pv.w; cc.height = pv.h; cc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pv.rgba.buffer || pv.rgba), pv.w, pv.h), 0, 0); this._lfCanvas = cc; }
      const ar = this._lfCanvas.width / this._lfCanvas.height; const w = W - 200, h = Math.min(H - 100, w / ar);
      g.drawImage(this._lfCanvas, 28, 52, h * ar, h);
      g.fillStyle = '#9fb0c4'; g.font = '11px system-ui';
      const st = lf.res.stats; g.fillText(`HFR ${st.hfr.toFixed(2)}  ★ ${st.stars}`, W - 160, 70); g.fillText(`${lf.meta.exp}s  ${lf.meta.type}`, W - 160, 86);
    } else { g.fillStyle = '#3a4656'; g.font = '13px system-ui'; g.fillText('No image yet', W / 2 - 40, H / 2); }
    const ex = S.T.exposure; if (ex) { const f = Math.min(1, (G.s.time - ex.t0) / 1000 / ex.exp); g.fillStyle = '#300'; g.fillRect(W - 160, 100, 130, 8); g.fillStyle = '#e44'; g.fillRect(W - 160, 100, 130 * f, 8); }
    // dock
    g.fillStyle = 'rgba(40,48,66,.7)'; g.fillRect(W / 2 - 140, H - 30, 280, 24);
    const cols = ['#d63a3a', '#28407a', '#7b3fe4', '#2b6cb0', '#0f3d5e', '#3aa0ff', '#2a8cff', '#1f9d8a', '#f08a24', '#ff5f8a', '#22b573', '#4fb3ff', '#6b7280'];
    cols.forEach((cl, i) => { g.fillStyle = cl; g.fillRect(W / 2 - 134 + i * 21, H - 27, 17, 17); });
    if (red) { g.globalCompositeOperation = 'multiply'; g.fillStyle = '#ff2020'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; }
    this.screenTex.needsUpdate = true;
    this.screenLight.color.setHex(red ? 0xff2010 : 0x6080ff);
  }

  // ------------------------------------------------------------ input
  bindInput() {
    const el = this.renderer.domElement; el.tabIndex = 0; el.style.outline = 'none';
    let drag = null;
    el.addEventListener('mousedown', (e) => {
      el.focus();
      if (e.button === 0 && !document.pointerLockElement) {
        drag = { x: e.clientX, y: e.clientY, moved: false };
        try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* drag-look fallback */ }
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.running) return;
      if (document.pointerLockElement === el) { this.look(e.movementX, e.movementY); return; }
      this.mouse = { x: e.clientX, y: e.clientY };
      if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true; this.look(dx, dy); drag.x = e.clientX; drag.y = e.clientY; }
    });
    window.addEventListener('mouseup', () => { if (drag && !drag.moved && !document.pointerLockElement) this.interact(); drag = null; });
    el.addEventListener('click', () => { if (document.pointerLockElement === el) this.interact(); });
    window.addEventListener('keydown', (e) => {
      if (!this.running || e.target.matches('input,select,textarea')) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyF') { this.flashlight = !this.flashlight; }
      if (e.code === 'KeyR') this.emit('panel');
      if (e.code === 'Escape' && this.grab) this.setGrab(false);
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
  }
  look(dx, dy) {
    const k = 0.0025 * (window.__flSens || 1);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.player.yaw = wrapPi(this.player.yaw - dx * k); this.player.pitch = THREE.MathUtils.clamp(this.player.pitch - dy * k, -1.45, 1.52);
  }
  setGrab(on) {
    this.grab = on;
    this.emit('grab', on);
  }
  interact() {
    if (this.grab) { this.setGrab(false); return; }
    const h = this.hover; if (!h) return;
    this.emit('action', h);
  }
  pick() {
    const ray = new THREE.Raycaster(); ray.far = 4;
    const locked = document.pointerLockElement === this.renderer.domElement;
    if (!locked && this.mouse) {
      const r = this.renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((this.mouse.x - r.left) / r.width) * 2 - 1, -((this.mouse.y - r.top) / r.height) * 2 + 1), this.camera);
    } else ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const objs = [this.rigGroup, this.table];
    const hits = ray.intersectObjects(objs, true).filter((h) => h.object.visible);
    for (const hh of hits) { let o = hh.object; while (o && !o.userData.action) o = o.parent; if (o) return o.userData.action; }
    return null;
  }

  // ------------------------------------------------------------ per-frame
  start() { if (this.running) return; this.running = true; this.clock.getDelta(); const loop = () => { if (!this.running) return; try { this.frame(); } catch (e) { (window.__reportError || console.error)(e); } requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
  stop() { this.running = false; if (document.pointerLockElement) document.exitPointerLock(); }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta()); const t = this.clock.elapsedTime;
    const n = G.s.night; if (!n) return;
    if (!this.stars && cat.loaded) this.buildStars();
    if (this.locId !== n.loc) { this.buildSite(n.loc); }
    if (this.rigKey !== JSON.stringify(G.s.rig)) this.buildRig();
    // movement
    const P = this.player; const sp = (this.keys.ShiftLeft || this.keys.ShiftRight ? 3.2 : 1.4) * dt;
    const fwd = v3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)), right = v3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    if (this.keys.KeyW || this.keys.ArrowUp) P.pos.addScaledVector(fwd, sp);
    if (this.keys.KeyS || this.keys.ArrowDown) P.pos.addScaledVector(fwd, -sp);
    if (this.keys.KeyA || this.keys.ArrowLeft) P.pos.addScaledVector(right, -sp);
    if (this.keys.KeyD || this.keys.ArrowRight) P.pos.addScaledVector(right, sp);
    if (P.pos.length() > 11) P.pos.setLength(11);
    // footsteps
    { const moved = this._lastPos ? Math.hypot(P.pos.x - this._lastPos.x, P.pos.z - this._lastPos.z) : 0; this._lastPos = P.pos.clone(); this._stride = (this._stride || 0) + moved;
      if (this._stride > 0.72) { this._stride = 0; window.dispatchEvent(new CustomEvent('fl-sfx', { detail: { name: 'step', surface: S.locNow()?.biome } })); } }
    P.pos.y = 1.65 + Math.sin(t * 1.3) * 0.003;
    this.camera.position.copy(P.pos);
    this.camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    // sky orientation
    const loc = S.locNow(); const L = A.lst(G.s.time, loc.lon);
    const w = (ra, dec) => { const aa = A.radec2altaz(ra, dec, L, loc.lat); return altAzToVec(aa.alt, aa.az); };
    const c1 = w(0, 0), c2 = w(90, 0), c3 = w(0, 90);
    const M = new THREE.Matrix4().makeBasis(c1, c2, c3); M.setPosition(this.camera.position);
    this.celestial.matrix.copy(M); this.celestial.matrixWorldNeedsUpdate = true;
    this.sky.position.copy(this.camera.position); this.clouds.position.copy(this.camera.position);
    const env = S.envAt(G.s.time);
    const sunV = altAzToVec(env.sunAlt, env.sunAz), moonV = altAzToVec(env.moonAlt, env.moonAz);
    const u = this.skyMat.uniforms;
    u.sunDir.value.copy(sunV); u.moonDir.value.copy(moonV); u.sunAlt.value = env.sunAlt;
    const moonUp = THREE.MathUtils.smoothstep(env.moonAlt, -2, 4);
    u.moonBright.value = moonUp * Math.pow(env.moonIllum, 1.5) * 1.3;
    const lpLevel = Math.log10(1 + Math.max(0, (A.magToNL(loc.sqm) - A.magToNL(21.95)) / A.magToNL(18.5)) * 3) * 0.75;
    u.lp.value = lpLevel * 1.4 * (1 + env.clouds * 1.5); u.lpDir.value.copy(altAzToVec(0, loc.lpAz));
    u.cloud.value = env.clouds;
    const au = env.aurora || {}; u.auStr.value = au.strength || 0; u.auPole.value = au.poleAz || 0; u.auArc.value = au.arcAlt || 20; u.uTime.value = G.s.time / 1000 % 1e5;
    // naked-eye limiting magnitude (approx from total sky brightness)
    const skyNL = A.magToNL(loc.sqm) + A.moonSkyNL(env.moonPhase, env.moonAlt, 60, 60) + A.twilightNL(env.sunAlt, 90);
    const skyMag = A.nlToMag(skyNL);
    const lim = THREE.MathUtils.clamp(7.93 - 5 * Math.log10(Math.pow(10, 4.316 - skyMag / 5) + 1), -2, 6.8);
    // planets: bright non-twinkling points on the celestial sphere, refreshed every few sim-minutes
    if (this.starMat && (!this.planetPts || Math.abs(G.s.time - (this._plT || 0)) > 120000)) {
      this._plT = G.s.time;
      const names = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
      if (!this.planetPts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(names.length * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(names.length * 3), 3));
        geo.setAttribute('mag', new THREE.BufferAttribute(new Float32Array(names.length), 1));
        this.planetPts = new THREE.Points(geo, this.starMat); this.planetPts.frustumCulled = false; this.planetPts.renderOrder = -6;
        this.celestial.add(this.planetPts);
      }
      const g = this.planetPts.geometry;
      names.forEach((nm, i) => { const b = S.bodyInfo(nm); const v = eqVec(b.ra, b.dec).multiplyScalar(SKY_R - 5); g.attributes.position.setXYZ(i, v.x, v.y, v.z); g.attributes.color.setXYZ(i, ...b.col); g.attributes.mag.setX(i, b.mag); });
      g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.mag.needsUpdate = true;
    }
    this.updateMeteors(lim);
    if (this.starMat) { this.starMat.uniforms.limMag.value = lim; this.starMat.uniforms.time.value = t; this.starMat.uniforms.seeing.value = env.seeing; }
    this.mwMat.uniforms.strength.value = THREE.MathUtils.clamp((lim - 4.2) / 2.2, 0, 1) * 1.6 * (1 - env.clouds);
    // moon & sun
    const mp = moonV.clone().multiplyScalar(820); this.moon.position.copy(this.camera.position).add(mp); this.moon.lookAt(this.camera.position); this.moon.scale.setScalar(820 * 0.0092 * 1.8);
    if (this._moonPhase === undefined || Math.abs(this._moonPhase - env.moonPhase) > 0.5) { this._moonPhase = env.moonPhase; this.drawMoon(env); }
    this.moon.visible = env.moonAlt > -2;
    this.sun.position.copy(this.camera.position).add(sunV.clone().multiplyScalar(830)); this.sun.lookAt(this.camera.position); this.sun.scale.setScalar(830 * 0.0046 * 1.6); this.sun.visible = env.sunAlt > -1;
    this.moonLight.position.copy(moonV.clone().multiplyScalar(40)); this.moonLight.intensity = moonUp * env.moonIllum * 1.4 * (1 - env.clouds * 0.8);
    const tw = THREE.MathUtils.clamp((env.sunAlt + 12) / 18, 0, 1);
    this.hemi.intensity = 1.1 + tw * 2 + moonUp * env.moonIllum * 0.8;
    this.lpLight.intensity = lpLevel * 0.9 * (1 + env.clouds);
    this.renderer.toneMappingExposure = 1.0 + (1 - tw) * 1.6;
    // clouds
    this.cloudMat.uniforms.cover.value = env.clouds; this.cloudMat.uniforms.time.value = (G.s.time / 1000) * 0.0006;
    const cl = this.cloudMat.uniforms.lit.value; cl.setRGB(0.012 + lpLevel * 0.16 + moonUp * env.moonIllum * 0.08 + tw * 0.4, 0.012 + lpLevel * 0.1 + moonUp * env.moonIllum * 0.08 + tw * 0.4, 0.015 + lpLevel * 0.06 + moonUp * env.moonIllum * 0.09 + tw * 0.45);
    // flashlight (red headlamp)
    this.flash.intensity = this.flashlight ? 3 : 0; this.flash.position.copy(this.camera.position);
    this.flash.target.position.copy(this.camera.position).add(this.camera.getWorldDirection(v3(0, 0, 0)));
    // grabbing the rig: the rig follows your gaze
    if (this.grab) {
      const dirv = this.camera.getWorldDirection(v3(0, 0, 0)); const aa = vecToAltAz(dirv);
      if (!this._lastAim || t - this._lastAim > 0.08) { this._lastAim = t; S.aimAltAz(aa.alt, aa.az); }
    }
    this.updateRig(t);
    this.updateAvatars(dt);
    if (!this._lastScreen || t - this._lastScreen > 0.5) { this._lastScreen = t; this.drawScreen(); }
    // hover
    const prev = this.hover; this.hover = this.grab ? null : this.pick();
    if (prev !== this.hover) this.emit('hover', this.hover);
    this.renderer.render(this.scene, this.camera);
    if (this.onView) try { this.onView(this); } catch (e) { console.warn(e); }
  }
  // meteors: new events since the last frame flash across the sky for ~1 s of real time
  updateMeteors(lim) {
    const MAX = 16;
    if (!this.metLines) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 2 * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX * 2 * 3), 3));
      this.metLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.metLines.frustumCulled = false; this.metLines.renderOrder = -5; this.celestial.add(this.metLines);
      this.metShow = []; this.metLast = G.s.time;
    }
    const now = performance.now() / 1000;
    if (G.s.time < this.metLast || G.s.time - this.metLast > 3600e3) this.metLast = G.s.time;
    for (const e of MET.between(this.metLast + 1, G.s.time)) if (e.t > this.metLast && e.mag < lim + 0.5 && this.metShow.length < MAX) this.metShow.push({ e, t0: now + Math.random() * 0.15 });
    this.metLast = G.s.time;
    this.metShow = this.metShow.filter((m) => now - m.t0 < 1.1);
    const pos = this.metLines.geometry.attributes.position, col = this.metLines.geometry.attributes.color;
    for (let i = 0; i < MAX; i++) {
      const m = this.metShow[i];
      if (!m || now < m.t0) { pos.setXYZ(i * 2, 0, 0, 0); pos.setXYZ(i * 2 + 1, 0, 0, 0); col.setXYZ(i * 2, 0, 0, 0); col.setXYZ(i * 2 + 1, 0, 0, 0); continue; }
      const f = (now - m.t0) / 1.1, head = Math.min(1, f * 1.8), tail = Math.max(0, head - 0.45);
      const a = eqVec(m.e.ra, m.e.dec), b = eqVec(m.e.ra2, m.e.dec2);
      const P = (u) => a.clone().lerp(b, u).normalize().multiplyScalar(SKY_R - 8);
      const ph = P(head), pt = P(tail);
      const br = Math.min(2.2, Math.pow(10, -0.4 * (m.e.mag - lim)) * 0.35) * (1 - Math.max(0, f - 0.55) / 0.45);
      pos.setXYZ(i * 2, pt.x, pt.y, pt.z); pos.setXYZ(i * 2 + 1, ph.x, ph.y, ph.z);
      col.setXYZ(i * 2, 0, 0, 0); col.setXYZ(i * 2 + 1, m.e.col[0] * br, m.e.col[1] * br, m.e.col[2] * br);
    }
    pos.needsUpdate = col.needsUpdate = true;
  }
  // screen position of a sky direction (for HUD markers); null when behind the camera
  projectAltAz(alt, az) {
    const v = altAzToVec(alt, az, 500).add(this.camera.position).project(this.camera);
    if (v.z > 1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, w: r.width, h: r.height };
  }
  viewAltAz() { return vecToAltAz(this.camera.getWorldDirection(v3(0, 0, 0))); }
  drawMoon(env) {
    const c = this.moonCanvas, g = c.getContext('2d'); const W = c.width, r = W * 0.45, cx = W / 2;
    g.clearRect(0, 0, W, W);
    const gl = g.createRadialGradient(cx, cx, r * 0.9, cx, cx, W / 2); gl.addColorStop(0, `rgba(255,250,230,${0.2 * env.moonIllum})`); gl.addColorStop(1, 'rgba(255,250,230,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, W);
    g.fillStyle = '#1a1a1c'; g.beginPath(); g.arc(cx, cx, r, 0, 7); g.fill();
    const ph = A.moonPhase(G.s.time); const k = Math.cos(ph.phaseAngle * A.D2R); const dir = ph.waxing ? 1 : -1;
    g.fillStyle = '#f2ecd6'; g.beginPath(); g.arc(cx, cx, r, -Math.PI / 2, Math.PI / 2, dir < 0); g.ellipse(cx, cx, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === (dir > 0)); g.fill();
    g.fillStyle = 'rgba(80,80,90,.25)'; for (const [x, y, s] of [[0.4, 0.35, 0.12], [0.6, 0.55, 0.18], [0.45, 0.65, 0.08], [0.62, 0.3, 0.07]]) { g.beginPath(); g.arc(W * x, W * y, W * s * 0.5, 0, 7); g.fill(); }
    this.moonTex.needsUpdate = true;
  }
}
void off; void on;
