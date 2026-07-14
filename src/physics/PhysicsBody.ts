import type { Quat } from '../core/math/Quaternion';
import type { Vec3 } from '../core/math/Vector3';

export interface PhysicsBody {
  readonly handle: number;
  position(): Vec3;
  rotation(): Quat;
  linearVelocity(): Vec3;
  angularVelocity(): Vec3;
  velocityAtPoint(point: Vec3): Vec3;
  clearForces(): void;
  clearTorques(): void;
  applyForce(force: Vec3): void;
  applyForceAtPoint(force: Vec3, point: Vec3): void;
  applyImpulse(impulse: Vec3): void;
  applyTorqueImpulse(torque: Vec3): void;
  setPosition(position: Vec3): void;
  setRotation(rotation: Quat): void;
  setLinearVelocity(velocity: Vec3): void;
  setAngularVelocity(velocity: Vec3): void;
  setEnabled(enabled: boolean): void;
  wakeUp(): void;
}
