import { dot, length, normalize, sub, type Vec3 } from '../../core/math/Vector3';
import type { TeamId } from '../../networking/LobbyProtocol';

export interface DemolitionImpactCar {
  readonly playerId: string;
  readonly team: TeamId;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export interface DemolitionResult {
  readonly attackerId: string;
  readonly victimId: string;
}

export const resolveDemolition = (
  left: DemolitionImpactCar,
  right: DemolitionImpactCar,
  maximumSpeed: number,
  speedRatio: number,
  minimumApproach: number,
): DemolitionResult | null => {
  if (left.team === right.team) return null;
  const leftAttack = attackScore(left, right, maximumSpeed * speedRatio, minimumApproach);
  const rightAttack = attackScore(right, left, maximumSpeed * speedRatio, minimumApproach);
  if (leftAttack === null && rightAttack === null) return null;
  if (rightAttack !== null && (leftAttack === null || rightAttack > leftAttack)) {
    return { attackerId: right.playerId, victimId: left.playerId };
  }
  return { attackerId: left.playerId, victimId: right.playerId };
};

const attackScore = (
  attacker: DemolitionImpactCar,
  victim: DemolitionImpactCar,
  requiredSpeed: number,
  minimumApproach: number,
): number | null => {
  const velocity = horizontal(attacker.velocity);
  const speed = length(velocity);
  if (speed < requiredSpeed) return null;
  const approach = dot(normalize(velocity), normalize(horizontal(sub(victim.position, attacker.position))));
  return approach >= minimumApproach ? speed * approach : null;
};

const horizontal = (value: Vec3): Vec3 => ({ x: value.x, y: 0, z: value.z });
