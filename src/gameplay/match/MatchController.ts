import { MATCH_TUNING } from '../../core/config/MatchTuning';
import type { EventBus } from '../../core/events/EventBus';
import type { GameEventMap } from '../../core/events/GameEvents';
import { clamp } from '../../core/math/MathUtils';
import type { Vec3 } from '../../core/math/Vector3';
import { KickoffManager } from './KickoffManager';
import type { MatchPhase } from './MatchPhase';
import type { MatchState } from './MatchState';
import { ScoreManager } from './ScoreManager';

export interface MatchControllerOptions {
  readonly unlimitedTime?: boolean;
}

export class MatchController {
  private phase: MatchPhase = 'countdown';
  private paused = false;
  private timeRemaining: number = MATCH_TUNING.durationSeconds;
  private phaseTime: number = MATCH_TUNING.countdownSeconds;
  private resetRequested = true;
  private lastGoalTeam: 'azure' | 'coral' | null = null;
  private endsAfterReplay = false;
  private readonly scores = new ScoreManager();
  private readonly kickoff = new KickoffManager();

  constructor(
    private readonly events: EventBus<GameEventMap>,
    private readonly options: MatchControllerOptions = {},
  ) {}

  update(deltaSeconds: number): void {
    if (this.paused || this.phase === 'ended') return;
    if (this.phase === 'countdown') {
      const count = this.kickoff.countdownValue(this.phaseTime);
      if (count > 0 && this.kickoff.shouldAnnounce(count)) this.events.emit('kickoff', { count });
      this.phaseTime -= deltaSeconds;
      if (this.phaseTime <= 0) this.phase = this.timeRemaining <= 0 ? 'overtime' : 'playing';
      return;
    }
    if (this.phase === 'goalExplosion') {
      this.phaseTime -= deltaSeconds;
      if (this.phaseTime <= 0) {
        this.phase = 'replay';
        this.phaseTime = MATCH_TUNING.replaySeconds;
      }
      return;
    }
    if (this.phase === 'replay') {
      this.phaseTime -= deltaSeconds;
      if (this.phaseTime <= 0) this.finishGoalSequence();
      return;
    }
    if (this.phase === 'playing') {
      if (this.options.unlimitedTime) return;
      this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
      if (this.timeRemaining === 0) this.finishRegulation();
    }
  }

  goal(team: 'azure' | 'coral', position: Vec3): boolean {
    if (this.phase !== 'playing' && this.phase !== 'overtime') return false;
    this.endsAfterReplay = this.phase === 'overtime';
    this.lastGoalTeam = team;
    this.scores.add(team);
    const scores = this.scores.scores();
    this.events.emit('goal', { team, position, ...scores });
    this.phase = 'goalExplosion';
    this.phaseTime = MATCH_TUNING.goalExplosionSeconds;
    return true;
  }

  togglePause(): void {
    if (this.phase === 'ended' || this.phase === 'goalExplosion' || this.phase === 'replay') return;
    this.paused = !this.paused;
    this.events.emit('paused', { paused: this.paused });
  }

  consumeResetRequest(): boolean {
    if (!this.resetRequested) return false;
    this.resetRequested = false;
    return true;
  }

  canSimulate(): boolean {
    return !this.paused && (this.phase === 'playing' || this.phase === 'overtime' || this.phase === 'goalExplosion');
  }

  skipReplay(): void {
    if (this.phase === 'replay') this.finishGoalSequence();
  }

  reset(): void {
    this.scores.reset();
    this.timeRemaining = MATCH_TUNING.durationSeconds;
    this.lastGoalTeam = null;
    this.endsAfterReplay = false;
    this.paused = false;
    this.beginKickoff();
  }

  stop(): void {
    const scores = this.scores.scores();
    const winner = scores.azure === scores.coral ? 'draw' : scores.azure > scores.coral ? 'azure' : 'coral';
    this.phase = 'ended';
    this.paused = false;
    this.events.emit('matchEnded', { winner });
  }

  winningTeam(): 'azure' | 'coral' | null {
    const scores = this.scores.scores();
    if (scores.azure === scores.coral) return null;
    return scores.azure > scores.coral ? 'azure' : 'coral';
  }

  state(): MatchState {
    const scores = this.scores.scores();
    return {
      phase: this.phase,
      paused: this.paused,
      timeRemaining: this.timeRemaining,
      countdown: this.phase === 'countdown' ? this.kickoff.countdownValue(this.phaseTime) : 0,
      azureScore: scores.azure,
      coralScore: scores.coral,
      overtime: this.phase === 'overtime',
      replayProgress: this.phase === 'replay'
        ? clamp(1 - this.phaseTime / MATCH_TUNING.replaySeconds, 0, 1)
        : 0,
      lastGoalTeam: this.lastGoalTeam,
    };
  }

  private beginKickoff(): void {
    this.phase = 'countdown';
    this.phaseTime = MATCH_TUNING.countdownSeconds;
    this.resetRequested = true;
    this.kickoff.reset();
  }

  private finishGoalSequence(): void {
    if (this.endsAfterReplay && this.lastGoalTeam) {
      this.phase = 'ended';
      this.events.emit('matchEnded', { winner: this.lastGoalTeam });
      return;
    }
    this.beginKickoff();
  }

  private finishRegulation(): void {
    const scores = this.scores.scores();
    if (scores.azure === scores.coral) {
      this.phase = 'countdown';
      this.phaseTime = MATCH_TUNING.countdownSeconds;
      this.resetRequested = true;
      this.kickoff.reset();
      return;
    }
    this.phase = 'ended';
    this.events.emit('matchEnded', { winner: scores.azure > scores.coral ? 'azure' : 'coral' });
  }
}
