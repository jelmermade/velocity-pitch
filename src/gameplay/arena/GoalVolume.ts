import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import type { Vec3 } from '../../core/math/Vector3';

export const detectScoringTeam = (ballPosition: Vec3): 'azure' | 'coral' | null => {
  const insideMouth = Math.abs(ballPosition.x) < ARENA_TUNING.goalHalfWidth && ballPosition.y < ARENA_TUNING.goalHeight;
  if (!insideMouth) return null;
  if (ballPosition.z > ARENA_TUNING.halfLength + 0.6) return 'azure';
  if (ballPosition.z < -ARENA_TUNING.halfLength - 0.6) return 'coral';
  return null;
};
