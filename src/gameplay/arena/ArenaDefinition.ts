import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import type { Quat } from '../../core/math/Quaternion';
import { add, cross, distance, dot, normalize, scale, sub, type Vec3 } from '../../core/math/Vector3';

export type ArenaSurfaceKind = 'floor' | 'wall' | 'curve' | 'ceiling' | 'goal';

export interface ArenaSurface {
  readonly position: Vec3;
  readonly halfExtents: Vec3;
  readonly rotation: Quat;
  readonly kind: ArenaSurfaceKind;
}

export interface GoalDefinition {
  readonly teamScored: 'azure' | 'coral';
  readonly defendingTeam: 'azure' | 'coral';
  readonly defendingEnd: 'north' | 'south';
  readonly center: Vec3;
}

interface BoundarySegment {
  readonly midpoint: Vec3;
  readonly tangent: Vec3;
  readonly outward: Vec3;
  readonly halfSpan: number;
  readonly bottom: boolean;
  readonly top: boolean;
}

const yawRotation = (yaw: number): Quat => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
const surface = (x: number, y: number, z: number, hx: number, hy: number, hz: number, kind: ArenaSurfaceKind, yaw = 0): ArenaSurface => ({
  position: { x, y, z }, halfExtents: { x: hx, y: hy, z: hz }, rotation: yawRotation(yaw), kind,
});

const createCornerSurfaces = (): ArenaSurface[] => {
  const { halfWidth, halfLength, cornerRadius, height, verticalCurveRadius } = ARENA_TUNING;
  const surfaces: ArenaSurface[] = [];
  const segments = 7;
  const wallHalfHeight = (height - verticalCurveRadius * 2) / 2;
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const centerX = sx * (halfWidth - cornerRadius);
      const centerZ = sz * (halfLength - cornerRadius);
      for (let index = 0; index < segments; index += 1) {
        const a = (index / segments) * Math.PI * 0.5;
        const b = ((index + 1) / segments) * Math.PI * 0.5;
        const start = { x: centerX + sx * Math.cos(a) * cornerRadius, y: 0, z: centerZ + sz * Math.sin(a) * cornerRadius };
        const end = { x: centerX + sx * Math.cos(b) * cornerRadius, y: 0, z: centerZ + sz * Math.sin(b) * cornerRadius };
        const delta = sub(end, start);
        const segmentLength = distance(start, end);
        surfaces.push(surface(
          (start.x + end.x) / 2,
          height / 2,
          (start.z + end.z) / 2,
          segmentLength / 2 + 0.08,
          wallHalfHeight,
          0.45,
          'wall',
          Math.atan2(-delta.z, delta.x),
        ));
      }
    }
  }
  return surfaces;
};

const createEndSurfaces = (zSign: -1 | 1): ArenaSurface[] => {
  const {
    halfWidth,
    halfLength,
    cornerRadius,
    height,
    goalHalfWidth,
    goalHeight,
    goalDepth,
    verticalCurveRadius,
  } = ARENA_TUNING;
  const outerWidth = halfWidth - cornerRadius;
  const sideWidth = (outerWidth - goalHalfWidth) / 2;
  const z = zSign * (halfLength + 0.25);
  const goalZ = zSign * (halfLength + goalDepth);
  const wallHalfHeight = (height - verticalCurveRadius * 2) / 2;
  const headerTop = height - verticalCurveRadius;
  const headerHalfHeight = (headerTop - goalHeight) / 2;
  return [
    surface(-(goalHalfWidth + sideWidth), height / 2, z, sideWidth, wallHalfHeight, 0.5, 'wall'),
    surface(goalHalfWidth + sideWidth, height / 2, z, sideWidth, wallHalfHeight, 0.5, 'wall'),
    surface(0, goalHeight + headerHalfHeight, z, goalHalfWidth, headerHalfHeight, 0.5, 'wall'),
    surface(0, goalHeight + 0.3, zSign * (halfLength + goalDepth / 2), goalHalfWidth, 0.3, goalDepth / 2, 'goal'),
    surface(0, -0.3, zSign * (halfLength + goalDepth / 2), goalHalfWidth, 0.3, goalDepth / 2, 'goal'),
    surface(-(goalHalfWidth + 0.3), goalHeight / 2, zSign * (halfLength + goalDepth / 2), 0.3, goalHeight / 2, goalDepth / 2, 'goal'),
    surface(goalHalfWidth + 0.3, goalHeight / 2, zSign * (halfLength + goalDepth / 2), 0.3, goalHeight / 2, goalDepth / 2, 'goal'),
    surface(0, goalHeight / 2, goalZ, goalHalfWidth, goalHeight / 2, 0.4, 'goal'),
  ];
};

const createStraightBoundaries = (): BoundarySegment[] => {
  const { halfWidth, halfLength, cornerRadius, goalHalfWidth } = ARENA_TUNING;
  const wallBoundaryX = halfWidth - 0.25;
  const wallBoundaryZ = halfLength - 0.25;
  const outerWidth = halfWidth - cornerRadius;
  const sideWidth = (outerWidth - goalHalfWidth) / 2;
  const boundaries: BoundarySegment[] = [
    { midpoint: { x: -wallBoundaryX, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 }, outward: { x: -1, y: 0, z: 0 }, halfSpan: halfLength - cornerRadius, bottom: true, top: true },
    { midpoint: { x: wallBoundaryX, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 }, outward: { x: 1, y: 0, z: 0 }, halfSpan: halfLength - cornerRadius, bottom: true, top: true },
  ];
  for (const zSign of [-1, 1] as const) {
    const outward = { x: 0, y: 0, z: zSign };
    boundaries.push(
      { midpoint: { x: -(goalHalfWidth + sideWidth), y: 0, z: zSign * wallBoundaryZ }, tangent: { x: 1, y: 0, z: 0 }, outward, halfSpan: sideWidth, bottom: true, top: true },
      { midpoint: { x: goalHalfWidth + sideWidth, y: 0, z: zSign * wallBoundaryZ }, tangent: { x: 1, y: 0, z: 0 }, outward, halfSpan: sideWidth, bottom: true, top: true },
      { midpoint: { x: 0, y: 0, z: zSign * wallBoundaryZ }, tangent: { x: 1, y: 0, z: 0 }, outward, halfSpan: goalHalfWidth, bottom: false, top: true },
    );
  }
  return boundaries;
};

const createCornerBoundaries = (): BoundarySegment[] => {
  const { halfWidth, halfLength, cornerRadius } = ARENA_TUNING;
  const boundaries: BoundarySegment[] = [];
  const segments = 4;
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const center = { x: sx * (halfWidth - cornerRadius), y: 0, z: sz * (halfLength - cornerRadius) };
      for (let index = 0; index < segments; index += 1) {
        const a = (index / segments) * Math.PI * 0.5;
        const b = ((index + 1) / segments) * Math.PI * 0.5;
        const start = { x: center.x + sx * Math.cos(a) * cornerRadius, y: 0, z: center.z + sz * Math.sin(a) * cornerRadius };
        const end = { x: center.x + sx * Math.cos(b) * cornerRadius, y: 0, z: center.z + sz * Math.sin(b) * cornerRadius };
        const midpoint = scale(add(start, end), 0.5);
        const outward = normalize(sub(midpoint, center));
        boundaries.push({
          midpoint: sub(midpoint, scale(outward, 0.35)),
          tangent: normalize(sub(end, start)),
          outward,
          halfSpan: distance(start, end) / 2 + 0.08,
          bottom: true,
          top: true,
        });
      }
    }
  }
  return boundaries;
};

const createTransitionSurfaces = (): ArenaSurface[] => {
  const { height, verticalCurveRadius: radius, verticalCurveSegments: segments } = ARENA_TUNING;
  const boundaries = [...createStraightBoundaries(), ...createCornerBoundaries()];
  const surfaces: ArenaSurface[] = [];
  const halfThickness = 0.16;
  boundaries.forEach((boundary) => {
    for (const location of ['bottom', 'top'] as const) {
      if (!boundary[location]) continue;
      for (let index = 0; index < segments; index += 1) {
        const a = (index / segments) * Math.PI * 0.5;
        const b = ((index + 1) / segments) * Math.PI * 0.5;
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
        surfaces.push({
          position: add(surfaceMidpoint, scale(yAxis, halfThickness)),
          halfExtents: { x: boundary.halfSpan, y: halfThickness, z: distance(start, end) / 2 + 0.005 },
          rotation: quaternionFromBasis(xAxis, yAxis, zAxis),
          kind: 'curve',
        });
      }
    }
  });
  return surfaces;
};

const transitionPoint = (
  boundary: BoundarySegment,
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

export const ARENA_SURFACES: readonly ArenaSurface[] = Object.freeze([
  surface(0, -0.5, 0, ARENA_TUNING.halfWidth, 0.5, ARENA_TUNING.halfLength, 'floor'),
  surface(0, ARENA_TUNING.height + 0.5, 0, ARENA_TUNING.halfWidth, 0.5, ARENA_TUNING.halfLength, 'ceiling'),
  surface(
    -ARENA_TUNING.halfWidth - 0.25,
    ARENA_TUNING.height / 2,
    0,
    0.5,
    (ARENA_TUNING.height - ARENA_TUNING.verticalCurveRadius * 2) / 2,
    ARENA_TUNING.halfLength - ARENA_TUNING.cornerRadius,
    'wall',
  ),
  surface(
    ARENA_TUNING.halfWidth + 0.25,
    ARENA_TUNING.height / 2,
    0,
    0.5,
    (ARENA_TUNING.height - ARENA_TUNING.verticalCurveRadius * 2) / 2,
    ARENA_TUNING.halfLength - ARENA_TUNING.cornerRadius,
    'wall',
  ),
  ...createCornerSurfaces(),
  ...createEndSurfaces(-1),
  ...createEndSurfaces(1),
  ...createTransitionSurfaces(),
]);

export const GOALS: readonly GoalDefinition[] = Object.freeze([
  {
    teamScored: 'coral',
    defendingTeam: 'azure',
    defendingEnd: 'north',
    center: { x: 0, y: ARENA_TUNING.goalHeight / 2, z: ARENA_TUNING.halfLength },
  },
  {
    teamScored: 'azure',
    defendingTeam: 'coral',
    defendingEnd: 'south',
    center: { x: 0, y: ARENA_TUNING.goalHeight / 2, z: -ARENA_TUNING.halfLength },
  },
]);
