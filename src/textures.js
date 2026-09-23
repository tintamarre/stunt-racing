// Procedural canvas textures (no image assets needed).
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function noise(ctx, w, h, amount, alpha = 0.08) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < (w * h) / 60; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

export function makeTextures() {
  const asphalt = canvas(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3d4045';
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 26, 0.12);
    // subtle tyre-worn lanes
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0.0, 'rgba(0,0,0,0)');
    g.addColorStop(0.28, 'rgba(0,0,0,0.10)');
    g.addColorStop(0.36, 'rgba(0,0,0,0)');
    g.addColorStop(0.64, 'rgba(0,0,0,0)');
    g.addColorStop(0.72, 'rgba(0,0,0,0.10)');
    g.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2ee';
    ctx.fillRect(w * 0.035, 0, w * 0.03, h);
    ctx.fillRect(w * 0.935, 0, w * 0.03, h);
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(w * 0.49, 0, w * 0.02, h * 0.45);
  });
  const curb = canvas(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d7262e';
    ctx.fillRect(0, 0, w, h / 2);
    noise(ctx, w, h, 14, 0.05);
  });
  const concrete = canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b9b6ae';
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 22, 0.1);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h);
  });
  const stripes = canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1b1b1d';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f7c21a';
    for (let i = -4; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 64, 0);
      ctx.lineTo(i * 64 + 32, 0);
      ctx.lineTo(i * 64 + 32 + h, h);
      ctx.lineTo(i * 64 + h, h);
      ctx.fill();
    }
    noise(ctx, w, h, 16, 0.06);
  });
  const rail = canvas(128, 32, (ctx, w, h) => {
    ctx.fillStyle = '#e9ecef';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d7262e';
    ctx.fillRect(0, 0, w / 2, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, h * 0.45, w, h * 0.1);
  });
  const checker = canvas(64, 16, (ctx, w, h) => {
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
    }
  });
  const boost = canvas(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(w * 0.15, h * 0.75);
    ctx.lineTo(w * 0.5, h * 0.3);
    ctx.lineTo(w * 0.85, h * 0.75);
    ctx.stroke();
  });
  const grass = canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 110 + Math.random() * 90;
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.fillRect(x, y, 1, 2 + Math.random() * 3);
    }
  });
  const banner = canvas(512, 64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#d7262e');
    g.addColorStop(1, '#ff7a1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = (x / 16) % 2 ? '#111' : '#fff';
      ctx.fillRect(x, 0, 16, 8);
      ctx.fillStyle = (x / 16) % 2 ? '#fff' : '#111';
      ctx.fillRect(x, h - 8, 16, 8);
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'italic 900 38px "Russo One", Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STUNT RACING', w / 2, h / 2 + 2);
  });
  const windows = canvas(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd89a';
    for (const x of [16, 56, 96]) ctx.fillRect(x, 22, 18, 22);
  });

  return {
    asphalt: tex(asphalt),
    curb: tex(curb),
    concrete: tex(concrete),
    stripes: tex(stripes),
    rail: tex(rail),
    checker: tex(checker),
    boost: tex(boost),
    grass: tex(grass, { srgb: false }),
    banner: tex(banner, { repeat: false }),
    windows: tex(windows, { repeat: false }),
  };
}
