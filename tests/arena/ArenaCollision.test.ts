import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIME_CONFIG } from '../../src/app/RuntimeConfig';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { BALL_TUNING } from '../../src/core/config/BallTuning';
import { DEFAULT_CAR_TUNING } from '../../src/core/config/CarTuning';
import { rotateVector } from '../../src/core/math/Quaternion';
import { dot, length } from '../../src/core/math/Vector3';
import { createArena, createArenaTransitionCollisionMesh } from '../../src/gameplay/arena/Arena';
import { ARENA_BOUNDARY_SEGMENTS } from '../../src/gameplay/arena/ArenaDefinition';
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

const WALL_RIDE_CASES = [8, 20, 32, 38].flatMap((speed) => (
  [-35, 0, 35].map((angleDegrees) => ({
    speed,
    angleDegrees,
    boost: speed === 38,
  }))
));

const RAMP_STEERING_CASES = [12, 20, 30].flatMap((speed) => ([
  { speed, direction: 'down toward the field', steer: -1, heightSign: -1 },
  { speed, direction: 'up toward the wall', steer: 1, heightSign: 1 },
] as const));

describe('arena boundary collisions', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => world?.dispose());

  it.each(WALL_RIDE_CASES)(
    'sticks to the curve and wall at $speed units/s from $angleDegrees degrees',
    async ({ speed, angleDegrees, boost }) => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const angle = angleDegrees * Math.PI / 180;
    const direction = { x: Math.cos(angle), z: Math.sin(angle) };
    const approachDistance = ARENA_TUNING.floorWallCurveRadius + 7;
    car.teleport(
      {
        position: {
          x: ARENA_TUNING.halfWidth - approachDistance,
          y: 0.65,
          z: -Math.tan(angle) * approachDistance,
        },
        rotation: yawRotationFor(direction.x, direction.z),
      },
      { x: direction.x * speed, y: 0, z: direction.z * speed },
    );

    let transitionTicks = 0;
    let groundedTransitionTicks = 0;
    let wallTicks = 0;
    let groundedWallTicks = 0;
    let wheelContactWallTicks = 0;
    let minimumWallAlignment = 1;
    let maximumWallSeparation = 0;
    let maximumAwayFromWallSpeed = 0;
    let maximumWheelOffsetError = 0;
    let peakHeight = 0.65;
    let flatEntrySpeed = 0;
    let minimumCurveSpeed = Number.POSITIVE_INFINITY;
    let wallEntrySpeed = 0;
    let flatEntryClimbSpeed = 0;
    let minimumCurveClimbSpeed = Number.POSITIVE_INFINITY;
    let wallEntryClimbSpeed = 0;
    let minimumCurveMovementRatio = Number.POSITIVE_INFINITY;
    let curveActualDistance = 0;
    let curveExpectedDistance = 0;
    let curveMovementTicks = 0;
    let previousPosition = car.state().transform.position;
    for (let tick = 0; tick < 300; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, throttle: 1, boost }, step);
      world.step(step);
      const state = car.state();
      const position = state.transform.position;
      const surfaceDebug = car.surfaceDebugState();
      const surfaceNormal = surfaceDebug?.surfaceNormal;
      const tangentSpeed = surfaceDebug ? length(surfaceDebug.tangentVelocity) : 0;
      const movementSpeed = Math.hypot(
        position.x - previousPosition.x,
        position.y - previousPosition.y,
        position.z - previousPosition.z,
      ) / step;
      previousPosition = position;
      const climbSpeed = surfaceNormal
        ? surfaceDebug.tangentVelocity.x * surfaceNormal.y
          - surfaceDebug.tangentVelocity.y * surfaceNormal.x
        : 0;
      if (surfaceNormal && surfaceNormal.y >= 0.98) {
        flatEntrySpeed = tangentSpeed;
        flatEntryClimbSpeed = climbSpeed;
      }
      if (surfaceNormal && surfaceNormal.y > 0.08 && surfaceNormal.y < 0.92) {
        minimumCurveSpeed = Math.min(minimumCurveSpeed, tangentSpeed);
        minimumCurveClimbSpeed = Math.min(minimumCurveClimbSpeed, climbSpeed);
        minimumCurveMovementRatio = Math.min(
          minimumCurveMovementRatio,
          movementSpeed / Math.max(0.01, tangentSpeed),
        );
        curveActualDistance += movementSpeed * step;
        curveExpectedDistance += tangentSpeed * step;
        curveMovementTicks += 1;
      }
      if (surfaceNormal && Math.abs(surfaceNormal.y) <= 0.02 && wallEntrySpeed === 0) {
        wallEntrySpeed = tangentSpeed;
        wallEntryClimbSpeed = climbSpeed;
      }
      peakHeight = Math.max(peakHeight, position.y);
      state.wheels.forEach(({ suspensionLength }) => {
        maximumWheelOffsetError = Math.max(maximumWheelOffsetError, Math.abs(suspensionLength));
      });

      const curveStart = ARENA_TUNING.halfWidth - ARENA_TUNING.floorWallCurveRadius - 0.5;
      if (position.x >= curveStart && position.y <= ARENA_TUNING.floorWallCurveRadius + 1.5) {
        transitionTicks += 1;
        if (state.grounded) groundedTransitionTicks += 1;
      }

      const ridingWall = position.y >= ARENA_TUNING.floorWallCurveRadius + 0.75
        && position.y <= ARENA_TUNING.floorWallCurveRadius + 8
        && position.x >= ARENA_TUNING.halfWidth - 2;
      if (ridingWall) {
        wallTicks += 1;
        if (state.grounded) groundedWallTicks += 1;
        if (state.wheels.filter(({ grounded }) => grounded).length >= 2) wheelContactWallTicks += 1;
        const carUp = rotateVector(state.transform.rotation, { x: 0, y: 1, z: 0 });
        minimumWallAlignment = Math.min(minimumWallAlignment, -carUp.x);
        maximumWallSeparation = Math.max(maximumWallSeparation, ARENA_TUNING.halfWidth - position.x);
        maximumAwayFromWallSpeed = Math.max(maximumAwayFromWallSpeed, -state.linearVelocity.x);
      }
    }

    const metrics = {
      speed,
      angleDegrees,
      boost,
      transitionTicks,
      groundedTransitionTicks,
      wallTicks,
      groundedWallTicks,
      wheelContactWallTicks,
      minimumWallAlignment,
      maximumWallSeparation,
      maximumAwayFromWallSpeed,
      maximumWheelOffsetError,
      peakHeight,
      flatEntrySpeed,
      minimumCurveSpeed,
      wallEntrySpeed,
      flatEntryClimbSpeed,
      minimumCurveClimbSpeed,
      wallEntryClimbSpeed,
      minimumCurveMovementRatio,
      curveTravelRatio: curveActualDistance / curveExpectedDistance,
      averageCurveMovementSpeed: curveActualDistance / Math.max(step, curveMovementTicks * step),
    };
    expect(transitionTicks, JSON.stringify(metrics)).toBeGreaterThan(10);
    expect(groundedTransitionTicks / transitionTicks, JSON.stringify(metrics)).toBeGreaterThan(0.98);
    expect(wallTicks, JSON.stringify(metrics)).toBeGreaterThan(10);
    expect(groundedWallTicks / wallTicks, JSON.stringify(metrics)).toBeGreaterThan(0.98);
    expect(wheelContactWallTicks / wallTicks, JSON.stringify(metrics)).toBeGreaterThan(0.95);
    expect(minimumWallAlignment, JSON.stringify(metrics)).toBeGreaterThan(0.98);
    expect(maximumWallSeparation, JSON.stringify(metrics)).toBeLessThan(0.8);
    expect(maximumAwayFromWallSpeed, JSON.stringify(metrics)).toBeLessThan(0.5);
    expect(maximumWheelOffsetError, JSON.stringify(metrics)).toBeLessThan(1e-6);
    expect(peakHeight, JSON.stringify(metrics)).toBeGreaterThan(ARENA_TUNING.floorWallCurveRadius + 6);
    expect(minimumCurveSpeed, JSON.stringify(metrics)).toBeGreaterThan(flatEntrySpeed * 0.99);
    expect(wallEntrySpeed, JSON.stringify(metrics)).toBeGreaterThan(flatEntrySpeed * 0.99);
    expect(minimumCurveClimbSpeed, JSON.stringify(metrics)).toBeGreaterThan(flatEntryClimbSpeed * 0.98);
    expect(wallEntryClimbSpeed, JSON.stringify(metrics)).toBeGreaterThan(flatEntryClimbSpeed * 0.98);
    expect(minimumCurveMovementRatio, JSON.stringify(metrics)).toBeGreaterThan(0.45);
    expect(metrics.curveTravelRatio, JSON.stringify(metrics)).toBeGreaterThan(0.9);
    expect(wallEntrySpeed, JSON.stringify(metrics)).toBeLessThan(metrics.averageCurveMovementSpeed * 1.25);
    },
  );

  it('carries a car into the planar chamfer without catching at either fillet', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const chamfer = ARENA_BOUNDARY_SEGMENTS.find(({ sectionType, midpoint }) => (
      sectionType === 'chamferWall' && midpoint.x > 0 && midpoint.z > 0
    ));
    expect(chamfer).toBeDefined();
    if (!chamfer) return;
    const car = new Car(world);
    const step = 1 / 120;
    const startInset = ARENA_TUNING.floorWallCurveRadius + 6;
    car.teleport(
      {
        position: {
          x: chamfer.midpoint.x - chamfer.outward.x * startInset,
          y: 0.65,
          z: chamfer.midpoint.z - chamfer.outward.z * startInset,
        },
        rotation: yawRotationFor(chamfer.outward.x, chamfer.outward.z),
      },
      { x: chamfer.outward.x * 10, y: 0, z: chamfer.outward.z * 10 },
    );

    let transitionTicks = 0;
    let minimumUpContinuity = 1;
    let maximumProgress = -startInset;
    let previousUp: { readonly x: number; readonly y: number; readonly z: number } | null = null;
    for (let tick = 0; tick < 240; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, throttle: 1 }, step);
      world.step(step);
      const state = car.state();
      const relative = {
        x: state.transform.position.x - chamfer.midpoint.x,
        y: 0,
        z: state.transform.position.z - chamfer.midpoint.z,
      };
      const progress = dot(relative, chamfer.outward);
      maximumProgress = Math.max(maximumProgress, progress);
      if (progress < -ARENA_TUNING.floorWallCurveRadius - 0.5) continue;
      transitionTicks += 1;
      const up = rotateVector(state.transform.rotation, { x: 0, y: 1, z: 0 });
      if (previousUp) minimumUpContinuity = Math.min(minimumUpContinuity, dot(previousUp, up));
      previousUp = up;
    }

    const metrics = { transitionTicks, maximumProgress, minimumUpContinuity };
    expect(transitionTicks, JSON.stringify(metrics)).toBeGreaterThan(5);
    expect(maximumProgress, JSON.stringify(metrics)).toBeGreaterThan(-ARENA_TUNING.floorWallCurveRadius);
    expect(minimumUpContinuity, JSON.stringify(metrics)).toBeGreaterThan(Math.cos(15 * Math.PI / 180));
  });

  it('reflects balls consistently from all four planar chamfer centers', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const physicsWorld = world;
    const chamfers = ARENA_BOUNDARY_SEGMENTS.filter(({ sectionType }) => sectionType === 'chamferWall');
    const balls = chamfers.map((chamfer) => {
      const ball = createBall(physicsWorld, {
        x: chamfer.midpoint.x - chamfer.outward.x * 8,
        y: ARENA_TUNING.floorWallCurveRadius + BALL_TUNING.radius + 1,
        z: chamfer.midpoint.z - chamfer.outward.z * 8,
      });
      ball.setLinearVelocity({ x: chamfer.outward.x * 18, y: 0, z: chamfer.outward.z * 18 });
      return { ball, chamfer, reflectedVelocity: null as { readonly x: number; readonly z: number } | null };
    });

    for (let tick = 0; tick < 180; tick += 1) {
      physicsWorld.step(1 / 120);
      balls.forEach((entry) => {
        if (entry.reflectedVelocity) return;
        const velocity = entry.ball.linearVelocity();
        if (velocity.x * entry.chamfer.outward.x + velocity.z * entry.chamfer.outward.z < -1) {
          entry.reflectedVelocity = velocity;
        }
      });
    }

    balls.forEach(({ chamfer, reflectedVelocity }) => {
      expect(reflectedVelocity).not.toBeNull();
      if (!reflectedVelocity) return;
      const normalSpeed = reflectedVelocity.x * chamfer.outward.x + reflectedVelocity.z * chamfer.outward.z;
      const tangentSpeed = reflectedVelocity.x * chamfer.tangent.x + reflectedVelocity.z * chamfer.tangent.z;
      expect(normalSpeed).toBeLessThan(-5);
      expect(Math.abs(tangentSpeed)).toBeLessThan(0.5);
    });
  });

  it('lets a car maintain a controlled low-speed climb on a vertical wall', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;
    const initialHeight = ARENA_TUNING.floorWallCurveRadius + 1;
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

  it('returns vertical wall speed to throttle control when input is released', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    car.teleport(
      {
        position: { x: ARENA_TUNING.halfWidth - 0.54, y: 15, z: 0 },
        rotation: { x: 0.5, y: -0.5, z: 0.5, w: 0.5 },
      },
      { x: 0, y: 10, z: 0 },
    );

    for (let tick = 0; tick < RUNTIME_CONFIG.physicsHz * 0.5; tick += 1) {
      car.update(world, NEUTRAL_COMMAND, step);
      world.step(step);
    }
    const coastState = car.state();
    for (let tick = 0; tick < RUNTIME_CONFIG.physicsHz; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, throttle: 1 }, step);
      world.step(step);
    }
    const throttleState = car.state();
    const metrics = { coastState, throttleState };

    expect(coastState.linearVelocity.y, JSON.stringify(metrics)).toBeLessThan(6);
    expect(throttleState.linearVelocity.y, JSON.stringify(metrics)).toBeGreaterThan(8);
    expect(throttleState.transform.position.x, JSON.stringify(metrics)).toBeGreaterThan(
      ARENA_TUNING.halfWidth - 0.9,
    );
  });

  it('drops a climbing car instead of letting it drive onto the ceiling', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const upperCurveStart = ARENA_TUNING.height - ARENA_TUNING.floorWallCurveRadius;
    car.teleport(
      {
        position: { x: ARENA_TUNING.halfWidth - 0.54, y: upperCurveStart - 4, z: 0 },
        rotation: { x: 0.5, y: -0.5, z: 0.5, w: 0.5 },
      },
      { x: 0, y: 20, z: 0 },
    );

    let peakHeight = car.state().transform.position.y;
    let ceilingGroundedTicks = 0;
    let fallingTicks = 0;
    for (let tick = 0; tick < RUNTIME_CONFIG.physicsHz * 2; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, throttle: 1 }, step);
      world.step(step);
      const state = car.state();
      const surfaceNormal = car.surfaceDebugState()?.surfaceNormal;
      peakHeight = Math.max(peakHeight, state.transform.position.y);
      if (state.grounded && surfaceNormal && surfaceNormal.y < -0.05) ceilingGroundedTicks += 1;
      if (!state.grounded && state.linearVelocity.y <= -DEFAULT_CAR_TUNING.minimumCeilingFallSpeed) {
        fallingTicks += 1;
      }
    }

    const state = car.state();
    const metrics = { peakHeight, ceilingGroundedTicks, fallingTicks, state };
    expect(peakHeight, JSON.stringify(metrics)).toBeGreaterThan(upperCurveStart);
    expect(ceilingGroundedTicks, JSON.stringify(metrics)).toBe(0);
    expect(fallingTicks, JSON.stringify(metrics)).toBeGreaterThan(10);
    expect(state.transform.position.y, JSON.stringify(metrics)).toBeLessThan(peakHeight - 3);
  });

  it('detaches immediately when jumping from a vertical wall', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const startX = ARENA_TUNING.halfWidth - 0.54;
    car.teleport({
      position: { x: startX, y: 15, z: 0 },
      rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
    });
    car.update(world, NEUTRAL_COMMAND, step);
    world.step(step);

    car.update(world, { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true }, step);
    expect(car.surfaceDebugState()?.adhesionForce).toEqual({ x: 0, y: 0, z: 0 });
    world.step(step);
    const launchState = car.state();
    let airborneTicks = 0;
    for (let tick = 0; tick < RUNTIME_CONFIG.physicsHz * 0.25; tick += 1) {
      car.update(world, NEUTRAL_COMMAND, step);
      world.step(step);
      if (!car.state().grounded) airborneTicks += 1;
    }
    const detachedState = car.state();
    const metrics = { launchState, detachedState, airborneTicks };

    expect(-launchState.linearVelocity.x, JSON.stringify(metrics)).toBeGreaterThan(5);
    expect(airborneTicks, JSON.stringify(metrics)).toBeGreaterThan(RUNTIME_CONFIG.physicsHz * 0.15);
    expect(startX - detachedState.transform.position.x, JSON.stringify(metrics)).toBeGreaterThan(1);
  });

  it('rolls backward down the ramp under gravity without autonomous drive input', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const rampAngle = Math.PI / 4;
    const curveRadius = ARENA_TUNING.floorWallCurveRadius;
    const surfaceX = ARENA_TUNING.halfWidth - curveRadius * (1 - Math.sin(rampAngle));
    const surfaceY = curveRadius * (1 - Math.cos(rampAngle));
    const surfaceNormal = { x: -Math.sin(rampAngle), y: Math.cos(rampAngle) };
    const start = {
      x: surfaceX + surfaceNormal.x * 0.54,
      y: surfaceY + surfaceNormal.y * 0.54,
      z: 0,
    };
    const halfYaw = Math.SQRT1_2;
    const halfRampSin = Math.sin(rampAngle * 0.5);
    const halfRampCos = Math.cos(rampAngle * 0.5);
    car.teleport({
      position: start,
      rotation: {
        x: halfRampSin * halfYaw,
        y: -halfRampCos * halfYaw,
        z: halfRampSin * halfYaw,
        w: halfRampCos * halfYaw,
      },
    });

    let groundedTicks = 0;
    let maximumThrottleForce = 0;
    for (let tick = 0; tick < RUNTIME_CONFIG.physicsHz * 0.5; tick += 1) {
      car.update(world, NEUTRAL_COMMAND, step);
      const debug = car.surfaceDebugState();
      maximumThrottleForce = Math.max(maximumThrottleForce, length(debug?.throttleForce ?? { x: 0, y: 0, z: 0 }));
      world.step(step);
      if (car.state().grounded) groundedTicks += 1;
    }

    const state = car.state();
    const forward = rotateVector(state.transform.rotation, { x: 0, y: 0, z: -1 });
    const backwardSpeed = -dot(state.linearVelocity, forward);
    const sidewaysSpeed = Math.abs(dot(
      state.linearVelocity,
      rotateVector(state.transform.rotation, { x: 1, y: 0, z: 0 }),
    ));
    const metrics = { start, state, backwardSpeed, sidewaysSpeed, groundedTicks, maximumThrottleForce };

    expect(maximumThrottleForce, JSON.stringify(metrics)).toBe(0);
    expect(groundedTicks, JSON.stringify(metrics)).toBeGreaterThan(RUNTIME_CONFIG.physicsHz * 0.45);
    expect(start.y - state.transform.position.y, JSON.stringify(metrics)).toBeGreaterThan(0.25);
    expect(start.x - state.transform.position.x, JSON.stringify(metrics)).toBeGreaterThan(0.25);
    expect(backwardSpeed, JSON.stringify(metrics)).toBeGreaterThan(1);
    expect(sidewaysSpeed, JSON.stringify(metrics)).toBeLessThan(0.5);
  });

  it('uses tire grip instead of sliding sideways down the ramp with no input', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const rampAngle = Math.PI / 4;
    const curveRadius = ARENA_TUNING.floorWallCurveRadius;
    const surfaceX = ARENA_TUNING.halfWidth - curveRadius * (1 - Math.sin(rampAngle));
    const surfaceY = curveRadius * (1 - Math.cos(rampAngle));
    const surfaceNormal = { x: -Math.sin(rampAngle), y: Math.cos(rampAngle) };
    const start = {
      x: surfaceX + surfaceNormal.x * 0.54,
      y: surfaceY + surfaceNormal.y * 0.54,
      z: 0,
    };
    car.teleport({
      position: start,
      rotation: { x: 0, y: 0, z: Math.sin(rampAngle * 0.5), w: Math.cos(rampAngle * 0.5) },
    });

    let maximumThrottleForce = 0;
    for (let tick = 0; tick < RUNTIME_CONFIG.physicsHz; tick += 1) {
      car.update(world, NEUTRAL_COMMAND, step);
      maximumThrottleForce = Math.max(
        maximumThrottleForce,
        length(car.surfaceDebugState()?.throttleForce ?? { x: 0, y: 0, z: 0 }),
      );
      world.step(step);
    }

    const state = car.state();
    const downhillTravel = Math.hypot(
      state.transform.position.x - start.x,
      state.transform.position.y - start.y,
    );
    const downhillSpeed = Math.hypot(state.linearVelocity.x, state.linearVelocity.y);
    const metrics = { start, state, downhillTravel, downhillSpeed, maximumThrottleForce };

    expect(maximumThrottleForce, JSON.stringify(metrics)).toBe(0);
    expect(state.grounded, JSON.stringify(metrics)).toBe(true);
    expect(downhillTravel, JSON.stringify(metrics)).toBeLessThan(0.35);
    expect(downhillSpeed, JSON.stringify(metrics)).toBeLessThan(0.35);
  });

  it('does not turn forward throttle into sideways ramp acceleration', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const rampAngle = Math.PI / 4;
    const curveRadius = ARENA_TUNING.floorWallCurveRadius;
    const surfaceX = ARENA_TUNING.halfWidth - curveRadius * (1 - Math.sin(rampAngle));
    const surfaceY = curveRadius * (1 - Math.cos(rampAngle));
    const surfaceNormal = { x: -Math.sin(rampAngle), y: Math.cos(rampAngle) };
    const start = {
      x: surfaceX + surfaceNormal.x * 0.54,
      y: surfaceY + surfaceNormal.y * 0.54,
      z: 0,
    };
    car.teleport({
      position: start,
      rotation: { x: 0, y: 0, z: Math.sin(rampAngle * 0.5), w: Math.cos(rampAngle * 0.5) },
    });

    for (let tick = 0; tick < RUNTIME_CONFIG.physicsHz * 0.5; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, throttle: 1 }, step);
      world.step(step);
    }

    const state = car.state();
    const crossSlopeTravel = Math.hypot(
      state.transform.position.x - start.x,
      state.transform.position.y - start.y,
    );
    const crossSlopeSpeed = Math.hypot(state.linearVelocity.x, state.linearVelocity.y);
    const metrics = { start, state, crossSlopeTravel, crossSlopeSpeed };

    expect(state.grounded, JSON.stringify(metrics)).toBe(true);
    expect(-state.transform.position.z, JSON.stringify(metrics)).toBeGreaterThan(2);
    expect(crossSlopeTravel, JSON.stringify(metrics)).toBeLessThan(0.3);
    expect(crossSlopeSpeed, JSON.stringify(metrics)).toBeLessThan(0.4);
  });

  it.each(RAMP_STEERING_CASES)(
    'steers $direction at $speed units/s while sticking to the lower ramp',
    async ({ speed, steer, heightSign }) => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const rampAngle = Math.PI / 4;
    const curveRadius = ARENA_TUNING.floorWallCurveRadius;
    const surfaceX = ARENA_TUNING.halfWidth - curveRadius * (1 - Math.sin(rampAngle));
    const surfaceY = curveRadius * (1 - Math.cos(rampAngle));
    const surfaceNormal = { x: -Math.sin(rampAngle), y: Math.cos(rampAngle) };
    const start = {
      x: surfaceX + surfaceNormal.x * 0.54,
      y: surfaceY + surfaceNormal.y * 0.54,
      z: 0,
    };
    car.teleport(
      {
        position: start,
        rotation: { x: 0, y: 0, z: Math.sin(rampAngle * 0.5), w: Math.cos(rampAngle * 0.5) },
      },
      { x: 0, y: 0, z: -speed },
    );

    let groundedTicks = 0;
    let wheelContactTicks = 0;
    let rampTicks = 0;
    let maximumDirectedHeightChange = 0;
    let maximumSlip = 0;
    let minimumRampAlignment = 1;
    let maximumRampSeparationError = 0;
    let minimumForwardContinuity = 1;
    let spatialTravel = 0;
    let previousPosition = start;
    let previousForward = rotateVector(car.state().transform.rotation, { x: 0, y: 0, z: -1 });
    const curveCenter = {
      x: ARENA_TUNING.halfWidth - curveRadius,
      y: curveRadius,
    };
    const expectedCenterRadius = curveRadius - 0.54;
    for (let tick = 0; tick < RUNTIME_CONFIG.physicsHz; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, throttle: 1, steer }, step);
      world.step(step);
      const state = car.state();
      spatialTravel += Math.hypot(
        state.transform.position.x - previousPosition.x,
        state.transform.position.y - previousPosition.y,
        state.transform.position.z - previousPosition.z,
      );
      previousPosition = state.transform.position;
      if (state.grounded) groundedTicks += 1;
      if (state.wheels.filter(({ grounded }) => grounded).length >= 2) wheelContactTicks += 1;
      maximumDirectedHeightChange = Math.max(
        maximumDirectedHeightChange,
        (state.transform.position.y - start.y) * heightSign,
      );
      const forward = rotateVector(state.transform.rotation, { x: 0, y: 0, z: -1 });
      const right = rotateVector(state.transform.rotation, { x: 1, y: 0, z: 0 });
      const forwardSpeed = dot(state.linearVelocity, forward);
      const lateralSpeed = dot(state.linearVelocity, right);
      maximumSlip = Math.max(maximumSlip, Math.abs(lateralSpeed) / Math.max(1, Math.abs(forwardSpeed)));
      minimumForwardContinuity = Math.min(minimumForwardContinuity, dot(previousForward, forward));
      previousForward = forward;

      const radialX = state.transform.position.x - curveCenter.x;
      const radialY = state.transform.position.y - curveCenter.y;
      const centerRadius = Math.hypot(radialX, radialY);
      const onLowerCurve = radialX > 0
        && state.transform.position.y > 0.25
        && state.transform.position.y < curveRadius - 0.25;
      if (onLowerCurve && centerRadius > 0.1) {
        rampTicks += 1;
        const expectedNormal = { x: -radialX / centerRadius, y: -radialY / centerRadius };
        const carUp = rotateVector(state.transform.rotation, { x: 0, y: 1, z: 0 });
        minimumRampAlignment = Math.min(
          minimumRampAlignment,
          carUp.x * expectedNormal.x + carUp.y * expectedNormal.y,
        );
        maximumRampSeparationError = Math.max(
          maximumRampSeparationError,
          Math.abs(centerRadius - expectedCenterRadius),
        );
      }
    }

    const state = car.state();
    const metrics = {
      speed,
      steer,
      start,
      groundedTicks,
      wheelContactTicks,
      rampTicks,
      maximumDirectedHeightChange,
      maximumSlip,
      minimumRampAlignment,
      maximumRampSeparationError,
      minimumForwardContinuity,
      spatialTravel,
      state,
    };
    expect(groundedTicks, JSON.stringify(metrics)).toBeGreaterThan(RUNTIME_CONFIG.physicsHz - 3);
    expect(wheelContactTicks, JSON.stringify(metrics)).toBeGreaterThan(RUNTIME_CONFIG.physicsHz - 5);
    expect(rampTicks, JSON.stringify(metrics)).toBeGreaterThan(2);
    expect(maximumDirectedHeightChange, JSON.stringify(metrics)).toBeGreaterThan(0.35);
    expect(minimumRampAlignment, JSON.stringify(metrics)).toBeGreaterThan(0.94);
    expect(maximumRampSeparationError, JSON.stringify(metrics)).toBeLessThan(0.25);
    expect(minimumForwardContinuity, JSON.stringify(metrics)).toBeGreaterThan(0.99);
    expect(maximumSlip, JSON.stringify(metrics)).toBeLessThan(0.13);
    expect(spatialTravel, JSON.stringify(metrics)).toBeGreaterThan(speed * 0.44);
    },
  );

  it('welds transition faces into one internal-edge-safe collision mesh', () => {
    world = undefined;
    const mesh = createArenaTransitionCollisionMesh();
    const uniqueVertices = new Set(mesh.vertices.map(({ x, y, z }) => (
      `${x.toFixed(5)}:${y.toFixed(5)}:${z.toFixed(5)}`
    )));
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.vertices.length).toBe(uniqueVertices.size);
    expect(mesh.vertices.length).toBeLessThan(mesh.indices.length);
    expect(mesh.indices.every((index) => index >= 0 && index < mesh.vertices.length)).toBe(true);
  });

  it.each([
    { direction: 'down', steer: -1, heightSign: -1 },
    { direction: 'up', steer: 1, heightSign: 1 },
  ] as const)('turns $direction while driving horizontally on the vertical wall', async ({ steer, heightSign }) => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const start = { x: ARENA_TUNING.halfWidth - 0.54, y: 20, z: 0 };
    const wallRideTicks = Math.round(RUNTIME_CONFIG.physicsHz * 0.6);
    car.teleport(
      {
        position: start,
        rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
      },
      { x: 0, y: 0, z: -20 },
    );

    let groundedTicks = 0;
    let wheelContactTicks = 0;
    let minimumWallAlignment = 1;
    let maximumWallSeparation = 0;
    let maximumDirectedHeightChange = 0;
    let minimumForwardContinuity = 1;
    let previousForward = rotateVector(car.state().transform.rotation, { x: 0, y: 0, z: -1 });
    for (let tick = 0; tick < wallRideTicks; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, throttle: 1, steer }, step);
      world.step(step);
      const state = car.state();
      if (state.grounded) groundedTicks += 1;
      if (state.wheels.filter(({ grounded }) => grounded).length >= 2) wheelContactTicks += 1;
      const up = rotateVector(state.transform.rotation, { x: 0, y: 1, z: 0 });
      const forward = rotateVector(state.transform.rotation, { x: 0, y: 0, z: -1 });
      minimumWallAlignment = Math.min(minimumWallAlignment, -up.x);
      maximumWallSeparation = Math.max(
        maximumWallSeparation,
        ARENA_TUNING.halfWidth - state.transform.position.x,
      );
      maximumDirectedHeightChange = Math.max(
        maximumDirectedHeightChange,
        (state.transform.position.y - start.y) * heightSign,
      );
      minimumForwardContinuity = Math.min(minimumForwardContinuity, dot(previousForward, forward));
      previousForward = forward;
    }

    const metrics = {
      steer,
      groundedTicks,
      wheelContactTicks,
      minimumWallAlignment,
      maximumWallSeparation,
      maximumDirectedHeightChange,
      minimumForwardContinuity,
      state: car.state(),
    };
    expect(groundedTicks, JSON.stringify(metrics)).toBeGreaterThan(wallRideTicks - 3);
    expect(wheelContactTicks, JSON.stringify(metrics)).toBeGreaterThan(wallRideTicks - 5);
    expect(minimumWallAlignment, JSON.stringify(metrics)).toBeGreaterThan(0.94);
    expect(maximumWallSeparation, JSON.stringify(metrics)).toBeLessThan(0.8);
    expect(maximumDirectedHeightChange, JSON.stringify(metrics)).toBeGreaterThan(3);
    expect(minimumForwardContinuity, JSON.stringify(metrics)).toBeGreaterThan(0.995);
  });

  it('keeps a rolling ball flat until it reaches the tight lower-wall fillet', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const initialHeight = BALL_TUNING.radius + 0.05;
    const curveStart = ARENA_TUNING.halfWidth - ARENA_TUNING.floorWallCurveRadius;
    const ball = createBall(world, {
      x: curveStart - 10,
      y: initialHeight,
      z: 0,
    });
    ball.setLinearVelocity({ x: 16, y: 0, z: 0 });

    let flatSamples = 0;
    let maximumFlatHeight = initialHeight;
    let maximumTransitionHeight = initialHeight;
    for (let tick = 0; tick < 180; tick += 1) {
      world.step(1 / 120);
      const position = ball.position();
      if (position.x < curveStart - BALL_TUNING.radius - 0.25) {
        flatSamples += 1;
        maximumFlatHeight = Math.max(maximumFlatHeight, position.y);
      } else {
        maximumTransitionHeight = Math.max(maximumTransitionHeight, position.y);
      }
    }

    expect(flatSamples).toBeGreaterThan(30);
    expect(maximumFlatHeight).toBeLessThan(initialHeight + 0.15);
    expect(maximumTransitionHeight).toBeGreaterThan(initialHeight + 0.25);
  });

  it.each([-1, 1] as const)('keeps a ball supported through the %s goal-mouth seam', async (zSign) => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const mouthZ = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;
    const initialHeight = BALL_TUNING.radius + 0.05;
    const ball = createBall(world, {
      x: ARENA_TUNING.goalHalfWidth - BALL_TUNING.radius - 0.8,
      y: initialHeight,
      z: zSign * (mouthZ - 8),
    });
    ball.setLinearVelocity({ x: 0, y: 0, z: zSign * 18 });

    let maximumGoalDepth = 0;
    let minimumHeight = initialHeight;
    for (let tick = 0; tick < 180; tick += 1) {
      world.step(1 / 120);
      const position = ball.position();
      maximumGoalDepth = Math.max(maximumGoalDepth, Math.abs(position.z) - mouthZ);
      minimumHeight = Math.min(minimumHeight, position.y);
    }

    expect(maximumGoalDepth).toBeGreaterThan(ARENA_TUNING.goalDepth * 0.45);
    expect(minimumHeight).toBeGreaterThan(BALL_TUNING.radius - 0.12);
  });

  it('keeps a car grounded while driving across the goal floor seam', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const car = new Car(world);
    const step = 1 / 120;
    const mouthZ = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;
    car.teleport(
      {
        position: { x: ARENA_TUNING.goalHalfWidth - 4, y: 0.65, z: mouthZ - 8 },
        rotation: yawRotationFor(0, 1),
      },
      { x: 0, y: 0, z: 8 },
    );

    let seamTicks = 0;
    let groundedTicks = 0;
    let maximumGoalDepth = 0;
    for (let tick = 0; tick < 240; tick += 1) {
      car.update(world, { ...NEUTRAL_COMMAND, throttle: 1 }, step);
      world.step(step);
      const state = car.state();
      const mouthDistance = state.transform.position.z - mouthZ;
      maximumGoalDepth = Math.max(maximumGoalDepth, mouthDistance);
      if (Math.abs(mouthDistance) > 4) continue;
      seamTicks += 1;
      if (state.grounded) groundedTicks += 1;
    }

    const metrics = { seamTicks, groundedTicks, maximumGoalDepth };
    expect(seamTicks, JSON.stringify(metrics)).toBeGreaterThan(10);
    expect(groundedTicks / seamTicks, JSON.stringify(metrics)).toBeGreaterThan(0.95);
    expect(maximumGoalDepth, JSON.stringify(metrics)).toBeGreaterThan(ARENA_TUNING.goalDepth * 0.4);
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

  it('deflects an airborne ball across the upper wall-to-ceiling fillet', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    const radius = ARENA_TUNING.floorWallCurveRadius;
    const diagonal = Math.SQRT1_2;
    const curveCenter = {
      x: ARENA_TUNING.halfWidth - radius,
      y: ARENA_TUNING.height - radius,
    };
    const contactRadius = radius - BALL_TUNING.radius;
    const ball = createBall(world, {
      x: curveCenter.x + diagonal * contactRadius - diagonal * 5,
      y: curveCenter.y + diagonal * contactRadius - diagonal * 5,
      z: 0,
    });
    ball.setLinearVelocity({ x: diagonal * 24, y: diagonal * 24, z: 0 });

    let minimumNormalVelocity = Number.POSITIVE_INFINITY;
    let maximumX = ball.position().x;
    let maximumY = ball.position().y;
    for (let tick = 0; tick < 120; tick += 1) {
      world.step(1 / 120);
      const position = ball.position();
      const velocity = ball.linearVelocity();
      maximumX = Math.max(maximumX, position.x);
      maximumY = Math.max(maximumY, position.y);
      minimumNormalVelocity = Math.min(
        minimumNormalVelocity,
        (velocity.x + velocity.y) * diagonal,
      );
    }

    expect(maximumX).toBeLessThan(ARENA_TUNING.halfWidth - BALL_TUNING.radius + 0.2);
    expect(maximumY).toBeLessThan(ARENA_TUNING.height - BALL_TUNING.radius + 0.2);
    expect(minimumNormalVelocity).toBeLessThan(-4);
  });
});

const yawRotationFor = (directionX: number, directionZ: number) => {
  const yaw = Math.atan2(-directionX, -directionZ);
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
};
