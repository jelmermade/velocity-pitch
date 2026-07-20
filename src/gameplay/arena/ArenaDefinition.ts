import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import type { Quat } from '../../core/math/Quaternion';
import { add, cross, distance, dot, normalize, scale, sub, type Vec3 } from '../../core/math/Vector3';

export type ArenaSurfaceKind = 'floor' | 'wall' | 'curve' | 'ceiling' | 'goal';

export interface ArenaSurface {
  readonly position: Vec3;
  readonly halfExtents: Vec3;
  readonly rotation: Quat;
  readonly kind: ArenaSurfaceKind;
  readonly glass: boolean;
  readonly curveStartNormal?: Vec3;
  readonly curveEndNormal?: Vec3;
  readonly curveLocation?: 'floor' | 'ceiling';
  readonly curveProfileIndex?: number;
  readonly curveProfileSegments?: number;
  readonly curveBoundaryIndex?: number;
  readonly boundaryKind?: 'wall' | 'goal';
  readonly boundarySectionType?: BoundarySectionType;
}

export interface ArenaBoundarySegment {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly midpoint: Vec3;
  readonly tangent: Vec3;
  readonly outward: Vec3;
  readonly halfSpan: number;
  readonly kind: 'wall' | 'goal';
  readonly curve: boolean;
  readonly sectionType: BoundarySectionType;
}

export type BoundarySectionType = 'straightWall' | 'chamferWall' | 'filletArc' | 'goalTransition';

export interface GoalDefinition {
  readonly teamScored: 'azure' | 'coral';
  readonly defendingTeam: 'azure' | 'coral';
  readonly defendingEnd: 'north' | 'south';
  readonly center: Vec3;
}

interface Vec2 {
  readonly x: number;
  readonly z: number;
}

interface BoundaryControlPoint {
  readonly point: Vec2;
  readonly radius: number;
  readonly arcKind: 'wall' | 'goal';
  readonly edgeKind: 'wall' | 'goal';
  readonly outgoingSection: 'straightWall' | 'chamferWall';
  readonly filletSegments?: number;
}

interface StraightWallSection {
  readonly type: 'straightWall';
  readonly start: Vec2;
  readonly end: Vec2;
  readonly kind: 'wall' | 'goal';
}

interface ChamferWallSection {
  readonly type: 'chamferWall';
  readonly start: Vec2;
  readonly end: Vec2;
  readonly kind: 'wall';
}

interface FilletArcSection {
  readonly type: 'filletArc';
  readonly fillet: Fillet;
  readonly kind: 'wall' | 'goal';
  readonly segmentCount: number;
}

type BoundarySection = StraightWallSection | ChamferWallSection | FilletArcSection;

interface Fillet {
  readonly start: Vec2;
  readonly end: Vec2;
  readonly center: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  readonly angleDelta: number;
}

interface WallTransitionBoundary {
  readonly midpoint: Vec3;
  readonly tangent: Vec3;
  readonly outward: Vec3;
  readonly halfSpan: number;
  readonly startTurn: number;
  readonly endTurn: number;
  readonly boundaryIndex: number;
  readonly boundaryKind: 'wall' | 'goal';
  readonly sectionType: BoundarySectionType;
}

export const ARENA_WALL_HALF_THICKNESS = 0.45;

const yawRotation = (yaw: number): Quat => ({
  x: 0,
  y: Math.sin(yaw / 2),
  z: 0,
  w: Math.cos(yaw / 2),
});

const surface = (
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  kind: ArenaSurfaceKind,
  yaw = 0,
): ArenaSurface => ({
  position: { x, y, z },
  halfExtents: { x: hx, y: hy, z: hz },
  rotation: yawRotation(yaw),
  kind,
  glass: kind === 'wall' || kind === 'curve' || kind === 'ceiling',
});

const createBoundaryControlPoints = (): readonly BoundaryControlPoint[] => {
  const {
    halfWidth,
    halfLength,
    goalHalfWidth,
    goalDepth,
    goalTransitionDepth,
    goalTransitionRadius,
    goalBackCornerRadius,
    cornerChamferLength,
    cornerFilletRadius,
    cornerFilletSegments,
  } = ARENA_TUNING;
  const mouthZ = halfLength;
  const rearZ = halfLength + goalTransitionDepth + goalDepth;
  const wall = 'wall' as const;
  const goal = 'goal' as const;
  const straightWall = 'straightWall' as const;
  const chamferWall = 'chamferWall' as const;
  const cornerInset = (
    cornerChamferLength + 2 * cornerFilletRadius * Math.tan(Math.PI / 8)
  ) / Math.SQRT2;

  // Clockwise ordering keeps the playable area on the right of every segment.
  return [
    { point: { x: -goalHalfWidth, z: rearZ }, radius: goalBackCornerRadius, arcKind: goal, edgeKind: goal, outgoingSection: straightWall },
    { point: { x: goalHalfWidth, z: rearZ }, radius: goalBackCornerRadius, arcKind: goal, edgeKind: goal, outgoingSection: straightWall },
    { point: { x: goalHalfWidth, z: mouthZ }, radius: goalTransitionRadius, arcKind: wall, edgeKind: wall, outgoingSection: straightWall },
    { point: { x: halfWidth - cornerInset, z: halfLength }, radius: cornerFilletRadius, arcKind: wall, edgeKind: wall, outgoingSection: chamferWall, filletSegments: cornerFilletSegments },
    { point: { x: halfWidth, z: halfLength - cornerInset }, radius: cornerFilletRadius, arcKind: wall, edgeKind: wall, outgoingSection: straightWall, filletSegments: cornerFilletSegments },
    { point: { x: halfWidth, z: -halfLength + cornerInset }, radius: cornerFilletRadius, arcKind: wall, edgeKind: wall, outgoingSection: chamferWall, filletSegments: cornerFilletSegments },
    { point: { x: halfWidth - cornerInset, z: -halfLength }, radius: cornerFilletRadius, arcKind: wall, edgeKind: wall, outgoingSection: straightWall, filletSegments: cornerFilletSegments },
    { point: { x: goalHalfWidth, z: -mouthZ }, radius: goalTransitionRadius, arcKind: wall, edgeKind: goal, outgoingSection: straightWall },
    { point: { x: goalHalfWidth, z: -rearZ }, radius: goalBackCornerRadius, arcKind: goal, edgeKind: goal, outgoingSection: straightWall },
    { point: { x: -goalHalfWidth, z: -rearZ }, radius: goalBackCornerRadius, arcKind: goal, edgeKind: goal, outgoingSection: straightWall },
    { point: { x: -goalHalfWidth, z: -mouthZ }, radius: goalTransitionRadius, arcKind: wall, edgeKind: wall, outgoingSection: straightWall },
    { point: { x: -halfWidth + cornerInset, z: -halfLength }, radius: cornerFilletRadius, arcKind: wall, edgeKind: wall, outgoingSection: chamferWall, filletSegments: cornerFilletSegments },
    { point: { x: -halfWidth, z: -halfLength + cornerInset }, radius: cornerFilletRadius, arcKind: wall, edgeKind: wall, outgoingSection: straightWall, filletSegments: cornerFilletSegments },
    { point: { x: -halfWidth, z: halfLength - cornerInset }, radius: cornerFilletRadius, arcKind: wall, edgeKind: wall, outgoingSection: chamferWall, filletSegments: cornerFilletSegments },
    { point: { x: -halfWidth + cornerInset, z: halfLength }, radius: cornerFilletRadius, arcKind: wall, edgeKind: wall, outgoingSection: straightWall, filletSegments: cornerFilletSegments },
    { point: { x: -goalHalfWidth, z: mouthZ }, radius: goalTransitionRadius, arcKind: wall, edgeKind: goal, outgoingSection: straightWall },
  ];
};

const createFillet = (previous: Vec2, vertex: Vec2, next: Vec2, requestedRadius: number): Fillet => {
  const towardPrevious = normalize2(sub2(previous, vertex));
  const towardNext = normalize2(sub2(next, vertex));
  const angle = Math.acos(clamp(dot2(towardPrevious, towardNext), -1, 1));
  const maximumTangentDistance = Math.min(distance2(previous, vertex), distance2(next, vertex)) * 0.45;
  const tangentDistance = Math.min(requestedRadius / Math.tan(angle / 2), maximumTangentDistance);
  const radius = tangentDistance * Math.tan(angle / 2);
  const centerDistance = radius / Math.sin(angle / 2);
  const center = add2(vertex, scale2(normalize2(add2(towardPrevious, towardNext)), centerDistance));
  const start = add2(vertex, scale2(towardPrevious, tangentDistance));
  const end = add2(vertex, scale2(towardNext, tangentDistance));
  const startAngle = Math.atan2(start.z - center.z, start.x - center.x);
  const endAngle = Math.atan2(end.z - center.z, end.x - center.x);
  return {
    start,
    end,
    center,
    radius,
    startAngle,
    angleDelta: shortestAngle(endAngle - startAngle),
  };
};

const createBoundarySections = (): readonly BoundarySection[] => {
  const controlPoints = createBoundaryControlPoints();
  const fillets = controlPoints.map(({ point, radius }, index) => createFillet(
    controlPoints[(index - 1 + controlPoints.length) % controlPoints.length]?.point ?? point,
    point,
    controlPoints[(index + 1) % controlPoints.length]?.point ?? point,
    radius,
  ));
  const sections: BoundarySection[] = [];

  controlPoints.forEach((controlPoint, index) => {
    const fillet = fillets[index];
    const nextFillet = fillets[(index + 1) % fillets.length];
    const nextControlPoint = controlPoints[(index + 1) % controlPoints.length];
    if (!fillet || !nextFillet) return;
    if (controlPoint.outgoingSection === 'chamferWall') {
      sections.push({
        type: 'chamferWall',
        start: fillet.end,
        end: nextFillet.start,
        kind: 'wall',
      });
    } else {
      sections.push({
        type: 'straightWall',
        start: fillet.end,
        end: nextFillet.start,
        kind: controlPoint.edgeKind,
      });
    }
    sections.push({
      type: 'filletArc',
      fillet: nextFillet,
      kind: nextControlPoint?.arcKind ?? 'wall',
      segmentCount: nextControlPoint?.filletSegments ?? 6,
    });
  });
  return sections;
};

const sampleBoundarySections = (sections: readonly BoundarySection[]): ArenaBoundarySegment[] => {
  const segments: ArenaBoundarySegment[] = [];
  sections.forEach((section) => {
    if (section.type === 'straightWall' || section.type === 'chamferWall') {
      pushBoundarySegment(segments, section.start, section.end, section.kind, section.type);
      return;
    }
    const arc = section.fillet;
    const segmentCount = section.segmentCount;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const startRatio = segmentIndex / segmentCount;
      const endRatio = (segmentIndex + 1) / segmentCount;
      const start = segmentIndex === 0
        ? arc.start
        : pointOnArc(arc, startRatio);
      const end = segmentIndex === segmentCount - 1
        ? arc.end
        : pointOnArc(arc, endRatio);
      pushGoalMouthAlignedSegment(segments, start, end, section.kind, section.type);
    }
  });
  return segments;
};

const pushGoalMouthAlignedSegment = (
  segments: ArenaBoundarySegment[],
  start: Vec2,
  end: Vec2,
  kind: 'wall' | 'goal',
  sectionType: BoundarySectionType,
): void => {
  if (kind !== 'goal') {
    pushBoundarySegment(segments, start, end, kind, sectionType);
    return;
  }

  const mouthZ = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;
  const startDepth = Math.abs(start.z) - mouthZ;
  const endDepth = Math.abs(end.z) - mouthZ;
  if (startDepth * endDepth < 0) {
    const targetZ = Math.sign(start.z + end.z) * mouthZ;
    const ratio = (targetZ - start.z) / (end.z - start.z);
    const mouthPoint = {
      x: start.x + (end.x - start.x) * ratio,
      z: targetZ,
    };
    pushBoundarySegment(
      segments,
      start,
      mouthPoint,
      startDepth > 0 ? 'goal' : 'wall',
      sectionType,
    );
    pushBoundarySegment(
      segments,
      mouthPoint,
      end,
      endDepth > 0 ? 'goal' : 'wall',
      sectionType,
    );
    return;
  }

  pushBoundarySegment(
    segments,
    start,
    end,
    (startDepth + endDepth) / 2 >= 0 ? 'goal' : 'wall',
    sectionType,
  );
};

const pushBoundarySegment = (
  segments: ArenaBoundarySegment[],
  start2D: Vec2,
  end2D: Vec2,
  kind: 'wall' | 'goal',
  sectionType: BoundarySectionType,
): void => {
  const start = { x: start2D.x, y: 0, z: start2D.z };
  const end = { x: end2D.x, y: 0, z: end2D.z };
  const delta = sub(end, start);
  const segmentLength = distance(start, end);
  if (segmentLength < 0.001) return;
  const tangent = normalize(delta);
  const outward = { x: -tangent.z, y: 0, z: tangent.x };
  segments.push({
    start,
    end,
    midpoint: scale(add(start, end), 0.5),
    tangent,
    outward,
    halfSpan: segmentLength / 2,
    kind,
    curve: sectionType === 'filletArc' || sectionType === 'goalTransition',
    sectionType,
  });
};

const createWallSurfaces = (): ArenaSurface[] => ARENA_BOUNDARY_SEGMENTS.map((boundary) => {
  const isGoal = boundary.kind === 'goal';
  const halfHeight = isGoal
    ? (ARENA_TUNING.goalHeight - ARENA_TUNING.floorWallCurveRadius) / 2
    : (ARENA_TUNING.height - ARENA_TUNING.floorWallCurveRadius * 2) / 2;
  const centerHeight = isGoal
    ? ARENA_TUNING.floorWallCurveRadius + halfHeight
    : ARENA_TUNING.height / 2;
  const position = add(boundary.midpoint, scale(boundary.outward, ARENA_WALL_HALF_THICKNESS));
  return {
    ...surface(
      position.x,
      centerHeight,
      position.z,
      boundary.halfSpan,
      halfHeight,
      ARENA_WALL_HALF_THICKNESS,
      boundary.kind,
      Math.atan2(-boundary.tangent.z, boundary.tangent.x),
    ),
    glass: !isGoal,
    boundaryKind: boundary.kind,
    boundarySectionType: boundary.sectionType,
  };
});

const createHeaderSurfaces = (): ArenaSurface[] => {
  const mouthZ = ARENA_TUNING.halfLength;
  const headerTop = ARENA_TUNING.height - ARENA_TUNING.floorWallCurveRadius;
  const halfHeight = (headerTop - ARENA_TUNING.goalHeight) / 2;
  return ([-1, 1] as const).map((zSign) => {
    const position = {
      x: 0,
      y: 0,
      z: zSign * (mouthZ + ARENA_WALL_HALF_THICKNESS),
    };
    return surface(
      position.x,
      ARENA_TUNING.goalHeight + halfHeight,
      position.z,
      GOAL_MOUTH_BOUNDARY_HALF_WIDTH,
      halfHeight,
      ARENA_WALL_HALF_THICKNESS,
      'wall',
    );
  });
};

const createGoalFloorAndRoof = (zSign: -1 | 1): ArenaSurface[] => {
  const mouthZ = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;
  const centerZ = zSign * (mouthZ + ARENA_TUNING.goalDepth / 2);
  return [
    surface(0, -0.3, centerZ, GOAL_MOUTH_BOUNDARY_HALF_WIDTH, 0.3, ARENA_TUNING.goalDepth / 2, 'goal'),
    surface(
      0,
      ARENA_TUNING.goalHeight + 0.3,
      centerZ,
      GOAL_MOUTH_BOUNDARY_HALF_WIDTH,
      0.3,
      ARENA_TUNING.goalDepth / 2,
      'goal',
    ),
  ];
};

const createWallTransitionCurveSurfaces = (): ArenaSurface[] => {
  const {
    floorWallCurveRadius: radius,
    floorWallCurveSegments: segmentCount,
  } = ARENA_TUNING;
  const boundaries: WallTransitionBoundary[] = ARENA_BOUNDARY_SEGMENTS
    .map((boundary, index, allBoundaries) => {
      const previous = allBoundaries[(index - 1 + allBoundaries.length) % allBoundaries.length];
      const next = allBoundaries[(index + 1) % allBoundaries.length];
      return {
        midpoint: boundary.midpoint,
        tangent: boundary.tangent,
        outward: boundary.outward,
        halfSpan: boundary.halfSpan,
        startTurn: tangentTurn(previous?.tangent, boundary.tangent),
        endTurn: tangentTurn(boundary.tangent, next?.tangent),
        boundaryIndex: index,
        boundaryKind: boundary.kind,
        sectionType: boundary.sectionType,
      };
    });
  const mouthZ = ARENA_TUNING.halfLength;
  const headerBoundaries: WallTransitionBoundary[] = ([-1, 1] as const).map((zSign, index) => ({
    midpoint: { x: 0, y: 0, z: zSign * mouthZ },
    tangent: { x: 1, y: 0, z: 0 },
    outward: { x: 0, y: 0, z: zSign },
    halfSpan: GOAL_MOUTH_BOUNDARY_HALF_WIDTH,
    startTurn: 0,
    endTurn: 0,
    boundaryIndex: ARENA_BOUNDARY_SEGMENTS.length + index,
    boundaryKind: 'wall',
    sectionType: 'straightWall',
  }));
  const surfaces: ArenaSurface[] = [];
  const halfThickness = 0.16;

  const addCurve = (
    boundary: WallTransitionBoundary,
    location: 'floor' | 'ceiling',
  ): void => {
    const profileSegments = boundary.boundaryKind === 'goal'
      || boundary.sectionType === 'goalTransition'
      ? ARENA_TUNING.goalWallCurveSegments
      : segmentCount;
    for (let index = 0; index < profileSegments; index += 1) {
      const a = (index / profileSegments) * Math.PI * 0.5;
      const b = ((index + 1) / profileSegments) * Math.PI * 0.5;
      const start = wallTransitionPoint(boundary, location, a, radius);
      const end = wallTransitionPoint(boundary, location, b, radius);
      const crossDirection = normalize(sub(end, start));
      let xAxis = normalize(boundary.tangent);
      const zAxis = crossDirection;
      let yAxis = normalize(cross(zAxis, xAxis));
      if (dot(yAxis, boundary.outward) < 0) {
        xAxis = scale(xAxis, -1);
        yAxis = scale(yAxis, -1);
      }
      const surfaceMidpoint = scale(add(start, end), 0.5);
      const maximumInset = location === 'floor'
        ? radius * (1 - Math.sin(a))
        : radius * (1 - Math.cos(b));
      const startExtension = miterExtension(maximumInset, boundary.startTurn);
      const endExtension = miterExtension(maximumInset, boundary.endTurn);
      const alongBoundary = (endExtension - startExtension) / 2;
      surfaces.push({
        position: add(
          add(surfaceMidpoint, scale(boundary.tangent, alongBoundary)),
          scale(yAxis, halfThickness),
        ),
        halfExtents: {
          x: boundary.halfSpan + (startExtension + endExtension) / 2,
          y: halfThickness,
          z: distance(start, end) / 2,
        },
        rotation: quaternionFromBasis(xAxis, yAxis, zAxis),
        kind: 'curve',
        glass: true,
        curveStartNormal: wallTransitionNormal(boundary.outward, location, a),
        curveEndNormal: wallTransitionNormal(boundary.outward, location, b),
        curveLocation: location,
        curveProfileIndex: index,
        curveProfileSegments: profileSegments,
        curveBoundaryIndex: boundary.boundaryIndex,
        boundaryKind: boundary.boundaryKind,
        boundarySectionType: boundary.sectionType,
      });
    }
  };

  boundaries.forEach((boundary) => {
    addCurve(boundary, 'floor');
    if (boundary.boundaryKind === 'wall') addCurve(boundary, 'ceiling');
  });
  headerBoundaries.forEach((boundary) => addCurve(boundary, 'ceiling'));
  return surfaces;
};

const wallTransitionNormal = (
  outward: Vec3,
  location: 'floor' | 'ceiling',
  angle: number,
): Vec3 => location === 'floor'
  ? {
      x: -outward.x * Math.sin(angle),
      y: Math.cos(angle),
      z: -outward.z * Math.sin(angle),
    }
  : {
      x: -outward.x * Math.cos(angle),
      y: -Math.sin(angle),
      z: -outward.z * Math.cos(angle),
    };

const wallTransitionPoint = (
  boundary: WallTransitionBoundary,
  location: 'floor' | 'ceiling',
  angle: number,
  radius: number,
): Vec3 => location === 'floor'
  ? add(
      sub(boundary.midpoint, scale(boundary.outward, radius * (1 - Math.sin(angle)))),
      { x: 0, y: radius * (1 - Math.cos(angle)), z: 0 },
    )
  : add(
      sub(boundary.midpoint, scale(boundary.outward, radius * (1 - Math.cos(angle)))),
      { x: 0, y: ARENA_TUNING.height - radius + radius * Math.sin(angle), z: 0 },
    );

const tangentTurn = (left: Vec3 | undefined, right: Vec3 | undefined): number => {
  if (!left || !right) return 0;
  return Math.acos(clamp(dot(left, right), -1, 1));
};

const miterExtension = (inset: number, turn: number): number => (
  Math.min(ARENA_TUNING.floorWallCurveRadius * 0.3, inset * Math.tan(turn / 2))
);

const quaternionFromBasis = (xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quat => {
  const m00 = xAxis.x; const m01 = yAxis.x; const m02 = zAxis.x;
  const m10 = xAxis.y; const m11 = yAxis.y; const m12 = zAxis.y;
  const m20 = xAxis.z; const m21 = yAxis.z; const m22 = zAxis.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return { x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s, w: s / 4 };
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return { x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s, w: (m21 - m12) / s };
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return { x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s, w: (m02 - m20) / s };
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return { x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4, w: (m10 - m01) / s };
};

const pointOnArc = (fillet: Fillet, ratio: number): Vec2 => {
  const angle = fillet.startAngle + fillet.angleDelta * ratio;
  return {
    x: fillet.center.x + Math.cos(angle) * fillet.radius,
    z: fillet.center.z + Math.sin(angle) * fillet.radius,
  };
};

const add2 = (left: Vec2, right: Vec2): Vec2 => ({ x: left.x + right.x, z: left.z + right.z });
const sub2 = (left: Vec2, right: Vec2): Vec2 => ({ x: left.x - right.x, z: left.z - right.z });
const scale2 = (value: Vec2, amount: number): Vec2 => ({ x: value.x * amount, z: value.z * amount });
const dot2 = (left: Vec2, right: Vec2): number => left.x * right.x + left.z * right.z;
const distance2 = (left: Vec2, right: Vec2): number => Math.hypot(left.x - right.x, left.z - right.z);
const normalize2 = (value: Vec2): Vec2 => {
  const magnitude = Math.hypot(value.x, value.z);
  return magnitude > 0 ? scale2(value, 1 / magnitude) : { x: 0, z: 0 };
};
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
const shortestAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export const ARENA_BOUNDARY_SEGMENTS: readonly ArenaBoundarySegment[] = Object.freeze(
  sampleBoundarySections(createBoundarySections()),
);

const goalMouthZ = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;
const goalMouthTolerance = 0.000_01 * ARENA_TUNING.scale;
const flatBackWalls = ARENA_BOUNDARY_SEGMENTS.filter(({ kind, sectionType, midpoint, tangent }) => (
  kind === 'wall'
  && sectionType === 'straightWall'
  && Math.abs(tangent.z) < goalMouthTolerance
  && Math.abs(Math.abs(midpoint.z) - ARENA_TUNING.halfLength) < goalMouthTolerance
));

export const GOAL_MOUTH_BOUNDARY_HALF_WIDTH = Math.min(
  ...flatBackWalls.flatMap(({ start, end }) => [Math.abs(start.x), Math.abs(end.x)]),
);

export const ARENA_SURFACES: readonly ArenaSurface[] = Object.freeze([
  surface(0, -0.5, 0, ARENA_TUNING.halfWidth, 0.5, goalMouthZ, 'floor'),
  surface(0, ARENA_TUNING.height + 0.5, 0, ARENA_TUNING.halfWidth, 0.5, goalMouthZ, 'ceiling'),
  ...createWallSurfaces(),
  ...createHeaderSurfaces(),
  ...createGoalFloorAndRoof(-1),
  ...createGoalFloorAndRoof(1),
  ...createWallTransitionCurveSurfaces(),
]);

export const GOALS: readonly GoalDefinition[] = Object.freeze([
  {
    teamScored: 'coral',
    defendingTeam: 'azure',
    defendingEnd: 'north',
    center: { x: 0, y: ARENA_TUNING.goalHeight / 2, z: goalMouthZ },
  },
  {
    teamScored: 'azure',
    defendingTeam: 'coral',
    defendingEnd: 'south',
    center: { x: 0, y: ARENA_TUNING.goalHeight / 2, z: -goalMouthZ },
  },
]);
