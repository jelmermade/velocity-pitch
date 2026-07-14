import type { Vec3 } from '../../core/math/Vector3';
import type { Transform } from '../../core/types/Transform';

export interface BallState {
  readonly transform: Transform;
  readonly linearVelocity: Vec3;
  readonly angularVelocity: Vec3;
}
