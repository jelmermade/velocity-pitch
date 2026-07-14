import { describe, expect, it } from 'vitest';
import {
  carTuningForMatch,
  DEFAULT_MATCH_SETTINGS,
  sanitizeMatchSettings,
} from '../../src/gameplay/match/MatchSettings';

describe('match settings', () => {
  it('sanitizes host-provided values to supported slider ranges', () => {
    expect(sanitizeMatchSettings({
      boostRechargePerSecond: 999,
      boostPowerMultiplier: 1.26,
      hitPowerMultiplier: -4,
    })).toEqual({
      boostRechargePerSecond: 30,
      boostPowerMultiplier: 1.3,
      hitPowerMultiplier: 1,
    });
  });

  it('uses defaults for malformed settings', () => {
    expect(sanitizeMatchSettings({ boostPowerMultiplier: Number.NaN })).toEqual(DEFAULT_MATCH_SETTINGS);
  });

  it('maps match sliders to car recharge and thrust tuning', () => {
    const tuning = carTuningForMatch({
      boostRechargePerSecond: 18,
      boostPowerMultiplier: 2.5,
      hitPowerMultiplier: 1,
    });

    expect(tuning.boostRecharge).toBe(18);
    expect(tuning.boostForce).toBe(60_000);
  });
});
