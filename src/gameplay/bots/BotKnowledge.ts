import knowledgeData from './BotKnowledgeData.json';

export type BotRole = 'striker' | 'defender';
export type BotPolicy = 'balanced' | 'press' | 'rotate';
export type BotTechniqueKind = 'ground' | 'aerial';
export type BotTechnique = 'balanced' | 'safe' | 'aggressive';

export interface BotPolicyKnowledge {
  readonly value: number;
  readonly samples: number;
}

export interface BotKnowledge {
  readonly schemaVersion: 2;
  readonly generation: number;
  readonly updatedAt: string;
  readonly roles: Readonly<Record<BotRole, Readonly<Record<BotPolicy, BotPolicyKnowledge>>>>;
  readonly techniques: Readonly<
    Record<BotTechniqueKind, Readonly<Record<BotTechnique, BotPolicyKnowledge>>>
  >;
}

export interface BotPolicyObservation {
  readonly totalValue: number;
  readonly samples: number;
}

export interface BotKnowledgeObservations {
  readonly striker: Record<BotPolicy, BotPolicyObservation>;
  readonly defender: Record<BotPolicy, BotPolicyObservation>;
  readonly techniques: Record<
    BotTechniqueKind,
    Record<BotTechnique, BotPolicyObservation>
  >;
}

export const BOT_ROLES: readonly BotRole[] = ['striker', 'defender'];
export const BOT_POLICY_ORDER: readonly BotPolicy[] = ['balanced', 'press', 'rotate'];
export const BOT_TECHNIQUE_KINDS: readonly BotTechniqueKind[] = ['ground', 'aerial'];
export const BOT_TECHNIQUE_ORDER: readonly BotTechnique[] = ['balanced', 'safe', 'aggressive'];
const MAXIMUM_HISTORY_WEIGHT = 500;
const MAXIMUM_OBSERVATION_SAMPLES = 1_000;

export const normalizeBotKnowledge = (value: unknown): BotKnowledge => {
  const source = asRecord(value);
  const roles = asRecord(source.roles);
  const techniques = asRecord(source.techniques);
  return {
    schemaVersion: 2,
    generation: nonNegativeInteger(source.generation),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date(0).toISOString(),
    roles: {
      striker: normalizeRole(asRecord(roles.striker)),
      defender: normalizeRole(asRecord(roles.defender)),
    },
    techniques: {
      ground: normalizeTechnique(asRecord(techniques.ground)),
      aerial: normalizeTechnique(asRecord(techniques.aerial)),
    },
  };
};

export const createEmptyBotKnowledgeObservations = (): BotKnowledgeObservations => ({
  striker: createEmptyRoleObservations(),
  defender: createEmptyRoleObservations(),
  techniques: {
    ground: createEmptyTechniqueObservations(),
    aerial: createEmptyTechniqueObservations(),
  },
});

export const normalizeBotKnowledgeObservations = (value: unknown): BotKnowledgeObservations => {
  const source = asRecord(value);
  // The fallback keeps schema-v1 clients useful during a rolling deployment.
  const roles = source.roles === undefined ? source : asRecord(source.roles);
  const techniques = asRecord(source.techniques);
  return {
    striker: normalizeRoleObservations(asRecord(roles.striker)),
    defender: normalizeRoleObservations(asRecord(roles.defender)),
    techniques: {
      ground: normalizeTechniqueObservations(asRecord(techniques.ground)),
      aerial: normalizeTechniqueObservations(asRecord(techniques.aerial)),
    },
  };
};

export const hasBotKnowledgeObservations = (observations: BotKnowledgeObservations): boolean => (
  BOT_ROLES.some((role) => BOT_POLICY_ORDER.some((policy) => (
    observations[role][policy].samples > 0
  )))
  || BOT_TECHNIQUE_KINDS.some((kind) => BOT_TECHNIQUE_ORDER.some((technique) => (
    observations.techniques[kind][technique].samples > 0
  )))
);

export const mergeBotKnowledge = (
  current: BotKnowledge,
  observations: BotKnowledgeObservations,
  updatedAt = new Date().toISOString(),
): BotKnowledge => ({
  schemaVersion: 2,
  generation: current.generation + 1,
  updatedAt,
  roles: {
    striker: mergeRole(current.roles.striker, observations.striker),
    defender: mergeRole(current.roles.defender, observations.defender),
  },
  techniques: {
    ground: mergeTechnique(current.techniques.ground, observations.techniques.ground),
    aerial: mergeTechnique(current.techniques.aerial, observations.techniques.aerial),
  },
});

export const selectBotPolicy = (knowledge: BotKnowledge, role: BotRole): BotPolicy => (
  BOT_POLICY_ORDER.reduce((best, policy) => (
    knowledge.roles[role][policy].value > knowledge.roles[role][best].value ? policy : best
  ), 'balanced')
);

export const selectBotTechnique = (
  knowledge: BotKnowledge,
  kind: BotTechniqueKind,
): BotTechnique => BOT_TECHNIQUE_ORDER.reduce((best, technique) => (
  knowledge.techniques[kind][technique].value > knowledge.techniques[kind][best].value
    ? technique
    : best
), 'balanced');

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

const normalizeTechnique = (
  value: Record<string, unknown>,
): Readonly<Record<BotTechnique, BotPolicyKnowledge>> => Object.fromEntries(
  BOT_TECHNIQUE_ORDER.map((technique) => {
    const entry = asRecord(value[technique]);
    return [technique, {
      value: finiteNumber(entry.value),
      samples: nonNegativeInteger(entry.samples),
    }];
  }),
) as Record<BotTechnique, BotPolicyKnowledge>;

const mergeTechnique = (
  current: Readonly<Record<BotTechnique, BotPolicyKnowledge>>,
  observations: Readonly<Record<BotTechnique, BotPolicyObservation>>,
): Readonly<Record<BotTechnique, BotPolicyKnowledge>> => Object.fromEntries(
  BOT_TECHNIQUE_ORDER.map((technique) => {
    const existing = current[technique];
    const observation = observations[technique];
    const oldWeight = Math.min(existing.samples, MAXIMUM_HISTORY_WEIGHT);
    const newSamples = nonNegativeInteger(observation.samples);
    const totalWeight = oldWeight + newSamples;
    const value = totalWeight === 0
      ? existing.value
      : (existing.value * oldWeight + finiteNumber(observation.totalValue)) / totalWeight;
    return [technique, {
      value: round(value),
      samples: existing.samples + newSamples,
    }];
  }),
) as Record<BotTechnique, BotPolicyKnowledge>;

const createEmptyRoleObservations = (): Record<BotPolicy, BotPolicyObservation> => ({
  balanced: { totalValue: 0, samples: 0 },
  press: { totalValue: 0, samples: 0 },
  rotate: { totalValue: 0, samples: 0 },
});

const createEmptyTechniqueObservations = (): Record<BotTechnique, BotPolicyObservation> => ({
  balanced: { totalValue: 0, samples: 0 },
  safe: { totalValue: 0, samples: 0 },
  aggressive: { totalValue: 0, samples: 0 },
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

const normalizeTechniqueObservations = (
  value: Record<string, unknown>,
): Record<BotTechnique, BotPolicyObservation> => Object.fromEntries(
  BOT_TECHNIQUE_ORDER.map((technique) => {
    const entry = asRecord(value[technique]);
    const samples = Math.min(nonNegativeInteger(entry.samples), MAXIMUM_OBSERVATION_SAMPLES);
    return [technique, {
      totalValue: clamp(finiteNumber(entry.totalValue), -samples, samples),
      samples,
    }];
  }),
) as Record<BotTechnique, BotPolicyObservation>;

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
