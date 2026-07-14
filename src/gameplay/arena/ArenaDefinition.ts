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
}

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

interface BoundaryVertex {
  readonly point: Vec2;
  readonly radius: number;
  readonly arcKind: 'wall' | 'goal';
  readonly edgeKind: 'wall' | 'goal';
}

interface Fillet {
  readonly start: Vec2;
  readonly end: Vec2;
  readonly center: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  readonly angleDelta: number;
}

interface TransitionBoundary {
  readonly midpoint: Vec3;
  readonly tangent: Vec3;
  readonly outward: Vec3;
  readonly halfSpan: number;
  readonly startTurn: number;
  readonly endTurn: number;
  readonly bottom: boolean;
  readonly top: boolean;
}

const WALL_HALF_THICKNESS = 0.45;
const SEGMENT_OVERLAP = 0.08;

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

const createBoundaryVertices = (): readonly BoundaryVertex[] => {
  const {
    halfWidth,
    halfLength,
    goalHalfWidth,
    goalDepth,
    goalTransitionOuterX,
    goalTransitionDepth,
    goalTransitionRadius,
    goalBackCornerRadius,
    cornerRadius,
  } = ARENA_TUNING;
  const mouthZ = halfLength + goalTransitionDepth;
  const rearZ = mouthZ + goalDepth;
  const wall = 'wall' as const;
  const goal = 'goal' as const;

  // Clockwise ordering keeps the playable area on the right of every segment.
  return [
    { point: { x: -goalHalfWidth, z: rearZ }, radius: goalBackCornerRadius, arcKind: goal, edgeKind: goal },
    { point: { x: goalHalfWidth, z: rearZ }, radius: goalBackCornerRadius, arcKind: goal, edgeKind: goal },
    { point: { x: goalHalfWidth, z: mouthZ }, radius: goalTransitionRadius, arcKind: goal, edgeKind: wall },
    { point: { x: goalTransitionOuterX, z: halfLength }, radius: goalTransitionRadius, arcKind: wall, edgeKind: wall },
    { point: { x: halfWidth, z: halfLength }, radius: cornerRadius, arcKind: wall, edgeKind: wall },
    { point: { x: halfWidth, z: -halfLength }, radius: cornerRadius, arcKind: wall, edgeKind: wall },
    { point: { x: goalTransitionOuterX, z: -halfLength }, radius: goalTransitionRadius, arcKind: wall, edgeKind: wall },
    { point: { x: goalHalfWidth, z: -mouthZ }, radius: goalTransitionRadius, arcKind: goal, edgeKind: goal },
    { point: { x: goalHalfWidth, z: -rearZ }, radius: goalBackCornerRadius, arcKind: goal, edgeKind: goal },
    { point: { x: -goalHalfWidth, z: -rearZ }, radius: goalBackCornerRadius, arcKind: goal, edgeKind: goal },
    { point: { x: -goalHalfWidth, z: -mouthZ }, radius: goalTransitionRadius, arcKind: goal, edgeKind: wall },
    { point: { x: -goalTransitionOuterX, z: -halfLength }, radius: goalTransitionRadius, arcKind: wall, edgeKind: wall },
    { point: { x: -halfWidth, z: -halfLength }, radius: cornerRadius, arcKind: wall, edgeKind: wall },
    { point: { x: -halfWidth, z: halfLength }, radius: cornerRadius, arcKind: wall, edgeKind: wall },
    { point: { x: -goalTransitionOuterX, z: halfLength }, radius: goalTransitionRadius, arcKind: wall, edgeKind: wall },
    { point: { x: -goalHalfWidth, z: mouthZ }, radius: goalTransitionRadius, arcKind: goal, edgeKind: goal },
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

const createHorizontalBoundary = (): ArenaBoundarySegment[] => {
  const vertices = createBoundaryVertices();
  const fillets = vertices.map(({ point, radius }, index) => createFillet(
    vertices[(index - 1 + vertices.length) % vertices.length]?.point ?? point,
    point,
    vertices[(index + 1) % vertices.length]?.point ?? point,
    radius,
  ));
  const segments: ArenaBoundarySegment[] = [];

  vertices.forEach((vertex, index) => {
    const fillet = fillets[index];
    const nextFillet = fillets[(index + 1) % fillets.length];
    if (!fillet || !nextFillet) return;
    pushBoundarySegment(segments, fillet.end, nextFillet.start, vertex.edgeKind, false);

    const arc = nextFillet;
    const arcKind = vertices[(index + 1) % vertices.length]?.arcKind ?? 'wall';
    const segmentCount = Math.max(6, Math.ceil(
      Math.abs(arc.angleDelta) / (Math.PI / 2)
      * ARENA_TUNING.horizontalCurveSegments
      * Math.sqrt(arc.radius / ARENA_TUNING.cornerRadius),
    ));
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const startRatio = segmentIndex / segmentCount;
      const endRatio = (segmentIndex + 1) / segmentCount;
      const start = segmentIndex === 0
        ? arc.start
        : pointOnArc(arc, startRatio);
      const end = segmentIndex === segmentCount - 1
        ? arc.end
        : pointOnArc(arc, endRatio);
      pushBoundarySegment(segments, start, end, arcKind, true);
    }
  });
  return segments;
};

const pushBoundarySegment = (
  segments: ArenaBoundarySegment[],
  start2D: Vec2,
  end2D: Vec2,
  kind: 'wall' | 'goal',
  curve: boolean,
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
    curve,
  });
};

const createWallSurfaces = (): ArenaSurface[] => ARENA_BOUNDARY_SEGMENTS.map((boundary) => {
  const isGoal = boundary.kind === 'goal';
  const halfHeight = isGoal
    ? ARENA_TUNING.goalHeight / 2
    : (ARENA_TUNING.height - ARENA_TUNING.verticalCurveRadius * 2) / 2;
  const centerHeight = isGoal ? halfHeight : ARENA_TUNING.height / 2;
  const position = add(boundary.midpoint, scale(boundary.outward, WALL_HALF_THICKNESS));
  return {
    ...surface(
      position.x,
      centerHeight,
      position.z,
      boundary.halfSpan + SEGMENT_OVERLAP,
      halfHeight,
      WALL_HALF_THICKNESS,
      boundary.kind,
      Math.atan2(-boundary.tangent.z, boundary.tangent.x),
    ),
    glass: true,
  };
});

const createHeaderBoundaries = (): TransitionBoundary[] => {
  const mouthZ = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;
  return ([-1, 1] as const).map((zSign) => ({
    midpoint: { x: 0, y: 0, z: zSign * mouthZ },
    tangent: { x: 1, y: 0, z: 0 },
    outward: { x: 0, y: 0, z: zSign },
    halfSpan: ARENA_TUNING.goalHalfWidth,
    startTurn: 0,
    endTurn: 0,
    bottom: false,
    top: true,
  }));
};

const createHeaderSurfaces = (): ArenaSurface[] => {
  const headerTop = ARENA_TUNING.height - ARENA_TUNING.verticalCurveRadius;
  const halfHeight = (headerTop - ARENA_TUNING.goalHeight) / 2;
  return createHeaderBoundaries().map((boundary) => {
    const position = add(boundary.midpoint, scale(boundary.outward, WALL_HALF_THICKNESS));
    return surface(
      position.x,
      ARENA_TUNING.goalHeight + halfHeight,
      position.z,
      boundary.halfSpan,
      halfHeight,
      WALL_HALF_THICKNESS,
      'wall',
    );
  });
};

const createGoalFloorAndRoof = (zSign: -1 | 1): ArenaSurface[] => {
  const mouthZ = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;
  const centerZ = zSign * (mouthZ + ARENA_TUNING.goalDepth / 2);
  return [
    surface(0, -0.3, centerZ, ARENA_TUNING.goalHalfWidth, 0.3, ARENA_TUNING.goalDepth / 2, 'goal'),
    {
      ...surface(
        0,
        ARENA_TUNING.goalHeight + 0.3,
        centerZ,
        ARENA_TUNING.goalHalfWidth,
        0.3,
        ARENA_TUNING.goalDepth / 2,
        'goal',
      ),
      glass: true,
    },
  ];
};

const createTransitionSurfaces = (): ArenaSurface[] => {
  const { height, verticalCurveRadius: radius, verticalCurveSegments: segmentCount } = ARENA_TUNING;
  const boundaries: TransitionBoundary[] = [
    ...ARENA_BOUNDARY_SEGMENTS
      .flatMap((boundary, index, allBoundaries) => {
        if (boundary.kind !== 'wall') return [];
        const previous = allBoundaries[(index - 1 + allBoundaries.length) % allBoundaries.length];
        const next = allBoundaries[(index + 1) % allBoundaries.length];
        return [{
          midpoint: boundary.midpoint,
          tangent: boundary.tangent,
          outward: boundary.outward,
          halfSpan: boundary.halfSpan,
          startTurn: tangentTurn(previous?.tangent, boundary.tangent),
          endTurn: tangentTurn(boundary.tangent, next?.tangent),
          bottom: true,
          top: true,
        }];
      }),
    ...createHeaderBoundaries(),
  ];
  const surfaces: ArenaSurface[] = [];
  const halfThickness = 0.16;

  boundaries.forEach((boundary) => {
    for (const location of ['bottom', 'top'] as const) {
      if (!boundary[location]) continue;
      for (let index = 0; index < segmentCount; index += 1) {
        const a = (index / segmentCount) * Math.PI * 0.5;
        const b = ((index + 1) / segmentCount) * Math.PI * 0.5;
        const start = transitionPoint(boundary, location, a, radius, height);
        const end = transitionPoint(boundary, location, b, radius, height);
        const crossDirection = normalize(sub(end, start));
        let xAxis = normalize(boundary.tangent);
        const zAxis = crossDirection;
        let yAxis = normalize(cross(zAxis, xAxis));
        if (dot(yAxis, boundary.outward) < 0) {
          xAxis = scale(xAxis, -1);
          yAxis = scale(yAxis, -1);
        }
        const surfaceMidpoint = scale(add(start, end), 0.5);
        const maximumInset = location === 'bottom'
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
            x: boundary.halfSpan + (startExtension + endExtension) / 2 + 0.015,
            y: halfThickness,
            z: distance(start, end) / 2 + 0.005,
          },
          rotation: quaternionFromBasis(xAxis, yAxis, zAxis),
          kind: 'curve',
          glass: true,
        });
      }
    }
  });
  return surfaces;
};

const transitionPoint = (
  boundary: TransitionBoundary,
  location: 'bottom' | 'top',
  angle: number,
  radius: number,
  height: number,
): Vec3 => {
  if (location === 'bottom') {
    return add(
      sub(boundary.midpoint, scale(boundary.outward, radius * (1 - Math.sin(angle)))),
      { x: 0, y: radius * (1 - Math.cos(angle)), z: 0 },
    );
  }
  return add(
    sub(boundary.midpoint, scale(boundary.outward, radius * (1 - Math.cos(angle)))),
    { x: 0, y: height - radius + radius * Math.sin(angle), z: 0 },
  );
};

const tangentTurn = (left: Vec3 | undefined, right: Vec3 | undefined): number => {
  if (!left || !right) return 0;
  return Math.acos(clamp(dot(left, right), -1, 1));
};

const miterExtension = (inset: number, turn: number): number => (
  Math.min(ARENA_TUNING.verticalCurveRadius * 0.3, inset * Math.tan(turn / 2))
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

export const ARENA_BOUNDARY_SEGMENTS: readonly ArenaBoundarySegment[] = Object.freeze(createHorizontalBoundary());

const goalMouthZ = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;

export const ARENA_SURFACES: readonly ArenaSurface[] = Object.freeze([
  surface(0, -0.5, 0, ARENA_TUNING.halfWidth, 0.5, goalMouthZ, 'floor'),
  surface(0, ARENA_TUNING.height + 0.5, 0, ARENA_TUNING.halfWidth, 0.5, goalMouthZ, 'ceiling'),
  ...createWallSurfaces(),
  ...createHeaderSurfaces(),
  ...createGoalFloorAndRoof(-1),
  ...createGoalFloorAndRoof(1),
  ...createTransitionSurfaces(),
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
