import { describe, expect, it } from 'vitest';
import {
  createVictoryLineup,
  selectVictoryCars,
  VICTORY_CENTER,
} from '../../src/gameplay/match/VictoryLineup';
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
    expect((lineup.get('azure-1')?.x ?? 0) + (lineup.get('azure-2')?.x ?? 0)).toBe(VICTORY_CENTER.x);
  });

  it('keeps every winning car visible and excludes losing cars', () => {
    const lineup = createVictoryLineup(PLAYERS, 'azure');
    const visibleCars = selectVictoryCars({
      'azure-1': 'first winner',
      'coral-1': 'first loser',
      'azure-2': 'second winner',
      'coral-2': 'second loser',
    }, lineup);

    expect(visibleCars).toEqual({
      'azure-1': 'first winner',
      'azure-2': 'second winner',
    });
  });

  it('centers available cars when the winning team has no rostered player', () => {
    const soloPlayer = PLAYERS.slice(0, 1);
    const lineup = createVictoryLineup(soloPlayer, 'coral');

    expect(lineup.get('azure-1')).toEqual(VICTORY_CENTER);
  });
});
