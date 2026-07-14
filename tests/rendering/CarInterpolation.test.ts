import { describe, expect, it } from 'vitest';
import type { CarState } from '../../src/gameplay/car/CarState';
import { interpolateCarState } from '../../src/gameplay/simulation/SnapshotInterpolator';

describe('car render interpolation', () => {
  it('interpolates transform and velocity between fixed physics states', () => {
    const previous = carState(0, 2, 1);
    const current = carState(10, 6, 5);

    const rendered = interpolateCarState(previous, current, 0.25);

    expect(rendered.transform.position.x).toBeCloseTo(2.5);
    expect(rendered.linearVelocity.x).toBeCloseTo(3);
    expect(rendered.angularVelocity.y).toBeCloseTo(2);
  });
});

const carState = (x: number, linearX: number, angularY: number): CarState => ({
  transform: {
    position: { x, y: 0.72, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
  linearVelocity: { x: linearX, y: 0, z: 0 },
  angularVelocity: { x: 0, y: angularY, z: 0 },
  wheels: [],
  grounded: true,
  boost: 100,
  boosting: false,
});
