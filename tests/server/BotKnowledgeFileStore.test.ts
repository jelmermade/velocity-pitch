import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmptyBotKnowledgeObservations,
  normalizeBotKnowledge,
} from '../../src/gameplay/bots/BotKnowledge';
import { BotKnowledgeFileStore } from '../../server/BotKnowledgeFileStore';

describe('bot knowledge file store', () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('serializes concurrent observation merges into one JSON history', async () => {
    directory = await mkdtemp(join(tmpdir(), 'velocity-pitch-knowledge-'));
    const path = join(directory, 'bot-knowledge.json');
    const initial = normalizeBotKnowledge({ generation: 10 });
    const store = new BotKnowledgeFileStore(path);
    await store.write(initial);
    const first = createEmptyBotKnowledgeObservations();
    const second = createEmptyBotKnowledgeObservations();
    first.striker.press = { totalValue: 0.4, samples: 4 };
    second.striker.press = { totalValue: 0.3, samples: 3 };

    const [generation11, generation12] = await Promise.all([store.merge(first), store.merge(second)]);
    const stored = normalizeBotKnowledge(JSON.parse(await readFile(path, 'utf8')) as unknown);

    expect(generation11.generation).toBe(11);
    expect(generation12.generation).toBe(12);
    expect(stored.generation).toBe(12);
    expect(stored.roles.striker.press).toEqual({ value: 0.1, samples: 7 });
  });

  it('falls back to bundled knowledge when the shared file is corrupt', async () => {
    directory = await mkdtemp(join(tmpdir(), 'velocity-pitch-knowledge-'));
    const path = join(directory, 'bot-knowledge.json');
    await writeFile(path, '{broken', 'utf8');

    const knowledge = await new BotKnowledgeFileStore(path).load();

    expect(knowledge.generation).toBeGreaterThanOrEqual(0);
    expect(knowledge.schemaVersion).toBe(2);
  });

  it('honors an explicit generation-zero reset instead of bundled history', async () => {
    directory = await mkdtemp(join(tmpdir(), 'velocity-pitch-knowledge-'));
    const path = join(directory, 'bot-knowledge.json');
    await writeFile(path, JSON.stringify(normalizeBotKnowledge({ generation: 0 })), 'utf8');

    const knowledge = await new BotKnowledgeFileStore(path).load();

    expect(knowledge.generation).toBe(0);
    expect(knowledge.roles.striker.balanced).toEqual({ value: 0, samples: 0 });
  });
});
