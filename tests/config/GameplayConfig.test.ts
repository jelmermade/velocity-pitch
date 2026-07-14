import { describe, expect, it } from 'vitest';
import { DEFAULT_CAR_TUNING } from '../../src/core/config/CarTuning';
import { VEHICLE_CONFIG } from '../../src/core/config/GameplayScale';

describe('gameplay vehicle configuration', () => {
  it('maps every configurable performance value into car tuning', () => {
    expect(DEFAULT_CAR_TUNING.maximumGroundDriveSpeed).toBe(VEHICLE_CONFIG.driveTopSpeed);
    expect(DEFAULT_CAR_TUNING.maximumGroundReverseSpeed).toBe(VEHICLE_CONFIG.reverseTopSpeed);
    expect(DEFAULT_CAR_TUNING.engineForce).toBe(9_500 * VEHICLE_CONFIG.accelerationMultiplier);
    expect(DEFAULT_CAR_TUNING.reverseForce).toBe(6_500 * VEHICLE_CONFIG.reverseAccelerationMultiplier);
    expect(DEFAULT_CAR_TUNING.brakeForce).toBe(18_000 * VEHICLE_CONFIG.brakeMultiplier);
    expect(DEFAULT_CAR_TUNING.maximumSteerAngle).toBe(0.265 * VEHICLE_CONFIG.steeringMultiplier);
    expect(DEFAULT_CAR_TUNING.maximumGroundBoostSpeed).toBe(VEHICLE_CONFIG.boostTopSpeed);
    expect(DEFAULT_CAR_TUNING.boostForce).toBe(24_000 * VEHICLE_CONFIG.boostAccelerationMultiplier);
    expect(DEFAULT_CAR_TUNING.boostConsumption).toBe(VEHICLE_CONFIG.boostConsumptionPerSecond);
    expect(DEFAULT_CAR_TUNING.boostRecharge).toBe(VEHICLE_CONFIG.boostRechargePerSecond);
    expect(DEFAULT_CAR_TUNING.jumpImpulse).toBe(5_700 * VEHICLE_CONFIG.jumpPowerMultiplier);
    expect(DEFAULT_CAR_TUNING.dodgeImpulse).toBe(4_500 * VEHICLE_CONFIG.dodgePowerMultiplier);
    expect(DEFAULT_CAR_TUNING.aerialTorque).toBe(12_000 * VEHICLE_CONFIG.aerialControlMultiplier);
  });
});
