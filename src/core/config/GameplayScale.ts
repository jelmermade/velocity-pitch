import gameplayConfig from '../../../data/gameplay-config.json';

const positiveScale = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
);

const nonNegative = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
);

const positive = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
);

const vehicle = gameplayConfig.vehicle;

export const GAMEPLAY_SCALE = Object.freeze({
  arenaScale: positiveScale(gameplayConfig.arenaScale),
  ballSize: positiveScale(gameplayConfig.ballSize),
});

export const VEHICLE_CONFIG = Object.freeze({
  driveTopSpeed: positive(vehicle.driveTopSpeed, 22),
  reverseTopSpeed: positive(vehicle.reverseTopSpeed, 12),
  accelerationMultiplier: positive(vehicle.accelerationMultiplier, 1),
  reverseAccelerationMultiplier: positive(vehicle.reverseAccelerationMultiplier, 1),
  brakeMultiplier: positive(vehicle.brakeMultiplier, 1),
  steeringMultiplier: positive(vehicle.steeringMultiplier, 1),
  boostTopSpeed: positive(vehicle.boostTopSpeed, 28),
  boostAccelerationMultiplier: positive(vehicle.boostAccelerationMultiplier, 1),
  boostConsumptionPerSecond: nonNegative(vehicle.boostConsumptionPerSecond, 30),
  boostRechargePerSecond: nonNegative(vehicle.boostRechargePerSecond, 5),
  jumpPowerMultiplier: positive(vehicle.jumpPowerMultiplier, 1),
  dodgePowerMultiplier: positive(vehicle.dodgePowerMultiplier, 1),
  aerialControlMultiplier: positive(vehicle.aerialControlMultiplier, 1),
});
