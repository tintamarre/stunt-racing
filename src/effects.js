// Tyre smoke / dust particles and skid marks.
import * as THREE from 'three';

const MAX_P = 700;

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX_P * 3);
    this.col = new Float32Array(MAX_P * 4);
    this.size = new Float32Array(MAX_P);
    this.vel = new Float32Array(MAX_P * 3);
    this.age = new Float32Array(MAX_P).fill(1e9);
    this.life = new Float32Array(MAX_P).fill(1);
    this.base = new Float32Array(MAX_P * 4);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { scale: { value: window.innerHeight } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d);
        if (r > 0.25) discard; float a = smoothstep(0.25, 0.0, r); gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
    window.addEventListener('resize', () => (m.uniforms.scale.value = window.innerHeight));
  }

  emit(p, v, color, alpha, size, life) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_P;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x + (Math.random() - 0.5) * 1.5, v.y + Math.random() * 1.2, v.z + (Math.random() - 0.5) * 1.5], i * 3);
    this.base.set([color.r, color.g, color.b, alpha], i * 4);
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
  }

  update(dt) {
    for (let i = 0; i < MAX_P; i++) {
      const a = (this.age[i] += dt);
      const k = a / this.life[i];
      if (k >= 1) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      const damp = Math.exp(-dt * 2.2);
      this.vel[i * 3] *= damp;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damp + dt * 0.6;
      this.vel[i * 3 + 2] *= damp;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += dt * 2.4;
      this.col[i * 4] = this.base[i * 4];
      this.col[i * 4 + 1] = this.base[i * 4 + 1];
      this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * (1 - k) * Math.min(1, a * 8);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }

  clear() {
    this.age.fill(1e9);
    this.col.fill(0);
  }
}

const MAX_SEG = 1600;

export class Skids {
  constructor(scene) {
    this.pos = new Float32Array(MAX_SEG * 4 * 3);
    this.alpha = new Float32Array(MAX_SEG * 4);
    const idx = [];
    for (let i = 0; i < MAX_SEG; i++) {
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.03,0.03,0.03, vA); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.next = 0;
    this.last = [null, null, null, null];
  }

  // p: contact point, n: normal, side: lateral dir, a: alpha
  add(i, p, n, side, a) {
    const cur = { p: p.clone().addScaledVector(n, 0.04), side: side.clone().multiplyScalar(0.14) };
    const prev = this.last[i];
    this.last[i] = cur;
    if (!prev || a <= 0.02 || prev.p.distanceToSquared(cur.p) > 4) return;
    const s = this.next;
    this.next = (this.next + 1) % MAX_SEG;
    const v = [
      prev.p.clone().sub(prev.side),
      prev.p.clone().add(prev.side),
      cur.p.clone().add(cur.side),
      cur.p.clone().sub(cur.side),
    ];
    v.forEach((q, k) => {
      this.pos.set([q.x, q.y, q.z], (s * 4 + k) * 3);
      this.alpha[s * 4 + k] = Math.min(0.55, a * 0.6);
    });
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }

  lift(i) {
    this.last[i] = null;
  }

  clear() {
    this.alpha.fill(0);
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.last = [null, null, null, null];
  }
}
