import { describe, expect, it } from 'vitest';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { BALL_TUNING } from '../../src/core/config/BallTuning';
import { GAMEPLAY_SCALE } from '../../src/core/config/GameplayScale';
import { rotateVector } from '../../src/core/math/Quaternion';
import { distance, dot } from '../../src/core/math/Vector3';
import {
  ARENA_BOUNDARY_SEGMENTS,
  ARENA_SURFACES,
  ARENA_WALL_HALF_THICKNESS,
  GOAL_MOUTH_BOUNDARY_HALF_WIDTH,
} from '../../src/gameplay/arena/ArenaDefinition';
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

  it('uses sculpted diagonal goal entries and recesses beyond the rectangular field', () => {
    const diagonals = ARENA_BOUNDARY_SEGMENTS.filter(({ kind, tangent, midpoint }) => (
      kind === 'wall'
      && Math.abs(tangent.x) > 0.2
      && Math.abs(tangent.z) > 0.2
      && Math.abs(midpoint.z) > ARENA_TUNING.halfLength
    ));
    const goalSegments = ARENA_BOUNDARY_SEGMENTS.filter(({ kind }) => kind === 'goal');

    expect(diagonals.length).toBeGreaterThan(4);
    expect(goalSegments).not.toHaveLength(0);
    expect(Math.max(...goalSegments.map(({ midpoint }) => Math.abs(midpoint.z)))).toBeGreaterThan(
      ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth + ARENA_TUNING.goalDepth - 2,
    );
  });

  it('keeps flat back walls coplanar and rounds only the recessed goal posts', () => {
    const wallPlaneZ = ARENA_TUNING.halfLength;
    const tolerance = 0.000_01 * ARENA_TUNING.scale;
    const goalJunctions = ARENA_BOUNDARY_SEGMENTS.flatMap((segment, index) => {
      const next = ARENA_BOUNDARY_SEGMENTS[(index + 1) % ARENA_BOUNDARY_SEGMENTS.length];
      if (!next || segment.kind === next.kind) return [];
      return [{ segment, next }];
    });
    const backWalls = ARENA_BOUNDARY_SEGMENTS.filter(({ kind, sectionType, midpoint, tangent }) => (
      kind === 'wall'
      && sectionType === 'straightWall'
      && Math.abs(tangent.z) < tolerance
      && Math.abs(Math.abs(midpoint.z) - wallPlaneZ) < tolerance
    ));
    const goalPostFillets = ARENA_BOUNDARY_SEGMENTS.filter(({ kind, sectionType, midpoint }) => (
      kind === 'wall'
      && sectionType === 'filletArc'
      && Math.abs(midpoint.x) < ARENA_TUNING.goalHalfWidth + ARENA_TUNING.goalTransitionRadius + tolerance
      && Math.abs(midpoint.z) >= wallPlaneZ - tolerance
    ));

    expect(GOAL_MOUTH_BOUNDARY_HALF_WIDTH).toBeCloseTo(
      ARENA_TUNING.goalHalfWidth + ARENA_TUNING.goalTransitionRadius,
      8,
    );
    expect(backWalls).toHaveLength(4);
    backWalls.forEach(({ start, end }) => {
      expect(Math.abs(start.z)).toBeCloseTo(wallPlaneZ, 8);
      expect(Math.abs(end.z)).toBeCloseTo(wallPlaneZ, 8);
    });
    expect(goalPostFillets).toHaveLength(24);
    expect(goalPostFillets.every(({ start, end }) => (
      Math.abs(start.z) >= wallPlaneZ - tolerance
      && Math.abs(end.z) >= wallPlaneZ - tolerance
    ))).toBe(true);
    expect(goalJunctions).toHaveLength(4);
    goalJunctions.forEach(({ segment, next }) => {
      expect(Math.abs(segment.end.x)).toBeCloseTo(ARENA_TUNING.goalHalfWidth, 8);
      expect(Math.abs(segment.end.z)).toBeGreaterThan(wallPlaneZ);
      expect(distance(segment.end, next.start)).toBeLessThan(tolerance);
      expect(new Set([segment.kind, next.kind])).toEqual(new Set(['wall', 'goal']));
    });
  });

  it('keeps the lower wall fillet small and independent from horizontal corners', () => {
    expect(ARENA_TUNING.floorWallCurveRadius / ARENA_TUNING.halfWidth).toBeCloseTo(3.5 / 48, 4);
    expect(ARENA_TUNING.cornerFilletRadius).toBeLessThan(ARENA_TUNING.floorWallCurveRadius);
    expect(ARENA_TUNING.cornerFilletRadius).toBeLessThan(ARENA_TUNING.cornerChamferLength * 0.2);
  });

  it('preserves substantial straight side walls and flat back-wall pieces', () => {
    const tolerance = 0.001 * ARENA_TUNING.scale;
    const sideWalls = ARENA_BOUNDARY_SEGMENTS.filter(({ curve, midpoint, tangent }) => (
      !curve
      && Math.abs(Math.abs(midpoint.x) - ARENA_TUNING.halfWidth) < tolerance
      && Math.abs(tangent.x) < tolerance
    ));
    const backWalls = ARENA_BOUNDARY_SEGMENTS.filter(({ kind, curve, midpoint, tangent }) => (
      kind === 'wall'
      && !curve
      && Math.abs(Math.abs(midpoint.z) - ARENA_TUNING.halfLength) < tolerance
      && Math.abs(tangent.z) < tolerance
    ));

    expect(sideWalls).toHaveLength(2);
    expect(sideWalls.every(({ halfSpan }) => halfSpan * 2 > ARENA_TUNING.halfLength * 1.5)).toBe(true);
    expect(backWalls).toHaveLength(4);
    expect(backWalls.every(({ halfSpan }) => halfSpan * 2 > ARENA_TUNING.halfWidth * 0.25)).toBe(true);
  });

  it('builds every field corner from fillet, flat 45-degree chamfer, fillet', () => {
    const chamfers = ARENA_BOUNDARY_SEGMENTS.filter(({ sectionType }) => sectionType === 'chamferWall');
    const fieldCornerFillets = ARENA_BOUNDARY_SEGMENTS.filter(({ kind, sectionType, midpoint }) => (
      kind === 'wall'
      && sectionType === 'filletArc'
      && Math.abs(midpoint.x) > ARENA_TUNING.halfWidth - ARENA_TUNING.cornerChamferLength
      && Math.abs(midpoint.z) > ARENA_TUNING.halfLength - ARENA_TUNING.cornerChamferLength
    ));

    expect(chamfers).toHaveLength(4);
    expect(fieldCornerFillets).toHaveLength(ARENA_TUNING.cornerFilletSegments * 8);
    chamfers.forEach((chamfer) => {
      expect(chamfer.halfSpan * 2).toBeCloseTo(ARENA_TUNING.cornerChamferLength, 5);
      expect(Math.abs(chamfer.tangent.x)).toBeCloseTo(Math.SQRT1_2, 5);
      expect(Math.abs(chamfer.tangent.z)).toBeCloseTo(Math.SQRT1_2, 5);
      const index = ARENA_BOUNDARY_SEGMENTS.indexOf(chamfer);
      const previousFillets = contiguousFilletLength(index, -1);
      const nextFillets = contiguousFilletLength(index, 1);
      const chamferLength = chamfer.halfSpan * 2;
      const chamferRatio = chamferLength / (chamferLength + previousFillets + nextFillets);
      expect(chamferRatio).toBeGreaterThanOrEqual(0.6);
      expect(chamferRatio).toBeLessThanOrEqual(0.8);
    });

    const chamferWalls = ARENA_SURFACES.filter(({ kind, boundarySectionType }) => (
      kind === 'wall' && boundarySectionType === 'chamferWall'
    ));
    const chamferFloorCurves = ARENA_SURFACES.filter(({ kind, curveLocation, boundarySectionType }) => (
      kind === 'curve' && curveLocation === 'floor' && boundarySectionType === 'chamferWall'
    ));
    const chamferCeilingCurves = ARENA_SURFACES.filter(({ kind, curveLocation, boundarySectionType }) => (
      kind === 'curve' && curveLocation === 'ceiling' && boundarySectionType === 'chamferWall'
    ));
    expect(chamferWalls).toHaveLength(4);
    expect(chamferFloorCurves).toHaveLength(4 * ARENA_TUNING.floorWallCurveSegments);
    expect(chamferCeilingCurves).toHaveLength(chamferFloorCurves.length);
  });

  it('connects the flat floor and ceiling with matching segmented quarter circles', () => {
    const curves = ARENA_SURFACES.filter(({ kind }) => kind === 'curve');
    const floorCurves = curves.filter(({ curveLocation }) => curveLocation === 'floor');
    const ceilingCurves = curves.filter(({ curveLocation }) => curveLocation === 'ceiling');

    expect(floorCurves.length).toBeGreaterThan(50);
    const wallFloorCurves = floorCurves.filter(({ boundaryKind }) => boundaryKind === 'wall');
    const goalFloorCurves = floorCurves.filter(({ boundaryKind }) => boundaryKind === 'goal');
    expect(goalFloorCurves.length).toBeGreaterThan(0);
    expect(ceilingCurves).toHaveLength(
      wallFloorCurves.length + ARENA_TUNING.floorWallCurveSegments * 2,
    );
    expect(floorCurves.every(({ position, halfExtents }) => (
      position.y + halfExtents.y <= ARENA_TUNING.floorWallCurveRadius + 0.2
    ))).toBe(true);
    expect(ceilingCurves.every(({ position, halfExtents }) => (
      position.y - halfExtents.y >= ARENA_TUNING.height - ARENA_TUNING.floorWallCurveRadius - 0.2
    ))).toBe(true);
    expect(curves.every(({ rotation }) => Math.abs(rotation.x) + Math.abs(rotation.z) > 0.000_1)).toBe(true);
  });

  it('seals the recessed goal walls between their shared floor fillet and roof', () => {
    const goalWalls = ARENA_SURFACES.filter(({ kind, boundaryKind }) => (
      kind === 'goal' && boundaryKind === 'goal'
    ));
    const goalFloorAndRoof = ARENA_SURFACES.filter(({ kind, boundaryKind }) => (
      kind === 'goal' && boundaryKind === undefined
    ));

    expect(goalWalls).not.toHaveLength(0);
    goalWalls.forEach(({ glass, position, halfExtents }) => {
      expect(glass).toBe(false);
      expect(position.y - halfExtents.y).toBeCloseTo(ARENA_TUNING.floorWallCurveRadius);
      expect(position.y + halfExtents.y).toBeCloseTo(ARENA_TUNING.goalHeight);
    });
    expect(goalFloorAndRoof).toHaveLength(4);
    expect(goalFloorAndRoof.every(({ glass, halfExtents }) => (
      !glass && Math.abs(halfExtents.x - GOAL_MOUTH_BOUNDARY_HALF_WIDTH) < 0.000_01
    ))).toBe(true);
    expect(ARENA_SURFACES.some(({ kind, curveLocation, boundaryKind }) => (
      kind === 'curve' && curveLocation === 'floor' && boundaryKind === 'goal'
    ))).toBe(true);
  });

  it('does not emit duplicate collision surfaces around either goal', () => {
    const signatures = ARENA_SURFACES.map(({ position, halfExtents, rotation }) => [
      position.x, position.y, position.z,
      halfExtents.x, halfExtents.y, halfExtents.z,
      rotation.x, rotation.y, rotation.z, rotation.w,
    ].map((value) => value.toFixed(7)).join(':'));

    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('keeps planar walls between the lower and upper fillets', () => {
    const walls = ARENA_SURFACES.filter(({ kind }) => kind === 'wall');

    walls.forEach(({ position, halfExtents }) => {
      const lowerEdge = position.y - halfExtents.y;
      const isGoalHeader = Math.abs(position.x) < 0.001
        && Math.abs(Math.abs(position.z) - (
          ARENA_TUNING.halfLength
          + ARENA_WALL_HALF_THICKNESS
        )) < 0.001;
      if (isGoalHeader) expect(lowerEdge).toBeCloseTo(ARENA_TUNING.goalHeight);
      else expect(lowerEdge).toBeCloseTo(ARENA_TUNING.floorWallCurveRadius);
      expect(position.y + halfExtents.y).toBeCloseTo(
        ARENA_TUNING.height - ARENA_TUNING.floorWallCurveRadius,
      );
    });
  });

  it('leaves both recessed goal openings clear below the flat backboards', () => {
    const mouthZ = ARENA_TUNING.halfLength;
    for (const zSign of [-1, 1] as const) {
      const openingBlockers = ARENA_SURFACES.filter(({ kind, position, halfExtents }) => (
        kind === 'wall'
        && Math.abs(position.z - zSign * (mouthZ + ARENA_WALL_HALF_THICKNESS)) < 0.001
        && Math.abs(position.x) < ARENA_TUNING.goalHalfWidth
        && position.y - halfExtents.y < ARENA_TUNING.goalHeight - 0.001
      ));
      expect(openingBlockers).toHaveLength(0);
    }
  });

  it('orients every transition thickness out of the playable arena like the right wall', () => {
    const curves = ARENA_SURFACES.filter(({ kind }) => kind === 'curve');

    curves.forEach(({ position, rotation, curveLocation }) => {
      const solidDirection = rotateVector(rotation, { x: 0, y: 1, z: 0 });
      const horizontalOutward = dot(
        { x: solidDirection.x, y: 0, z: solidDirection.z },
        { x: position.x, y: 0, z: position.z },
      );

      expect(horizontalOutward).toBeGreaterThan(0);
      expect(solidDirection.y * (curveLocation === 'floor' ? -1 : 1)).toBeGreaterThan(0);
    });
  });
});

const contiguousFilletLength = (originIndex: number, direction: -1 | 1): number => {
  let length = 0;
  let index = (originIndex + direction + ARENA_BOUNDARY_SEGMENTS.length) % ARENA_BOUNDARY_SEGMENTS.length;
  while (ARENA_BOUNDARY_SEGMENTS[index]?.sectionType === 'filletArc') {
    length += (ARENA_BOUNDARY_SEGMENTS[index]?.halfSpan ?? 0) * 2;
    index = (index + direction + ARENA_BOUNDARY_SEGMENTS.length) % ARENA_BOUNDARY_SEGMENTS.length;
  }
  return length;
};
