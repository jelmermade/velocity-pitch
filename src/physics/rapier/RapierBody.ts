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
    assertFiniteVector(point, 'velocityAtPoint');
    return fromRapierVector(this.raw.velocityAtPoint(point));
  }

  clearForces(): void { this.raw.resetForces(true); }
  clearTorques(): void { this.raw.resetTorques(true); }
  applyForce(force: Vec3): void {
    assertFiniteVector(force, 'applyForce');
    this.raw.addForce(force, true);
  }
  applyForceAtPoint(force: Vec3, point: Vec3): void {
    assertFiniteVector(force, 'applyForceAtPoint force');
    assertFiniteVector(point, 'applyForceAtPoint point');
    this.raw.addForceAtPoint(force, point, true);
  }
  applyImpulse(impulse: Vec3): void {
    assertFiniteVector(impulse, 'applyImpulse');
    this.raw.applyImpulse(impulse, true);
  }
  applyTorqueImpulse(torque: Vec3): void {
    assertFiniteVector(torque, 'applyTorqueImpulse');
    this.raw.applyTorqueImpulse(torque, true);
  }
  setPosition(position: Vec3): void {
    assertFiniteVector(position, 'setPosition');
    this.raw.setTranslation(position, true);
  }
  setRotation(rotation: Quat): void {
    if (![rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)) {
      throw new Error(`RapierBody.setRotation received a non-finite quaternion: ${JSON.stringify(rotation)}`);
    }
    this.raw.setRotation(rotation, true);
  }
  setLinearVelocity(velocity: Vec3): void {
    assertFiniteVector(velocity, 'setLinearVelocity');
    this.raw.setLinvel(velocity, true);
  }
  setAngularVelocity(velocity: Vec3): void {
    assertFiniteVector(velocity, 'setAngularVelocity');
    this.raw.setAngvel(velocity, true);
  }
  setEnabled(enabled: boolean): void { this.raw.setEnabled(enabled); }
  wakeUp(): void { this.raw.wakeUp(); }
}

const assertFiniteVector = (value: Vec3, operation: string): void => {
  if ([value.x, value.y, value.z].every(Number.isFinite)) return;
  throw new Error(`RapierBody.${operation} received a non-finite vector: ${JSON.stringify(value)}`);
};
