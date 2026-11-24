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
import { makeNoise, mulberry32, hashStr, smoothstep } from './util.js';
import * as MD from './models.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    // a soft studio environment gives metal and glass something to reflect; dimmed to near nothing at night
    const pm = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    this.scene.environmentIntensity = 0.06;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.03, 3000);
    this.player = { pos: v3(0, 1.65, 1.6), yaw: 0.35, pitch: 0.25, vel: v3(0, 0, 0) };
    this.keys = {};
    this.running = false;
    this.locId = null; this.rigKey = null;
    this.hover = null; this.grab = false; this.flashlight = false;
    this.bino = false; this.binoFov = 7.5; this.showConst = false; this.laserOn = false; this.seated = null;
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
    this.moonLight.shadow.mapSize.set(2048, 2048); this.moonLight.shadow.bias = -0.0004; this.moonLight.shadow.normalBias = 0.02; Object.assign(this.moonLight.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 80 });
    sc.add(this.moonLight); sc.add(this.moonLight.target);
    this.lpLight = new THREE.HemisphereLight(0xffa860, 0x000000, 0.0); sc.add(this.lpLight);
    this.flash = new THREE.SpotLight(0xff1a00, 0, 14, 0.55, 0.6, 1.5); sc.add(this.flash); sc.add(this.flash.target);

    // ground
    const gc = document.createElement('canvas'); gc.width = gc.height = 256; const g = gc.getContext('2d');
    const r = mulberry32(7); g.fillStyle = '#3c5230'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { const s = r(); g.fillStyle = `rgba(${20 + s * 50},${40 + s * 60},${15 + s * 25},${0.35 + r() * 0.4})`; g.fillRect(r() * 256, r() * 256, 1, 2 + r() * 3); }
    this.groundTex = new THREE.CanvasTexture(gc); this.groundTex.wrapS = this.groundTex.wrapT = THREE.RepeatWrapping; this.groundTex.repeat.set(120, 120); this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundMat = new THREE.MeshLambertMaterial({ map: this.groundTex, color: 0xffffff });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2), this.groundMat); ground.receiveShadow = true; sc.add(ground); this.ground = ground;

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
    // The catalog stops at magnitude 6. Binoculars and pristine skies show far more, so fill in a statistical
    // field of fainter stars (mag 6–9.5), crowded toward the galactic plane like the real sky.
    {
      const N = 90000, rnd = mulberry32(4242), fp = new Float32Array(N * 3), fc = new Float32Array(N * 3), fm = new Float32Array(N);
      const aG = 192.85948 * A.D2R, dG = 27.12825 * A.D2R; let k = 0;
      while (k < N) {
        const ra = rnd() * 360, dec = Math.asin(rnd() * 2 - 1) * A.R2D; const d = dec * A.D2R;
        const sb = Math.sin(d) * Math.sin(dG) + Math.cos(d) * Math.cos(dG) * Math.cos(ra * A.D2R - aG);
        if (rnd() > 0.3 + 0.7 * Math.exp(-Math.abs(Math.asin(sb)) * A.R2D / 14)) continue;
        const v = eqVec(ra, dec).multiplyScalar(SKY_R); fp.set([v.x, v.y, v.z], k * 3);
        fc.set(bvToRGB(0.2 + rnd() * 1.2), k * 3);
        fm[k] = 6 + Math.log10(1 + rnd() * (Math.pow(10, 0.46 * 3.5) - 1)) / 0.46; k++;
      }
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fp, 3)); fg.setAttribute('color', new THREE.BufferAttribute(fc, 3)); fg.setAttribute('mag', new THREE.BufferAttribute(fm, 1));
      this.faint = new THREE.Points(fg, this.starMat); this.faint.frustumCulled = false; this.faint.renderOrder = -7; this.celestial.add(this.faint);
    }
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
    this.screenCanvas = document.createElement('canvas'); this.screenCanvas.width = 640; this.screenCanvas.height = 400;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas); this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const out = MD.buildCampTable(this.screenTex); const t = out.group;
    t.position.set(1.35, 0, -0.6); t.rotation.y = -0.5;
    this.screenLight = new THREE.PointLight(0x6080ff, 0.25, 2.5, 2); this.screenLight.position.set(0, 0.15, 0.15); out.lid.add(this.screenLight);
    const chair = MD.buildCampChair(); chair.position.set(0.12, 0, 0.66); chair.rotation.y = Math.PI + 0.15; t.add(chair); this.chair = chair;
    const cs = MD.buildGearCase(); cs.position.set(-0.78, 0, 0.5); cs.rotation.y = 0.5; t.add(cs);
    const cs2 = MD.buildGearCase(0x3a2f24); cs2.scale.setScalar(0.7); cs2.position.set(-0.76, 0.3, 0.48); cs2.rotation.y = 0.3; t.add(cs2);
    this.table = t; this.laptop = out.laptop; this.laptopScreen = out.screen; this.lantern = out.lantern;
    this.scene.add(t);
  }

  // ------------------------------------------------------------ ground
  // Flat where you stand; rolling further out. Heights also seat trees, rocks and buildings.
  groundH(x, z) {
    const r = Math.hypot(x, z); const f = this._gShape || {};
    if (f.flat) return 0;
    let h = smoothstep(14, 50, r) * (this._gNoise.fbm(x / 34 + 3, z / 34 + 7, 3) - 0.42) * (f.amp ?? 1.8);
    if (f.coast) h -= 1.4 * smoothstep(8, 40, z);
    for (const d of f.dips || []) { const dd = Math.hypot(x - d.x, z - d.z); h = THREE.MathUtils.lerp(-d.depth, h, smoothstep(d.r * 0.85, d.r * 1.15, dd)); }
    return h;
  }
  buildGround(biome, shape) {
    this._gNoise = this._gNoise || makeNoise(17);
    this._gShape = shape;
    const geo = new THREE.PlaneGeometry(800, 800, 180, 180); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position; const col = new Float32Array(pos.count * 3); const nz = this._gNoise;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.groundH(x, z));
      const v = 0.72 + 0.42 * nz.fbm(x / 11, z / 11, 3) + 0.12 * (nz.noise(x / 2.5, z / 2.5) - 0.5);
      col[i * 3] = v * (biome === 'snow' ? 1 : 1.02); col[i * 3 + 1] = v; col[i * 3 + 2] = v * (biome === 'snow' ? 1.03 : 0.95);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    this.ground.geometry.dispose(); this.ground.geometry = geo;
  }

  // ------------------------------------------------------------ site
  buildSite(locId) {
    const loc = S.locNow();
    this.locId = locId;
    const grp = this.siteGroup; grp.clear(); this.grass = null;
    const rnd = mulberry32(hashStr('site' + locId));
    const biome = loc.biome || 'field';
    const lake = biome === 'snow' ? altAzToVec(0, 200, 85) : null;
    this.buildGround(biome, { flat: biome === 'city', amp: { mountain: 3.2, snow: 2.6, desert: 1.4, observatory: 2.4, coast: 0.8 }[biome] ?? 1.8, coast: biome === 'coast', dips: lake ? [{ x: lake.x, z: lake.z, r: 60, depth: 0.25 }] : [] });
    const gy = (x, z) => this.groundH(x, z);
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
    this.groundMat.map = this.groundTexture(biome); this.groundMat.color.set(0xffffff); this.groundMat.vertexColors = true; this.groundMat.needsUpdate = true;
    silhouette.material.color.set({ desert: 0x2a2018, observatory: 0x1e1814, mountain: 0x161614, snow: 0x30363e, city: 0x07080a, coast: 0x0b100c }[biome] || 0x0b120c);
    const conColors = biome === 'snow' ? [0x1a2a20, 0x1e3024] : [0x14200f, 0x18281a, 0x1b2a14, 0x223318];
    const leafColors = [0x2a3d1c, 0x334a22, 0x263a1e, 0x3a4a24];
    const place = (o, x, z, sink = 0.05) => { o.position.set(x, gy(x, z) - sink, z); o.traverse((m) => { if (m.isMesh) m.castShadow = true; }); grp.add(o); return o; };
    const addTree = (x, z, hgt, snowy, kind) => place((kind || (rnd() < 0.5 ? 'con' : 'leaf')) === 'con' ? MD.conifer(rnd, hgt, snowy, conColors) : MD.broadleaf(rnd, hgt, leafColors), x, z);
    const rockM = new THREE.MeshLambertMaterial({ color: biome === 'desert' ? 0x7a6448 : biome === 'snow' ? 0x5a5f66 : 0x55504a, flatShading: true });
    const addRocks = (n, dmin, dmax, smax) => { for (let i = 0; i < n; i++) { const a = rnd() * 360, d = dmin + rnd() * (dmax - dmin); const p = altAzToVec(0, a, d); const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + rnd() * smax, 1), rockM); r.scale.set(1, 0.55 + rnd() * 0.4, 0.8 + rnd() * 0.4); r.position.set(p.x, gy(p.x, p.z) + 0.02, p.z); r.rotation.set(rnd(), rnd(), rnd()); r.castShadow = r.receiveShadow = true; grp.add(r); } };
    const addGrass = (n, pal, rMax = 38, h = 0.32) => {
      const tableP = this.table.position; const avoid = (x, z) => (biome === 'coast' && z > 6) || Math.hypot(x - tableP.x, z - tableP.z) < 0.55 || Math.hypot(x, z + 1.2) < 0.35;
      const gf = MD.grassField(n, 0.4, rMax, rnd, pal, gy, avoid, h); grp.add(gf.mesh); this.grass = gf;
    };
    const windowTex = (lit) => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
      g.fillStyle = '#121418'; g.fillRect(0, 0, 128, 256);
      for (let y = 6; y < 250; y += 12) for (let x = 6; x < 124; x += 12) { g.fillStyle = rnd() < lit ? `hsl(${35 + rnd() * 20},${60 + rnd() * 30}%,${55 + rnd() * 25}%)` : '#1c2026'; g.fillRect(x, y, 7, 8); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const addCar = (x, z, rot = 0.7) => { const c = MD.car(rnd, [0x223044, 0x5a1a1a, 0x2b2d31, 0x8a8f96, 0x1d3a2a][Math.floor(rnd() * 5)]); c.rotation.y = rot; place(c, x, z, 0); };
    if (biome === 'suburb') {
      const hp = altAzToVec(0, 45, 24); const house = MD.house(rnd); house.lookAt(hp.clone().multiplyScalar(-1)); place(house, hp.x, hp.z, 0.15);
      const porch = new THREE.PointLight(0xffb060, 6, 30, 1.6); porch.position.set(0.9, 2.6, 4.5); house.add(porch);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08), new THREE.MeshBasicMaterial({ color: 0xfff0c0, toneMapped: false })); bulb.position.copy(porch.position); house.add(bulb);
      MD.fence(grp, 100, 330, 14, altAzToVec, rnd);
      for (const a of [250, 280, 20, 140, 320, 200]) { const p = altAzToVec(0, a, 18 + rnd() * 12); addTree(p.x, p.z, 8 + rnd() * 6, false, a === 280 ? 'con' : 'leaf'); }
      // street light on a curved arm
      const sp = altAzToVec(0, loc.lpAz, 30); const poleM = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.5 });
      const sx = sp.x, sz = sp.z, base = gy(sx, sz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 7.2, 10), poleM); pole.position.set(sx, base + 3.6, sz); grp.add(pole);
      const inward = v3(-sx, 0, -sz).normalize();
      const arm = MD.rod(v3(sx, base + 7.1, sz), v3(sx, base + 7.1, sz).addScaledVector(inward, 1.4).add(v3(0, 0.25, 0)), 0.04, 0.035, poleM); grp.add(arm);
      const lp = v3(sx, base + 7.3, sz).addScaledVector(inward, 1.5);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.28), poleM); head.position.copy(lp); head.lookAt(lp.clone().add(inward)); grp.add(head);
      const sl = new THREE.PointLight(0xffaa55, 14, 45, 1.4); sl.position.copy(lp).add(v3(0, -0.15, 0)); grp.add(sl);
      const lb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.2), new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false })); lb.position.copy(lp).add(v3(0, -0.07, 0)); lb.quaternion.copy(head.quaternion); grp.add(lb);
      addGrass(16000, [[62, 84, 44], [112, 142, 78]], 26, 0.13);
      addCar(-9, 9, 2.2);
    } else if (biome === 'city') {
      // a flat rooftop with a parapet, AC units, vents, and a ring of lit skyscrapers
      const para = new THREE.MeshLambertMaterial({ color: 0x4a4a50 });
      for (const [x, z, w, d] of [[0, -12, 24, 0.3], [0, 12, 24, 0.3], [-12, 0, 0.3, 24], [12, 0, 0.3, 24]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), para); m.position.set(x, 0.55, z); grp.add(m); }
      const acM = new THREE.MeshStandardMaterial({ color: 0x8a8d92, metalness: 0.6, roughness: 0.5 });
      for (const [x, z] of [[-7, 6], [-5, 6], [7, -7]]) {
        const u = new THREE.Group(); u.position.set(x, 0, z);
        u.add(MD.box(1.6, 1.1, 1.6, acM, 0, 0.6, 0)); const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 24), new THREE.MeshStandardMaterial({ color: 0x1a1b1d })); fan.position.y = 1.16; u.add(fan);
        for (let i = 0; i < 4; i++) { const leg = MD.box(0.08, 0.1, 0.08, acM, (i % 2 ? 0.7 : -0.7), 0.05, (i > 1 ? 0.7 : -0.7)); u.add(leg); }
        grp.add(u);
      }
      for (const [x, z] of [[3, -9], [-9, -3]]) { const vent = MD.cylY(0.18, 0.18, 1.2, acM, 0.6, 12); vent.position.set(x, 0.6, z); grp.add(vent); }
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
      const n = biome === 'forest' ? 60 : 18;
      for (let i = 0; i < n; i++) { const a = rnd() * 360, d = (biome === 'forest' ? 20 : 45) + rnd() * 60; const p = altAzToVec(0, a, d); addTree(p.x, p.z, 8 + rnd() * 10, false, biome === 'forest' ? (rnd() < 0.75 ? 'con' : 'leaf') : null); }
      addRocks(biome === 'forest' ? 12 : 6, 8, 40, 0.6);
      addGrass(biome === 'field' ? 15000 : 9000, biome === 'field' ? [[78, 88, 46], [150, 152, 88]] : [[50, 70, 40], [92, 122, 68]], 38, biome === 'field' ? 0.42 : 0.3);
      addCar(6, 3);
    } else if (biome === 'mountain' || biome === 'snow') {
      addRocks(70, 5, 140, 1.8);
      for (let i = 0; i < (biome === 'snow' ? 34 : 14); i++) { const a = rnd() * 360, d = 25 + rnd() * 90; const p = altAzToVec(0, a, d); if (lake && Math.hypot(p.x - lake.x, p.z - lake.z) < 64) continue; addTree(p.x, p.z, 5 + rnd() * 9, biome === 'snow' || loc.elev > 1500, 'con'); }
      if (lake) { const lk = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x0a1018, metalness: 0.9, roughness: 0.08 })); lk.rotation.x = -Math.PI / 2; lk.position.set(lake.x, -0.12, lake.z); grp.add(lk); }
      if (biome === 'mountain') addGrass(4000, [[86, 82, 56], [150, 138, 94]], 30, 0.22);
      addCar(7, 4);
    } else if (biome === 'observatory') {
      addRocks(55, 8, 120, 1.6);
      const domeM = new THREE.MeshStandardMaterial({ color: 0xe9ebef, metalness: 0.4, roughness: 0.35 });
      for (const [a, d, r] of [[60, 70, 9], [100, 110, 14], [140, 60, 6], [300, 90, 11], [330, 160, 18]]) {
        const p = altAzToVec(0, a, d); const b = new THREE.Group();
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.9, 40), domeM); cyl.position.y = r * 0.45; b.add(cyl);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.05, r * 0.12, 40), new THREE.MeshLambertMaterial({ color: 0x77716a })); base.position.y = r * 0.06; b.add(base);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), domeM); dome.position.y = r * 0.9; b.add(dome);
        const slit = new THREE.Mesh(new THREE.BoxGeometry(r * 0.35, r * 0.05, r * 2.02), new THREE.MeshBasicMaterial({ color: 0x050608 })); slit.position.y = r * 1.75; b.add(slit);
        const door = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.16, r * 0.3), new THREE.MeshLambertMaterial({ color: 0x3a3d44 })); door.position.set(0, r * 0.17, r * 1.001); b.add(door);
        b.position.set(p.x, 0, p.z); b.lookAt(0, 0, 0); place(b, p.x, p.z, 0.3);
      }
      addGrass(2200, [[96, 80, 56], [162, 138, 98]], 30, 0.2);
      addCar(7, 4);
    } else if (biome === 'desert') {
      addRocks(45, 8, 140, 1.5);
      if (loc.lon < -30 && loc.lat > 15) for (let i = 0; i < 16; i++) {
        const a = rnd() * 360, d = 12 + rnd() * 60; const p = altAzToVec(0, a, d); const c = new THREE.Group(); const cm = new THREE.MeshLambertMaterial({ color: 0x2b3f22, flatShading: true });
        const H = 3 + rnd() * 3; c.add(MD.cylY(0.24, 0.3, H, cm, H / 2, 10)); c.add(MD.sphere(0.24, cm, 0, H, 0, 10, 6));
        for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) { const ang = rnd() * 6.28, y0 = H * (0.35 + rnd() * 0.3), out = 0.55 + rnd() * 0.2, up = 0.8 + rnd() * 1.2; const dx = Math.cos(ang), dz = Math.sin(ang);
          c.add(MD.rod(v3(0, y0, 0), v3(dx * out, y0 + 0.1, dz * out), 0.16, 0.16, cm, 8)); c.add(MD.rod(v3(dx * out, y0, dz * out), v3(dx * out, y0 + up, dz * out), 0.16, 0.15, cm, 8)); c.add(MD.sphere(0.15, cm, dx * out, y0 + up, dz * out, 8, 6)); }
        place(c, p.x, p.z, 0.05);
      }
      addGrass(800, [[112, 94, 62], [178, 156, 106]], 30, 0.2);
      addCar(7, 4);
    } else if (biome === 'coast') {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 450), new THREE.MeshStandardMaterial({ color: 0x050c14, metalness: 0.85, roughness: 0.15 })); sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.45, 240); grp.add(sea);
      addRocks(20, 6, 40, 1.2); addGrass(3500, [[108, 100, 70], [172, 162, 112]], 28, 0.38); addCar(6, -4, 0.4);
    }
  }
  groundTexture(biome) {
    this._gtex = this._gtex || {};
    if (this._gtex[biome]) return this._gtex[biome];
    const pal = { suburb: ['#3c5230', [20, 40, 15], [50, 60, 25]], forest: ['#34482a', [25, 30, 15], [45, 45, 25]], field: ['#4a5a30', [30, 40, 15], [60, 60, 25]],
      city: ['#55565a', [70, 70, 72], [25, 25, 25]], mountain: ['#5a5448', [60, 55, 48], [35, 32, 28]], observatory: ['#6b5444', [80, 60, 45], [30, 25, 20]],
      desert: ['#b09060', [170, 140, 95], [35, 30, 20]], snow: ['#dfe6ee', [215, 222, 232], [25, 25, 25]], coast: ['#8c7d5c', [140, 125, 92], [30, 28, 22]] }[biome] || ['#3c5230', [20, 40, 15], [50, 60, 25]];
    const S2 = 512; const c = document.createElement('canvas'); c.width = c.height = S2; const g = c.getContext('2d'); const r = mulberry32(hashStr('g' + biome));
    g.fillStyle = pal[0]; g.fillRect(0, 0, S2, S2);
    const grassy = biome === 'suburb' || biome === 'forest' || biome === 'field';
    // soft dirt / pebble patches, tileable via wrap-around drawing
    const blot = (x, y, rad, col) => { for (const ox of [-S2, 0, S2]) for (const oy of [-S2, 0, S2]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2); } };
    for (let i = 0; i < 26; i++) blot(r() * S2, r() * S2, 20 + r() * 60, grassy ? `rgba(${60 + r() * 30},${50 + r() * 20},${30},${0.12 + r() * 0.12})` : `rgba(${pal[1][0] * 0.8},${pal[1][1] * 0.8},${pal[1][2] * 0.8},${0.15 + r() * 0.15})`);
    for (let i = 0; i < 36000; i++) { const s = r(); g.fillStyle = `rgba(${pal[1][0] + s * pal[2][0]},${pal[1][1] + s * pal[2][1]},${pal[1][2] + s * pal[2][2]},${0.3 + r() * 0.45})`; if (grassy) { g.save(); g.translate(r() * S2, r() * S2); g.rotate((r() - 0.5) * 0.9); g.fillRect(0, 0, 1, 2 + r() * 5); g.restore(); } else g.fillRect(r() * S2, r() * S2, 1 + r() * 2.5, 1 + r() * 2.5); }
    if (!grassy && biome !== 'snow') for (let i = 0; i < 500; i++) { const x = r() * S2, y = r() * S2, s = 1.5 + r() * 3; g.fillStyle = `rgba(${pal[1][0] * 0.55},${pal[1][1] * 0.55},${pal[1][2] * 0.55},0.6)`; g.beginPath(); g.ellipse(x, y, s, s * 0.7, r() * 3, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.ellipse(x - s * 0.2, y - s * 0.2, s * 0.5, s * 0.3, 0, 0, 7); g.fill(); }
    if (biome === 'city') { g.strokeStyle = 'rgba(30,30,32,.6)'; g.lineWidth = 2; for (let i = 0; i <= S2; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S2); g.moveTo(0, i); g.lineTo(S2, i); g.stroke(); } }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(biome === 'city' ? 40 : 90, biome === 'city' ? 40 : 90); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return (this._gtex[biome] = t);
  }

  // ------------------------------------------------------------ rig
  buildRig() {
    const rig = G.s.rig; const ri = rigInfo(rig);
    this.rigKey = JSON.stringify(rig);
    const R = this.rigGroup; R.clear(); this.usb = null;
    const mount = ri.mount; const loc = S.locNow();
    const st = MD.mountStyle(mount);
    const tri = MD.buildTripod(st.tripod); R.add(tri.group);
    const { head, refs } = MD.buildMountHead(mount, loc, st); head.position.y = tri.headH; R.add(head);
    if (mount.goto && st.kind === 'gem' && st.tripod !== 'pier') R.add(MD.buildHandController(tri));
    const o = MD.buildOTA(ri); R.add(o.group);
    Object.assign(refs, o.refs, { ota: o.group, mountPoint: o.mountPoint, headH: tri.headH, apex: tri.apex });
    if (ri.hasPower) {
      const ps = MD.buildPowerStation(); ps.position.set(0.55, 0, 0.3); ps.rotation.y = -0.7; R.add(ps);
      R.add(MD.cable(v3(0.47, 0.16, 0.37), tri.apex.clone().add(v3(0.02, 0, 0.02)), 0.25, 0.004));
    }
    R.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.otaLength = o.frontZ;
    this.rig = refs;
  }

  updateRig(t) {
    const n = G.s.night; if (!n || !this.rig) return;
    const p = S.pointing(); if (!p) return;
    const loc = S.locNow(); const refs = this.rig;
    const dir = altAzToVec(p.alt, p.az);
    this.rigGroup.updateMatrixWorld(true);
    let off;
    if (refs.polar) {
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
      refs.decSide.scale.x = side; refs.decSide.updateMatrixWorld(true);
      off = v3(side, 0, 0).applyQuaternion(rq);
    } else if (refs.azRot) {
      refs.azRot.rotation.y = -p.az * A.D2R; refs.azRot.updateMatrixWorld(true);
      const q = new THREE.Quaternion(); refs.azRot.getWorldQuaternion(q); off = v3(1, 0, 0).applyQuaternion(q);
    } else off = v3(0, 1, 0);
    // the OTA's -Y faces the mount; its saddle point sits exactly on the mount's saddle
    off.addScaledVector(dir, -off.dot(dir));
    if (off.lengthSq() < 1e-6) off.copy(this._lastOff || v3(0, 0, 1)); off.normalize(); this._lastOff = off.clone();
    const xA = off.clone().cross(dir).normalize(), yA = dir.clone().cross(xA);
    refs.ota.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, dir));
    const sp = new THREE.Vector3(); refs.saddle.getWorldPosition(sp);
    refs.ota.position.copy(this.rigGroup.worldToLocal(sp)).sub(refs.mountPoint.clone().applyQuaternion(refs.ota.quaternion));
    refs.cap.visible = n.capOn; refs.baht.visible = n.bahtinov; refs.panel.visible = n.panelOn;
    refs.dew.material.emissive.setHex(n.dewHeater ? 0x3a0800 : 0x000000);
    const fogA = Math.min(0.85, n.dew * 0.9 + (n.smudge || 0) * 0.25);
    refs.fog.visible = !n.capOn && fogA > 0.02; refs.fog.material.opacity = fogA;
    refs.led.material.color.setHex(S.T.exposure ? (Math.floor(t * 2) % 2 ? 0xff2020 : 0x400000) : 0x00ff40);
    // USB cable from the camera down to the mount, re-hung when the scope moves
    if (refs.camBack && refs.apex) {
      const a = refs.camBack.clone().applyQuaternion(refs.ota.quaternion).add(refs.ota.position);
      if (!this.usb || this.usb.a.distanceToSquared(a) > 1e-4) {
        if (this.usb) { this.rigGroup.remove(this.usb.mesh); this.usb.mesh.geometry.dispose(); }
        const b = refs.apex; const drop = Math.max(0.12, (a.y - b.y) * 0.4 + 0.12);
        const c = new THREE.CatmullRomCurve3([a, a.clone().add(v3(0, -0.06, 0)), a.clone().lerp(b, 0.5).add(v3(0.05, -drop, 0.05)), b.clone().add(v3(0.03, 0.02, 0.03)), b]);
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(c, 32, 0.003, 5), MD.std(0x0e0e0f, 0.7, 0.05)); mesh.castShadow = true;
        this.rigGroup.add(mesh); this.usb = { a, mesh };
      }
    }
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
    for (const [id, a] of this.avatars) if (!seen.has(id)) { this.scene.remove(a.g); this.scene.remove(a.laser); this.avatars.delete(id); }
  }
  makeAvatar(p) {
    const g = new THREE.Group();
    const col = new THREE.Color(p.color || '#8fd3ff');
    const jacket = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.55) }), pants = new THREE.MeshLambertMaterial({ color: 0x22252b }), boot = new THREE.MeshLambertMaterial({ color: 0x15120f }), skin = new THREE.MeshLambertMaterial({ color: 0xc8a48a });
    const cap = (r, len, m, x, y, z) => { const c = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m); c.position.set(x, y, z); c.castShadow = true; return c; };
    for (const x of [-0.1, 0.1]) { g.add(cap(0.075, 0.62, pants, x, 0.46, 0)); g.add(MD.rbox(0.12, 0.09, 0.24, 0.03, boot, x, 0.045, -0.03)); }
    const torso = cap(0.2, 0.42, jacket, 0, 1.13, 0); torso.scale.z = 0.72; g.add(torso);
    const zip = MD.box(0.012, 0.5, 0.01, new THREE.MeshLambertMaterial({ color: col }), 0, 1.15, -0.146); g.add(zip);
    const armL = new THREE.Group(); armL.position.set(-0.25, 1.4, 0); armL.rotation.z = -0.12; armL.add(cap(0.06, 0.48, jacket, 0, -0.3, 0)); armL.add(cap(0.045, 0.04, skin, 0, -0.6, 0)); g.add(armL);
    const armR = new THREE.Group(); armR.position.set(0.25, 1.4, 0); armR.rotation.z = 0.12; armR.add(cap(0.06, 0.48, jacket, 0, -0.3, 0)); armR.add(cap(0.045, 0.04, skin, 0, -0.6, 0)); g.add(armR);
    const hand = new THREE.Object3D(); hand.position.set(0, -0.66, 0); armR.add(hand);
    g.add(cap(0.06, 0.05, skin, 0, 1.47, 0));
    const headPivot = new THREE.Group(); headPivot.position.y = 1.62; g.add(headPivot);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), skin); head.scale.set(0.95, 1.08, 1); headPivot.add(head);
    const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.122, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: col })); beanie.position.y = 0.025; headPivot.add(beanie);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.022, 8, 24), new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.8) })); cuff.rotation.x = Math.PI / 2; cuff.position.y = 0.03; headPivot.add(cuff);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshLambertMaterial({ color: col })); pom.position.y = 0.15; headPivot.add(pom);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.008, 6, 24), new THREE.MeshLambertMaterial({ color: 0x111111 })); strap.rotation.x = Math.PI / 2; strap.position.y = 0.055; headPivot.add(strap);
    headPivot.add(MD.rbox(0.05, 0.03, 0.025, 0.006, new THREE.MeshLambertMaterial({ color: 0x1a1a1a }), 0, 0.055, -0.125));
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.011, 12), new THREE.MeshBasicMaterial({ color: 0xff2010, toneMapped: false })); lamp.position.set(0, 0.055, -0.139); lamp.rotation.y = Math.PI; headPivot.add(lamp);
    const beam = new THREE.SpotLight(0xff1a00, 0, 10, 0.5, 0.6, 1.5); beam.position.copy(lamp.position); headPivot.add(beam); beam.target.position.set(0, -0.2, -2); headPivot.add(beam.target);
    // name tag
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d');
    x.font = '500 26px "IBM Plex Sans Condensed", system-ui'; x.textAlign = 'center'; x.fillStyle = 'rgba(0,0,0,.55)'; const w = Math.min(250, x.measureText(p.name).width + 24); x.fillRect(128 - w / 2, 4, w, 38);
    x.fillStyle = p.color || '#8fd3ff'; x.fillText(p.name.toUpperCase(), 128, 33);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); tag.scale.set(0.9, 0.17, 1); tag.position.y = 2.0; g.add(tag);
    return { g, headPivot, lamp, beam, armR, hand, laser: this.makeLaser(false), cur: null, target: null };
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
      a.g.scale.y = t.at === 'laptop' || t.at === 'chair' ? 0.82 : 1; // sitting
      a.laser.visible = !!t.laser;
      // raise the right arm along the gaze while pointing the laser
      const armT = t.laser ? Math.PI / 2 + THREE.MathUtils.clamp(a.cur.pitch, -0.6, 1.4) : 0; a.armR.rotation.x += (armT - a.armR.rotation.x) * k; a.armR.rotation.z = t.laser ? 0.02 : 0.12;
      if (t.laser) { const cp = Math.cos(a.cur.pitch); const d = v3(-Math.sin(a.cur.yaw) * cp, Math.sin(a.cur.pitch), -Math.cos(a.cur.yaw) * cp); a.g.updateMatrixWorld(true); this.aimLaser(a.laser, a.hand.getWorldPosition(v3(0, 0, 0)), d); }
      a.lamp.visible = !!t.lamp; a.beam.intensity = t.lamp ? 2.5 : 0;
    }
  }

  // ------------------------------------------------------------ sky overlays: constellations & names, deep-sky glows
  buildOverlays() {
    if (this.constGroup || !cat.loaded) return;
    const g = new THREE.Group(); g.visible = false; this.celestial.add(g); this.constGroup = g; this.constFade = 0;
    const pos = [];
    for (const ls of cat.lines) for (let i = 0; i < ls.length - 1; i++) { const a = eqVec(ls[i][0], ls[i][1]).multiplyScalar(SKY_R - 15), b = eqVec(ls[i + 1][0], ls[i + 1][1]).multiplyScalar(SKY_R - 15); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.constMat = new THREE.LineBasicMaterial({ color: 0x5a8ad0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const lines = new THREE.LineSegments(lg, this.constMat); lines.frustumCulled = false; lines.renderOrder = -6; g.add(lines);
    this.labelMats = [];
    const label = (text, ra, dec, color, size, font) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d');
      x.font = font; x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = 'rgba(0,0,0,.9)'; x.shadowBlur = 6; x.fillText(text, 256, 32);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.SpriteMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const sp = new THREE.Sprite(m); sp.position.copy(eqVec(ra, dec).multiplyScalar(SKY_R - 20)); sp.scale.set(size * 8, size, 1); sp.renderOrder = -5; g.add(sp); this.labelMats.push(m);
    };
    for (const cn of cat.constNames) label(cn.name.toUpperCase().split('').join(' '), cn.ra, cn.dec, '#8fb3e6', 34, '500 30px "IBM Plex Sans Condensed", system-ui');
    for (const st of cat.stars) { if (st.mag > 1.7) break; if (st.name) label(st.name, st.ra, st.dec - 1.6, '#ead9ad', 24, '500 30px "IBM Plex Sans", system-ui'); }
    // deep-sky objects as faint glows whose visibility follows surface brightness (M31, M42, the Magellanic Clouds…)
    const ds = cat.dsos.filter((d) => Number.isFinite(+d.mag) && +d.mag < 9.5 && +d.size > 0 && !/^(planet|moon|star|milkyway|pos|dark|dn)$/.test(d.type));
    const P = new Float32Array(ds.length * 3), SZ = new Float32Array(ds.length), MG = new Float32Array(ds.length), C = new Float32Array(ds.length * 3);
    ds.forEach((d, i) => {
      const v = eqVec(d.ra, d.dec).multiplyScalar(SKY_R - 12); P.set([v.x, v.y, v.z], i * 3); SZ[i] = Math.min(12, +d.size / 60); MG[i] = +d.mag + (/^(oc|cluster)$/.test(d.type) ? 1.5 : 0);
      C.set(/(en|bn|rn|nebula|snr|sn|pn|planetary)$/.test(d.type) ? [0.78, 1.0, 0.88] : /^(gc|oc|cluster)$/.test(d.type) ? [1.0, 0.96, 0.88] : [0.88, 0.9, 1.0], i * 3);
    });
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(P, 3)); dg.setAttribute('size', new THREE.BufferAttribute(SZ, 1)); dg.setAttribute('mag', new THREE.BufferAttribute(MG, 1)); dg.setAttribute('color', new THREE.BufferAttribute(C, 3));
    this.dsoMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { limMag: { value: 5 }, ppd: { value: 10 } },
      vertexShader: `attribute float size; attribute float mag; attribute vec3 color; uniform float limMag, ppd; varying vec3 vColor; varying float vI;
        void main(){ vec4 wp = modelMatrix*vec4(position,1.0); float alt = normalize(wp.xyz).y;
          float px = max(3.0, size * ppd); float b = pow(10.0, -0.4*(mag + 0.25/max(alt,0.05) - limMag));
          vI = max(0.0, min(0.4, 0.05 * b * 8.0 / max(8.0, px)) - 0.02) * smoothstep(0.0, 0.08, alt);
          vColor = color; gl_PointSize = min(px, 480.0); gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `varying vec3 vColor; varying float vI; void main(){ vec2 c = gl_PointCoord - 0.5; float r2 = dot(c,c)*4.0; float a = exp(-r2*3.2) * vI; if (a < 0.002) discard; gl_FragColor = vec4(vColor * a, 1.0); }`,
    });
    this.dso = new THREE.Points(dg, this.dsoMat); this.dso.frustumCulled = false; this.dso.renderOrder = -7; this.celestial.add(this.dso);
  }
  setConstellations(on) { this.showConst = on; this.emit('const', on); }
  setBino(on) {
    this.bino = on; if (on && this.seated) { /* fine — stargazing from the chair */ }
    if (on && this.grab) this.setGrab(false);
    this.emit('bino', on ? this.binoFov : 0);
  }
  // green laser pointer: a thin bright core near you and a 1-px line to the sky
  makeLaser(withCore) {
    const g = new THREE.Group(); g.visible = false;
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute([0.35, 1.0, 0.45, 0.05, 0.28, 0.1], 3));
    const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); line.frustumCulled = false; g.add(line);
    if (withCore) { const cg = new THREE.CylinderGeometry(0.0016, 0.0016, 1, 6, 1, true); cg.translate(0, 0.5, 0); const core = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0x40ff70, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); core.frustumCulled = false; g.add(core); g.userData.core = core; }
    g.userData.line = line; this.scene.add(g); return g;
  }
  aimLaser(L, from, dir) {
    const p = L.userData.line.geometry.attributes.position; const to = from.clone().addScaledVector(dir, SKY_R * 0.92);
    p.setXYZ(0, from.x, from.y, from.z); p.setXYZ(1, to.x, to.y, to.z); p.needsUpdate = true;
    const core = L.userData.core; if (core) { core.position.copy(from); core.quaternion.setFromUnitVectors(v3(0, 1, 0), dir); core.scale.set(1, 80, 1); }
  }
  // the camp chair: sit back and look up
  toggleSeat() {
    if (this.seated) { this.seated = null; this.player.pos.copy(this._standPos || v3(0.6, 1.65, 0.6)); this.emit('seat', false); return; }
    const seat = this.chair.localToWorld(v3(0, 0.5, 0.02));
    this._standPos = this.player.pos.clone();
    const yaw = this.table.rotation.y + this.chair.rotation.y + Math.PI;
    this.seated = { pos: v3(seat.x, 1.08, seat.z) };
    this.player.yaw = wrapPi(yaw); this.player.pitch = 0.6; this.setGrab(false);
    this.emit('seat', true);
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
      if (e.code === 'KeyB' && !e.repeat) this.setBino(!this.bino);
      if (e.code === 'KeyC' && !e.repeat && !e.metaKey && !e.ctrlKey) this.setConstellations(!this.showConst);
      if (e.code === 'KeyL') this.laserOn = true;
      if (e.code === 'Escape' && this.grab) this.setGrab(false);
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'KeyL') this.laserOn = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.laserOn = false; });
    el.addEventListener('wheel', (e) => { if (!this.running || !this.bino) return; e.preventDefault(); this.binoFov = THREE.MathUtils.clamp(this.binoFov * Math.exp(e.deltaY * 0.0015), 2.5, 14); this.emit('bino', this.binoFov); }, { passive: false });
  }
  look(dx, dy) {
    const k = 0.0025 * (window.__flSens || 1) * Math.max(0.05, this.camera.fov / 70);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.player.yaw = wrapPi(this.player.yaw - dx * k); this.player.pitch = THREE.MathUtils.clamp(this.player.pitch - dy * k, -1.45, 1.52);
  }
  setGrab(on) {
    this.grab = on;
    this.emit('grab', on);
  }
  interact() {
    if (this.grab) { this.setGrab(false); return; }
    const h = this.hover;
    if (this.seated && (!h || h === 'chair')) { this.toggleSeat(); return; }
    if (!h) return;
    this.emit('action', h);
  }
  pick() {
    const ray = new THREE.Raycaster(); ray.far = 4;
    const locked = document.pointerLockElement === this.renderer.domElement;
    if (!locked && this.mouse) {
      const r = this.renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((this.mouse.x - r.left) / r.width) * 2 - 1, -((this.mouse.y - r.top) / r.height) * 2 + 1), this.camera);
    } else ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const objs = [this.rigGroup, this.table]; ray.far = this.seated ? 6 : 4;
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
    if (!this.constGroup && cat.loaded) this.buildOverlays();
    if (this.locId !== n.loc) { this.buildSite(n.loc); }
    if (this.rigKey !== JSON.stringify(G.s.rig)) this.buildRig();
    // movement
    const P = this.player; const sp = (this.keys.ShiftLeft || this.keys.ShiftRight ? 3.2 : 1.4) * dt;
    const K = this.keys; if (this.seated && (K.KeyW || K.KeyS || K.KeyA || K.KeyD || K.ArrowUp || K.ArrowDown || K.ArrowLeft || K.ArrowRight)) this.toggleSeat();
    const fwd = v3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)), right = v3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    if (this.keys.KeyW || this.keys.ArrowUp) P.pos.addScaledVector(fwd, sp);
    if (this.keys.KeyS || this.keys.ArrowDown) P.pos.addScaledVector(fwd, -sp);
    if (this.keys.KeyA || this.keys.ArrowLeft) P.pos.addScaledVector(right, -sp);
    if (this.keys.KeyD || this.keys.ArrowRight) P.pos.addScaledVector(right, sp);
    if (P.pos.length() > 11) P.pos.setLength(11);
    // footsteps
    { const moved = this._lastPos ? Math.hypot(P.pos.x - this._lastPos.x, P.pos.z - this._lastPos.z) : 0; this._lastPos = P.pos.clone(); this._stride = (this._stride || 0) + moved;
      if (this._stride > 0.72) { this._stride = 0; window.dispatchEvent(new CustomEvent('fl-sfx', { detail: { name: 'step', surface: S.locNow()?.biome } })); } }
    if (this.seated) P.pos.copy(this.seated.pos); else P.pos.y = 1.65 + Math.sin(t * 1.3) * 0.003;
    // binoculars zoom the view; the FOV eases in and out
    const fovT = this.bino ? this.binoFov : 70;
    if (Math.abs(this.camera.fov - fovT) > 0.01) { this.camera.fov += (fovT - this.camera.fov) * Math.min(1, dt * 9); this.camera.updateProjectionMatrix(); }
    const zoomK = THREE.MathUtils.clamp((70 - this.camera.fov) / (70 - 14), 0, 1);
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
    // 50 mm binoculars gather ~4 magnitudes more than a dark-adapted eye
    const limEff = lim + 4.2 * zoomK * (1 - env.clouds * 0.6);
    if (this.starMat) { this.starMat.uniforms.limMag.value = limEff; this.starMat.uniforms.time.value = t; this.starMat.uniforms.seeing.value = env.seeing * (1 - zoomK * 0.8); }
    this.mwMat.uniforms.strength.value = THREE.MathUtils.clamp((lim - 4.2) / 2.2, 0, 1) * 1.6 * (1 - env.clouds) * (1 - zoomK * 0.45);
    if (this.dsoMat) { this.dsoMat.uniforms.limMag.value = limEff - env.clouds * 3; this.dsoMat.uniforms.ppd.value = this.renderer.domElement.height / this.camera.fov; }
    if (this.constGroup) {
      this.constFade += ((this.showConst ? 1 : 0) - this.constFade) * Math.min(1, dt * 6);
      this.constGroup.visible = this.constFade > 0.01; this.constMat.opacity = this.constFade * 0.55;
      for (const m of this.labelMats) m.opacity = this.constFade * 0.85;
    }
    // moon & sun
    const mp = moonV.clone().multiplyScalar(820); this.moon.position.copy(this.camera.position).add(mp); this.moon.lookAt(this.camera.position); this.moon.scale.setScalar(820 * 0.0092 * 1.8);
    if (this._moonPhase === undefined || Math.abs(this._moonPhase - env.moonPhase) > 0.5) { this._moonPhase = env.moonPhase; this.drawMoon(env); }
    this.moon.visible = env.moonAlt > -2;
    this.sun.position.copy(this.camera.position).add(sunV.clone().multiplyScalar(830)); this.sun.lookAt(this.camera.position); this.sun.scale.setScalar(830 * 0.0046 * 1.6); this.sun.visible = env.sunAlt > -1;
    this.moonLight.position.copy(moonV.clone().multiplyScalar(40)); this.moonLight.intensity = moonUp * env.moonIllum * 1.4 * (1 - env.clouds * 0.8);
    const tw = THREE.MathUtils.clamp((env.sunAlt + 12) / 18, 0, 1);
    this.hemi.intensity = 1.1 + tw * 2 + moonUp * env.moonIllum * 0.8;
    this.scene.environmentIntensity = 0.03 + tw * 0.55 + moonUp * env.moonIllum * 0.08;
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
    // laser pointer
    if (this.laserOn || this.laser) {
      this.laser = this.laser || this.makeLaser(true); this.laser.visible = this.laserOn;
      if (this.laserOn) { const fwd = this.camera.getWorldDirection(v3(0, 0, 0)); const right = v3(1, 0, 0).applyQuaternion(this.camera.quaternion); const from = this.camera.position.clone().addScaledVector(right, 0.14).add(v3(0, -0.16, 0)).addScaledVector(fwd, 0.3); this.aimLaser(this.laser, from, fwd); }
    }
    if (this.grass) this.grass.time.value = t;
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
