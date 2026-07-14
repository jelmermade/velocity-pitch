import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/core/math/Vector3';
import { GoalExplosionSystem, type ExplosionTarget } from '../../src/gameplay/effects/GoalExplosionSystem';

describe('GoalExplosionSystem', () => {
  it('pushes nearby cars away from the goal with radial falloff', () => {
    const near = new RecordingTarget({ x: 0, y: 1, z: 5 });
    const far = new RecordingTarget({ x: 0, y: 1, z: 30 });
    new GoalExplosionSystem().trigger({ x: 0, y: 1, z: 0 }, [near, far]);

    expect(near.impulses).toHaveLength(1);
    const impulse = near.impulses[0];
    if (!impulse) throw new Error('Expected nearby target to receive an impulse');
    expect(impulse.z).toBeGreaterThan(0);
    expect(impulse.y).toBeGreaterThan(0);
    expect(far.impulses).toHaveLength(0);
  });
});

class RecordingTarget implements ExplosionTarget {
  readonly impulses: Vec3[] = [];

  constructor(private readonly position: Vec3) {}

  state(): { readonly transform: { readonly position: Vec3 } } {
    return { transform: { position: this.position } };
  }

  applyImpulse(impulse: Vec3): void {
    this.impulses.push(impulse);
  }
}
