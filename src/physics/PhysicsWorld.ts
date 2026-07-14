import type { Vec3 } from '../core/math/Vector3';
import type { PhysicsBody } from './PhysicsBody';
import type { BodyOptions, ColliderOptions, RayHit } from './PhysicsTypes';

export interface PhysicsWorld {
  createDynamicBody(body: BodyOptions, collider: ColliderOptions): PhysicsBody;
  createFixedCollider(body: BodyOptions, collider: ColliderOptions): void;
  castRay(
    origin: Vec3,
    direction: Vec3,
    maximumDistance: number,
    excludedBody?: PhysicsBody,
    fixedBodiesOnly?: boolean,
  ): RayHit | null;
  synchronizeSceneQueries(): void;
  contactingBodyHandles(body: PhysicsBody): readonly number[];
  step(deltaSeconds: number): void;
  dispose(): void;
}
