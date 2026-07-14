import { afterEach, describe, expect, it } from 'vitest';
import { MATCH_TUNING } from '../../src/core/config/MatchTuning';
import { DEFAULT_CAR_TUNING } from '../../src/core/config/CarTuning';
import { Car, DEFAULT_CAR_SPAWN } from '../../src/gameplay/car/Car';
import { resolveDemolition, type DemolitionImpactCar } from '../../src/gameplay/car/DemolitionSystem';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';

describe('car demolitions', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => world?.dispose());

  it('demolishes the opponent hit directly at maximum speed', () => {
    expect(resolveDemolition(
      car('attacker', 'azure', { x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: -28 }),
      car('victim', 'coral', { x: 0, y: 0, z: 0 }),
      28,
      MATCH_TUNING.demolitionSpeedRatio,
      MATCH_TUNING.demolitionMinimumApproach,
    )).toEqual({ attackerId: 'attacker', victimId: 'victim' });
  });

  it.each([
    ['teammate', car('victim', 'azure', { x: 0, y: 0, z: 0 })],
    ['low speed', car('victim', 'coral', { x: 0, y: 0, z: 0 })],
    ['side swipe', car('victim', 'coral', { x: 0, y: 0, z: 0 })],
  ] as const)('does not demolish on a %s contact', (scenario, victim) => {
    const velocity = scenario === 'low speed'
      ? { x: 0, y: 0, z: -12 }
      : scenario === 'side swipe'
        ? { x: 28, y: 0, z: 0 }
        : { x: 0, y: 0, z: -28 };
    expect(resolveDemolition(
      car('attacker', 'azure', { x: 0, y: 0, z: 4 }, velocity),
      victim,
      28,
      MATCH_TUNING.demolitionSpeedRatio,
      MATCH_TUNING.demolitionMinimumApproach,
    )).toBeNull();
  });

  it('keeps a demolished car disabled until its delayed spawn reset', async () => {
    world = await RapierPhysicsWorld.create();
    const vehicle = new Car(world);

    vehicle.demolish(MATCH_TUNING.demolitionRespawnSeconds);
    expect(vehicle.isDemolished()).toBe(true);
    expect(vehicle.advanceRespawn(MATCH_TUNING.demolitionRespawnSeconds - 0.1)).toBe(false);
    expect(vehicle.isDemolished()).toBe(true);
    expect(vehicle.advanceRespawn(0.11)).toBe(true);
    expect(vehicle.isDemolished()).toBe(false);
    const position = vehicle.state().transform.position;
    expect(position.x).toBeCloseTo(DEFAULT_CAR_SPAWN.position.x);
    expect(position.y).toBeCloseTo(DEFAULT_CAR_SPAWN.position.y);
    expect(position.z).toBeCloseTo(DEFAULT_CAR_SPAWN.position.z);
  });

  it('reports real car-to-car contact pairs from the physics world', async () => {
    world = await RapierPhysicsWorld.create();
    const left = new Car(world, DEFAULT_CAR_TUNING, {
      position: { x: -0.8, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    const right = new Car(world, DEFAULT_CAR_TUNING, {
      position: { x: 0.8, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });

    world.step(1 / 120);

    expect(left.contactingBodyHandles(world)).toContain(right.bodyHandle());
    expect(right.contactingBodyHandles(world)).toContain(left.bodyHandle());
  });
});

const car = (
  playerId: string,
  team: 'azure' | 'coral',
  position: DemolitionImpactCar['position'],
  velocity: DemolitionImpactCar['velocity'] = { x: 0, y: 0, z: 0 },
): DemolitionImpactCar => ({ playerId, team, position, velocity });
