import type { Vec3 } from '../../core/math/Vector3';
import type { LobbyPlayer, TeamId } from '../../networking/LobbyProtocol';

const VICTORY_CAR_SPACING = 3.4;
const VICTORY_CAR_HEIGHT = 0.72;

export const createVictoryLineup = (
  players: readonly LobbyPlayer[],
  winningTeam: TeamId | null,
): ReadonlyMap<string, Vec3> => {
  const winners = winningTeam === null
    ? players
    : players.filter(({ team }) => team === winningTeam);

  return new Map(winners.map((player, index) => [player.id, {
    x: (index - (winners.length - 1) / 2) * VICTORY_CAR_SPACING,
    y: VICTORY_CAR_HEIGHT,
    z: 0,
  }]));
};
