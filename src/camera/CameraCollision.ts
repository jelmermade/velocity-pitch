import type * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export class CameraCollision {
  constructor(
    private readonly world: PhysicsWorld,
    private readonly padding: number,
  ) {}

  resolve(anchor: THREE.Vector3, desired: THREE.Vector3): THREE.Vector3 {
    const offset = desired.clone().sub(anchor);
    const distance = offset.length();
    if (distance < 0.01) return desired;
    const direction = offset.multiplyScalar(1 / distance);
    const hit = this.world.castRay(anchor, direction, distance, undefined, true);
    if (!hit) return desired;
    return anchor.clone().addScaledVector(direction, Math.max(0.4, hit.distance - this.padding));
  }
}
