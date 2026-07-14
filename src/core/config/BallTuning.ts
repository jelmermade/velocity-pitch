import { GAMEPLAY_SCALE } from './GameplayScale';

const size = GAMEPLAY_SCALE.ballSize;

export const BALL_TUNING = Object.freeze({
  size,
  radius: 1.35 * size,
  mass: 32 * size ** 3,
  restitution: 0.72,
  friction: 0.45,
});
