# Velocity Pitch

Velocity Pitch is an original browser-based rocket car soccer game built with TypeScript, Three.js, Rapier, and Vite. Its visuals, arena, code, and synthesized audio are created specifically for this project.

## Run

```bash
npm install
npm run dev
```

Multiplayer development starts the browser client and WebSocket lobby service together:

```bash
npm run dev:multiplayer
```

Network settings can be overridden through environment variables listed in `.env.example`. The browser defaults to same-origin WebSockets, so invite links work through Nginx without embedding an internal port.

Production verification:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Controls

| Input | Action |
| --- | --- |
| `W` / `S` | Throttle, reverse, and aerial pitch |
| `A` / `D` | Steering and aerial yaw |
| Left mouse | Boost |
| Right mouse | Jump, double jump, directional flip, or recovery |
| `Shift` | Powerslide |
| `Q` / `E` | Air roll |
| `Space` | Toggle ball camera |
| `F3` | Toggle debug free camera |
| `Escape` | Pause and settings |

In free camera mode, use `WASD`, `Space`, and `Ctrl` to move and the arrow keys to look.

## Architecture

The simulation runs at a fixed 120 Hz and publishes snapshots to the render loop. Gameplay imports engine-neutral physics interfaces; Rapier is isolated in `src/physics/rapier`. Input is represented as tick-numbered commands, and `GameSession` separates local and network transports. Multiplayer uses host-authoritative physics with server-relayed guest commands and snapshots.

Primary tuning values live in `src/core/config`. Match flow is an explicit state machine supporting countdown, kickoff, scoring, reset delay, overtime, match end, and pause. Rendering, cameras, UI, and audio consume snapshots and typed events without owning gameplay state.
