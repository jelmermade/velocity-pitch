import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import type { Vec3 } from '../../core/math/Vector3';
import { GOALS } from './ArenaDefinition';

export const detectScoringTeam = (ballPosition: Vec3): 'azure' | 'coral' | null => {
  const insideMouth = Math.abs(ballPosition.x) < ARENA_TUNING.goalHalfWidth && ballPosition.y < ARENA_TUNING.goalHeight;
  if (!insideMouth) return null;
  const goalLine = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;
  const defendingEnd = ballPosition.z > goalLine + 0.6
    ? 'north'
    : ballPosition.z < -goalLine - 0.6 ? 'south' : null;
  return GOALS.find((goal) => goal.defendingEnd === defendingEnd)?.teamScored ?? null;
};
