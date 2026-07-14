import { DEFAULT_CAR_TUNING, type CarTuning } from '../../core/config/CarTuning';
import { IDENTITY_QUAT } from '../../core/math/Quaternion';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { PlayerCommand } from '../../input/PlayerCommand';
import type { Transform } from '../../core/types/Transform';
import { ZERO, type Vec3 } from '../../core/math/Vector3';
import { CarController } from './CarController';
import type { CarState } from './CarState';
import { WHEEL_CONNECTIONS } from './WheelState';

export interface CarSpawn {
  readonly position: Vec3;
  readonly rotation: typeof IDENTITY_QUAT;
}

export const DEFAULT_CAR_SPAWN: CarSpawn = Object.freeze({
  position: { x: 0, y: 0.62, z: 23 },
  rotation: IDENTITY_QUAT,
});
export class Car {
  private readonly body: PhysicsBody;
  private readonly controller: CarController;
  private readonly initialWheels;
  private controlState: Pick<CarState, 'wheels' | 'grounded' | 'boost' | 'boosting'>;

  constructor(
    world: PhysicsWorld,
    tuning: CarTuning = DEFAULT_CAR_TUNING,
    private readonly spawn: CarSpawn = DEFAULT_CAR_SPAWN,
  ) {
    this.controller = new CarController(tuning);
    this.initialWheels = WHEEL_CONNECTIONS.map(({ x, y, z }) => ({
      connectionPoint: { x, y: spawn.position.y + y, z: spawn.position.z + z },
      contactPoint: { x, y: 0, z: spawn.position.z + z },
      position: { x, y: tuning.wheelRadius, z: spawn.position.z + z },
      grounded: true,
      suspensionLength: spawn.position.y - 0.2 - tuning.wheelRadius,
      steeringAngle: 0,
      spinAngle: 0,
    }));
    this.controlState = { wheels: this.initialWheels, grounded: true, boost: 100, boosting: false };
    this.body = world.createDynamicBody(
      { position: spawn.position, rotation: spawn.rotation, linearDamping: 0.08, angularDamping: 0.5, ccd: true },
      {
        shape: { type: 'roundConvexHull', points: tuning.colliderPoints, borderRadius: tuning.colliderBorderRadius },
        mass: tuning.mass,
        friction: 0.5,
        restitution: 0,
        restitutionCombineRule: 'min',
      },
    );
  }

  update(world: PhysicsWorld, command: PlayerCommand, deltaSeconds: number): void {
    this.controlState = this.controller.update(world, this.body, command, deltaSeconds);
  }

  state(): CarState {
    return {
      transform: { position: this.body.position(), rotation: this.body.rotation() },
      linearVelocity: this.body.linearVelocity(),
      angularVelocity: this.body.angularVelocity(),
      ...this.controlState,
    };
  }

  collectBoost(amount: number): number {
    const collected = this.controller.addBoost(amount);
    this.controlState = { ...this.controlState, boost: this.controlState.boost + collected };
    return collected;
  }

  applyImpulse(impulse: Vec3): void {
    this.body.applyImpulse(impulse);
  }

  teleport(transform: Transform, linearVelocity: Vec3 = ZERO, angularVelocity: Vec3 = ZERO): void {
    this.body.setPosition(transform.position);
    this.body.setRotation(transform.rotation);
    this.body.setLinearVelocity(linearVelocity);
    this.body.setAngularVelocity(angularVelocity);
    this.body.clearForces();
    this.body.clearTorques();
    this.body.wakeUp();
  }

  reset(): void {
    this.teleport(this.spawn);
    this.controller.reset();
    this.controlState = { wheels: this.initialWheels, grounded: true, boost: 100, boosting: false };
  }
}
