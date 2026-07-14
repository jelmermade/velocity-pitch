import { describe, expect, it } from 'vitest';
import { gearForSpeed, resolveVehicleGear, vehicleAudioTargets } from '../../src/audio/VehicleAudioModel';

describe('vehicle audio model', () => {
  it('maps the normal driving range across five gears', () => {
    expect(gearForSpeed(0)).toBe(1);
    expect(gearForSpeed(7)).toBe(2);
    expect(gearForSpeed(13)).toBe(3);
    expect(gearForSpeed(20)).toBe(4);
    expect(gearForSpeed(28)).toBe(5);
  });

  it('uses downshift hysteresis to avoid repeated changes near a threshold', () => {
    expect(resolveVehicleGear(12.8, 3)).toBe(3);
    expect(resolveVehicleGear(11.4, 3)).toBe(2);
    expect(resolveVehicleGear(13.1, 2)).toBe(3);
  });

  it('drops the engine pitch after an upshift', () => {
    const car = {
      linearVelocity: { x: 0, y: 0, z: 12.9 },
      grounded: true,
      boosting: false,
    };
    const beforeShift = vehicleAudioTargets(car, 2);
    const afterShift = vehicleAudioTargets({ ...car, linearVelocity: { x: 0, y: 0, z: 13 } }, 3);

    expect(afterShift.engineFrequency).toBeLessThan(beforeShift.engineFrequency);
  });

  it('makes boost prominent and silences continuous audio while paused', () => {
    const car = {
      linearVelocity: { x: 18, y: 4, z: 0 },
      grounded: false,
      boosting: true,
    };
    const playing = vehicleAudioTargets(car, 3);
    const paused = vehicleAudioTargets(car, 3, false);

    expect(playing.boostNoiseGain).toBeGreaterThan(playing.engineGain);
    expect(paused.engineGain).toBe(0);
    expect(paused.boostNoiseGain).toBe(0);
    expect(paused.boostToneGain).toBe(0);
  });
});
