import { describe, expect, it } from 'vitest';
import {
  selectBotTrainingLeader,
  type BotTrainingEntry,
  type BotTrainingState,
} from '../../src/gameplay/bots/BotTrainingState';

describe('bot training spectator', () => {
  it('selects the highest-scoring bot', () => {
    const state = trainingState([
      entry('ace', 12),
      entry('ember', 28),
      entry('nova', 19),
    ]);

    expect(selectBotTrainingLeader(state, 'ace')).toBe('ember');
  });

  it('retains the current bot while it is tied for the highest score', () => {
    const state = trainingState([
      entry('ace', 28),
      entry('ember', 28),
      entry('nova', 19),
    ]);

    expect(selectBotTrainingLeader(state, 'ember')).toBe('ember');
    expect(selectBotTrainingLeader(state, 'nova')).toBe('ace');
  });

  it('returns null when no bots are available', () => {
    expect(selectBotTrainingLeader(trainingState([]))).toBeNull();
  });
});

const trainingState = (entries: readonly BotTrainingEntry[]): BotTrainingState => ({
  tick: 0,
  knowledgeGeneration: 0,
  entries,
});

const entry = (playerId: string, points: number): BotTrainingEntry => ({
  playerId,
  playerName: playerId,
  team: 'azure',
  role: 'striker',
  points,
  policy: 'balanced',
  policyValue: 0,
  policyValues: { balanced: 0, press: 0, rotate: 0 },
  policySamples: { balanced: 0, press: 0, rotate: 0 },
  lastReward: 0,
});
