import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILT_IN_BOT_KNOWLEDGE,
  createEmptyBotKnowledgeObservations,
  normalizeBotKnowledge,
} from '../../src/gameplay/bots/BotKnowledge';

describe('shared bot knowledge client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost', origin: 'http://localhost' } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads a newer shared generation', async () => {
    const shared = normalizeBotKnowledge({
      ...BUILT_IN_BOT_KNOWLEDGE,
      generation: BUILT_IN_BOT_KNOWLEDGE.generation + 1,
    });
    const request = vi.fn((): Promise<Pick<Response, 'json' | 'ok'>> => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(shared),
    }));
    const { loadSharedBotKnowledge } = await import('../../src/networking/BotKnowledgeClient');

    await expect(loadSharedBotKnowledge(request, '/knowledge')).resolves.toEqual(shared);
    expect(request).toHaveBeenCalledWith('/knowledge', { headers: { Accept: 'application/json' } });
  });

  it('submits observations without uploading a full model snapshot', async () => {
    const observations = createEmptyBotKnowledgeObservations();
    observations.defender.balanced = { totalValue: 0.2, samples: 4 };
    const learned = normalizeBotKnowledge({
      ...BUILT_IN_BOT_KNOWLEDGE,
      generation: BUILT_IN_BOT_KNOWLEDGE.generation + 1,
    });
    const request = vi.fn((): Promise<Pick<Response, 'json' | 'ok'>> => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(learned),
    }));
    const { submitSharedBotKnowledge } = await import('../../src/networking/BotKnowledgeClient');

    await expect(submitSharedBotKnowledge(observations, request, '/observations')).resolves.toEqual(learned);
    expect(request).toHaveBeenCalledWith('/observations', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(observations),
      keepalive: true,
    }));
  });

  it('falls back to bundled knowledge when the service is unavailable', async () => {
    const request = vi.fn(() => Promise.reject(new Error('offline')));
    const { loadSharedBotKnowledge } = await import('../../src/networking/BotKnowledgeClient');

    await expect(loadSharedBotKnowledge(request, '/knowledge')).resolves.toEqual(BUILT_IN_BOT_KNOWLEDGE);
  });
});
