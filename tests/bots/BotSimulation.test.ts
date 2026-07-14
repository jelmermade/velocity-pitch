import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIME_CONFIG } from '../../src/app/RuntimeConfig';
import { EventBus } from '../../src/core/events/EventBus';
import type { GameEventMap } from '../../src/core/events/GameEvents';
import { GameSimulation } from '../../src/gameplay/simulation/GameSimulation';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import { LocalSession } from '../../src/networking/LocalSession';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';

describe('singleplayer bot simulation', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => world?.dispose());

  it('spawns four separate cars and drives the bots after kickoff', async () => {
    world = await RapierPhysicsWorld.create();
    const session = new LocalSession();
    const simulation = new GameSimulation(
      world,
      new EventBus<GameEventMap>(),
      session.players,
      session.localPlayerId,
    );
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const kickoffTicks = RUNTIME_CONFIG.physicsHz * 4;

    for (let tick = 0; tick < kickoffTicks; tick += 1) {
      const frame = simulation.authoritativeFrame(tick);
      simulation.updatePlayers(session.commandsForTick(tick, NEUTRAL_COMMAND, frame), step);
    }
    const before = simulation.authoritativeFrame(kickoffTicks);

    for (let tick = kickoffTicks; tick < kickoffTicks + RUNTIME_CONFIG.physicsHz; tick += 1) {
      const frame = simulation.authoritativeFrame(tick);
      simulation.updatePlayers(session.commandsForTick(tick, NEUTRAL_COMMAND, frame), step);
    }
    const after = simulation.authoritativeFrame(kickoffTicks + RUNTIME_CONFIG.physicsHz);
    const positions = Object.values(before.cars).map(({ transform }) => transform.position);
    const emberBefore = before.cars['bot-coral-0']?.transform.position;
    const emberAfter = after.cars['bot-coral-0']?.transform.position;

    expect(Object.keys(after.cars)).toHaveLength(4);
    expect(new Set(positions.map(({ x, z }) => `${x.toFixed(2)}:${z.toFixed(2)}`)).size).toBe(4);
    expect(emberBefore).toBeDefined();
    expect(emberAfter).toBeDefined();
    expect(Math.hypot(
      (emberAfter?.x ?? 0) - (emberBefore?.x ?? 0),
      (emberAfter?.z ?? 0) - (emberBefore?.z ?? 0),
    )).toBeGreaterThan(2);
  });

  it('spawns six separate cars for a 3v3 match', async () => {
    world = await RapierPhysicsWorld.create();
    const session = new LocalSession(3);
    const simulation = new GameSimulation(
      world,
      new EventBus<GameEventMap>(),
      session.players,
      session.localPlayerId,
    );

    const frame = simulation.authoritativeFrame(0);
    const positions = Object.values(frame.cars).map(({ transform }) => transform.position);

    expect(Object.keys(frame.cars)).toHaveLength(6);
    expect(new Set(positions.map(({ x, z }) => `${x.toFixed(2)}:${z.toFixed(2)}`)).size).toBe(6);
    expect(session.commandsForTick(0, NEUTRAL_COMMAND, frame).size).toBe(6);
  });
});
