import { afterEach, describe, expect, it, vi } from 'vitest';
import { carTuningForVehicleConfig, DEFAULT_CAR_TUNING } from '../../src/core/config/CarTuning';
import {
  clearRuntimeGameplayConfig,
  readRuntimeGameplayConfig,
  saveRuntimeGameplayConfig,
  sanitizeVehicleConfig,
  VEHICLE_CONFIG,
} from '../../src/core/config/GameplayScale';

describe('gameplay vehicle configuration', () => {
  afterEach(() => vi.unstubAllGlobals());
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

  it('builds independent temporary tuning without changing file defaults', () => {
    const temporary = sanitizeVehicleConfig({
      ...VEHICLE_CONFIG,
      driveTopSpeed: 31,
      accelerationMultiplier: 1.75,
      boostTopSpeed: 42,
      jumpPowerMultiplier: 1.4,
    });
    const tuning = carTuningForVehicleConfig(temporary);

    expect(tuning.maximumGroundDriveSpeed).toBe(31);
    expect(tuning.engineForce).toBe(9_500 * 1.75);
    expect(tuning.maximumGroundBoostSpeed).toBe(42);
    expect(tuning.jumpImpulse).toBe(5_700 * 1.4);
    expect(DEFAULT_CAR_TUNING.maximumGroundDriveSpeed).toBe(VEHICLE_CONFIG.driveTopSpeed);
  });

  it('round-trips a tab-scoped Bot Lab geometry override', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    const temporary = {
      arenaScale: 2.15,
      ballSize: 1.65,
      vehicle: { ...VEHICLE_CONFIG, boostTopSpeed: 39 },
    };

    saveRuntimeGameplayConfig(temporary);
    expect(readRuntimeGameplayConfig()).toEqual(temporary);
    clearRuntimeGameplayConfig();
    expect(readRuntimeGameplayConfig()).toBeNull();
  });

  it('loads temporary arena and ball sizes when the game starts again', async () => {
    const storage = new Map<string, string>();
    storage.set('velocity-pitch:bot-lab-gameplay-config', JSON.stringify({
      arenaScale: 2.4,
      ballSize: 1.8,
      vehicle: VEHICLE_CONFIG,
    }));
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    vi.resetModules();

    const reloaded = await import('../../src/core/config/GameplayScale');

    expect(reloaded.GAMEPLAY_SCALE).toEqual({ arenaScale: 2.4, ballSize: 1.8 });
  });
});
