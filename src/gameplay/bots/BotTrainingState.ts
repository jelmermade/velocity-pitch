import type { TeamId } from '../../networking/LobbyProtocol';
import type { BotPolicy, BotRole } from './BotController';
import type { BotTechnique, BotTechniqueKind } from './BotKnowledge';

export interface BotTrainingEntry {
  readonly playerId: string;
  readonly playerName: string;
  readonly team: TeamId;
  readonly role: BotRole;
  readonly points: number;
  readonly policy: BotPolicy;
  readonly policyValue: number;
  readonly policyValues: Readonly<Record<BotPolicy, number>>;
  readonly policySamples: Readonly<Record<BotPolicy, number>>;
  readonly techniques?: Readonly<Record<BotTechniqueKind, BotTechnique>>;
  readonly techniqueValues?: Readonly<
    Record<BotTechniqueKind, Readonly<Record<BotTechnique, number>>>
  >;
  readonly techniqueSamples?: Readonly<
    Record<BotTechniqueKind, Readonly<Record<BotTechnique, number>>>
  >;
  readonly lastReward: number;
}

export interface BotTrainingState {
  readonly tick: number;
  readonly knowledgeGeneration: number;
  readonly entries: readonly BotTrainingEntry[];
}

export const selectBotTrainingLeader = (
  state: BotTrainingState,
  currentPlayerId: string | null = null,
): string | null => {
  const highestScore = state.entries.reduce(
    (highest, entry) => Math.max(highest, entry.points),
    Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(highestScore)) return null;
  const current = state.entries.find(({ playerId }) => playerId === currentPlayerId);
  if (current?.points === highestScore) return current.playerId;
  return state.entries.find(({ points }) => points === highestScore)?.playerId ?? null;
};
