import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import type { LobbyPlayer, TeamId } from '../../networking/LobbyProtocol';
import type { CarSpawn } from '../car/Car';
import type { TeamSize } from './MatchSettings';

interface NormalizedSpawn {
  readonly x: number;
  readonly z: number;
}

interface KickoffSpawnGroup {
  readonly solo: readonly [NormalizedSpawn];
  readonly duo: readonly [NormalizedSpawn, NormalizedSpawn];
  readonly trio: readonly [NormalizedSpawn, NormalizedSpawn, NormalizedSpawn];
}

const KICKOFF_SPAWN_GROUPS: readonly KickoffSpawnGroup[] = Object.freeze([
  // Wide V
  group(
      [{ x: 0, z: 0.55 }],
      [{ x: -0.30, z: 0.42 }, { x: 0.30, z: 0.42 }],
      [{ x: -0.36, z: 0.34 }, { x: 0, z: 0.56 }, { x: 0.36, z: 0.34 }],
  ),

  // Right-heavy diagonal
  group(
      [{ x: 0.26, z: 0.47 }],
      [{ x: -0.12, z: 0.33 }, { x: 0.28, z: 0.55 }],
      [{ x: -0.28, z: 0.30 }, { x: 0.02, z: 0.43 }, { x: 0.32, z: 0.56 }],
  ),

  // Arrow pointing forward
  group(
      [{ x: 0, z: 0.32 }],
      [{ x: -0.22, z: 0.46 }, { x: 0.22, z: 0.46 }],
      [{ x: -0.34, z: 0.58 }, { x: 0, z: 0.34 }, { x: 0.34, z: 0.58 }],
  ),

  // Left-side stack
  group(
      [{ x: -0.26, z: 0.50 }],
      [{ x: -0.32, z: 0.34 }, { x: 0.12, z: 0.52 }],
      [{ x: -0.34, z: 0.30 }, { x: -0.08, z: 0.44 }, { x: 0.26, z: 0.58 }],
  ),

  // Zig-zag
  group(
      [{ x: -0.12, z: 0.36 }],
      [{ x: 0.18, z: 0.44 }, { x: -0.22, z: 0.56 }],
      [{ x: -0.32, z: 0.32 }, { x: 0.08, z: 0.44 }, { x: 0.34, z: 0.56 }],
  ),

  // Wide arc
  group(
      [{ x: 0, z: 0.58 }],
      [{ x: -0.36, z: 0.46 }, { x: 0.36, z: 0.46 }],
      [{ x: -0.26, z: 0.32 }, { x: 0, z: 0.42 }, { x: 0.26, z: 0.32 }],
  ),
]);

export const KICKOFF_SPAWN_GROUP_COUNT = KICKOFF_SPAWN_GROUPS.length;

export const kickoffSpawnGroupForRoster = (players: readonly LobbyPlayer[]): number => {
  const signature = [...players]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, team }) => `${id}:${team}`)
    .join('|');
  let hash = 0;
  for (const character of signature) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % KICKOFF_SPAWN_GROUP_COUNT;
};

export const kickoffSpawnFor = (
  team: TeamId,
  teamSlot: number,
  teamSize: TeamSize,
  groupIndex: number,
): CarSpawn => {
  const spawnGroup = KICKOFF_SPAWN_GROUPS[positiveModulo(groupIndex, KICKOFF_SPAWN_GROUP_COUNT)]
    ?? KICKOFF_SPAWN_GROUPS[0];
  const spots = teamSize === 1 ? spawnGroup?.solo : teamSize === 2 ? spawnGroup?.duo : spawnGroup?.trio;
  const spot = spots?.[teamSlot] ?? spots?.[0] ?? { x: 0, z: 0.46 };
  const teamDirection = team === 'azure' ? 1 : -1;
  return {
    position: {
      x: spot.x * ARENA_TUNING.halfWidth * teamDirection,
      y: 0.62,
      z: spot.z * ARENA_TUNING.halfLength * teamDirection,
    },
    rotation: team === 'azure'
      ? { x: 0, y: 0, z: 0, w: 1 }
      : { x: 0, y: 1, z: 0, w: 0 },
  };
};

function group(
  solo: KickoffSpawnGroup['solo'],
  duo: KickoffSpawnGroup['duo'],
  trio: KickoffSpawnGroup['trio'],
): KickoffSpawnGroup {
  return Object.freeze({
    solo: Object.freeze(solo),
    duo: Object.freeze(duo),
    trio: Object.freeze(trio),
  });
}

const positiveModulo = (value: number, divisor: number): number => (
  ((Math.floor(value) % divisor) + divisor) % divisor
);
