import type { Vec3 } from '../../core/math/Vector3';

export interface WheelState {
  readonly connectionPoint: Vec3;
  readonly contactPoint: Vec3;
  readonly position: Vec3;
  readonly grounded: boolean;
  readonly suspensionLength: number;
  readonly steeringAngle: number;
  readonly spinAngle: number;
}
