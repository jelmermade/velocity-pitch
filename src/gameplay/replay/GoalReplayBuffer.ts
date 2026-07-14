import { RUNTIME_CONFIG } from '../../app/RuntimeConfig';
import { MATCH_TUNING } from '../../core/config/MatchTuning';
import { clamp } from '../../core/math/MathUtils';
import type { CarState } from '../car/CarState';
import { interpolateCarState, interpolateSnapshots } from '../simulation/SnapshotInterpolator';
import type { SimulationSnapshot } from '../simulation/SimulationSnapshot';

export interface GoalReplayFrame {
  readonly snapshot: SimulationSnapshot;
  readonly cars: Readonly<Record<string, CarState>>;
}

export class GoalReplayBuffer {
  private readonly history: GoalReplayFrame[] = [];
  private playback: readonly GoalReplayFrame[] = [];
  private readonly maximumHistoryFrames = Math.ceil(
    MATCH_TUNING.replayHistorySeconds * RUNTIME_CONFIG.physicsHz,
  );

  record(snapshot: SimulationSnapshot, cars: Readonly<Record<string, CarState>>): void {
    this.history.push({ snapshot, cars });
    if (this.history.length > this.maximumHistoryFrames) this.history.shift();
  }

  freeze(finalSnapshot: SimulationSnapshot, cars: Readonly<Record<string, CarState>>): void {
    this.playback = [...this.history, { snapshot: finalSnapshot, cars }];
    this.history.length = 0;
  }

  sample(progress: number): GoalReplayFrame | null {
    if (this.playback.length === 0) return null;
    const framePosition = clamp(progress, 0, 1) * (this.playback.length - 1);
    const previousIndex = Math.floor(framePosition);
    const currentIndex = Math.min(this.playback.length - 1, previousIndex + 1);
    const previous = this.playback[previousIndex];
    const current = this.playback[currentIndex];
    if (!previous || !current) return null;
    const alpha = framePosition - previousIndex;
    return {
      snapshot: interpolateSnapshots(previous.snapshot, current.snapshot, alpha),
      cars: interpolateCars(previous.cars, current.cars, alpha),
    };
  }

  clear(): void {
    this.history.length = 0;
    this.playback = [];
  }
}

const interpolateCars = (
  previous: Readonly<Record<string, CarState>>,
  current: Readonly<Record<string, CarState>>,
  alpha: number,
): Readonly<Record<string, CarState>> => Object.fromEntries(
  Object.entries(current).map(([playerId, state]) => [
    playerId,
    previous[playerId] ? interpolateCarState(previous[playerId], state, alpha) : state,
  ]),
);
