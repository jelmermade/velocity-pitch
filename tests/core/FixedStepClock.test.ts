import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../../src/core/time/FixedStepClock';

describe('FixedStepClock', () => {
  it('runs simulation steps independently from render frames', () => {
    const clock = new FixedStepClock(0.01, 8);
    expect(clock.update(0).steps).toBe(0);
    const frame = clock.update(25);
    expect(frame.steps).toBe(2);
    expect(frame.alpha).toBeCloseTo(0.5);
  });

  it('limits catch-up work after a stall', () => {
    const clock = new FixedStepClock(0.01, 4);
    clock.update(0);
    expect(clock.update(1000).steps).toBe(4);
  });
});
