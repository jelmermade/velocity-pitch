import { RUNTIME_CONFIG } from '../../app/RuntimeConfig';
import { MATCH_TUNING } from '../../core/config/MatchTuning';
import { clamp } from '../../core/math/MathUtils';
import { interpolateSnapshots } from '../simulation/SnapshotInterpolator';
import type { SimulationSnapshot } from '../simulation/SimulationSnapshot';

export class GoalReplayBuffer {
  private readonly history: SimulationSnapshot[] = [];
  private playback: readonly SimulationSnapshot[] = [];
  private readonly maximumHistoryFrames = Math.ceil(
    MATCH_TUNING.replayHistorySeconds * RUNTIME_CONFIG.physicsHz,
  );

  record(snapshot: SimulationSnapshot): void {
    this.history.push(snapshot);
    if (this.history.length > this.maximumHistoryFrames) this.history.shift();
  }

  freeze(finalSnapshot: SimulationSnapshot): void {
    this.playback = [...this.history, finalSnapshot];
    this.history.length = 0;
  }

  sample(progress: number): SimulationSnapshot | null {
    if (this.playback.length === 0) return null;
    const framePosition = clamp(progress, 0, 1) * (this.playback.length - 1);
    const previousIndex = Math.floor(framePosition);
    const currentIndex = Math.min(this.playback.length - 1, previousIndex + 1);
    const previous = this.playback[previousIndex];
    const current = this.playback[currentIndex];
    if (!previous || !current) return null;
    return interpolateSnapshots(previous, current, framePosition - previousIndex);
  }

  clear(): void {
    this.history.length = 0;
    this.playback = [];
  }
}
