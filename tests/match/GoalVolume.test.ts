import { describe, expect, it } from 'vitest';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { GOALS } from '../../src/gameplay/arena/ArenaDefinition';
import { detectScoringTeam } from '../../src/gameplay/arena/GoalVolume';

describe('goal detection', () => {
  it('awards the attacking team after the ball crosses inside a goal mouth', () => {
    expect(detectScoringTeam({ x: 0, y: 2, z: ARENA_TUNING.halfLength + 1 })).toBe('coral');
    expect(detectScoringTeam({ x: 0, y: 2, z: -ARENA_TUNING.halfLength - 1 })).toBe('azure');
    expect(detectScoringTeam({ x: ARENA_TUNING.goalHalfWidth + 1, y: 2, z: ARENA_TUNING.halfLength + 1 })).toBeNull();
  });

  it('defines each colored goal as defended by that team', () => {
    expect(GOALS.find(({ defendingTeam }) => defendingTeam === 'azure')).toMatchObject({
      teamScored: 'coral',
      defendingEnd: 'north',
    });
    expect(GOALS.find(({ defendingTeam }) => defendingTeam === 'coral')).toMatchObject({
      teamScored: 'azure',
      defendingEnd: 'south',
    });
  });
});
