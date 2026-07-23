import type { Vec3 } from '../../core/math/Vector3';
import type { Transform } from '../../core/types/Transform';
import type { WheelState } from './WheelState';

export interface SurfaceRayDebug {
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly length: number;
  readonly hitPoint: Vec3 | null;
}

export interface CarSurfaceDebug {
  readonly grounded: boolean;
  readonly rays: readonly SurfaceRayDebug[];
  readonly surfaceNormal: Vec3 | null;
  readonly projectedForward: Vec3;
  readonly velocity: Vec3;
  readonly tangentVelocity: Vec3;
  readonly adhesionForce: Vec3;
  readonly throttleForce: Vec3;
}

export interface CarState {
  readonly transform: Transform;
  readonly linearVelocity: Vec3;
  readonly angularVelocity: Vec3;
  readonly wheels: readonly WheelState[];
  readonly grounded: boolean;
  readonly boost: number;
  readonly boosting: boolean;
  /** Normal of the surface carrying the wheels; null while airborne. */
  readonly surfaceNormal?: Vec3 | null;
  readonly surfaceDebug?: CarSurfaceDebug;
}
