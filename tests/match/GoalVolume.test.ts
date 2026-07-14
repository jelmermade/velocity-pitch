import { describe, expect, it } from 'vitest';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { detectScoringTeam } from '../../src/gameplay/arena/GoalVolume';

describe('goal detection', () => {
  it('scores only after the ball crosses inside a goal mouth', () => {
    expect(detectScoringTeam({ x: 0, y: 2, z: ARENA_TUNING.halfLength + 1 })).toBe('azure');
    expect(detectScoringTeam({ x: 0, y: 2, z: -ARENA_TUNING.halfLength - 1 })).toBe('coral');
    expect(detectScoringTeam({ x: ARENA_TUNING.goalHalfWidth + 1, y: 2, z: ARENA_TUNING.halfLength + 1 })).toBeNull();
  });
});
