import type { BallState } from '../ball/BallState';
import type { CarState } from '../car/CarState';
import type { BoostPickupState } from '../boost/BoostPickup';
import type { MatchState } from '../match/MatchState';
import type { Vec3 } from '../../core/math/Vector3';
import type { TeamId } from '../../networking/LobbyProtocol';

export interface DemolitionSnapshot {
  readonly sequence: number;
  readonly attackerId: string;
  readonly victimId: string;
  readonly attackerTeam: TeamId;
  readonly victimTeam: TeamId;
  readonly position: Vec3;
}

export interface SimulationSnapshot {
  readonly tick: number;
  readonly car: CarState;
  readonly ball: BallState;
  readonly boostPickups: readonly BoostPickupState[];
  readonly match: MatchState;
  readonly demolition?: DemolitionSnapshot;
}
