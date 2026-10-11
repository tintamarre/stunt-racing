# Stunt Racing

A modern browser tribute to the 1990 classic *Stunts*: loops, jumps, banked turns, boost pads, a tile-based track editor with shareable links, best-lap ghosts and TV-camera replays.

**Play:** https://www.tintamarre.be/stunt-racing/

## Features

- Real-time vehicle physics (Rapier raycast vehicle) with air control and a loop assist.
- Two driving modes: **Arcade** (default, kart-style: turns can be taken flat out, hold the drift button for a mini-turbo) and **Classic** (realistic grip, handbrake).
- Optional *Auto return to track*: puts the car back on the road after a moment on the grass (off by default).
- Six cars (three of them silly), eleven built-in tracks (three easy ones for beginners, two in the mountains with climbs and descents) with wide (2×2) and sweeping (3×3) curves, bridges over streams and solid tunnels you can also drive over, day / sunset / night lighting, and clear / rain / snow weather (slippery roads, falling rain or snow, wet or snowy look).
- 1 to 5 lap races, with lap times and a best time per lap count.
- Up to 5 computer opponents (easy / normal / hard) on a starting grid, with live positions and final standings. They ease off when ahead and push when behind, so races stay close.
- Mario Kart style items: drive through the ? boxes, then use (E, Right Ctrl for player 2) a 🚀 turbo, a 🍌 banana, a 🦘 spring or a ⭐ star. Players at the back get the better items.
- A lap counts when you have driven over (or close to) every tile; cut too much and MISSED TILES! shows them blinking on the minimap.
- Coins along every track and three stars per circuit: finish, beat the par time, collect every coin in one race.
- Stunt score: air time, flips, loops, drifts, mini-turbos and felled trees score points; chain them within 2.5 s for up to ×5, crash and the chain is lost. Best score saved per track.
- Burnout starts: from a standstill or out of reverse the rear wheels spin, smoke on asphalt, throw mud on grass, and the nose lifts (a lot on the monster truck).
- Math quiz mode (serious gaming, menu: Math quiz Easy / Medium / Hard): every 25-40 s the race pauses on a multiple-choice question. Split screen: player 1 answers with 1-4, player 2 with 7 8 9 0; the first right answer drives off with a turbo, the other is frozen for 3 s. Alone: right = turbo, wrong = frozen.
- Funny visual damage: dents, parts flying off, engine smoke and backfires (it never changes how the car drives).
- Trees hit above ~20 km/h snap and let the car through, at the cost of some speed. Scraping a wall at a shallow angle slides the car along it; only a big wall hit head-on stops it.
- Track editor: paint tiles (including 2×2 wide curves, 3×3 sweeping curves, slopes and elevation levels, bridges and tunnels) on a 16×16 board, test-drive instantly, save locally or copy a share link (the whole track is encoded in the URL).
- Best-lap ghost per track, full replay with TV / chase / heli / cinematic cameras.
- Keyboard, gamepad and touch controls.

## Controls

| Key | Action |
| --- | --- |
| ↑ / W | Accelerate (in the air: lean forward) |
| ↓ / S | Brake, reverse (in the air: lean back) |
| ← → / A D | Steer (in the air: spin) |
| Space / Shift | Arcade: drift (release for a mini-turbo). Classic: handbrake |
| H | Horn |
| C | Change camera |
| R | Put the car back on the track |
| E | Use item (player 2: Right Ctrl) |
| G | Toggle ghost |
| Esc | Pause |

## Development

Requires Node 22+.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # headless physics tests: the autopilot drives every track with every car in both modes,
                 # and a flat-out novice driver must finish the easy tracks in arcade mode
npm run build    # static build in dist/
```

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## Stack

Vanilla JavaScript + [Vite](https://vite.dev), [three.js](https://threejs.org) for rendering (physical sky, PBR materials, shadows, bloom) and [Rapier](https://rapier.rs) for physics. All textures, models and sounds are generated procedurally: there are no asset files.

## Layout

| File | Role |
| --- | --- |
| `src/track.js` | Tile model, piece geometry (ribbons), path tracing, track encoding, mountain relief |
| `src/terrain.js` | Terrain height (landscape plus the current track's relief) |
| `src/tracks.js` | Built-in tracks, described as drive-through paths |
| `src/physics.js` | Rapier world, terrain collider, car controller |
| `src/world.js` | Renderer, sky, lighting, terrain, track meshes, scenery |
| `src/game.js` | Game loop, race rules, recording, replays, ghosts |
| `src/editor.js` | Track editor |
| `tests/sim.mjs` | Headless lap test |
| `tests/novice.mjs` | Full-throttle, never-brake driver: checks the easy tracks stay easy |
| `tests/paths.mjs` | Prints every built-in track as an ASCII board and checks it is a closed circuit |
| `tests/trees.mjs` | A fast car snaps a tree, a slow one is stopped |
| `tests/tunnel.mjs` | Tunnels are solid from above and from the side |
| `tests/walls.mjs` | Glancing wall hits keep speed, head-on hits stop the car |
| `tests/quiz.mjs` | Quiz questions always have a whole answer among four distinct choices |
| `tests/damage.mjs` | Damage detection: real crashes count, clean laps and big jumps don't |
