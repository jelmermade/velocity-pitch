import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_TUNING } from '../../core/config/PhysicsTuning';
import type { Vec3 } from '../../core/math/Vector3';
import type { PhysicsBody } from '../PhysicsBody';
import type { PhysicsWorld } from '../PhysicsWorld';
import type { BodyOptions, CoefficientCombineRule, ColliderOptions, RayHit } from '../PhysicsTypes';
import { RapierBody } from './RapierBody';

export class RapierPhysicsWorld implements PhysicsWorld {
  private constructor(private readonly world: RAPIER.World) {}

  static async create(): Promise<RapierPhysicsWorld> {
    await RAPIER.init();
    return new RapierPhysicsWorld(new RAPIER.World(PHYSICS_TUNING.gravity));
  }

  createDynamicBody(
    options: BodyOptions,
    colliderOptions: ColliderOptions | readonly ColliderOptions[],
  ): PhysicsBody {
    let descriptor = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(options.position.x, options.position.y, options.position.z)
      .setLinearDamping(options.linearDamping ?? 0)
      .setAngularDamping(options.angularDamping ?? 0)
      .setCcdEnabled(options.ccd ?? false);
    if (options.rotation) descriptor = descriptor.setRotation(options.rotation);
    const body = this.world.createRigidBody(descriptor);
    const colliders = 'shape' in colliderOptions ? [colliderOptions] : colliderOptions;
    colliders.forEach((optionsForCollider) => {
      this.world.createCollider(this.createColliderDescriptor(optionsForCollider), body);
    });
    return new RapierBody(body);
  }

  createFixedCollider(options: BodyOptions, colliderOptions: ColliderOptions): void {
    let descriptor = RAPIER.RigidBodyDesc.fixed().setTranslation(options.position.x, options.position.y, options.position.z);
    if (options.rotation) descriptor = descriptor.setRotation(options.rotation);
    const body = this.world.createRigidBody(descriptor);
    this.world.createCollider(this.createColliderDescriptor(colliderOptions), body);
  }

  castRay(
    origin: Vec3,
    direction: Vec3,
    maximumDistance: number,
    excludedBody?: PhysicsBody,
    fixedBodiesOnly = false,
  ): RayHit | null {
    const ray = new RAPIER.Ray(origin, direction);
    const excluded = excludedBody instanceof RapierBody ? excludedBody.raw : undefined;
    const filterFlags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
      | (fixedBodiesOnly ? RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC : 0);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maximumDistance,
      true,
      filterFlags,
      undefined,
      undefined,
      excluded,
    );
    if (!hit) return null;
    const point = ray.pointAt(hit.timeOfImpact);
    return {
      point: { x: point.x, y: point.y, z: point.z },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      distance: hit.timeOfImpact,
      bodyHandle: hit.collider.parent()?.handle ?? null,
    };
  }

  synchronizeSceneQueries(): void {
    const timestep = this.world.timestep;
    try {
      this.world.timestep = 0;
      this.world.step();
    } finally {
      this.world.timestep = timestep;
    }
  }

  contactingBodyHandles(body: PhysicsBody): readonly number[] {
    if (!(body instanceof RapierBody) || body.raw.numColliders() === 0) return [];
    const handles = new Set<number>();
    for (let index = 0; index < body.raw.numColliders(); index += 1) {
      this.world.contactPairsWith(body.raw.collider(index), (other) => {
        const handle = other.parent()?.handle;
        if (handle !== undefined) handles.add(handle);
      });
    }
    return [...handles];
  }

  step(deltaSeconds: number): void {
    this.world.timestep = deltaSeconds;
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }

  private createColliderDescriptor(options: ColliderOptions): RAPIER.ColliderDesc {
    let descriptor: RAPIER.ColliderDesc;
    switch (options.shape.type) {
      case 'box':
        descriptor = RAPIER.ColliderDesc.cuboid(options.shape.halfExtents.x, options.shape.halfExtents.y, options.shape.halfExtents.z);
        break;
      case 'roundBox':
        descriptor = RAPIER.ColliderDesc.roundCuboid(
          options.shape.halfExtents.x,
          options.shape.halfExtents.y,
          options.shape.halfExtents.z,
          options.shape.borderRadius,
        );
        break;
      case 'roundConvexHull': {
        const points = new Float32Array(options.shape.points.flatMap(({ x, y, z }) => [x, y, z]));
        const hull = RAPIER.ColliderDesc.roundConvexHull(points, options.shape.borderRadius);
        if (!hull) throw new Error('Unable to construct rounded convex collider');
        descriptor = hull;
        break;
      }
      case 'ball':
        descriptor = RAPIER.ColliderDesc.ball(options.shape.radius);
        break;
    }
    if (options.localPosition) {
      descriptor.setTranslation(
        options.localPosition.x,
        options.localPosition.y,
        options.localPosition.z,
      );
    }
    if (options.mass !== undefined) descriptor.setMass(options.mass);
    descriptor.setFriction(options.friction ?? 0.7);
    descriptor.setRestitution(options.restitution ?? 0.1);
    descriptor.setFrictionCombineRule(toRapierCombineRule(options.frictionCombineRule ?? 'average'));
    descriptor.setRestitutionCombineRule(toRapierCombineRule(options.restitutionCombineRule ?? 'average'));
    descriptor.setSensor(options.sensor ?? false);
    return descriptor;
  }
}

const toRapierCombineRule = (rule: CoefficientCombineRule): RAPIER.CoefficientCombineRule => {
  switch (rule) {
    case 'average': return RAPIER.CoefficientCombineRule.Average;
    case 'min': return RAPIER.CoefficientCombineRule.Min;
    case 'multiply': return RAPIER.CoefficientCombineRule.Multiply;
    case 'max': return RAPIER.CoefficientCombineRule.Max;
  }
};
