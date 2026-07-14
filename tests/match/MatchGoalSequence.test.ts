import { describe, expect, it } from 'vitest';
import { MATCH_TUNING } from '../../src/core/config/MatchTuning';
import { EventBus } from '../../src/core/events/EventBus';
import type { GameEventMap } from '../../src/core/events/GameEvents';
import { MatchController } from '../../src/gameplay/match/MatchController';

describe('MatchController goal sequence', () => {
  it('keeps celebration physics active, blocks pause, and allows replay skip', () => {
    const events = new EventBus<GameEventMap>();
    const match = new MatchController(events);
    const goalEvents: GameEventMap['goal'][] = [];
    events.on('goal', (event) => goalEvents.push(event));
    match.consumeResetRequest();
    match.update(MATCH_TUNING.countdownSeconds);

    const position = { x: 0, y: 3.75, z: -51 };
    expect(match.goal('azure', position)).toBe(true);
    expect(match.state().phase).toBe('goalExplosion');
    expect(match.winningTeam()).toBe('azure');
    expect(match.canSimulate()).toBe(true);
    expect(goalEvents).toEqual([{ team: 'azure', azure: 1, coral: 0, position }]);

    match.togglePause();
    expect(match.state().paused).toBe(false);
    match.update(MATCH_TUNING.goalExplosionSeconds);
    expect(match.state().phase).toBe('replay');
    expect(match.canSimulate()).toBe(false);

    match.togglePause();
    expect(match.state().paused).toBe(false);
    match.skipReplay();
    expect(match.state().phase).toBe('countdown');
    expect(match.consumeResetRequest()).toBe(true);
  });

  it('reports replay progress while playback advances', () => {
    const match = new MatchController(new EventBus<GameEventMap>());
    match.update(MATCH_TUNING.countdownSeconds);
    match.goal('coral', { x: 0, y: 3.75, z: 51 });
    match.update(MATCH_TUNING.goalExplosionSeconds);
    match.update(MATCH_TUNING.replaySeconds / 2);

    expect(match.state().phase).toBe('replay');
    expect(match.state().replayProgress).toBeCloseTo(0.5);
  });

  it('resets the full match and allows the host to stop it', () => {
    const events = new EventBus<GameEventMap>();
    const match = new MatchController(events);
    const ended: GameEventMap['matchEnded'][] = [];
    events.on('matchEnded', (event) => ended.push(event));
    match.update(MATCH_TUNING.countdownSeconds);
    match.goal('azure', { x: 0, y: 3.75, z: -51 });

    match.reset();

    expect(match.state()).toMatchObject({
      phase: 'countdown',
      paused: false,
      timeRemaining: MATCH_TUNING.durationSeconds,
      azureScore: 0,
      coralScore: 0,
      lastGoalTeam: null,
    });
    expect(match.winningTeam()).toBeNull();
    expect(match.consumeResetRequest()).toBe(true);

    match.stop();

    expect(match.state().phase).toBe('ended');
    expect(ended).toEqual([{ winner: 'draw' }]);
  });

});
