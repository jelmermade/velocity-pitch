import { describe, expect, it } from 'vitest';
import { createVictoryLineup } from '../../src/gameplay/match/VictoryLineup';
import type { LobbyPlayer } from '../../src/networking/LobbyProtocol';

const PLAYERS: readonly LobbyPlayer[] = [
  { id: 'azure-1', name: 'Azure 1', team: 'azure', host: true },
  { id: 'coral-1', name: 'Coral 1', team: 'coral', host: false },
  { id: 'azure-2', name: 'Azure 2', team: 'azure', host: false },
  { id: 'coral-2', name: 'Coral 2', team: 'coral', host: false },
];

describe('victory lineup', () => {
  it('centers only the winning team at midfield', () => {
    const lineup = createVictoryLineup(PLAYERS, 'azure');

    expect([...lineup.keys()]).toEqual(['azure-1', 'azure-2']);
    expect(lineup.get('azure-1')).toEqual({ x: -1.7, y: 0.72, z: 0 });
    expect(lineup.get('azure-2')).toEqual({ x: 1.7, y: 0.72, z: 0 });
    expect(lineup.has('coral-1')).toBe(false);
    expect(lineup.has('coral-2')).toBe(false);
  });
});
