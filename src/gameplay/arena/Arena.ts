import { rotateVector } from '../../core/math/Quaternion';
import { add, type Vec3 } from '../../core/math/Vector3';
import type { ColliderShape } from '../../physics/PhysicsTypes';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { ARENA_SURFACES, type ArenaSurface } from './ArenaDefinition';

const WELD_PRECISION = 100_000;

export const createArenaTransitionCollisionMesh = (
  surfaces: readonly ArenaSurface[] = ARENA_SURFACES,
): Extract<ColliderShape, { readonly type: 'trimesh' }> => {
  const vertices: Vec3[] = [];
  const indices: number[] = [];
  const weldedVertices = new Map<string, number>();
  const triangles = new Set<string>();
  const vertexIndex = (vertex: Vec3): number => {
    const key = [vertex.x, vertex.y, vertex.z]
      .map((component) => Math.round(component * WELD_PRECISION))
      .join(':');
    const existing = weldedVertices.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length;
    vertices.push(vertex);
    weldedVertices.set(key, index);
    return index;
  };
  const addTriangle = (a: number, b: number, c: number): void => {
    const signature = [a, b, c].sort((left, right) => left - right).join(':');
    if (triangles.has(signature) || a === b || b === c || a === c) return;
    triangles.add(signature);
    indices.push(a, b, c);
  };

  surfaces.filter(({ kind }) => kind === 'curve').forEach((surface) => {
    // Only the inward playable face is needed. Removing the boxes also removes their
    // side faces, which acted as small collision lips at every profile segment.
    const { x, y, z } = surface.halfExtents;
    const localCorners: readonly Vec3[] = [
      { x: -x, y: -y, z: -z },
      { x, y: -y, z: -z },
      { x, y: -y, z },
      { x: -x, y: -y, z },
    ];
    const [a, b, c, d] = localCorners.map((corner) => vertexIndex(add(
      surface.position,
      rotateVector(surface.rotation, corner),
    ))) as [number, number, number, number];
    addTriangle(a, b, c);
    addTriangle(a, c, d);
  });
  return { type: 'trimesh', vertices, indices };
};

export const createArena = (world: PhysicsWorld): void => {
  ARENA_SURFACES.filter(({ kind }) => kind !== 'curve').forEach((surface) => {
    world.createFixedCollider(
      { position: surface.position, rotation: surface.rotation },
      {
        shape: { type: 'box', halfExtents: surface.halfExtents },
        // Car grip is supplied by WheelContactSystem, not rigid-body contact friction.
        friction: surface.kind === 'floor' ? 0.35 : 0.1,
        restitution: surface.kind === 'floor' ? 0.35 : 0.62,
      },
    );
  });
  world.createFixedCollider(
    { position: { x: 0, y: 0, z: 0 } },
    {
      shape: createArenaTransitionCollisionMesh(),
      friction: 0.02,
      restitution: 0,
    },
  );
};
