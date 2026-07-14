import { BALL_TUNING } from '../../core/config/BallTuning';
import { IDENTITY_QUAT } from '../../core/math/Quaternion';
import type { Vec3 } from '../../core/math/Vector3';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { BallState } from './BallState';

const BALL_SPAWN: Vec3 = { x: 0, y: BALL_TUNING.radius + 0.15, z: 0 };

export class Ball {
  private readonly body: PhysicsBody;

  constructor(world: PhysicsWorld) {
    this.body = world.createDynamicBody(
      { position: BALL_SPAWN, linearDamping: 0.025, angularDamping: 0.035, ccd: true },
      {
        shape: { type: 'ball', radius: BALL_TUNING.radius },
        mass: BALL_TUNING.mass,
        friction: BALL_TUNING.friction,
        restitution: BALL_TUNING.restitution,
        restitutionCombineRule: 'max',
      },
    );
  }

  state(): BallState {
    return {
      transform: { position: this.body.position(), rotation: this.body.rotation() },
      linearVelocity: this.body.linearVelocity(),
      angularVelocity: this.body.angularVelocity(),
    };
  }

  reset(): void {
    this.body.setPosition(BALL_SPAWN);
    this.body.setRotation(IDENTITY_QUAT);
    this.body.setLinearVelocity({ x: 0, y: 0, z: 0 });
    this.body.setAngularVelocity({ x: 0, y: 0, z: 0 });
    this.body.wakeUp();
  }
}
