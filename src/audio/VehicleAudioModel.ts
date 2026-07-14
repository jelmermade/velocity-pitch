import type { CarState } from '../gameplay/car/CarState';

const GEAR_START_SPEEDS = [0, 7, 13, 20, 27] as const;
const DOWNSHIFT_HYSTERESIS = 1.5;
const MAXIMUM_AUDIO_SPEED = 36;

export interface VehicleAudioTargets {
  readonly speed: number;
  readonly gear: number;
  readonly engineFrequency: number;
  readonly engineGain: number;
  readonly boostNoiseGain: number;
  readonly boostToneGain: number;
  readonly boostFilterFrequency: number;
}

export function gearForSpeed(speed: number): number {
  const safeSpeed = Math.max(0, speed);
  let gear = 1;
  for (let index = 1; index < GEAR_START_SPEEDS.length; index += 1) {
    const threshold = GEAR_START_SPEEDS[index];
    if (threshold !== undefined && safeSpeed >= threshold) gear = index + 1;
  }
  return gear;
}

export function resolveVehicleGear(speed: number, currentGear: number): number {
  const safeSpeed = Math.max(0, speed);
  let gear = Math.min(GEAR_START_SPEEDS.length, Math.max(1, Math.round(currentGear)));

  while (gear < GEAR_START_SPEEDS.length) {
    const upshiftSpeed = GEAR_START_SPEEDS[gear];
    if (upshiftSpeed === undefined || safeSpeed < upshiftSpeed) break;
    gear += 1;
  }
  while (gear > 1) {
    const currentGearStart = GEAR_START_SPEEDS[gear - 1];
    if (currentGearStart === undefined || safeSpeed >= currentGearStart - DOWNSHIFT_HYSTERESIS) break;
    gear -= 1;
  }
  return gear;
}

export function vehicleAudioTargets(
  car: Pick<CarState, 'linearVelocity' | 'grounded' | 'boosting'>,
  gear: number,
  active = true,
): VehicleAudioTargets {
  const speed = Math.hypot(car.linearVelocity.x, car.linearVelocity.z);
  const safeGear = Math.min(GEAR_START_SPEEDS.length, Math.max(1, Math.round(gear)));
  const gearStart = GEAR_START_SPEEDS[safeGear - 1] ?? 0;
  const nextGearStart = GEAR_START_SPEEDS[safeGear] ?? MAXIMUM_AUDIO_SPEED;
  const rev = Math.min(1, Math.max(0, (speed - gearStart) / (nextGearStart - gearStart)));

  return {
    speed,
    gear: safeGear,
    engineFrequency: 70 + safeGear * 7 + rev * 64,
    engineGain: active ? (car.grounded ? 0.035 + rev * 0.025 : 0.025 + rev * 0.012) : 0,
    boostNoiseGain: active && car.boosting ? 0.11 : 0,
    boostToneGain: active && car.boosting ? 0.035 : 0,
    boostFilterFrequency: 720 + Math.min(speed, MAXIMUM_AUDIO_SPEED) * 22,
  };
}
