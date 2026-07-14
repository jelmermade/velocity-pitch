import type RAPIER from '@dimforge/rapier3d-compat';
import type { Quat } from '../../core/math/Quaternion';
import type { Vec3 } from '../../core/math/Vector3';
import type { PhysicsBody } from '../PhysicsBody';
import { fromRapierRotation, fromRapierVector } from './RapierConversions';

export class RapierBody implements PhysicsBody {
  constructor(readonly raw: RAPIER.RigidBody) {}

  get handle(): number {
    return this.raw.handle;
  }

  position(): Vec3 { return fromRapierVector(this.raw.translation()); }
  rotation(): Quat { return fromRapierRotation(this.raw.rotation()); }
  linearVelocity(): Vec3 { return fromRapierVector(this.raw.linvel()); }
  angularVelocity(): Vec3 { return fromRapierVector(this.raw.angvel()); }

  velocityAtPoint(point: Vec3): Vec3 {
    return fromRapierVector(this.raw.velocityAtPoint(point));
  }

  clearForces(): void { this.raw.resetForces(true); }
  clearTorques(): void { this.raw.resetTorques(true); }
  applyForce(force: Vec3): void { this.raw.addForce(force, true); }
  applyForceAtPoint(force: Vec3, point: Vec3): void { this.raw.addForceAtPoint(force, point, true); }
  applyImpulse(impulse: Vec3): void { this.raw.applyImpulse(impulse, true); }
  applyTorqueImpulse(torque: Vec3): void { this.raw.applyTorqueImpulse(torque, true); }
  setPosition(position: Vec3): void { this.raw.setTranslation(position, true); }
  setRotation(rotation: Quat): void { this.raw.setRotation(rotation, true); }
  setLinearVelocity(velocity: Vec3): void { this.raw.setLinvel(velocity, true); }
  setAngularVelocity(velocity: Vec3): void { this.raw.setAngvel(velocity, true); }
  setEnabled(enabled: boolean): void { this.raw.setEnabled(enabled); }
  wakeUp(): void { this.raw.wakeUp(); }
}
