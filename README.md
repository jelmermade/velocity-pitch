# Velocity Pitch

Velocity Pitch is a browser-based rocket car soccer game built with TypeScript, Three.js, Rapier, WebSockets, and Vite. It includes a fixed-step vehicle simulation, single-player practice, host-authoritative multiplayer, match replays, and configurable match tuning.

## Features

- Rocket-car handling with suspension, powersliding, boost, aerial control, recovery, double jumps, and directional dodges.
- A curved enclosed arena with goals, boost pickups, goal explosions, replays, overtime, and a post-match winner presentation.
- 1v1, 2v2, or 3v3 matches with bots filling every open team slot.
- Player nameplates above every vehicle and channel-aware multiplayer chat with fading match history.
- Single-player matches with session-only team size, boost recharge, boost power, and hit power controls.
- A multiplayer lobby browser with named lobbies, optional passwords, invite links, and saved driver names.
- Host controls for team assignment, player removal, match reset, match stop, and rematches from the lobby.
- Host-authoritative multiplayer physics with command buffering, snapshot interpolation, and limited extrapolation.
- A 60 Hz simulation and adaptive render resolution targeting 60 FPS.
- Persistent client preferences for camera distance, field of view, bloom, volume, FPS visibility, car-position visibility, and driver name.
- Independent FPS and car-position readouts for debugging.
- A temporary five-minute 3v3 Bot Lab with persistent tactical reinforcement, per-bot reward scores,
  live tactical heading arrows, and a projected ball trajectory for debugging.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm
- A browser with WebGL and WebSocket support

## Local Development

Install dependencies and start the client:

```bash
npm install
npm run dev
```

Start the Vite client and multiplayer WebSocket service together:

```bash
npm run dev:multiplayer
```

The development client proxies same-origin WebSocket requests to the local multiplayer service.

## Configuration

Keep deployment-specific values in an untracked `.env` file. Do not add credentials, private addresses, tokens, or production secrets to source control or this README.

| Variable | Purpose |
| --- | --- |
| `VITE_MULTIPLAYER_URL` | Optional public WebSocket endpoint used by the browser. |
| `VITE_PUBLIC_URL` | Optional public game origin used to build lobby invite links. |
| `VITE_BOT_KNOWLEDGE_URL` | Optional shared bot-knowledge API URL. Defaults to `/api/bot-knowledge`. |
| `MULTIPLAYER_HOST` | Bind address for the multiplayer service. |
| `MULTIPLAYER_PORT` | Listening port for the multiplayer service. |
| `BOT_KNOWLEDGE_PATH` | Optional JSON file path for shared bot knowledge. Defaults to `data/bot-knowledge.json`. |

Variables prefixed with `VITE_` are bundled into browser code and must never contain secrets. Without browser overrides, multiplayer uses the current origin and the `/ws` path. For production, serve the built client and proxy both `/ws` and `/api` to the multiplayer service.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development client. |
| `npm run dev:server` | Start the multiplayer service in watch mode. |
| `npm run dev:multiplayer` | Start the client and multiplayer service together. |
| `npm run server` | Start the multiplayer service without watch mode. |
| `npm run preview` | Preview the production client build. |
| `npm run typecheck` | Run TypeScript project checks. |
| `npm run lint` | Run ESLint. |
| `npm test` | Run the Vitest suite. |
| `npm run test:e2e` | Run the browser-level arena flow in Chrome. |
| `npm run test:e2e:headed` | Run the e2e flow in a visible Chrome window. |
| `npm run test:e2e:ui` | Open Playwright's interactive runner and trace viewer. |
| `npm run test:bot-evaluation` | Simulate a five-minute 3v3 bot match, write its metrics, and persist the next knowledge generation. |
| `npm run evaluate:bot-v3` | Run a non-persisting v3 candidate evaluation with shot-target and aerial accuracy metrics. |
| `npm run train:bot-v3` | Run evaluation v3 and merge tactical plus contact-technique observations into shared knowledge. |
| `npm run analyze:bot-evaluations` | Summarize all current evaluation reports in `data/`. |
| `npm run build` | Type-check and build the production client into `dist`. |

## Controls

| Input | Action |
| --- | --- |
| `W` / `S` | Throttle, reverse, and aerial pitch |
| `A` / `D` | Steering and aerial yaw |
| Left mouse | Boost |
| Right mouse | Jump, double jump, directional dodge, or recovery |
| `Shift` | Powerslide |
| `Q` / `E` | Air roll |
| `Space` | Toggle ball camera |
| `Tab` | Hold to show the score and player roster |
| `Enter` | Open global chat |
| `T` | Open team chat |
| `Y` | Open party/lobby chat |
| `F2` | Toggle the FPS readout |
| `F3` | Toggle the debug free camera |
| `Escape` | Open or close the pause menu |

Free-camera controls use `WASD` for horizontal movement, `Space` and `Ctrl` for vertical movement, arrow keys to look, and `Shift` for faster movement.

Chat presentation and behavior defaults live in `src/ui/ChatConfig.ts`. Position, UI scale, opacity, font size, visible/history limits, fade and animation timing, character limits, cooldown, channel colors, close-after-send behavior, timestamps, prefixes, and keyboard bindings can be overridden when constructing `ChatPanel`.

## Match Flow

The main menu separates single-player and multiplayer. Multiplayer opens the lobby browser, where a driver can join an available lobby or create a named lobby with an optional password. The host controls match tuning and the lobby roster before starting.

Matches progress through countdown, active play, goal explosion, replay, kickoff, overtime when tied, and completion. After completion, the winning cars are presented at midfield with jump, boost, and turning controls while horizontal driving remains locked. Multiplayer sessions then return to the lobby for a rematch.

Match tuning is intentionally session-only and is not written to local storage. General display/audio preferences and the driver name are stored locally in the browser.

## Architecture

- `src/app` coordinates startup, the fixed-step loop, sessions, rendering, cameras, and UI.
- `src/gameplay` contains arena, car, ball, boost, replay, match, and simulation logic.
- `src/physics` defines engine-neutral interfaces; `src/physics/rapier` contains the Rapier adapter.
- `src/networking` contains lobby protocol types, WebSocket transport, command buffering, and frame interpolation.
- `src/rendering` owns Three.js scene views, lighting, post-processing, and adaptive quality.
- `src/ui` contains the main menu, lobby browser, HUD, pause menu, settings, and styles.
- `server` contains the in-memory WebSocket lobby and relay service.
- `tests` covers gameplay, physics, networking, rendering, cameras, input, and UI helpers.

The host runs the authoritative simulation. Guests send ticked input commands, while the host publishes car and match snapshots for interpolated rendering. Gameplay code depends on physics interfaces rather than Rapier directly, and rendering/UI consume snapshots without owning simulation state.

## Verification

Run the complete verification sequence before merging changes:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

The Vitest suite contains unit and integration coverage for geometry, physics, rendering helpers, and networking. The Playwright suite starts the real Vite application and includes a visible car-behavior showcase covering acceleration, braking, reverse, left/right steering, left/right powerslides, jumping, pitch-to-flight, boost flight, both air-roll directions, aerial damping, off-angle landing, the complete wall-approach speed/angle matrix, wall steering, and wall-jump detachment. Use `npm run test:e2e:ui` to select and replay individual scenarios, or `npm run test:e2e:headed` to watch the complete sequence in Chrome.
