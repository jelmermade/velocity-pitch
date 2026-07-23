import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { BALL_TUNING } from '../../core/config/BallTuning';
import { PHYSICS_TUNING } from '../../core/config/PhysicsTuning';
import type { Vec3 } from '../../core/math/Vector3';

export const BALL_TRAJECTORY_STEP_SECONDS = 1 / 30;
const BALL_LINEAR_DAMPING = 0.025;
const MINIMUM_BOUNCE_SPEED = 0.5;

interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Lightweight deterministic prediction shared by bot decisions and their debug overlay.
 * It intentionally models the large arena planes rather than attempting a second Rapier world.
 */
export const predictBallTrajectory = (
  position: Vec3,
  velocity: Vec3,
  durationSeconds: number,
  stepSeconds = BALL_TRAJECTORY_STEP_SECONDS,
): readonly Vec3[] => {
  const points: Vec3[] = [{ ...position }];
  simulateBall(position, velocity, durationSeconds, stepSeconds, (point) => points.push(point));
  return points;
};

export const predictBallPosition = (
  position: Vec3,
  velocity: Vec3,
  seconds: number,
): Vec3 => simulateBall(position, velocity, seconds, BALL_TRAJECTORY_STEP_SECONDS);

const simulateBall = (
  position: Vec3,
  velocity: Vec3,
  durationSeconds: number,
  stepSeconds: number,
  observe?: (point: Vec3) => void,
): Vec3 => {
  const next: MutableVec3 = { ...position };
  const motion: MutableVec3 = { ...velocity };
  const steps = Math.max(1, Math.ceil(durationSeconds / stepSeconds));
  const step = durationSeconds / steps;
  const damping = Math.exp(-BALL_LINEAR_DAMPING * step);

  for (let index = 0; index < steps; index += 1) {
    motion.x = (motion.x + PHYSICS_TUNING.gravity.x * step) * damping;
    motion.y = (motion.y + PHYSICS_TUNING.gravity.y * step) * damping;
    motion.z = (motion.z + PHYSICS_TUNING.gravity.z * step) * damping;
    next.x += motion.x * step;
    next.y += motion.y * step;
    next.z += motion.z * step;

    bounceWithin(next, motion, 'y', BALL_TUNING.radius, ARENA_TUNING.height - BALL_TUNING.radius);
    bounceWithin(
      next,
      motion,
      'x',
      -ARENA_TUNING.halfWidth + BALL_TUNING.radius,
      ARENA_TUNING.halfWidth - BALL_TUNING.radius,
    );

    const insideGoalMouth = Math.abs(next.x) <= ARENA_TUNING.goalHalfWidth - BALL_TUNING.radius
      && next.y <= ARENA_TUNING.goalHeight - BALL_TUNING.radius;
    const endLimit = insideGoalMouth
      ? ARENA_TUNING.halfLength
        + ARENA_TUNING.goalTransitionDepth
        + ARENA_TUNING.goalDepth
        - BALL_TUNING.radius
      : ARENA_TUNING.halfLength - BALL_TUNING.radius;
    bounceWithin(next, motion, 'z', -endLimit, endLimit);
    observe?.({ ...next });
  }

  return { ...next };
};

const bounceWithin = (
  position: MutableVec3,
  velocity: MutableVec3,
  axis: 'x' | 'y' | 'z',
  minimum: number,
  maximum: number,
): void => {
  if (position[axis] < minimum) {
    position[axis] = minimum;
    velocity[axis] = Math.abs(velocity[axis]) * BALL_TUNING.restitution;
  } else if (position[axis] > maximum) {
    position[axis] = maximum;
    velocity[axis] = -Math.abs(velocity[axis]) * BALL_TUNING.restitution;
  }
  if (axis === 'y' && position.y === minimum && Math.abs(velocity.y) < MINIMUM_BOUNCE_SPEED) {
    velocity.y = 0;
  }
};
