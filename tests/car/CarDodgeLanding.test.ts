import { afterEach, describe, expect, it } from 'vitest';
import { rotateVector } from '../../src/core/math/Quaternion';
import { createArena } from '../../src/gameplay/arena/Arena';
import { Car } from '../../src/gameplay/car/Car';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../src/input/PlayerCommand';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';

const STEP = 1 / 120;

describe('directional dodge landing', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => {
    world?.dispose();
    world = undefined;
  });

  it.each([
    ['forward', 1],
    ['backward', -1],
  ] as const)('lands upright after a %s dodge while throttle remains held', async (_name, throttle) => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    simulate(car, world, NEUTRAL_COMMAND, 180);

    step(car, world, { ...NEUTRAL_COMMAND, throttle, jumpPressed: true, jumpHeld: true });
    simulate(car, world, { ...NEUTRAL_COMMAND, throttle, jumpHeld: true }, 18);
    step(car, world, { ...NEUTRAL_COMMAND, throttle, jumpPressed: true, jumpHeld: true });

    let leftGround = false;
    let landed = false;
    for (let tick = 0; tick < 360; tick += 1) {
      step(car, world, { ...NEUTRAL_COMMAND, throttle });
      leftGround ||= !car.state().grounded;
      if (leftGround && car.state().grounded) {
        landed = true;
        break;
      }
    }

    const state = car.state();
    const up = rotateVector(state.transform.rotation, { x: 0, y: 1, z: 0 });
    expect(landed).toBe(true);
    expect(up.y, JSON.stringify({ up, angularVelocity: state.angularVelocity })).toBeGreaterThan(0.75);
  });

  it.each([
    ['forward', 1, 0],
    ['backward', -1, 0],
    ['left', 0, -1],
    ['right', 0, 1],
    ['diagonal', 1, 1],
  ] as const)('auto-levels after a %s dodge when no tilt input is held', async (_name, throttle, steer) => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    simulate(car, world, NEUTRAL_COMMAND, 180);

    step(car, world, { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true });
    simulate(car, world, { ...NEUTRAL_COMMAND, jumpHeld: true }, 18);
    step(car, world, { ...NEUTRAL_COMMAND, throttle, steer, jumpPressed: true, jumpHeld: true });

    let leftGround = false;
    let landed = false;
    for (let tick = 0; tick < 360; tick += 1) {
      step(car, world, NEUTRAL_COMMAND);
      leftGround ||= !car.state().grounded;
      if (leftGround && car.state().grounded) {
        landed = true;
        break;
      }
    }

    const state = car.state();
    const up = rotateVector(state.transform.rotation, { x: 0, y: 1, z: 0 });
    const metrics = { up, angularVelocity: state.angularVelocity, position: state.transform.position };
    expect(landed, JSON.stringify(metrics)).toBe(true);
    expect(up.y, JSON.stringify(metrics)).toBeGreaterThan(0.75);
  });

  it('ignores aerial rotation input during a committed dodge', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    simulate(car, world, NEUTRAL_COMMAND, 180);

    step(car, world, { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true });
    simulate(car, world, { ...NEUTRAL_COMMAND, jumpHeld: true }, 18);
    step(car, world, { ...NEUTRAL_COMMAND, steer: 1, jumpPressed: true, jumpHeld: true });

    const rotationInput = { ...NEUTRAL_COMMAND, throttle: -1, steer: -1, airRoll: 1 };
    let leftGround = false;
    let landed = false;
    for (let tick = 0; tick < 360; tick += 1) {
      step(car, world, rotationInput);
      leftGround ||= !car.state().grounded;
      if (leftGround && car.state().grounded) {
        landed = true;
        break;
      }
    }

    const state = car.state();
    const up = rotateVector(state.transform.rotation, { x: 0, y: 1, z: 0 });
    const metrics = { up, angularVelocity: state.angularVelocity };
    expect(landed, JSON.stringify(metrics)).toBe(true);
    expect(up.y, JSON.stringify(metrics)).toBeGreaterThan(0.75);
  });
});

const simulate = (car: Car, world: PhysicsWorld, command: PlayerCommand, ticks: number): void => {
  for (let tick = 0; tick < ticks; tick += 1) step(car, world, command);
};

const step = (car: Car, world: PhysicsWorld, command: PlayerCommand): void => {
  car.update(world, command, STEP);
  world.step(STEP);
};
