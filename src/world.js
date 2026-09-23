// Renderer, sky, lighting, terrain, track meshes and scenery.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeTextures } from './textures.js';
import { terrainHeight, fbm, outside, CENTER, TERRAIN_SIZE, FIELD } from './terrain.js';
import { T, LOOP_R, ROAD_W } from './track.js';

export const PRESETS = {
  day: {
    label: 'Day',
    elevation: 48,
    azimuth: 150,
    turbidity: 2.2,
    rayleigh: 1.1,
    mie: 0.004,
    mieG: 0.8,
    exposure: 0.62,
    sun: 0xfff3e0,
    sunI: 3.6,
    hemiSky: 0xbfd8ff,
    hemiGround: 0x5a6b3a,
    hemiI: 0.45,
    fog: 0xc6d6e6,
    fogDensity: 0.00055,
    night: false,
  },
  sunset: {
    label: 'Sunset',
    elevation: 3.2,
    azimuth: 250,
    turbidity: 8,
    rayleigh: 2.6,
    mie: 0.008,
    mieG: 0.93,
    exposure: 0.5,
    sun: 0xffa060,
    sunI: 3.4,
    hemiSky: 0xffc39a,
    hemiGround: 0x4a3a40,
    hemiI: 0.4,
    fog: 0xe6a27c,
    fogDensity: 0.0007,
    night: false,
  },
  night: {
    label: 'Night',
    elevation: -6,
    azimuth: 200,
    turbidity: 1,
    rayleigh: 0.4,
    mie: 0.002,
    mieG: 0.7,
    exposure: 0.9,
    sun: 0x9fb6ff,
    sunI: 0.5,
    hemiSky: 0x2a3a66,
    hemiGround: 0x101418,
    hemiI: 0.45,
    fog: 0x0b1224,
    fogDensity: 0.0012,
    night: true,
  },
};

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.28 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d) * 1.25);
      c.rgb *= mix(1.0 - amount, 1.0, v); gl_FragColor = c; }`,
};

export class World {
  constructor(canvas) {
    this.quality = 'high';
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.setSize(window.innerWidth, window.innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.2, 6000);
    this.tex = makeTextures();
    this.tex.grass.repeat.set(TERRAIN_SIZE / 6, TERRAIN_SIZE / 6);

    // Sky
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.scene.add(this.sky);
    this.sunDir = new THREE.Vector3();
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envScene = new THREE.Scene();

    // Lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    // Stars (night only)
    const sg = new THREE.BufferGeometry();
    const sp = [];
    for (let i = 0; i < 2500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.02) v.y = Math.abs(v.y) + 0.02;
      v.multiplyScalar(4000);
      sp.push(v.x, v.y, v.z);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false }));
    this.scene.add(this.stars);

    this.buildTerrain();

    // Post-processing
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(VignetteShader));

    this.trackGroup = null;
    this.animated = [];
    this.setPreset('day');
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  setQuality(q) {
    this.quality = q;
    const low = q === 'low';
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = !low;
    this.sun.castShadow = !low;
    this.bloom.enabled = !low;
    this.resize();
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
  }

  setPreset(name) {
    const p = PRESETS[name];
    this.preset = p;
    this.presetName = name;
    const u = this.sky.material.uniforms;
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mie;
    u.mieDirectionalG.value = p.mieG;
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.renderer.toneMappingExposure = p.exposure;
    this.sun.color.set(p.sun);
    this.sun.intensity = p.sunI;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiI;
    this.scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
    this.stars.visible = p.night;
    this.bloom.threshold = p.night ? 1.2 : 4;
    this.bloom.strength = p.night ? 0.8 : 0.25;
    this.bloom.radius = p.night ? 0.6 : 0.4;
    // Light direction for night = moon, keep it above the horizon
    this.lightDir = this.sunDir.clone();
    if (this.lightDir.y < 0.35) this.lightDir.y = p.night ? 0.8 : Math.max(this.lightDir.y, 0.12);
    this.lightDir.normalize();

    // Environment map from the sky
    const skyClone = new Sky();
    skyClone.scale.setScalar(1000);
    Object.assign(skyClone.material.uniforms.turbidity, { value: p.turbidity });
    skyClone.material.uniforms.rayleigh.value = p.rayleigh;
    skyClone.material.uniforms.mieCoefficient.value = p.mie;
    skyClone.material.uniforms.mieDirectionalG.value = p.mieG;
    skyClone.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.envScene.clear();
    this.envScene.add(skyClone);
    if (p.night) this.envScene.add(new THREE.HemisphereLight(0x223355, 0x080a10, 1));
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = p.night ? 0.25 : 0.55;
    for (const m of this.nightMaterials || []) m.emissiveIntensity = p.night ? m.userData.nightI : m.userData.dayI;
  }

  buildTerrain() {
    const segs = 320;
    const g = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segs, segs);
    g.rotateX(-Math.PI / 2);
    g.translate(CENTER, 0, CENTER);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grassA = new THREE.Color(0x4d7a2a);
    const grassB = new THREE.Color(0x6e9a36);
    const dry = new THREE.Color(0x9a9a52);
    const rock = new THREE.Color(0x7d766c);
    const snow = new THREE.Color(0xf2f4f7);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      const n = fbm(x * 0.02, z * 0.02, 3);
      c.copy(grassA).lerp(grassB, n);
      const d = outside(x, z);
      if (d <= 0) {
        // mowing stripes on the playfield
        const stripe = Math.floor((x + z * 0.0001) / 15) % 2 === 0 ? 1.06 : 0.95;
        c.multiplyScalar(stripe);
      } else {
        c.lerp(dry, Math.min(1, fbm(x * 0.01 + 7, z * 0.01, 2) * 0.8) * Math.min(1, d / 80));
      }
      if (y > 35) c.lerp(rock, Math.min(1, (y - 35) / 15));
      if (y > 58) c.lerp(snow, Math.min(1, (y - 58) / 8));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: this.tex.grass, roughness: 1, metalness: 0 });
    const terrain = new THREE.Mesh(g, mat);
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    // Distant mountain ring (visual only)
    const ring = new THREE.RingGeometry(TERRAIN_SIZE * 0.6, 5000, 160, 12);
    ring.rotateX(-Math.PI / 2);
    ring.translate(CENTER, 0, CENTER);
    const rp = ring.attributes.position;
    const rc = new Float32Array(rp.count * 3);
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i);
      const z = rp.getZ(i);
      const d = Math.hypot(x - CENTER, z - CENTER);
      const k = Math.min(1, (d - TERRAIN_SIZE * 0.6) / 600);
      const h = k * (60 + fbm(x * 0.0022, z * 0.0022, 5) * 520) - 10 + (1 - k) * 40;
      rp.setY(i, h);
      c.copy(rock).lerp(grassA, 0.35);
      if (h > 260) c.lerp(snow, Math.min(1, (h - 260) / 60));
      rc[i * 3] = c.r;
      rc[i * 3 + 1] = c.g;
      rc[i * 3 + 2] = c.b;
    }
    ring.setAttribute('color', new THREE.BufferAttribute(rc, 3));
    ring.computeVertexNormals();
    this.scene.add(new THREE.Mesh(ring, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));
  }

  buildTrack(built) {
    if (this.trackGroup) {
      this.scene.remove(this.trackGroup);
      this.trackGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    const group = new THREE.Group();
    this.trackGroup = group;
    this.animated = [];
    this.nightMaterials = [];
    const tx = this.tex;
    const S = built.surfaces;

    const glow = (color, dayI, nightI) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: dayI, roughness: 0.4 });
      m.userData = { dayI, nightI };
      this.nightMaterials.push(m);
      return m;
    };
    const mats = {
      road: new THREE.MeshStandardMaterial({ map: tx.asphalt, roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide }),
      curb: new THREE.MeshStandardMaterial({ map: tx.curb, roughness: 0.55 }),
      concrete: new THREE.MeshStandardMaterial({ map: tx.concrete, roughness: 0.9, side: THREE.DoubleSide }),
      stripes: new THREE.MeshStandardMaterial({ map: tx.stripes, roughness: 0.7, side: THREE.DoubleSide }),
      rail: new THREE.MeshStandardMaterial({ map: tx.rail, roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide }),
      checker: new THREE.MeshStandardMaterial({ map: tx.checker, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
      boost: new THREE.MeshBasicMaterial({
        map: tx.boost,
        color: 0x39e0ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    };
    const boostTex = tx.boost.clone();
    boostTex.needsUpdate = true;
    mats.boost.map = boostTex;
    this.animated.push((t) => {
      boostTex.offset.y = -t * 1.6;
      mats.boost.color.setHSL(0.52, 1, 0.5 + 0.15 * Math.sin(t * 8));
    });

    for (const [k, soup] of Object.entries(S)) {
      if (!soup.idx.length) continue;
      let g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(soup.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(soup.uv, 2));
      g.setIndex(soup.idx);
      g = mergeVertices(g, 1e-3);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mats[k]);
      m.receiveShadow = true;
      m.castShadow = k !== 'checker' && k !== 'boost' && k !== 'road';
      group.add(m);
    }

    // Props
    const steel = new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.85, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.5 });
    const lampMat = glow(0xfff1c8, 0.4, 6);
    for (const p of built.props) {
      const g = new THREE.Group();
      g.position.copy(p.pos);
      g.quaternion.copy(p.q);
      if (p.kind === 'gantry') {
        for (const s of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), dark);
          post.position.set(0, 4, s * (ROAD_W / 2 + 1.2));
          post.castShadow = true;
          g.add(post);
        }
        const bannerMat = new THREE.MeshStandardMaterial({ map: this.tex.banner, roughness: 0.5, emissive: 0xffffff, emissiveMap: this.tex.banner, emissiveIntensity: 0.15 });
        bannerMat.userData = { dayI: 0.15, nightI: 1.2 };
        this.nightMaterials.push(bannerMat);
        // Box faces 0/1 (±x) face the drivers
        const banner = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, ROAD_W + 3.2), [bannerMat, bannerMat, dark, dark, dark, dark]);
        banner.position.y = 7.6;
        banner.castShadow = true;
        g.add(banner);
        const lights = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, ROAD_W + 2), lampMat);
        lights.position.set(-0.4, 6.7, 0);
        g.add(lights);
      } else if (p.kind === 'loopTowers') {
        const topY = LOOP_R * 2 + 1.6;
        for (const s of [-1, 1]) {
          const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, topY, 0.9), steel);
          col.position.set(0, topY / 2, s * 13.2);
          col.castShadow = true;
          g.add(col);
          for (let k = 0; k < 4; k++) {
            const brace = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6.5, 0.25), steel);
            brace.position.set(0, 3 + k * 6, s * 13.2);
            brace.rotation.x = 0.5 * (k % 2 ? 1 : -1);
            g.add(brace);
          }
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), glow(0xff3030, 1, 5));
          lamp.position.set(0, topY + 0.4, s * 13.2);
          g.add(lamp);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 27.3), steel);
        beam.position.set(0, topY, 0);
        beam.castShadow = true;
        g.add(beam);
      } else if (p.kind === 'flags') {
        for (const s of [-1, 1]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5), dark);
          pole.position.set(-T / 2 + 1, 2.5, s * (ROAD_W / 2 + 3));
          g.add(pole);
          const flag = new THREE.Mesh(
            new THREE.PlaneGeometry(1.6, 1),
            new THREE.MeshStandardMaterial({ color: s > 0 ? 0xff5a1f : 0x2f7bff, side: THREE.DoubleSide, roughness: 0.8 }),
          );
          flag.position.set(-T / 2 + 1.8, 4.4, s * (ROAD_W / 2 + 3));
          g.add(flag);
          this.animated.push((t) => {
            flag.rotation.y = Math.sin(t * 3 + s) * 0.25;
          });
        }
      }
      group.add(g);
    }

    this.buildTrees(built.trees, group);
    this.buildHouses(built.houses, group);
    this.scene.add(group);
    if (this.preset) for (const m of this.nightMaterials) m.emissiveIntensity = this.preset.night ? m.userData.nightI : m.userData.dayI;
  }

  buildTrees(trees, group) {
    const n = trees.length;
    const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6);
    trunkG.translate(0, 1.2, 0);
    const pineG = mergeCones();
    const roundG = new THREE.IcosahedronGeometry(2.2, 1);
    roundG.translate(0, 4.2, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f8f35, roughness: 0.85, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkG, trunkMat, n);
    const pines = new THREE.InstancedMesh(pineG, leafMat, n);
    const rounds = new THREE.InstancedMesh(roundG, leafMat, n);
    let np = 0;
    let nr = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    trees.forEach((t, i) => {
      const y = terrainHeight(t.x, t.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.k * 6.28);
      s.setScalar(t.s);
      m.compose(new THREE.Vector3(t.x, y - 0.1, t.z), q, s);
      trunks.setMatrixAt(i, m);
      if (t.k < 0.55) {
        pines.setMatrixAt(np, m);
        pines.setColorAt(np++, c.setHSL(0.3 + t.k * 0.1, 0.3, 0.32 + t.k * 0.2));
      } else {
        rounds.setMatrixAt(nr, m);
        rounds.setColorAt(nr++, c.setHSL(0.12 + (t.k - 0.55) * 0.3, 0.55, 0.45 + (t.k - 0.55) * 0.4));
      }
    });
    pines.count = np;
    rounds.count = nr;
    for (const im of [trunks, pines, rounds]) {
      im.castShadow = true;
      im.receiveShadow = true;
      group.add(im);
    }
  }

  buildHouses(houses, group) {
    const wallCols = [0xf1e9da, 0xe6d3b3, 0xdfe7ea, 0xf3d6c8];
    const roofCols = [0xa8382c, 0x4a4f5a, 0x7a4a2c];
    const winMat = new THREE.MeshStandardMaterial({ color: 0x2a3440, emissive: 0xffd08a, emissiveMap: this.tex.windows, emissiveIntensity: 0.0, roughness: 0.2, metalness: 0.3 });
    winMat.userData = { dayI: 0, nightI: 2.2 };
    this.nightMaterials.push(winMat);
    for (const h of houses) {
      const g = new THREE.Group();
      g.position.set(h.x, 0, h.z);
      g.rotation.y = h.rot;
      const wall = new THREE.MeshStandardMaterial({ color: wallCols[Math.floor(h.k * 4)], roughness: 0.9 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 8), wall);
      body.position.y = 2.5;
      const roofShape = new THREE.Shape([new THREE.Vector2(-5.6, 0), new THREE.Vector2(5.6, 0), new THREE.Vector2(0, 3.2)]);
      const roofG = new THREE.ExtrudeGeometry(roofShape, { depth: 9, bevelEnabled: false });
      roofG.translate(0, 0, -4.5);
      roofG.rotateY(Math.PI / 2);
      const roof = new THREE.Mesh(roofG, new THREE.MeshStandardMaterial({ color: roofCols[Math.floor(h.k * 3)], roughness: 0.7 }));
      roof.rotation.y = Math.PI / 2;
      roof.position.y = 5;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), winMat);
      win.position.set(0, 2.6, 4.01);
      const win2 = win.clone();
      win2.position.z = -4.01;
      win2.rotation.y = Math.PI;
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.8), wall);
      chimney.position.set(2.5, 7, 1);
      for (const o of [body, roof, chimney]) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      g.add(body, roof, win, win2, chimney);
      group.add(g);
    }
  }

  update(t, focus) {
    for (const f of this.animated) f(t);
    // Shadow camera follows the focus point, snapped to texels to avoid shimmering
    const texel = 140 / 2048;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(this.lightDir, 200);
    this.sky.position.copy(this.camera.position);
  }

  render() {
    this.composer.render();
  }
}

function mergeCones() {
  const parts = [
    [2.2, 3.2, 3.4],
    [1.7, 2.8, 5.0],
    [1.1, 2.4, 6.5],
  ];
  const geos = parts.map(([r, h, y]) => {
    const g = new THREE.ConeGeometry(r, h, 7);
    g.translate(0, y, 0);
    return g.toNonIndexed();
  });
  const pos = [];
  for (const g of geos) pos.push(...g.attributes.position.array);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

function fixBannerUV(geo) {
  // BoxGeometry face uvs are fine for ±x faces; flip the -x face so text reads correctly.
  const uv = geo.attributes.uv;
  for (let i = 4; i < 8; i++) uv.setX(i, 1 - uv.getX(i));
  uv.needsUpdate = true;
}

export { FIELD };
