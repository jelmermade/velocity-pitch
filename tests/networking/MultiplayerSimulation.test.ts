import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/events/EventBus';
import { RUNTIME_CONFIG } from '../../src/app/RuntimeConfig';
import type { GameEventMap } from '../../src/core/events/GameEvents';
import { GameSimulation } from '../../src/gameplay/simulation/GameSimulation';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import type { LobbyPlayer } from '../../src/networking/LobbyProtocol';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';

const PLAYERS: readonly LobbyPlayer[] = [
  { id: 'host', name: 'Host', team: 'azure', host: true },
  { id: 'guest', name: 'Guest', team: 'coral', host: false },
];

describe('authoritative multiplayer simulation', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => world?.dispose());

  it('simulates remote input as a real car in the host physics world', async () => {
    world = await RapierPhysicsWorld.create();
    const simulation = new GameSimulation(world, new EventBus<GameEventMap>(), PLAYERS, 'host');
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const settlingTicks = Math.round(RUNTIME_CONFIG.physicsHz * 3.33);
    const drivingTicks = Math.round(RUNTIME_CONFIG.physicsHz * 1.5);
    const neutral = new Map(PLAYERS.map(({ id }) => [id, NEUTRAL_COMMAND]));
    for (let tick = 0; tick < settlingTicks; tick += 1) simulation.updatePlayers(neutral, step);

    const before = simulation.authoritativeFrame(settlingTicks).cars.guest;
    const commands = new Map([
      ['host', NEUTRAL_COMMAND],
      ['guest', { ...NEUTRAL_COMMAND, throttle: 1 }],
    ]);
    for (let tick = 0; tick < drivingTicks; tick += 1) simulation.updatePlayers(commands, step);
    const frame = simulation.authoritativeFrame(settlingTicks + drivingTicks);
    const guest = frame.cars.guest;

    expect(Object.keys(frame.cars)).toHaveLength(2);
    expect(before).toBeDefined();
    expect(guest).toBeDefined();
    expect((guest?.transform.position.z ?? -23) - (before?.transform.position.z ?? -23)).toBeGreaterThan(4);
  });

  it('anchors victory cars at midfield while allowing jump, boost, and yaw', async () => {
    world = await RapierPhysicsWorld.create();
    const simulation = new GameSimulation(world, new EventBus<GameEventMap>(), PLAYERS, 'host');
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    simulation.stopMatch();
    let maximumHeight = 0;

    for (let tick = 0; tick < RUNTIME_CONFIG.physicsHz * 3; tick += 1) {
      simulation.updatePlayers(new Map([
        ['host', {
          ...NEUTRAL_COMMAND,
          throttle: 1,
          steer: 1,
          boost: true,
          jumpPressed: tick === 0,
          jumpHeld: tick < 10,
        }],
        ['guest', NEUTRAL_COMMAND],
      ]), step);
      maximumHeight = Math.max(
        maximumHeight,
        simulation.authoritativeFrame(tick).cars.host?.transform.position.y ?? 0,
      );
    }

    const frame = simulation.authoritativeFrame(RUNTIME_CONFIG.physicsHz * 3);
    const host = frame.cars.host;
    const guest = frame.cars.guest;
    expect(frame.snapshot.match.phase).toBe('ended');
    expect(host).toBeDefined();
    expect(guest).toBeDefined();
    expect(host?.transform.position.x).toBeCloseTo(-1.7, 4);
    expect(host?.transform.position.z).toBeCloseTo(0, 4);
    expect(host?.transform.position.y).toBeGreaterThan(0.4);
    expect(guest?.transform.position.x).toBeCloseTo(1.7, 4);
    expect(guest?.transform.position.z).toBeCloseTo(0, 4);
    expect(guest?.transform.position.y).toBeGreaterThan(0.4);
    expect(maximumHeight).toBeGreaterThan(1.2);
    expect(host?.boost).toBeLessThan(100);
    expect(Math.abs(host?.transform.rotation.y ?? 0)).toBeGreaterThan(0.05);
  });
});
