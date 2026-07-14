import type { Vec3 } from '../../core/math/Vector3';

export const WHEEL_CONNECTIONS: readonly Vec3[] = Object.freeze([
  { x: -0.92, y: -0.2, z: -1.05 },
  { x: 0.92, y: -0.2, z: -1.05 },
  { x: -0.92, y: -0.2, z: 1.05 },
  { x: 0.92, y: -0.2, z: 1.05 },
]);

export interface WheelState {
  readonly connectionPoint: Vec3;
  readonly contactPoint: Vec3;
  readonly position: Vec3;
  readonly grounded: boolean;
  readonly suspensionLength: number;
  readonly steeringAngle: number;
  readonly spinAngle: number;
}
