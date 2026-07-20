import { GAMEPLAY_SCALE } from './GameplayScale';

const scale = GAMEPLAY_SCALE.arenaScale;
const scaled = (value: number): number => value * scale;

export const ARENA_TUNING = Object.freeze({
  scale,
  halfWidth: scaled(48),
  halfLength: scaled(60),
  height: scaled(24),
  goalHalfWidth: scaled(10.5),
  goalHeight: scaled(8),
  goalDepth: scaled(10),
  goalTransitionOuterX: scaled(18),
  goalTransitionDepth: scaled(2.5),
  goalTransitionRadius: scaled(1.5),
  goalTransitionSegments: 14,
  goalWallCurveSegments: 12,
  goalBackCornerRadius: scaled(2),
  cornerChamferLength: scaled(10),
  cornerFilletRadius: scaled(1.75),
  cornerFilletSegments: 5,
  floorWallCurveRadius: scaled(2.4),
  floorWallCurveSegments: Math.max(32, Math.ceil(32 * scale)),
});
