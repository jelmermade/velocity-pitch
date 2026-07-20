import { describe, expect, it } from 'vitest';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import {
  KICKOFF_SPAWN_GROUP_COUNT,
  kickoffSpawnFor,
  kickoffSpawnGroupForRoster,
} from '../../src/gameplay/match/KickoffSpawns';
import type { LobbyPlayer } from '../../src/networking/LobbyProtocol';

describe('kickoff spawn groups', () => {
  it('offers multiple unique formations for every supported team size', () => {
    for (const teamSize of [1, 2, 3] as const) {
      const formations = Array.from({ length: KICKOFF_SPAWN_GROUP_COUNT }, (_, groupIndex) => (
        Array.from({ length: teamSize }, (__, slot) => {
          const { x, z } = kickoffSpawnFor('azure', slot, teamSize, groupIndex).position;
          return `${x.toFixed(3)}:${z.toFixed(3)}`;
        }).join('|')
      ));

      expect(new Set(formations).size).toBe(KICKOFF_SPAWN_GROUP_COUNT);
    }
  });

  it('mirrors every team slot exactly through midfield', () => {
    for (let groupIndex = 0; groupIndex < KICKOFF_SPAWN_GROUP_COUNT; groupIndex += 1) {
      for (const teamSize of [1, 2, 3] as const) {
        for (let slot = 0; slot < teamSize; slot += 1) {
          const azure = kickoffSpawnFor('azure', slot, teamSize, groupIndex);
          const coral = kickoffSpawnFor('coral', slot, teamSize, groupIndex);

          expect(coral.position.x).toBeCloseTo(-azure.position.x);
          expect(coral.position.z).toBeCloseTo(-azure.position.z);
          expect(coral.position.y).toBe(azure.position.y);
          expect(Math.abs(azure.position.x)).toBeLessThan(ARENA_TUNING.halfWidth);
          expect(Math.abs(azure.position.z)).toBeLessThan(ARENA_TUNING.halfLength);
        }
      }
    }
  });

  it('selects different groups for different team assignments', () => {
    const players: LobbyPlayer[] = [
      { id: 'ace', name: 'Ace', team: 'azure', host: false, bot: true },
      { id: 'atlas', name: 'Atlas', team: 'azure', host: false, bot: true },
      { id: 'ember', name: 'Ember', team: 'coral', host: false, bot: true },
      { id: 'vex', name: 'Vex', team: 'coral', host: false, bot: true },
    ];
    const groups = new Set<number>();

    for (let assignment = 0; assignment < 16; assignment += 1) {
      const assignedPlayers = players.map((player, index): LobbyPlayer => ({
        ...player,
        team: (assignment & (1 << index)) === 0 ? 'azure' : 'coral',
      }));
      groups.add(kickoffSpawnGroupForRoster(assignedPlayers));
    }

    expect(groups.size).toBeGreaterThan(1);
  });
});
