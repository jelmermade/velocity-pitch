import { afterEach, describe, expect, it } from 'vitest';
import { BALL_TUNING } from '../../src/core/config/BallTuning';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { DEFAULT_CAR_TUNING } from '../../src/core/config/CarTuning';
import { rotateVector } from '../../src/core/math/Quaternion';
import { createArena } from '../../src/gameplay/arena/Arena';
import { Car } from '../../src/gameplay/car/Car';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';

describe('Car collision profile', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => world?.dispose());

  it('launches a fast grounded ball upward from the rounded front edge', async () => {
    world = await RapierPhysicsWorld.create();
    world.createFixedCollider(
      { position: { x: 0, y: -0.5, z: 0 } },
      { shape: { type: 'box', halfExtents: { x: 10, y: 0.5, z: 10 } }, restitution: 0.2 },
    );
    world.createFixedCollider(
      { position: { x: 0, y: 0.9, z: 0 } },
      {
        shape: {
          type: 'roundConvexHull',
          points: DEFAULT_CAR_TUNING.colliderPoints,
          borderRadius: DEFAULT_CAR_TUNING.colliderBorderRadius,
        },
        restitution: 0.08,
      },
    );
    const ball = world.createDynamicBody(
      { position: { x: 0, y: BALL_TUNING.radius + 0.02, z: -7 }, ccd: true },
      {
        shape: { type: 'ball', radius: BALL_TUNING.radius },
        mass: BALL_TUNING.mass,
        restitution: BALL_TUNING.restitution,
        friction: BALL_TUNING.friction,
      },
    );
    ball.setLinearVelocity({ x: 0, y: 0, z: 40 });

    let peakVerticalVelocity = 0;
    let peakHeight = ball.position().y;
    for (let tick = 0; tick < 60; tick += 1) {
      world.step(1 / 120);
      peakVerticalVelocity = Math.max(peakVerticalVelocity, ball.linearVelocity().y);
      peakHeight = Math.max(peakHeight, ball.position().y);
    }

    expect(peakVerticalVelocity).toBeGreaterThan(2);
    expect(peakHeight).toBeGreaterThan(BALL_TUNING.radius + 0.2);
  });

  it('pops and rolls an upside-down car when jump is pressed', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;
    car.teleport({
      position: { x: 0, y: 0.65, z: 0 },
      rotation: { x: 0, y: 0, z: 1, w: 0 },
    });

    for (let tick = 0; tick < 60; tick += 1) {
      car.update(world, NEUTRAL_COMMAND, step);
      world.step(step);
    }
    car.update(world, { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true }, step);
    world.step(step);
    const recovered = car.state();

    expect(recovered.linearVelocity.y).toBeGreaterThan(2);
    expect(Math.hypot(
      recovered.angularVelocity.x,
      recovered.angularVelocity.y,
      recovered.angularVelocity.z,
    )).toBeGreaterThan(1);
  });

  it.each([
    ['left', Math.SQRT1_2],
    ['right', -Math.SQRT1_2],
  ] as const)('uses jump to recover from the %s side', async (_side, z) => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;
    car.teleport({
      position: { x: 0, y: 1.05, z: 0 },
      rotation: { x: 0, y: 0, z, w: Math.SQRT1_2 },
    });
    for (let tick = 0; tick < 90; tick += 1) {
      car.update(world, NEUTRAL_COMMAND, step);
      world.step(step);
    }

    car.update(world, { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true }, step);
    world.step(step);
    for (let tick = 0; tick < 150; tick += 1) {
      car.update(world, NEUTRAL_COMMAND, step);
      world.step(step);
    }

    const state = car.state();
    const up = rotateVector(state.transform.rotation, { x: 0, y: 1, z: 0 });
    expect(up.y).toBeGreaterThan(0.7);
    expect(state.transform.position.y).toBeGreaterThan(0.5);
  });

  it('keeps wheel centers above the floor and tucked into the fenders', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;

    for (let tick = 0; tick < 240; tick += 1) {
      car.update(world, NEUTRAL_COMMAND, step);
      world.step(step);
    }
    const state = car.state();
    const visibleGroundClearance = state.transform.position.y - DEFAULT_CAR_TUNING.halfExtents.y;
    const physicalGroundClearance = visibleGroundClearance - DEFAULT_CAR_TUNING.colliderBorderRadius;

    expect(visibleGroundClearance).toBeGreaterThan(0.12);
    expect(visibleGroundClearance).toBeLessThan(0.25);
    expect(physicalGroundClearance).toBeGreaterThan(0.02);
    expect(physicalGroundClearance).toBeLessThan(0.12);
    state.wheels.forEach((wheel) => {
      const lateralOffset = Math.abs(wheel.position.x - state.transform.position.x);
      expect(wheel.position.y).toBeCloseTo(DEFAULT_CAR_TUNING.wheelRadius, 2);
      expect(wheel.contactPoint.y).toBeCloseTo(0, 2);
      expect(lateralOffset).toBeGreaterThan(DEFAULT_CAR_TUNING.halfExtents.x - 0.12);
      expect(lateralOffset).toBeLessThan(DEFAULT_CAR_TUNING.halfExtents.x + 0.12);
      expect(wheel.suspensionLength).toBeLessThan(DEFAULT_CAR_TUNING.suspensionRestLength);
      expect(wheel.position.y + DEFAULT_CAR_TUNING.wheelRadius).toBeGreaterThan(state.transform.position.y);
    });
  });

  it('falls away from the ceiling even while boost remains held', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;
    car.teleport(
      {
        position: { x: 0, y: ARENA_TUNING.height - 4, z: 0 },
        rotation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
      },
      { x: 0, y: 18, z: 0 },
    );

    let reachedCeiling = false;
    let fallingTicks = 0;
    for (let tick = 0; tick < 120; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, boost: true }, step);
      world.step(step);
      const state = car.state();
      reachedCeiling ||= state.transform.position.y > ARENA_TUNING.height
        - DEFAULT_CAR_TUNING.halfExtents.z
        - DEFAULT_CAR_TUNING.colliderBorderRadius
        - 0.2;
      if (reachedCeiling && state.linearVelocity.y < -1) fallingTicks += 1;
    }

    expect(reachedCeiling).toBe(true);
    expect(fallingTicks).toBeGreaterThan(20);
    expect(car.state().transform.position.y).toBeLessThan(ARENA_TUNING.height - 2);
  });
});
