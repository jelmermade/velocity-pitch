import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CameraCollision } from '../../src/camera/CameraCollision';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { createArena } from '../../src/gameplay/arena/Arena';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';

describe('CameraCollision', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => {
    world?.dispose();
    world = undefined;
  });

  it('detects arena walls after scene queries synchronize without advancing simulation', async () => {
    world = await RapierPhysicsWorld.create();
    createArena(world);
    world.synchronizeSceneQueries();
    const collision = new CameraCollision(world, 0.35);
    const anchor = new THREE.Vector3(ARENA_TUNING.halfWidth - 3, 4, 0);
    const desired = new THREE.Vector3(ARENA_TUNING.halfWidth + 4, 4, 0);

    const resolved = collision.resolve(anchor, desired);

    expect(resolved.x).toBeLessThan(ARENA_TUNING.halfWidth);
  });
});
