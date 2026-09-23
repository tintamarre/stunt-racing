import './style.css';
import { World } from './world.js';
import { initPhysics, CARS } from './physics.js';
import { Game } from './game.js';
import { Hud, fmtTime } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Editor } from './editor.js';
import { BUILTIN } from './tracks.js';
import { decodeTrack, encodeTrack, tracePath, TYPES } from './track.js';
import { drawBoardCropped } from './tiledraw.js';
import { prefs as prefStore, customTracks, records } from './storage.js';

const $ = (id) => document.getElementById(id);
const screens = ['menu', 'hud', 'pause', 'finish', 'replay', 'help', 'touch'];
const isTouch = matchMedia('(pointer: coarse)').matches;

function show(...names) {
  for (const s of screens) $(s).classList.toggle('hidden', !names.includes(s));
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
}

async function boot() {
  const world = new World($('view'));
  await initPhysics();
  const audio = new Audio();
  const input = new Input();
  input.bindTouch($('touch'));
  const hud = new Hud();
  const game = new Game(world, audio, input, hud);
  const prefs = { car: 0, preset: 'day', quality: 'high', track: 0, ...prefStore.load() };

  // Track list: built-ins, the player's tracks, and a shared one from the URL
  let tracks = [];
  let shared = null;
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('t')) shared = decodeTrack(hash.get('t'), hash.get('n') || 'Shared track');
  function rebuildList() {
    tracks = [...BUILTIN.map((t) => ({ track: t, kind: 'Built-in' }))];
    for (const e of customTracks.list()) {
      const t = decodeTrack(e.code, e.name);
      if (t && tracePath(t)) tracks.push({ track: t, kind: 'Your track' });
    }
    if (shared && tracePath(shared)) tracks.unshift({ track: shared, kind: 'Shared with you' });
  }
  rebuildList();
  let trackIdx = shared ? 0 : Math.min(prefs.track, tracks.length - 1);
  let testing = false;

  world.setQuality(prefs.quality);
  game.setPreset(prefs.preset);
  game.carIdx = prefs.car;

  function savePrefs() {
    prefStore.save(prefs);
  }

  function selectTrack(i) {
    trackIdx = (i + tracks.length) % tracks.length;
    const { track, kind } = tracks[trackIdx];
    game.loadTrack(track);
    game.startAttract();
    const p = game.path;
    const count = (id) => track.cells.filter((c) => TYPES[c.t].id === id).length;
    $('trackName').textContent = track.name;
    const bits = [`${p.cells.length} tiles`];
    if (count('loop')) bits.push(`${count('loop')} loop${count('loop') > 1 ? 's' : ''}`);
    const jumps = count('jump') + count('ramp');
    if (jumps) bits.push(`${jumps} jump${jumps > 1 ? 's' : ''}`);
    $('trackInfo').textContent = `${kind} · ${bits.join(' · ')}`;
    const rec = records.get(encodeTrack(track));
    $('trackBest').textContent = rec ? `Best ${fmtTime(rec.time)} · ${CARS[rec.car ?? 0].name}` : 'No record yet';
    const ctx = $('trackPreview').getContext('2d');
    drawBoardCropped(ctx, track, 160, { grid: false, bg: '#16301a' });
    if (kind === 'Built-in') {
      prefs.track = trackIdx;
      savePrefs();
    }
  }

  function selectCar(i) {
    prefs.car = (i + CARS.length) % CARS.length;
    savePrefs();
    const c = CARS[prefs.car];
    $('carName').textContent = c.name;
    c.stats.forEach((v, k) => ($(`stat${k}`).style.width = `${v * 20}%`));
    const hex = `#${c.color.toString(16).padStart(6, '0')}`;
    $('carSwatch').style.background = hex;
    $('carSwatch').style.color = hex;
    game.setCar(prefs.car);
    if (game.path && game.mode === 'attract') game.startAttract();
  }

  function selectPreset(name) {
    prefs.preset = name;
    savePrefs();
    game.setPreset(name);
    document.querySelectorAll('#presetSeg button').forEach((b) => b.classList.toggle('on', b.dataset.preset === name));
  }

  function toMenu() {
    if (testing) {
      testing = false;
      show();
      editor.open(game.track);
      game.startAttract();
      return;
    }
    show('menu');
    game.startAttract();
  }

  function race() {
    audio.unlock();
    show('hud', ...(isTouch ? ['touch'] : []));
    game.startRace();
  }

  hud.onFinish = (r) => {
    $('finTime').textContent = fmtTime(r.time);
    $('finTrack').textContent = `${r.track} · ${CARS[game.carIdx].name}`;
    $('finRecord').classList.toggle('hidden', !r.isBest);
    const parts = [];
    if (r.prevBest && !r.isBest) parts.push(`Best ${fmtTime(r.prevBest)} (+${(r.time - r.prevBest).toFixed(2)}s)`);
    if (r.prevBest && r.isBest) parts.push(`${(r.prevBest - r.time).toFixed(2)}s faster than before`);
    parts.push(r.crashes ? `${r.crashes} crash${r.crashes > 1 ? 'es' : ''}` : 'Clean run!');
    $('finDetail').textContent = parts.join(' · ');
    hud.setTrack(game.built, game.record);
    setTimeout(() => {
      if (game.mode === 'finished') show('finish', 'hud');
    }, 1200);
  };

  // --- Editor
  const editor = new Editor({
    toast,
    onTest: (track) => {
      editor.close();
      testing = true;
      game.loadTrack(track);
      race();
    },
    onExit: () => {
      editor.close();
      rebuildList();
      selectTrack(trackIdx);
      show('menu');
    },
  });
  editor.onSaved = () => rebuildList();

  // --- Menu wiring
  document.querySelectorAll('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      const d = +b.dataset.dir;
      if (b.dataset.pick === 'track') selectTrack(trackIdx + d);
      else selectCar(prefs.car + d);
    }),
  );
  document.querySelectorAll('#presetSeg button').forEach((b) => b.addEventListener('click', () => selectPreset(b.dataset.preset)));
  $('btnRace').onclick = race;
  $('btnEditor').onclick = () => {
    show();
    editor.open(tracks[trackIdx].track);
  };
  $('btnHelp').onclick = () => show('menu', 'help');
  const qualityLabel = () => ($('btnQuality').textContent = `Graphics: ${prefs.quality === 'high' ? 'High' : 'Fast'}`);
  const soundLabel = () => ($('btnSound').textContent = `Sound: ${audio.muted ? 'Off' : 'On'}`);
  $('btnQuality').onclick = () => {
    prefs.quality = prefs.quality === 'high' ? 'low' : 'high';
    world.setQuality(prefs.quality);
    savePrefs();
    qualityLabel();
  };
  $('btnSound').onclick = () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    soundLabel();
  };
  qualityLabel();
  soundLabel();

  const act = (a) => {
    if (a === 'resume') {
      game.pause(false);
      show('hud', ...(isTouch ? ['touch'] : []));
    } else if (a === 'restart') race();
    else if (a === 'menu') toMenu();
    else if (a === 'replay') {
      if (game.startReplay()) {
        show('replay');
        $('rpCam').textContent = 'TV';
        $('rpPlay').textContent = '❚❚';
        $('rpSpeed').textContent = '1×';
      }
    } else if (a === 'close') show('menu');
  };
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  $('tPause').addEventListener('click', () => {
    if (game.pause(true)) show('pause');
  });

  // Replay controls
  const speeds = [1, 0.5, 0.25, 2];
  const rp = {
    play: () => {
      game.replayPaused = !game.replayPaused;
      if (!game.replayPaused && game.replayT >= (game.recN - 1) / 60 - 0.01) game.replayT = 0;
      $('rpPlay').textContent = game.replayPaused ? '▶' : '❚❚';
    },
    speed: () => {
      const i = (speeds.indexOf(game.replaySpeed) + 1) % speeds.length;
      game.replaySpeed = speeds[i];
      $('rpSpeed').textContent = `${speeds[i]}×`;
    },
    cam: () => ($('rpCam').textContent = game.rig.cycle()),
    exit: () => {
      game.mode = 'finished';
      show('finish', 'hud');
    },
  };
  document.querySelectorAll('[data-rp]').forEach((b) => b.addEventListener('click', () => rp[b.dataset.rp]()));
  const scrub = $('rpScrub');
  scrub.addEventListener('input', () => {
    hud.scrubbing = true;
    game.replayT = (scrub.value / 1000) * ((game.recN - 1) / 60);
  });
  scrub.addEventListener('change', () => (hud.scrubbing = false));

  // Keyboard
  input.on('*', (code) => {
    audio.unlock();
    const m = game.mode;
    const inMenu = !$('menu').classList.contains('hidden');
    const inEditor = !$('editor').classList.contains('hidden');
    if (inEditor) return;
    if (!$('help').classList.contains('hidden')) {
      if (code === 'Escape' || code === 'Enter') show('menu');
      return;
    }
    if (inMenu) {
      if (code === 'Enter') race();
      if (code === 'ArrowLeft') selectTrack(trackIdx - 1);
      if (code === 'ArrowRight') selectTrack(trackIdx + 1);
      if (code === 'ArrowUp') selectCar(prefs.car - 1);
      if (code === 'ArrowDown') selectCar(prefs.car + 1);
      return;
    }
    if (code === 'KeyC' && m !== 'replay') game.rig.cycle();
    if (code === 'KeyM') {
      audio.setMuted(!audio.muted);
      soundLabel();
      toast(audio.muted ? 'Sound off' : 'Sound on');
    }
    if (code === 'KeyG') {
      game.ghostOn = !game.ghostOn;
      toast(game.ghostOn ? 'Ghost on' : 'Ghost off');
    }
    if (m === 'race') {
      if (code === 'Escape' || code === 'KeyP') {
        game.pause(true);
        show('pause');
      }
      if (code === 'KeyR') game.respawn(null);
    } else if (m === 'paused') {
      if (code === 'Escape' || code === 'KeyP') act('resume');
    } else if (m === 'replay') {
      if (code === 'Space') rp.play();
      if (code === 'KeyC') rp.cam();
      if (code === 'Escape') rp.exit();
    } else if (m === 'finished') {
      if (code === 'Enter') race();
      if (code === 'Escape') toMenu();
    } else if (m === 'countdown' && code === 'Escape') toMenu();
  });
  window.addEventListener('pointerdown', () => audio.unlock(), { once: false });

  // Start
  selectCar(prefs.car);
  selectPreset(prefs.preset);
  selectTrack(trackIdx);
  $('loading').classList.add('hidden');
  show('menu');
  if (shared) toast(`Loaded shared track “${shared.name}”`);

  let last = performance.now();
  function loop(now) {
    const dt = (now - last) / 1000;
    last = now;
    game.frame(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.__game = game;
}

boot().catch((e) => {
  console.error(e);
  document.querySelector('#loading .loadbar').outerHTML = `<p style="color:#ff8a70;max-width:520px;text-align:center">Could not start the game: ${e.message}. A browser with WebGL2 is required.</p>`;
});
