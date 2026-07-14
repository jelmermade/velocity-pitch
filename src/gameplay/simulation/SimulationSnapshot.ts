import type { BallState } from '../ball/BallState';
import type { CarState } from '../car/CarState';
import type { BoostPickupState } from '../boost/BoostPickup';
import type { MatchState } from '../match/MatchState';

export interface SimulationSnapshot {
  readonly tick: number;
  readonly car: CarState;
  readonly ball: BallState;
  readonly boostPickups: readonly BoostPickupState[];
  readonly match: MatchState;
}
