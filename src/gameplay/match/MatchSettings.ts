export interface MatchSettings {
  readonly boostRechargePerSecond: number;
  readonly boostPowerMultiplier: number;
  readonly hitPowerMultiplier: number;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = Object.freeze({
  boostRechargePerSecond: 5,
  boostPowerMultiplier: 1,
  hitPowerMultiplier: 1,
});

export const MATCH_SETTING_LIMITS = Object.freeze({
  boostRechargePerSecond: Object.freeze({ minimum: 0, maximum: 30, step: 1 }),
  boostPowerMultiplier: Object.freeze({ minimum: 1, maximum: 3, step: 0.1 }),
  hitPowerMultiplier: Object.freeze({ minimum: 1, maximum: 3, step: 0.1 }),
});

export const sanitizeMatchSettings = (value: unknown): MatchSettings => {
  const settings = value && typeof value === 'object' ? value as Partial<MatchSettings> : {};
  return {
    boostRechargePerSecond: sanitize(
      settings.boostRechargePerSecond,
      MATCH_SETTING_LIMITS.boostRechargePerSecond,
      DEFAULT_MATCH_SETTINGS.boostRechargePerSecond,
    ),
    boostPowerMultiplier: sanitize(
      settings.boostPowerMultiplier,
      MATCH_SETTING_LIMITS.boostPowerMultiplier,
      DEFAULT_MATCH_SETTINGS.boostPowerMultiplier,
    ),
    hitPowerMultiplier: sanitize(
      settings.hitPowerMultiplier,
      MATCH_SETTING_LIMITS.hitPowerMultiplier,
      DEFAULT_MATCH_SETTINGS.hitPowerMultiplier,
    ),
  };
};

export const carTuningForMatch = (settings: MatchSettings): CarTuning => ({
  ...DEFAULT_CAR_TUNING,
  boostRecharge: settings.boostRechargePerSecond,
  boostForce: DEFAULT_CAR_TUNING.boostForce * settings.boostPowerMultiplier,
});

const sanitize = (
  value: number | undefined,
  limits: { readonly minimum: number; readonly maximum: number; readonly step: number },
  fallback: number,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(limits.maximum, Math.max(limits.minimum, value));
  const stepped = Math.round(clamped / limits.step) * limits.step;
  return Number(stepped.toFixed(2));
};
import { DEFAULT_CAR_TUNING, type CarTuning } from '../../core/config/CarTuning';
