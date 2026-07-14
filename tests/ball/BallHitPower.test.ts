import { describe, expect, it } from 'vitest';
import type { Quat } from '../../src/core/math/Quaternion';
import type { Vec3 } from '../../src/core/math/Vector3';
import { Ball } from '../../src/gameplay/ball/Ball';
import type { PhysicsBody } from '../../src/physics/PhysicsBody';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';

describe('ball hit power', () => {
  it('scales the velocity change without scaling existing momentum', () => {
    const body = new RecordingBody();
    const ball = new Ball({ createDynamicBody: () => body } as unknown as PhysicsWorld);
    body.velocity = { x: 10, y: 2, z: -4 };

    ball.amplifyVelocityChange({ x: 4, y: 2, z: -2 }, 2);

    expect(body.velocity).toEqual({ x: 16, y: 2, z: -6 });
  });
});

class RecordingBody implements PhysicsBody {
  readonly handle = 1;
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  position(): Vec3 { return { x: 0, y: 0, z: 0 }; }
  rotation(): Quat { return { x: 0, y: 0, z: 0, w: 1 }; }
  linearVelocity(): Vec3 { return this.velocity; }
  angularVelocity(): Vec3 { return { x: 0, y: 0, z: 0 }; }
  velocityAtPoint(): Vec3 { return this.velocity; }
  clearForces(): void {}
  clearTorques(): void {}
  applyForce(): void {}
  applyForceAtPoint(): void {}
  applyImpulse(): void {}
  applyTorqueImpulse(): void {}
  setPosition(): void {}
  setRotation(): void {}
  setLinearVelocity(velocity: Vec3): void { this.velocity = velocity; }
  setAngularVelocity(): void {}
  wakeUp(): void {}
}
