import type { MatchPhase } from './MatchPhase';

export interface MatchState {
  readonly phase: MatchPhase;
  readonly paused: boolean;
  readonly timeRemaining: number;
  readonly countdown: number;
  readonly azureScore: number;
  readonly coralScore: number;
  readonly overtime: boolean;
  readonly replayProgress: number;
  readonly lastGoalTeam: 'azure' | 'coral' | null;
}
