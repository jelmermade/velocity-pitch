import type { Quat } from '../math/Quaternion';
import type { Vec3 } from '../math/Vector3';

export interface Transform {
  readonly position: Vec3;
  readonly rotation: Quat;
}
