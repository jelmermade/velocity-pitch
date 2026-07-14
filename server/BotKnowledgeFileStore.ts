import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  BUILT_IN_BOT_KNOWLEDGE,
  hasBotKnowledgeObservations,
  mergeBotKnowledge,
  normalizeBotKnowledge,
  normalizeBotKnowledgeObservations,
  type BotKnowledge,
  type BotKnowledgeObservations,
} from '../src/gameplay/bots/BotKnowledge';

export const DEFAULT_BOT_KNOWLEDGE_PATH = resolve(
  process.cwd(),
  process.env.BOT_KNOWLEDGE_PATH ?? 'data/bot-knowledge.json',
);

export class BotKnowledgeFileStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path = DEFAULT_BOT_KNOWLEDGE_PATH) {}

  async load(): Promise<BotKnowledge> {
    try {
      const stored = normalizeBotKnowledge(JSON.parse(await readFile(this.path, 'utf8')) as unknown);
      return stored.generation >= BUILT_IN_BOT_KNOWLEDGE.generation
        ? stored
        : BUILT_IN_BOT_KNOWLEDGE;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
        return BUILT_IN_BOT_KNOWLEDGE;
      }
      throw error;
    }
  }

  merge(value: unknown): Promise<BotKnowledge> {
    const observations = normalizeBotKnowledgeObservations(value);
    const operation = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!hasBotKnowledgeObservations(observations)) return current;
      const learned = mergeBotKnowledge(current, observations);
      await this.write(learned);
      return learned;
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async write(knowledge: BotKnowledge): Promise<void> {
    const normalized = normalizeBotKnowledge(knowledge);
    const temporaryPath = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.path);
  }
}

export type { BotKnowledgeObservations };
