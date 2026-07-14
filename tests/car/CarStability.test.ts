import { afterEach, describe, expect, it } from 'vitest';
import { createArena } from '../../src/gameplay/arena/Arena';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { rotateVector } from '../../src/core/math/Quaternion';
import { DEFAULT_CAR_TUNING } from '../../src/core/config/CarTuning';
import { Car } from '../../src/gameplay/car/Car';
import type { CarState } from '../../src/gameplay/car/CarState';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../src/input/PlayerCommand';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';

describe('Car stability', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => {
    world?.dispose();
    world = undefined;
  });

  it('settles on its suspension and accelerates without becoming unstable', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;

    simulate(car, world, NEUTRAL_COMMAND, step, 240);
    const resting = car.state();
    const neutralMetrics = {
      position: resting.transform.position,
      velocity: resting.linearVelocity,
      rotation: resting.transform.rotation,
      angularVelocity: resting.angularVelocity,
      suspensionLengths: resting.wheels.map(({ suspensionLength }) => suspensionLength),
    };
    expect(resting.grounded).toBe(true);
    expect(resting.transform.position.y).toBeGreaterThan(0.55);
    expect(resting.transform.position.y).toBeLessThan(0.75);
    expect(Math.abs(resting.linearVelocity.y)).toBeLessThan(0.5);
    expect(Math.hypot(resting.linearVelocity.x, resting.linearVelocity.z), JSON.stringify(neutralMetrics)).toBeLessThan(0.02);
    expect(Math.hypot(resting.transform.position.x, resting.transform.position.z - 23), JSON.stringify(neutralMetrics)).toBeLessThan(0.15);
    expect(Math.hypot(resting.angularVelocity.x, resting.angularVelocity.y, resting.angularVelocity.z)).toBeLessThan(0.1);

    const throttle: PlayerCommand = { ...NEUTRAL_COMMAND, throttle: 1 };
    simulate(car, world, throttle, step, 360);
    const driving = car.state();
    expect(Number.isFinite(driving.transform.position.x)).toBe(true);
    expect(Number.isFinite(driving.transform.position.y)).toBe(true);
    expect(Number.isFinite(driving.transform.position.z)).toBe(true);
    expect(Math.abs(driving.transform.position.z - resting.transform.position.z)).toBeGreaterThan(5);
    expect(driving.transform.position.y).toBeGreaterThan(0.3);
    expect(driving.transform.position.y).toBeLessThan(3);
    expect(Math.hypot(driving.angularVelocity.x, driving.angularVelocity.y, driving.angularVelocity.z)).toBeLessThan(8);
  });

  it.each([
    ['left', -1, -1],
    ['right', 1, 1],
  ] as const)('steers %s while moving forward', async (_direction, steer, expectedXSign) => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;

    simulate(car, world, NEUTRAL_COMMAND, step, 180);
    simulate(car, world, { ...NEUTRAL_COMMAND, throttle: 1, steer }, step, 180);
    const state = car.state();
    const forward = rotateVector(state.transform.rotation, { x: 0, y: 0, z: -1 });
    expect(state.transform.position.x * expectedXSign).toBeGreaterThan(1);
    expect(forward.x * expectedXSign).toBeGreaterThan(0.2);
    expect(state.grounded).toBe(true);
  });

  it('uses controlled boost thrust while retaining enough lift to fly', async () => {
    world = await RapierPhysicsWorld.create();
    const body = world.createDynamicBody(
      { position: { x: 0, y: 5, z: 0 }, linearDamping: 0.08 },
      {
        shape: { type: 'box', halfExtents: DEFAULT_CAR_TUNING.halfExtents },
        mass: DEFAULT_CAR_TUNING.mass,
      },
    );
    const step = 1 / 120;

    for (let tick = 0; tick < 120; tick += 1) {
      body.clearForces();
      body.applyForce({ x: 0, y: DEFAULT_CAR_TUNING.boostForce, z: 0 });
      world.step(step);
    }

    expect(DEFAULT_CAR_TUNING.boostForce).toBe(24_000);
    expect(body.position().y).toBeGreaterThan(8);
    expect(body.position().y).toBeLessThan(10);
    expect(body.linearVelocity().y).toBeGreaterThan(6);
    expect(body.linearVelocity().y).toBeLessThan(9);
  });

  it('brakes before engaging reverse when throttle opposes forward motion', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;

    simulate(car, world, NEUTRAL_COMMAND, step, 180);
    simulate(car, world, { ...NEUTRAL_COMMAND, throttle: 1 }, step, 180);
    const speedBeforeBraking = forwardSpeed(car.state());
    simulate(car, world, { ...NEUTRAL_COMMAND, throttle: -1 }, step, 60);
    const speedAfterBraking = forwardSpeed(car.state());

    const metrics = { speedBeforeBraking, speedAfterBraking, state: car.state() };
    expect(speedBeforeBraking, JSON.stringify(metrics)).toBeGreaterThan(8);
    expect(speedAfterBraking, JSON.stringify(metrics)).toBeGreaterThan(0);
    expect(speedAfterBraking, JSON.stringify(metrics)).toBeLessThan(speedBeforeBraking * 0.5);
  });

  it('limits boost acceleration on a surface without changing boost thrust', async () => {
    world = await RapierPhysicsWorld.create();
    world.createFixedCollider(
      { position: { x: 0, y: -0.5, z: 0 } },
      {
        shape: { type: 'box', halfExtents: { x: 200, y: 0.5, z: 200 } },
        friction: 0.82,
        restitution: 0.35,
      },
    );
    const car = new Car(world);
    const step = 1 / 120;

    simulate(car, world, NEUTRAL_COMMAND, step, 180);
    simulate(car, world, { ...NEUTRAL_COMMAND, throttle: 1, boost: true }, step, 360);
    const speed = forwardSpeed(car.state());

    expect(DEFAULT_CAR_TUNING.boostForce).toBe(24_000);
    expect(speed).toBeGreaterThan(DEFAULT_CAR_TUNING.maximumGroundBoostSpeed - 2);
    expect(speed).toBeLessThanOrEqual(DEFAULT_CAR_TUNING.maximumGroundBoostSpeed + 0.5);
  });

  it('does not apply the surface speed limit while airborne', async () => {
    world = await RapierPhysicsWorld.create();
    const car = new Car(world);
    const step = 1 / 120;
    car.teleport({
      position: { x: 0, y: ARENA_TUNING.height * 0.75, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });

    simulate(car, world, { ...NEUTRAL_COMMAND, boost: true }, step, 240);
    const state = car.state();

    expect(state.grounded).toBe(false);
    expect(forwardSpeed(state)).toBeGreaterThan(DEFAULT_CAR_TUNING.maximumGroundBoostSpeed + 15);
  });

  it('can pitch near vertical during a single jump before boost-up time is lost', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;

    simulate(car, world, NEUTRAL_COMMAND, step, 180);
    simulate(car, world, { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true }, step, 1);

    let ticksToVertical: number | null = null;
    let maximumForwardY = 0;
    let maximumPitchSpeed = 0;
    for (let tick = 0; tick < 90; tick += 1) {
      simulate(car, world, { ...NEUTRAL_COMMAND, throttle: -1 }, step, 1);
      const state = car.state();
      const forward = rotateVector(state.transform.rotation, { x: 0, y: 0, z: -1 });
      const right = rotateVector(state.transform.rotation, { x: 1, y: 0, z: 0 });
      maximumForwardY = Math.max(maximumForwardY, forward.y);
      maximumPitchSpeed = Math.max(maximumPitchSpeed, Math.abs(
        state.angularVelocity.x * right.x
          + state.angularVelocity.y * right.y
          + state.angularVelocity.z * right.z,
      ));
      if (ticksToVertical === null && forward.y > 0.995) ticksToVertical = tick + 1;
    }

    const metrics = { ticksToVertical, maximumForwardY, maximumPitchSpeed, state: car.state() };
    expect(ticksToVertical, JSON.stringify(metrics)).not.toBeNull();
    expect(ticksToVertical ?? Number.POSITIVE_INFINITY, JSON.stringify(metrics)).toBeLessThanOrEqual(60);
    expect(maximumPitchSpeed, JSON.stringify(metrics)).toBeLessThanOrEqual(
      DEFAULT_CAR_TUNING.maximumAerialAngularSpeed + 0.25,
    );
  });

  it('damps aerial rotation quickly after control input is released', async () => {
    world = await RapierPhysicsWorld.create();
    const car = new Car(world);
    const step = 1 / 120;
    car.teleport({
      position: { x: 0, y: 20, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });

    simulate(car, world, { ...NEUTRAL_COMMAND, throttle: -1 }, step, 45);
    const controlledSpeed = angularSpeed(car.state());
    simulate(car, world, NEUTRAL_COMMAND, step, 30);
    const releasedSpeed = angularSpeed(car.state());

    expect(controlledSpeed).toBeGreaterThan(2);
    expect(releasedSpeed).toBeLessThan(controlledSpeed * 0.35);
  });

  it('keeps normal cornering planted and reserves tighter rotation for powerslide', async () => {
    const normal = cornerMetrics(await simulateCorner(false));
    const sliding = cornerMetrics(await simulateCorner(true));

    expect(normal.slipRatio, JSON.stringify({ normal, sliding })).toBeLessThan(0.3);
    expect(normal.turnRadius, JSON.stringify({ normal, sliding })).toBeGreaterThan(8);
    expect(sliding.headingChange, JSON.stringify({ normal, sliding })).toBeGreaterThan(normal.headingChange * 1.2);
    expect(sliding.slipRatio, JSON.stringify({ normal, sliding })).toBeGreaterThan(normal.slipRatio + 0.08);
  });

  it.each([
    ['roll', { x: 0, y: 0, z: Math.sin(Math.PI / 12), w: Math.cos(Math.PI / 12) }],
    ['pitch', { x: Math.sin(Math.PI / 12), y: 0, z: 0, w: Math.cos(Math.PI / 12) }],
  ] as const)('settles predictably after an off-angle %s landing', async (_axis, rotation) => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    car.teleport(
      { position: { x: 0, y: 4, z: 0 }, rotation },
      { x: 0, y: -8, z: 0 },
    );

    let contacted = false;
    let maximumReboundSpeed = 0;
    let lostContactCount = 0;
    let wasGrounded = false;
    for (let tick = 0; tick < 600; tick += 1) {
      car.update(world, NEUTRAL_COMMAND, 1 / 120);
      world.step(1 / 120);
      const state = car.state();
      contacted ||= state.grounded || state.transform.position.y < 1.2;
      if (contacted) maximumReboundSpeed = Math.max(maximumReboundSpeed, state.linearVelocity.y);
      if (wasGrounded && !state.grounded) lostContactCount += 1;
      wasGrounded = state.grounded;
    }

    const state = car.state();
    const up = rotateVector(state.transform.rotation, { x: 0, y: 1, z: 0 });
    const metrics = { maximumReboundSpeed, lostContactCount, up, state };
    expect(maximumReboundSpeed, JSON.stringify(metrics)).toBeLessThan(2);
    expect(lostContactCount, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
    expect(state.grounded, JSON.stringify(metrics)).toBe(true);
    expect(up.y, JSON.stringify(metrics)).toBeGreaterThan(0.95);
    expect(Math.hypot(state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z), JSON.stringify(metrics)).toBeLessThan(0.2);
  });
});

const simulateCorner = async (powerslide: boolean): Promise<CarState> => {
  const world = await RapierPhysicsWorld.create();
  try {
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;
    simulate(car, world, NEUTRAL_COMMAND, step, 180);
    simulate(car, world, { ...NEUTRAL_COMMAND, throttle: 1 }, step, 120);
    simulate(car, world, { ...NEUTRAL_COMMAND, throttle: 1, steer: 1, powerslide }, step, 120);
    return car.state();
  } finally {
    world.dispose();
  }
};

const cornerMetrics = (state: CarState): {
  readonly headingChange: number;
  readonly slipRatio: number;
  readonly turnRadius: number;
} => {
  const forward = rotateVector(state.transform.rotation, { x: 0, y: 0, z: -1 });
  const right = rotateVector(state.transform.rotation, { x: 1, y: 0, z: 0 });
  const forwardSpeed = Math.abs(
    state.linearVelocity.x * forward.x + state.linearVelocity.y * forward.y + state.linearVelocity.z * forward.z,
  );
  const lateralSpeed = Math.abs(
    state.linearVelocity.x * right.x + state.linearVelocity.y * right.y + state.linearVelocity.z * right.z,
  );
  return {
    headingChange: Math.abs(Math.atan2(forward.x, -forward.z)),
    slipRatio: lateralSpeed / Math.max(1, forwardSpeed),
    turnRadius: forwardSpeed / Math.max(0.01, Math.abs(state.angularVelocity.y)),
  };
};

const forwardSpeed = (state: CarState): number => {
  const forward = rotateVector(state.transform.rotation, { x: 0, y: 0, z: -1 });
  return state.linearVelocity.x * forward.x
    + state.linearVelocity.y * forward.y
    + state.linearVelocity.z * forward.z;
};

const angularSpeed = (state: CarState): number => Math.hypot(
  state.angularVelocity.x,
  state.angularVelocity.y,
  state.angularVelocity.z,
);

const simulate = (
  car: Car,
  world: PhysicsWorld,
  command: PlayerCommand,
  step: number,
  ticks: number,
): void => {
  for (let tick = 0; tick < ticks; tick += 1) {
    car.update(world, command, step);
    world.step(step);
  }
};
