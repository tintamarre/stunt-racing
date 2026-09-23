// localStorage helpers (all wrapped: storage may be unavailable).
const get = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const set = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

export const prefs = {
  load: () => get('stunt.prefs', { car: 0, preset: 'day', quality: 'high', track: 0 }),
  save: (p) => set('stunt.prefs', p),
};

export const customTracks = {
  list: () => get('stunt.tracks', []),
  save: (list) => set('stunt.tracks', list),
};

function b64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

// Best time + ghost per track code
export const records = {
  get(code) {
    const r = get(`stunt.rec.${code}`, null);
    if (!r) return null;
    try {
      return { ...r, frames: r.frames ? unb64(r.frames) : null };
    } catch {
      return { ...r, frames: null };
    }
  },
  put(code, rec) {
    const data = { ...rec, frames: rec.frames ? b64(rec.frames) : null };
    if (!set(`stunt.rec.${code}`, data)) set(`stunt.rec.${code}`, { ...data, frames: null });
  },
};
