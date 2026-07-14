import { afterEach, describe, expect, it } from 'vitest';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { BALL_TUNING } from '../../src/core/config/BallTuning';
import { rotateVector } from '../../src/core/math/Quaternion';
import { dot, normalize } from '../../src/core/math/Vector3';
import { createArena } from '../../src/gameplay/arena/Arena';
import { Car } from '../../src/gameplay/car/Car';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import type { PhysicsBody } from '../../src/physics/PhysicsBody';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';

const createBall = (world: PhysicsWorld, position: { x: number; y: number; z: number }): PhysicsBody =>
  world.createDynamicBody(
    { position, ccd: true },
    {
      shape: { type: 'ball', radius: BALL_TUNING.radius },
      mass: BALL_TUNING.mass,
      restitution: BALL_TUNING.restitution,
      friction: BALL_TUNING.friction,
    },
  );

describe('arena vertical transitions', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => world?.dispose());

  it('keeps a high-speed car planted while it rides from the floor onto the wall', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;
    car.teleport(
      {
        position: { x: ARENA_TUNING.halfWidth - ARENA_TUNING.verticalCurveRadius - 9, y: 0.65, z: 0 },
        rotation: { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      },
      { x: 30, y: 0, z: 0 },
    );

    let peakHeight = car.state().transform.position.y;
    let transitionTicks = 0;
    let groundedTicks = 0;
    let fullyGroundedTicks = 0;
    let minimumGroundedWheels = 4;
    let consecutiveAirborneTicks = 0;
    let longestAirborneRun = 0;
    const airborneSamples: {
      readonly tick: number;
      readonly x: number;
      readonly y: number;
      readonly surfaceAlignment: number;
    }[] = [];
    for (let tick = 0; tick < 100; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, throttle: 1 }, step);
      world.step(step);
      const state = car.state();
      peakHeight = Math.max(peakHeight, state.transform.position.y);
      const curveStart = ARENA_TUNING.halfWidth - ARENA_TUNING.verticalCurveRadius - 0.5;
      const traversingCurve = state.transform.position.x >= curveStart
        && state.transform.position.y <= ARENA_TUNING.verticalCurveRadius + 1.5;
      if (!traversingCurve) continue;
      transitionTicks += 1;
      const groundedWheels = state.wheels.filter(({ grounded }) => grounded).length;
      minimumGroundedWheels = Math.min(minimumGroundedWheels, groundedWheels);
      if (groundedWheels === 4) fullyGroundedTicks += 1;
      if (state.grounded) {
        groundedTicks += 1;
        consecutiveAirborneTicks = 0;
      } else {
        const carUp = rotateVector(state.transform.rotation, { x: 0, y: 1, z: 0 });
        const curveCenter = {
          x: ARENA_TUNING.halfWidth - 0.25 - ARENA_TUNING.verticalCurveRadius,
          y: ARENA_TUNING.verticalCurveRadius,
          z: 0,
        };
        const expectedNormal = normalize({
          x: curveCenter.x - state.transform.position.x,
          y: curveCenter.y - state.transform.position.y,
          z: 0,
        });
        airborneSamples.push({
          tick,
          x: state.transform.position.x,
          y: state.transform.position.y,
          surfaceAlignment: dot(carUp, expectedNormal),
        });
        consecutiveAirborneTicks += 1;
        longestAirborneRun = Math.max(longestAirborneRun, consecutiveAirborneTicks);
      }
    }

    const metrics = {
      peakHeight,
      transitionTicks,
      groundedTicks,
      fullyGroundedTicks,
      minimumGroundedWheels,
      longestAirborneRun,
      airborneSamples,
    };
    expect(transitionTicks, JSON.stringify(metrics)).toBeGreaterThan(12);
    expect(groundedTicks, JSON.stringify(metrics)).toBe(transitionTicks);
    expect(fullyGroundedTicks / transitionTicks, JSON.stringify(metrics)).toBeGreaterThan(0.7);
    expect(minimumGroundedWheels, JSON.stringify(metrics)).toBeGreaterThanOrEqual(2);
    expect(longestAirborneRun, JSON.stringify(metrics)).toBe(0);
    expect(peakHeight, JSON.stringify(metrics)).toBeGreaterThan(ARENA_TUNING.verticalCurveRadius);
  });

  it('lets a car maintain a controlled low-speed climb on a vertical wall', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;
    const initialHeight = 8;
    car.teleport(
      {
        position: { x: ARENA_TUNING.halfWidth - 0.65, y: initialHeight, z: 0 },
        rotation: { x: 0.5, y: -0.5, z: 0.5, w: 0.5 },
      },
      { x: 0, y: 3, z: 0 },
    );

    let groundedTicks = 0;
    let minimumX = Number.POSITIVE_INFINITY;
    for (let tick = 0; tick < 120; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, throttle: 1 }, step);
      world.step(step);
      const state = car.state();
      if (state.grounded) groundedTicks += 1;
      minimumX = Math.min(minimumX, state.transform.position.x);
    }

    const state = car.state();
    const metrics = { groundedTicks, minimumX, state };
    expect(groundedTicks, JSON.stringify(metrics)).toBeGreaterThan(110);
    expect(minimumX, JSON.stringify(metrics)).toBeGreaterThan(ARENA_TUNING.halfWidth - 1.5);
    expect(state.transform.position.y, JSON.stringify(metrics)).toBeGreaterThan(initialHeight + 3);
  });

  it('rebounds an airborne entity from the solid ceiling', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const ball = createBall(world, { x: 0, y: ARENA_TUNING.height - 6, z: 0 });
    ball.setLinearVelocity({ x: 0, y: 28, z: 0 });

    let peakHeight = ball.position().y;
    let fastestDownwardVelocity = 0;
    for (let tick = 0; tick < 120; tick += 1) {
      world.step(1 / 120);
      peakHeight = Math.max(peakHeight, ball.position().y);
      fastestDownwardVelocity = Math.min(fastestDownwardVelocity, ball.linearVelocity().y);
    }

    expect(peakHeight).toBeLessThan(ARENA_TUNING.height - BALL_TUNING.radius + 0.18);
    expect(fastestDownwardVelocity).toBeLessThan(-8);
  });
});
