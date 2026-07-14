import { describe, expect, it } from 'vitest';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { BALL_TUNING } from '../../src/core/config/BallTuning';
import { GAMEPLAY_SCALE } from '../../src/core/config/GameplayScale';
import { rotateVector } from '../../src/core/math/Quaternion';
import { distance, dot } from '../../src/core/math/Vector3';
import { ARENA_BOUNDARY_SEGMENTS, ARENA_SURFACES } from '../../src/gameplay/arena/ArenaDefinition';
import { BOOST_PICKUP_DEFINITIONS } from '../../src/gameplay/boost/BoostPickup';

describe('competitive arena geometry', () => {
  it('uses standard car-soccer proportions', () => {
    expect(ARENA_TUNING.halfWidth * 2).toBe(96 * GAMEPLAY_SCALE.arenaScale);
    expect(ARENA_TUNING.halfLength * 2).toBe(120 * GAMEPLAY_SCALE.arenaScale);
    expect(ARENA_TUNING.height).toBe(24 * GAMEPLAY_SCALE.arenaScale);
    expect(ARENA_TUNING.halfLength / ARENA_TUNING.halfWidth).toBeCloseTo(1.25, 2);
  });

  it('applies the configured physical ball size consistently', () => {
    expect(BALL_TUNING.radius).toBe(1.35 * GAMEPLAY_SCALE.ballSize);
    expect(BALL_TUNING.mass).toBe(32 * GAMEPLAY_SCALE.ballSize ** 3);
  });

  it('keeps every boost route within the playable boundaries', () => {
    BOOST_PICKUP_DEFINITIONS.forEach(({ position }) => {
      expect(Math.abs(position.x)).toBeLessThan(ARENA_TUNING.halfWidth);
      expect(Math.abs(position.z)).toBeLessThan(ARENA_TUNING.halfLength);
    });
    expect(BOOST_PICKUP_DEFINITIONS.some(({ position }) => (
      Math.abs(position.x) > ARENA_TUNING.halfWidth * 0.8
    ))).toBe(true);
    expect(BOOST_PICKUP_DEFINITIONS.some(({ position }) => (
      Math.abs(position.z) > ARENA_TUNING.halfLength * 0.8
    ))).toBe(true);
  });

  it('forms one continuous symmetric boundary with smooth generated turns', () => {
    const geometryTolerance = 0.000_01 * ARENA_TUNING.scale;
    ARENA_BOUNDARY_SEGMENTS.forEach((segment, index) => {
      const next = ARENA_BOUNDARY_SEGMENTS[(index + 1) % ARENA_BOUNDARY_SEGMENTS.length];
      expect(next).toBeDefined();
      expect(distance(segment.end, next?.start ?? segment.end)).toBeLessThan(geometryTolerance);
      expect(dot(segment.tangent, next?.tangent ?? segment.tangent)).toBeGreaterThan(0.94);

      const opposite = ARENA_BOUNDARY_SEGMENTS.find((candidate) => (
        distance(candidate.start, { x: -segment.start.x, y: 0, z: -segment.start.z }) < geometryTolerance
        && distance(candidate.end, { x: -segment.end.x, y: 0, z: -segment.end.z }) < geometryTolerance
      ));
      expect(opposite).toBeDefined();
    });
  });

  it('uses diagonal goal entries and recesses beyond the rectangular field', () => {
    const diagonals = ARENA_BOUNDARY_SEGMENTS.filter(({ kind, curve, tangent, midpoint }) => (
      kind === 'wall'
      && !curve
      && Math.abs(tangent.x) > 0.2
      && Math.abs(tangent.z) > 0.2
      && Math.abs(midpoint.z) > ARENA_TUNING.halfLength
    ));
    const goalSegments = ARENA_BOUNDARY_SEGMENTS.filter(({ kind }) => kind === 'goal');

    expect(diagonals).toHaveLength(4);
    expect(goalSegments).not.toHaveLength(0);
    expect(Math.max(...goalSegments.map(({ midpoint }) => Math.abs(midpoint.z)))).toBeGreaterThan(
      ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth + ARENA_TUNING.goalDepth - 2,
    );
  });

  it('connects the floor and roof to every solid arena boundary with segmented curves', () => {
    const curves = ARENA_SURFACES.filter(({ kind }) => kind === 'curve');
    const bottomCurves = curves.filter(({ position }) => position.y < ARENA_TUNING.verticalCurveRadius);
    const roofCurves = curves.filter(({ position }) => position.y > ARENA_TUNING.height - ARENA_TUNING.verticalCurveRadius);

    expect(bottomCurves.length).toBeGreaterThan(50);
    expect(roofCurves).toHaveLength(bottomCurves.length + ARENA_TUNING.verticalCurveSegments * 2);
    expect(curves.every(({ rotation }) => Math.abs(rotation.x) + Math.abs(rotation.z) > 0.000_1)).toBe(true);
  });

  it('keeps straight wall colliders out of the curved transition volumes', () => {
    const walls = ARENA_SURFACES.filter(({ kind }) => kind === 'wall');
    const lowerTransitionEnd = ARENA_TUNING.verticalCurveRadius;
    const upperTransitionStart = ARENA_TUNING.height - ARENA_TUNING.verticalCurveRadius;

    walls.forEach(({ position, halfExtents }) => {
      const lowerEdge = position.y - halfExtents.y;
      const isGoalHeader = Math.abs(position.x) < 0.001
        && Math.abs(Math.abs(position.z) - (
          ARENA_TUNING.halfLength
          + ARENA_TUNING.goalTransitionDepth
          + 0.45
        )) < 0.001;
      if (isGoalHeader) expect(lowerEdge).toBeCloseTo(ARENA_TUNING.goalHeight);
      else expect(lowerEdge).toBeGreaterThanOrEqual(lowerTransitionEnd);
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
