import type { Vec3 } from '../../core/math/Vector3';

export const WHEEL_BASE = 2.1;
export const WHEEL_MOUNT_Y = -0.2;

export const WHEEL_CONNECTIONS: readonly Vec3[] = Object.freeze([
  { x: -0.92, y: WHEEL_MOUNT_Y, z: -WHEEL_BASE * 0.5 },
  { x: 0.92, y: WHEEL_MOUNT_Y, z: -WHEEL_BASE * 0.5 },
  { x: -0.92, y: WHEEL_MOUNT_Y, z: WHEEL_BASE * 0.5 },
  { x: 0.92, y: WHEEL_MOUNT_Y, z: WHEEL_BASE * 0.5 },
]);

export interface WheelState {
  readonly connectionPoint: Vec3;
  readonly contactPoint: Vec3;
  readonly position: Vec3;
  readonly grounded: boolean;
  /** Retained in snapshots for compatibility; rigid wheel mounts always report zero travel. */
  readonly suspensionLength: number;
  readonly steeringAngle: number;
  readonly spinAngle: number;
}
