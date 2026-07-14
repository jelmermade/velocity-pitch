import { DEFAULT_CAR_TUNING, type CarTuning } from '../../core/config/CarTuning';
import { IDENTITY_QUAT } from '../../core/math/Quaternion';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../input/PlayerCommand';
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
    private readonly tuning: CarTuning = DEFAULT_CAR_TUNING,
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

  updateVictory(world: PhysicsWorld, command: PlayerCommand, deltaSeconds: number): void {
    const controlState = this.controller.update(world, this.body, {
      ...NEUTRAL_COMMAND,
      jumpPressed: command.jumpPressed,
      jumpHeld: command.jumpHeld,
      boost: command.boost,
    }, deltaSeconds);
    this.controller.refillBoost();
    this.controlState = { ...controlState, boost: 100 };
    this.body.applyTorqueImpulse({
      x: 0,
      y: -command.steer * this.tuning.aerialTorque * 0.35 * deltaSeconds,
      z: 0,
    });
  }

  anchorHorizontal(position: Pick<Vec3, 'x' | 'z'>): void {
    const currentPosition = this.body.position();
    const linearVelocity = this.body.linearVelocity();
    const angularVelocity = this.body.angularVelocity();
    this.body.setPosition({ x: position.x, y: currentPosition.y, z: position.z });
    this.body.setLinearVelocity({ x: 0, y: linearVelocity.y, z: 0 });
    this.body.setAngularVelocity({ x: 0, y: angularVelocity.y, z: 0 });
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
