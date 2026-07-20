import type { Quat } from '../../core/math/Quaternion';
import type { Vec3 } from '../../core/math/Vector3';
import type { LobbyPlayer, TeamId } from '../../networking/LobbyProtocol';

const VICTORY_CAR_SPACING = 3.4;

export const VICTORY_CENTER: Readonly<Vec3> = Object.freeze({ x: 0, y: 0.62, z: 0 });
export const VICTORY_ROTATION: Readonly<Quat> = Object.freeze({ x: 0, y: 1, z: 0, w: 0 });

export const createVictoryLineup = (
  players: readonly LobbyPlayer[],
  winningTeam: TeamId | null,
): ReadonlyMap<string, Vec3> => {
  const teamWinners = winningTeam === null
    ? players
    : players.filter(({ team }) => team === winningTeam);
  // Single-player and unbalanced lobbies can end with no car rostered for the scoring team.
  const winners = teamWinners.length > 0 ? teamWinners : players;

  return new Map(winners.map((player, index) => [player.id, {
    x: VICTORY_CENTER.x + (index - (winners.length - 1) / 2) * VICTORY_CAR_SPACING,
    y: VICTORY_CENTER.y,
    z: VICTORY_CENTER.z,
  }]));
};

export const selectVictoryCars = <T>(
  cars: Readonly<Record<string, T>>,
  lineup: ReadonlyMap<string, Vec3>,
): Readonly<Record<string, T>> => Object.fromEntries(
  [...lineup.keys()].flatMap((playerId) => {
    const car = cars[playerId];
    return car === undefined ? [] : [[playerId, car]];
  }),
);
