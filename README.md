# Stunt Racing

A modern browser tribute to the 1990 classic *Stunts*: loops, jumps, banked turns, boost pads, a tile-based track editor with shareable links, best-lap ghosts and TV-camera replays.

**Play:** https://www.tintamarre.be/stunt-racing/

## Features

- Real-time vehicle physics (Rapier raycast vehicle) with air control and a loop assist.
- Two driving modes: **Arcade** (default, kart-style: turns can be taken flat out, hold the drift button for a mini-turbo) and **Classic** (realistic grip, handbrake).
- Optional *Auto return to track*: puts the car back on the road after a moment on the grass (off by default).
- Six cars (three of them silly), seven built-in tracks (two easy ones for beginners) with wide flowing curves, bridges over streams and tunnels, day / sunset / night lighting.
- 1 to 5 lap races, with lap times and a best time per lap count.
- Trees hit at full speed snap and let the car through, at the cost of some speed.
- Track editor: paint tiles (including 2×2 wide curves, bridges and tunnels) on a 16×16 board, test-drive instantly, save locally or copy a share link (the whole track is encoded in the URL).
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
| `src/track.js` | Tile model, piece geometry (ribbons), path tracing, track encoding |
| `src/tracks.js` | Built-in tracks, described as drive-through paths |
| `src/physics.js` | Rapier world, terrain collider, car controller |
| `src/world.js` | Renderer, sky, lighting, terrain, track meshes, scenery |
| `src/game.js` | Game loop, race rules, recording, replays, ghosts |
| `src/editor.js` | Track editor |
| `tests/sim.mjs` | Headless lap test |
| `tests/novice.mjs` | Full-throttle, never-brake driver: checks the easy tracks stay easy |
| `tests/paths.mjs` | Prints every built-in track as an ASCII board and checks it is a closed circuit |
| `tests/trees.mjs` | A fast car snaps a tree, a slow one is stopped |
