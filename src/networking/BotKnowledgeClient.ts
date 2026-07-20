import {
  BUILT_IN_BOT_KNOWLEDGE,
  normalizeBotKnowledge,
  type BotKnowledge,
  type BotKnowledgeObservations,
} from '../gameplay/bots/BotKnowledge';
import { NETWORK_CONFIG } from './NetworkConfig';

type KnowledgeFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'json' | 'ok'>>;

export const loadSharedBotKnowledge = async (
  request: KnowledgeFetch = fetch,
  url = NETWORK_CONFIG.botKnowledgeUrl,
): Promise<BotKnowledge> => {
  try {
    const response = await request(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return BUILT_IN_BOT_KNOWLEDGE;
    return normalizeBotKnowledge(await response.json());
  } catch {
    return BUILT_IN_BOT_KNOWLEDGE;
  }
};

export const submitSharedBotKnowledge = async (
  observations: BotKnowledgeObservations,
  request: KnowledgeFetch = fetch,
  url = `${NETWORK_CONFIG.botKnowledgeUrl}/observations`,
): Promise<BotKnowledge | null> => {
  try {
    const response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(observations),
      keepalive: true,
    });
    return response.ok ? normalizeBotKnowledge(await response.json()) : null;
  } catch {
    return null;
  }
};
