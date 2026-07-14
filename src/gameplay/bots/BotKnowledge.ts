import knowledgeData from './BotKnowledgeData.json';

export type BotRole = 'striker' | 'defender';
export type BotPolicy = 'balanced' | 'press' | 'rotate';

export interface BotPolicyKnowledge {
  readonly value: number;
  readonly samples: number;
}

export interface BotKnowledge {
  readonly schemaVersion: 1;
  readonly generation: number;
  readonly updatedAt: string;
  readonly roles: Readonly<Record<BotRole, Readonly<Record<BotPolicy, BotPolicyKnowledge>>>>;
}

export interface BotPolicyObservation {
  readonly totalValue: number;
  readonly samples: number;
}

export type BotKnowledgeObservations = Record<BotRole, Record<BotPolicy, BotPolicyObservation>>;

export const BOT_ROLES: readonly BotRole[] = ['striker', 'defender'];
export const BOT_POLICY_ORDER: readonly BotPolicy[] = ['balanced', 'press', 'rotate'];
const MAXIMUM_HISTORY_WEIGHT = 500;
const MAXIMUM_OBSERVATION_SAMPLES = 1_000;

export const normalizeBotKnowledge = (value: unknown): BotKnowledge => {
  const source = asRecord(value);
  const roles = asRecord(source.roles);
  return {
    schemaVersion: 1,
    generation: nonNegativeInteger(source.generation),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date(0).toISOString(),
    roles: {
      striker: normalizeRole(asRecord(roles.striker)),
      defender: normalizeRole(asRecord(roles.defender)),
    },
  };
};

export const createEmptyBotKnowledgeObservations = (): BotKnowledgeObservations => ({
  striker: createEmptyRoleObservations(),
  defender: createEmptyRoleObservations(),
});

export const normalizeBotKnowledgeObservations = (value: unknown): BotKnowledgeObservations => {
  const source = asRecord(value);
  const roles = source.roles === undefined ? source : asRecord(source.roles);
  return {
    striker: normalizeRoleObservations(asRecord(roles.striker)),
    defender: normalizeRoleObservations(asRecord(roles.defender)),
  };
};

export const hasBotKnowledgeObservations = (observations: BotKnowledgeObservations): boolean => (
  BOT_ROLES.some((role) => BOT_POLICY_ORDER.some((policy) => observations[role][policy].samples > 0))
);

export const mergeBotKnowledge = (
  current: BotKnowledge,
  observations: BotKnowledgeObservations,
  updatedAt = new Date().toISOString(),
): BotKnowledge => ({
  schemaVersion: 1,
  generation: current.generation + 1,
  updatedAt,
  roles: {
    striker: mergeRole(current.roles.striker, observations.striker),
    defender: mergeRole(current.roles.defender, observations.defender),
  },
});

export const selectBotPolicy = (knowledge: BotKnowledge, role: BotRole): BotPolicy => (
  BOT_POLICY_ORDER.reduce((best, policy) => (
    knowledge.roles[role][policy].value > knowledge.roles[role][best].value ? policy : best
  ), 'balanced')
);

const mergeRole = (
  current: Readonly<Record<BotPolicy, BotPolicyKnowledge>>,
  observations: Readonly<Record<BotPolicy, BotPolicyObservation>>,
): Readonly<Record<BotPolicy, BotPolicyKnowledge>> => Object.fromEntries(
  BOT_POLICY_ORDER.map((policy) => {
    const existing = current[policy];
    const observation = observations[policy];
    const oldWeight = Math.min(existing.samples, MAXIMUM_HISTORY_WEIGHT);
    const newSamples = nonNegativeInteger(observation.samples);
    const totalWeight = oldWeight + newSamples;
    const value = totalWeight === 0
      ? existing.value
      : (existing.value * oldWeight + finiteNumber(observation.totalValue)) / totalWeight;
    return [policy, {
      value: round(value),
      samples: existing.samples + newSamples,
    }];
  }),
) as Record<BotPolicy, BotPolicyKnowledge>;

const normalizeRole = (value: Record<string, unknown>): Readonly<Record<BotPolicy, BotPolicyKnowledge>> => (
  Object.fromEntries(BOT_POLICY_ORDER.map((policy) => {
    const entry = asRecord(value[policy]);
    return [policy, {
      value: finiteNumber(entry.value),
      samples: nonNegativeInteger(entry.samples),
    }];
  })) as Record<BotPolicy, BotPolicyKnowledge>
);

const createEmptyRoleObservations = (): Record<BotPolicy, BotPolicyObservation> => ({
  balanced: { totalValue: 0, samples: 0 },
  press: { totalValue: 0, samples: 0 },
  rotate: { totalValue: 0, samples: 0 },
});

const normalizeRoleObservations = (
  value: Record<string, unknown>,
): Record<BotPolicy, BotPolicyObservation> => Object.fromEntries(
  BOT_POLICY_ORDER.map((policy) => {
    const entry = asRecord(value[policy]);
    const samples = Math.min(nonNegativeInteger(entry.samples), MAXIMUM_OBSERVATION_SAMPLES);
    return [policy, {
      totalValue: clamp(finiteNumber(entry.totalValue), -samples, samples),
      samples,
    }];
  }),
) as Record<BotPolicy, BotPolicyObservation>;

const asRecord = (value: unknown): Record<string, unknown> => (
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
);

const finiteNumber = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
);

const nonNegativeInteger = (value: unknown): number => Math.max(0, Math.floor(finiteNumber(value)));

const round = (value: number): number => Number(value.toFixed(6));

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);

export const BUILT_IN_BOT_KNOWLEDGE = normalizeBotKnowledge(knowledgeData);
