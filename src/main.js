import './style.css';
import { World } from './world.js';
import { initPhysics, CARS } from './physics.js';
import { Game, ordinal } from './game.js';
import { Hud, fmtTime } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Editor } from './editor.js';
import { BUILTIN } from './tracks.js';
import { decodeTrack, tracePath, TYPES } from './track.js';
import { drawBoardCropped } from './tiledraw.js';
import { prefs as prefStore, customTracks, records, stars } from './storage.js';
import { starText } from './coins.js';

const $ = (id) => document.getElementById(id);
const screens = ['menu', 'hud', 'pause', 'finish', 'replay', 'help', 'touch'];
const isTouch = matchMedia('(pointer: coarse)').matches;

function show(...names) {
  for (const s of screens) $(s).classList.toggle('hidden', !names.includes(s));
  $('p2hud')?.classList.toggle('hidden', !names.includes('hud'));
}

// Player 2's HUD is a copy of player 1's with every id prefixed by "p2"
function cloneHud() {
  const c = $('hud').cloneNode(true);
  c.id = 'p2hud';
  c.querySelectorAll('[id]').forEach((el) => (el.id = 'p2' + el.id));
  $('hud').after(c);
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
  cloneHud();
  const game = new Game(world, audio, input, hud);
  game.hud2 = new Hud('p2');
  const prefs = { car: 0, preset: 'day', weather: 'clear', quality: 'high', track: 0, handling: 'arcade', autoReturn: false, laps: 3, players: 1, car2: 1, opponents: 3, ai: 'normal', items: true, ...prefStore.load() };
  if (isTouch) prefs.players = 1;

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
    const bits = [...(track.level ? [track.level] : []), `${p.cells.length} tiles`];
    if (count('loop')) bits.push(`${count('loop')} loop${count('loop') > 1 ? 's' : ''}`);
    const jumps = count('jump') + count('ramp');
    if (jumps) bits.push(`${jumps} jump${jumps > 1 ? 's' : ''}`);
    if (game.lapCount() > 1) bits.push(`${game.lapCount()} laps`);
    $('trackInfo').textContent = `${kind} · ${bits.join(' · ')}`;
    showBest();
    const ctx = $('trackPreview').getContext('2d');
    drawBoardCropped(ctx, track, 160, { grid: false, bg: '#16301a' });
    if (kind === 'Built-in') {
      prefs.track = trackIdx;
      savePrefs();
    }
  }

  // Stars and best time of the selected track, under its name
  function showBest() {
    const rec = records.get(game.recordKey());
    $('trackBest').textContent = `${starText(stars.get(game.code))}  ` + (rec ? `Best ${fmtTime(rec.time)} · ${CARS[rec.car ?? 0].name}` : 'No record yet');
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

  function selectCar2(i) {
    prefs.car2 = (i + CARS.length) % CARS.length;
    savePrefs();
    const c = CARS[prefs.car2];
    $('car2Name').textContent = c.name;
    const hex = `#${c.color.toString(16).padStart(6, '0')}`;
    $('car2Swatch').style.background = hex;
    $('car2Swatch').style.color = hex;
    game.setPlayers(prefs.players, prefs.car2);
  }

  function selectItems(on) {
    prefs.items = on;
    savePrefs();
    game.setItems(on);
    document.querySelectorAll('#itemsSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.items === 'on') === on));
    $('tItem').classList.toggle('hidden', !on);
  }

  function selectOpponents(n, level = prefs.ai) {
    prefs.opponents = n;
    prefs.ai = level;
    savePrefs();
    game.setOpponents(n, level);
    document.querySelectorAll('#oppSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.opp === n));
    document.querySelectorAll('#aiSeg button').forEach((b) => b.classList.toggle('on', b.dataset.ai === level));
    $('aiCard').classList.toggle('hidden', n === 0);
  }

  function selectPlayers(n) {
    prefs.players = n;
    savePrefs();
    game.setPlayers(n, prefs.car2);
    $('p2Card').classList.toggle('hidden', n < 2);
    $('carHeader').textContent = n < 2 ? 'Car' : 'Player 1 car';
    document.querySelectorAll('#playersSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.players === n));
  }

  function selectWeather(name) {
    prefs.weather = name;
    savePrefs();
    game.setWeather(name);
    document.querySelectorAll('#weatherSeg button').forEach((b) => b.classList.toggle('on', b.dataset.weather === name));
  }

  function selectPreset(name) {
    prefs.preset = name;
    savePrefs();
    game.setPreset(name);
    document.querySelectorAll('#presetSeg button').forEach((b) => b.classList.toggle('on', b.dataset.preset === name));
  }

  function selectHandling(name) {
    prefs.handling = name;
    savePrefs();
    game.setHandling(name === 'arcade');
    $('tDrift').textContent = name === 'arcade' ? 'DRIFT' : 'HB';
    document.querySelectorAll('#handlingSeg button').forEach((b) => b.classList.toggle('on', b.dataset.handling === name));
  }

  function selectLaps(n) {
    prefs.laps = n;
    savePrefs();
    game.setLaps(n);
    document.querySelectorAll('#lapsSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.laps === n));
    if (game.path) selectTrack(trackIdx);
  }

  function selectAutoReturn(on) {
    prefs.autoReturn = on;
    savePrefs();
    game.autoReturn = on;
    document.querySelectorAll('#autoReturnSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.auto === 'on') === on));
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
    document.body.classList.remove('split');
  }

  function race() {
    audio.unlock();
    show('hud', ...(isTouch ? ['touch'] : []));
    game.startRace();
    document.body.classList.toggle('split', !!game.p2);
  }

  const finTitle = document.querySelector('.finish-title');
  hud.onFinish = (r) => {
    document.querySelector('#finish [data-act=replay]').classList.toggle('hidden', !!r.split);
    if (r.split) return finishSplit(r);
    showBest();
    finTitle.textContent = r.place ? (r.place === 1 ? 'YOU WIN!' : `${ordinal(r.place)} PLACE`) : 'FINISH';
    $('finDetail').style.whiteSpace = r.standings ? 'pre-line' : '';
    $('finTime').textContent = fmtTime(r.time);
    $('finTrack').textContent = `${r.track} · ${CARS[game.carIdx].name}`;
    $('finRecord').classList.toggle('hidden', !r.isBest);
    // ★ finish · ★ par time · ★ all coins, the new ones pop
    $('finStars').innerHTML = r.stars
      ? [['finish', 'Finish'], ['par', `Par ${fmtTime(r.par)}`], ['coins', `Coins ${r.coins}/${r.coinTotal}`]]
          .map(([k, label]) => `<span class="${r.allStars?.[k] ? 'on' : ''} ${r.freshStars.includes(k) ? 'new' : ''}"><b>★</b>${label}</span>`)
          .join('')
      : '';
    const parts = [];
    if (r.prevBest && !r.isBest) parts.push(`Best ${fmtTime(r.prevBest)} (+${(r.time - r.prevBest).toFixed(2)}s)`);
    if (r.prevBest && r.isBest) parts.push(`${(r.prevBest - r.time).toFixed(2)}s faster than before`);
    if (r.lapTimes.length > 1) {
      const best = Math.min(...r.lapTimes);
      parts.push(`Laps ${r.lapTimes.map((t) => (t === best ? `${fmtTime(t)} ★` : fmtTime(t))).join(' · ')}`);
    }
    parts.push(r.crashes ? `${r.crashes} crash${r.crashes > 1 ? 'es' : ''}` : 'Clean run!');
    if (r.score) parts.push(`Stunt score ${r.score.toLocaleString('en')}${r.score > r.prevScore ? ' (best!)' : ''}`);
    $('finDetail').textContent = parts.join(' · ') + (r.standings ? '\n\n' + standingsText(r.standings) : '');
    hud.setTrack(game.built, game.record);
    setTimeout(() => {
      if (game.mode === 'finished') show('finish', 'hud');
    }, 1200);
  };

  // "1. Lucky Lou · Bubble · 0:42.10", the humans marked with ▶
  function standingsText(list) {
    return list.map((p, i) => `${p.human ? '▶ ' : ''}${i + 1}. ${p.name} · ${CARS[p.car].name} · ${p.time != null ? fmtTime(p.time) : 'racing…'}`).join('\n');
  }

  function finishSplit(r) {
    $('finStars').innerHTML = '';
    const w = r.results[r.winner];
    finTitle.textContent = w.time != null ? `${w.name.toUpperCase()} WINS!` : 'NO WINNER';
    $('finTime').textContent = fmtTime(w.time);
    $('finTrack').textContent = r.track;
    $('finRecord').classList.add('hidden');
    $('finDetail').textContent = r.results
      .map((p) => {
        const laps = p.lapTimes.length > 1 ? ` (${p.lapTimes.map(fmtTime).join(' · ')})` : '';
        const gap = p !== w && p.time != null ? ` +${(p.time - w.time).toFixed(2)}s` : '';
        return `${p.name} · ${CARS[p.car].name}: ${p.time != null ? fmtTime(p.time) + gap : 'DNF'}${laps}`;
      })
      .join('\n') + (r.standings ? '\n\n' + standingsText(r.standings) : '');
    $('finDetail').style.whiteSpace = 'pre-line';
    setTimeout(() => {
      if (game.mode === 'finished') show('finish', 'hud');
    }, 1200);
  }

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
      else if (b.dataset.pick === 'car2') selectCar2(prefs.car2 + d);
      else selectCar(prefs.car + d);
    }),
  );
  document.querySelectorAll('#presetSeg button').forEach((b) => b.addEventListener('click', () => selectPreset(b.dataset.preset)));
  document.querySelectorAll('#weatherSeg button').forEach((b) => b.addEventListener('click', () => selectWeather(b.dataset.weather)));
  document.querySelectorAll('#lapsSeg button').forEach((b) => b.addEventListener('click', () => selectLaps(+b.dataset.laps)));
  document.querySelectorAll('#playersSeg button').forEach((b) => b.addEventListener('click', () => selectPlayers(+b.dataset.players)));
  document.querySelectorAll('#itemsSeg button').forEach((b) => b.addEventListener('click', () => selectItems(b.dataset.items === 'on')));
  $('tItem').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    game.useItem(1);
  });
  document.querySelectorAll('#oppSeg button').forEach((b) => b.addEventListener('click', () => selectOpponents(+b.dataset.opp)));
  document.querySelectorAll('#aiSeg button').forEach((b) => b.addEventListener('click', () => selectOpponents(prefs.opponents, b.dataset.ai)));
  document.querySelectorAll('#handlingSeg button').forEach((b) => b.addEventListener('click', () => selectHandling(b.dataset.handling)));
  document.querySelectorAll('#autoReturnSeg button').forEach((b) => b.addEventListener('click', () => selectAutoReturn(b.dataset.auto === 'on')));
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
    if (code === 'KeyH' && m !== 'replay') audio.horn(CARS[game.carIdx].horn);
    const p2 = game.p2;
    if (p2 && code === 'Comma') p2.rig.cycle();
    if (p2 && code === 'Period') audio.horn(CARS[p2.carIdx].horn);
    if (code === 'KeyE') game.useItem(1);
    if (p2 && (code === 'ControlRight' || code === 'Numpad1')) game.useItem(2);
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
      if (p2 && (code === 'Enter' || code === 'NumpadEnter')) game.respawn(null, p2);
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
  selectHandling(prefs.handling);
  selectAutoReturn(prefs.autoReturn);
  game.laps = prefs.laps;
  document.querySelectorAll('#lapsSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.laps === prefs.laps));
  selectCar(prefs.car);
  selectCar2(prefs.car2);
  selectPlayers(prefs.players);
  selectOpponents(prefs.opponents, prefs.ai);
  selectItems(prefs.items);
  if (isTouch) $('playersSeg').closest('.card').classList.add('hidden');
  selectWeather(prefs.weather);
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
