import gameplayConfig from '../../../data/gameplay-config.json';

export interface VehicleConfig {
  readonly driveTopSpeed: number;
  readonly reverseTopSpeed: number;
  readonly accelerationMultiplier: number;
  readonly reverseAccelerationMultiplier: number;
  readonly brakeMultiplier: number;
  readonly steeringMultiplier: number;
  readonly boostTopSpeed: number;
  readonly boostAccelerationMultiplier: number;
  readonly boostConsumptionPerSecond: number;
  readonly boostRechargePerSecond: number;
  readonly jumpPowerMultiplier: number;
  readonly dodgePowerMultiplier: number;
  readonly aerialControlMultiplier: number;
}

export interface GameplayConfig {
  readonly arenaScale: number;
  readonly ballSize: number;
  readonly vehicle: VehicleConfig;
}

export const RUNTIME_GAMEPLAY_CONFIG_KEY = 'velocity-pitch:bot-lab-gameplay-config';

const positiveScale = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
);

const nonNegative = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
);

const positive = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
);

export const sanitizeVehicleConfig = (value: Partial<VehicleConfig>): VehicleConfig => ({
  driveTopSpeed: positive(value.driveTopSpeed, 22),
  reverseTopSpeed: positive(value.reverseTopSpeed, 12),
  accelerationMultiplier: positive(value.accelerationMultiplier, 1),
  reverseAccelerationMultiplier: positive(value.reverseAccelerationMultiplier, 1),
  brakeMultiplier: positive(value.brakeMultiplier, 1),
  steeringMultiplier: positive(value.steeringMultiplier, 1),
  boostTopSpeed: positive(value.boostTopSpeed, 28),
  boostAccelerationMultiplier: positive(value.boostAccelerationMultiplier, 1),
  boostConsumptionPerSecond: nonNegative(value.boostConsumptionPerSecond, 30),
  boostRechargePerSecond: nonNegative(value.boostRechargePerSecond, 5),
  jumpPowerMultiplier: positive(value.jumpPowerMultiplier, 1),
  dodgePowerMultiplier: positive(value.dodgePowerMultiplier, 1),
  aerialControlMultiplier: positive(value.aerialControlMultiplier, 1),
});

export const sanitizeGameplayConfig = (value: Partial<GameplayConfig>): GameplayConfig => ({
  arenaScale: positiveScale(value.arenaScale),
  ballSize: positiveScale(value.ballSize),
  vehicle: sanitizeVehicleConfig(value.vehicle ?? {}),
});

const runtimeConfig = readRuntimeGameplayConfig();

export const GAMEPLAY_SCALE = Object.freeze({
  arenaScale: positiveScale(runtimeConfig?.arenaScale ?? gameplayConfig.arenaScale),
  ballSize: positiveScale(runtimeConfig?.ballSize ?? gameplayConfig.ballSize),
});

export const VEHICLE_CONFIG = Object.freeze(sanitizeVehicleConfig(
  runtimeConfig?.vehicle ?? gameplayConfig.vehicle,
));

export function readRuntimeGameplayConfig(): GameplayConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.sessionStorage.getItem(RUNTIME_GAMEPLAY_CONFIG_KEY);
    if (!stored) return null;
    return sanitizeGameplayConfig(JSON.parse(stored) as Partial<GameplayConfig>);
  } catch {
    return null;
  }
}

export const saveRuntimeGameplayConfig = (config: GameplayConfig): void => {
  window.sessionStorage.setItem(
    RUNTIME_GAMEPLAY_CONFIG_KEY,
    JSON.stringify(sanitizeGameplayConfig(config)),
  );
};

export const clearRuntimeGameplayConfig = (): void => {
  try {
    window.sessionStorage.removeItem(RUNTIME_GAMEPLAY_CONFIG_KEY);
  } catch {
    // Session storage can be unavailable in privacy-restricted browser contexts.
  }
};
