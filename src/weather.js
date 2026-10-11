// Weather: falling rain streaks / snow flakes, sky and fog adjustments, snow cover tint.
// Particles live in a box that wraps around the camera in the vertex shader, so they stay
// anchored to the world (no rain glued to the lens) and cost nothing on the CPU.
import * as THREE from 'three';

export const WEATHERS = ['clear', 'rain', 'snow'];

// Grip multiplier given to every car
export const WEATHER_GRIP = { clear: 1, rain: 0.8, snow: 0.65 };

const BOX = new THREE.Vector3(90, 46, 90);

// Shared snow-cover amount, injected into terrain / foliage materials
export const snowCover = { value: 0 };

export function addSnowCover(material, strength = 1) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev?.(shader, r);
    shader.uniforms.uSnow = snowCover;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), uSnow * ${strength.toFixed(2)});`,
      );
  };
  material.customProgramCacheKey = () => `snow${strength}`;
  material.needsUpdate = true;
  return material;
}

// Sky / light / fog for a time-of-day preset under some weather
export function weatherPreset(p, kind) {
  if (kind === 'clear') return p;
  const q = { ...p };
  const fogC = new THREE.Color(p.fog);
  if (kind === 'rain') {
    q.turbidity = 12;
    q.rayleigh = p.night ? 0.2 : 0.35;
    q.mie = 0.05;
    q.mieG = 0.6;
    q.sunI = p.sunI * (p.night ? 0.6 : 0.3);
    q.hemiI = p.hemiI * (p.night ? 0.9 : 1.5);
    q.hemiSky = p.night ? 0x2a3550 : 0x9aa6b4;
    q.fog = fogC.lerp(new THREE.Color(p.night ? 0x070b12 : 0x7d8792), 0.8).getHex();
    q.fogDensity = p.night ? 0.0028 : 0.0024;
    q.exposure = p.exposure * (p.night ? 1 : 0.95);
  } else {
    q.turbidity = 10;
    q.rayleigh = p.night ? 0.25 : 0.5;
    q.mie = 0.04;
    q.mieG = 0.55;
    q.sunI = p.sunI * (p.night ? 0.7 : 0.45);
    q.hemiI = p.hemiI * (p.night ? 1.1 : 1.6);
    q.hemiSky = p.night ? 0x4a5a80 : 0xe4ecf6;
    q.hemiGround = p.night ? 0x2a3040 : 0xb8c0cc;
    q.fog = fogC.lerp(new THREE.Color(p.night ? 0x1a2233 : 0xdde4ec), 0.8).getHex();
    q.fogDensity = p.night ? 0.0026 : 0.0021;
  }
  return q;
}

export class Precipitation {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.kind = 'clear';
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: BOX },
      uColor: { value: new THREE.Color() },
      uScale: { value: window.innerHeight },
    };
    window.addEventListener('resize', () => (this.uniforms.uScale.value = window.innerHeight));
  }

  set(kind, quality, night) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    this.kind = kind;
    if (kind === 'clear') return;
    const low = quality === 'low';
    const rain = kind === 'rain';
    const n = rain ? (low ? 2500 : 7000) : low ? 2500 : 6000;
    const seed = new Float32Array(n * (rain ? 2 : 1) * 4);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * BOX.x;
      const y = Math.random() * BOX.y;
      const z = Math.random() * BOX.z;
      const s = Math.random();
      if (rain) {
        // two vertices per streak, w: 0 = head, 1 = tail (+ random phase in the fraction)
        seed.set([x, y, z, s * 0.5], i * 8);
        seed.set([x, y, z, 1 + s * 0.5], i * 8 + 4);
      } else seed.set([x, y, z, s], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seed.length / 4 * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    this.uniforms.uColor.value.set(rain ? (night ? 0x8090a8 : 0xb4c0cc) : 0xffffff);
    const wrap = `
      uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; attribute vec4 seed;
      vec3 wrapPos(vec3 p) { return mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5 + uCenter; }`;
    const mat = rain
      ? new THREE.ShaderMaterial({
          uniforms: this.uniforms,
          transparent: true,
          depthWrite: false,
          vertexShader: `${wrap} varying float vA;
            void main() {
              float tail = step(1.0, seed.w); float ph = fract(seed.w) * 2.0;
              vec3 p = seed.xyz + vec3(uTime * 3.0, -uTime * (26.0 + ph * 8.0), uTime * 1.5);
              p = wrapPos(p);
              p += vec3(0.12, 1.0, 0.06) * tail * 1.1;
              vA = mix(0.8, 0.0, tail);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }`,
          fragmentShader: `uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor, vA); }`,
        })
      : new THREE.ShaderMaterial({
          uniforms: this.uniforms,
          transparent: true,
          depthWrite: false,
          vertexShader: `${wrap} uniform float uScale; varying float vA;
            void main() {
              float ph = seed.w * 6.2831;
              vec3 p = seed.xyz + vec3(sin(uTime * 0.7 + ph) * 1.6 + uTime * 1.2, -uTime * (2.2 + seed.w * 1.4), cos(uTime * 0.5 + ph) * 1.6);
              p = wrapPos(p);
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              vA = smoothstep(80.0, 20.0, -mv.z);
              gl_PointSize = (0.16 + seed.w * 0.12) * uScale / -mv.z;
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: `uniform vec3 uColor; varying float vA;
            void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard;
              gl_FragColor = vec4(uColor * 1.6, vA * smoothstep(0.25, 0.08, r)); }`,
        });
    this.mesh = rain ? new THREE.LineSegments(g, mat) : new THREE.Points(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.scene.add(this.mesh);
  }

  update(t) {
    this.uniforms.uTime.value = t;
  }

  center(camera) {
    this.uniforms.uCenter.value.copy(camera.position);
  }
}
