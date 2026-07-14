import { describe, expect, it } from 'vitest';
import type { CarState } from '../../src/gameplay/car/CarState';
import type { SimulationSnapshot } from '../../src/gameplay/simulation/SimulationSnapshot';
import { AuthoritativeFrameInterpolator } from '../../src/networking/AuthoritativeFrameInterpolator';
import type { AuthoritativeFrame } from '../../src/networking/LobbyProtocol';

describe('authoritative frame interpolation', () => {
  it('advances smoothly between sparse network frames', () => {
    const interpolator = new AuthoritativeFrameInterpolator(0.05, 120);
    interpolator.push(frame(0, 0), 0);
    interpolator.push(frame(6, 6), 0.05);

    expect(interpolator.sample(0.05)?.cars.guest?.transform.position.z).toBeCloseTo(0);
    expect(interpolator.sample(0.075)?.cars.guest?.transform.position.z).toBeCloseTo(3);
    expect(interpolator.sample(0.1)?.cars.guest?.transform.position.z).toBeCloseTo(6);
  });

  it('never moves playback backwards when a packet arrives late', () => {
    const interpolator = new AuthoritativeFrameInterpolator(0.05, 120);
    interpolator.push(frame(0, 0), 0);
    interpolator.push(frame(6, 6), 0.05);
    const beforeLatePacket = interpolator.sample(0.11)?.cars.guest?.transform.position.z ?? 0;
    interpolator.push(frame(12, 12), 0.12);

    expect(interpolator.sample(0.12)?.cars.guest?.transform.position.z).toBeGreaterThanOrEqual(beforeLatePacket);
  });

  it('briefly extrapolates instead of freezing when the next packet is late', () => {
    const interpolator = new AuthoritativeFrameInterpolator(0.05, 120, 0.05);
    interpolator.push(frame(0, 0), 0);
    interpolator.push(frame(6, 6), 0.05);

    expect(interpolator.sample(0.11)?.cars.guest?.transform.position.z).toBeCloseTo(7.2);
    expect(interpolator.sample(0.2)?.cars.guest?.transform.position.z).toBeCloseTo(12);
  });
});

const frame = (sequence: number, z: number): AuthoritativeFrame => {
  const car = carState(z);
  const snapshot: SimulationSnapshot = {
    tick: sequence,
    car,
    ball: {
      transform: { position: { x: 0, y: 1, z }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    },
    boostPickups: [],
    match: {
      phase: 'playing',
      paused: false,
      azureScore: 0,
      coralScore: 0,
      timeRemaining: 300,
      countdown: 0,
      overtime: false,
      lastGoalTeam: null,
      replayProgress: 0,
    },
  };
  return { sequence, snapshot, cars: { host: car, guest: car } };
};

const carState = (z: number): CarState => ({
  transform: { position: { x: 0, y: 1, z }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  linearVelocity: { x: 0, y: 0, z: 20 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  wheels: [],
  grounded: true,
  boost: 100,
  boosting: false,
});
