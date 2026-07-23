import { describe, expect, it } from 'vitest';
import {
  createEmptyBotKnowledgeObservations,
  mergeBotKnowledge,
  normalizeBotKnowledge,
  normalizeBotKnowledgeObservations,
  selectBotPolicy,
} from '../../src/gameplay/bots/BotKnowledge';

describe('bot knowledge', () => {
  it('merges policy observations with existing weighted history', () => {
    const current = normalizeBotKnowledge({
      generation: 4,
      updatedAt: '2026-01-01T00:00:00.000Z',
      roles: {
        striker: {
          balanced: { value: 0.1, samples: 100 },
          press: { value: 0, samples: 0 },
          rotate: { value: 0, samples: 0 },
        },
      },
    });
    const observations = createEmptyBotKnowledgeObservations();
    observations.striker.balanced = { totalValue: 0.6, samples: 2 };

    const learned = mergeBotKnowledge(current, observations, '2026-02-01T00:00:00.000Z');

    expect(learned.generation).toBe(5);
    expect(learned.roles.striker.balanced).toEqual({ value: 0.103922, samples: 102 });
    expect(selectBotPolicy(learned, 'striker')).toBe('balanced');
  });

  it('bounds shared observation payloads before merging them', () => {
    const observations = normalizeBotKnowledgeObservations({
      roles: {
        striker: {
          balanced: { totalValue: 4_000, samples: 8_000 },
          press: { totalValue: -4_000, samples: 25 },
        },
      },
    });

    expect(observations.striker.balanced).toEqual({ totalValue: 1_000, samples: 1_000 });
    expect(observations.striker.press).toEqual({ totalValue: -25, samples: 25 });
    expect(observations.defender.rotate).toEqual({ totalValue: 0, samples: 0 });
  });

  it('migrates v1 knowledge and learns contact techniques independently', () => {
    const current = normalizeBotKnowledge({
      schemaVersion: 1,
      generation: 202,
      roles: {
        striker: { balanced: { value: 0.2, samples: 20 } },
      },
    });
    const observations = createEmptyBotKnowledgeObservations();
    observations.techniques.aerial.safe = { totalValue: 2.4, samples: 3 };

    const learned = mergeBotKnowledge(current, observations, '2026-07-22T00:00:00.000Z');

    expect(current.schemaVersion).toBe(2);
    expect(current.roles.striker.balanced).toEqual({ value: 0.2, samples: 20 });
    expect(learned.techniques.aerial.safe).toEqual({ value: 0.8, samples: 3 });
    expect(learned.techniques.ground.balanced).toEqual({ value: 0, samples: 0 });
  });
});
