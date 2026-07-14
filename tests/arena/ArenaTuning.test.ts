import { describe, expect, it } from 'vitest';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { rotateVector } from '../../src/core/math/Quaternion';
import { dot } from '../../src/core/math/Vector3';
import { ARENA_SURFACES } from '../../src/gameplay/arena/ArenaDefinition';
import { BOOST_PICKUP_DEFINITIONS } from '../../src/gameplay/boost/BoostPickup';

describe('expanded arena', () => {
  it('uses the larger competitive dimensions', () => {
    expect(ARENA_TUNING.halfWidth * 2).toBe(84);
    expect(ARENA_TUNING.halfLength * 2).toBe(126);
    expect(ARENA_TUNING.height).toBe(24);
  });

  it('keeps every boost route within the playable boundaries', () => {
    BOOST_PICKUP_DEFINITIONS.forEach(({ position }) => {
      expect(Math.abs(position.x)).toBeLessThan(ARENA_TUNING.halfWidth);
      expect(Math.abs(position.z)).toBeLessThan(ARENA_TUNING.halfLength);
    });
    expect(BOOST_PICKUP_DEFINITIONS.some(({ position }) => Math.abs(position.x) > 34)).toBe(true);
    expect(BOOST_PICKUP_DEFINITIONS.some(({ position }) => Math.abs(position.z) > 51)).toBe(true);
  });

  it('connects the floor and roof to every solid arena boundary with segmented curves', () => {
    const curves = ARENA_SURFACES.filter(({ kind }) => kind === 'curve');
    const bottomCurves = curves.filter(({ position }) => position.y < ARENA_TUNING.verticalCurveRadius);
    const roofCurves = curves.filter(({ position }) => position.y > ARENA_TUNING.height - ARENA_TUNING.verticalCurveRadius);

    expect(bottomCurves.length).toBeGreaterThan(50);
    expect(roofCurves).toHaveLength(bottomCurves.length + ARENA_TUNING.verticalCurveSegments * 2);
    expect(curves.every(({ rotation }) => Math.abs(rotation.x) + Math.abs(rotation.z) > 0.01)).toBe(true);
  });

  it('keeps straight wall colliders out of the curved transition volumes', () => {
    const walls = ARENA_SURFACES.filter(({ kind }) => kind === 'wall');
    const lowerTransitionEnd = ARENA_TUNING.verticalCurveRadius;
    const upperTransitionStart = ARENA_TUNING.height - ARENA_TUNING.verticalCurveRadius;

    walls.forEach(({ position, halfExtents }) => {
      expect(position.y - halfExtents.y).toBeGreaterThanOrEqual(lowerTransitionEnd);
      expect(position.y + halfExtents.y).toBeLessThanOrEqual(upperTransitionStart);
    });
  });

  it('orients every transition thickness out of the playable arena like the right wall', () => {
    const curves = ARENA_SURFACES.filter(({ kind }) => kind === 'curve');

    curves.forEach(({ position, rotation }) => {
      const solidDirection = rotateVector(rotation, { x: 0, y: 1, z: 0 });
      const horizontalOutward = dot(
        { x: solidDirection.x, y: 0, z: solidDirection.z },
        { x: position.x, y: 0, z: position.z },
      );
      const expectedVerticalSign = position.y < ARENA_TUNING.height / 2 ? -1 : 1;

      expect(horizontalOutward).toBeGreaterThan(0);
      expect(solidDirection.y * expectedVerticalSign).toBeGreaterThan(0);
    });
  });
});
