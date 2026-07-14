import type { Vec3 } from '../../core/math/Vector3';
import type { Transform } from '../../core/types/Transform';
import type { WheelState } from './WheelState';

export interface CarState {
  readonly transform: Transform;
  readonly linearVelocity: Vec3;
  readonly angularVelocity: Vec3;
  readonly wheels: readonly WheelState[];
  readonly grounded: boolean;
  readonly boost: number;
  readonly boosting: boolean;
}
