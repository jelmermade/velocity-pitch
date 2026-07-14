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
});
