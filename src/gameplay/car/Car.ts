import { DEFAULT_CAR_TUNING, type CarTuning } from '../../core/config/CarTuning';
import { IDENTITY_QUAT } from '../../core/math/Quaternion';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../input/PlayerCommand';
import type { Transform } from '../../core/types/Transform';
import { ZERO, type Vec3 } from '../../core/math/Vector3';
import { CarController } from './CarController';
import type { CarState, CarSurfaceDebug } from './CarState';
import { WHEEL_CONNECTIONS, WHEEL_MOUNT_Y } from './WheelState';

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
  private controlState: Pick<CarState, 'wheels' | 'grounded' | 'boost' | 'boosting' | 'surfaceDebug'>;
  private respawnSecondsRemaining = 0;

  constructor(
    world: PhysicsWorld,
    private tuning: CarTuning = DEFAULT_CAR_TUNING,
    private readonly spawn: CarSpawn = DEFAULT_CAR_SPAWN,
  ) {
    this.controller = new CarController(tuning);
    this.initialWheels = WHEEL_CONNECTIONS.map(({ x, y, z }) => ({
      connectionPoint: { x, y: spawn.position.y + y, z: spawn.position.z + z },
      contactPoint: {
        x,
        y: spawn.position.y + y - tuning.wheelRadius,
        z: spawn.position.z + z,
      },
      position: { x, y: spawn.position.y + y, z: spawn.position.z + z },
      grounded: true,
      suspensionLength: 0,
      steeringAngle: 0,
      spinAngle: 0,
    }));
    this.controlState = { wheels: this.initialWheels, grounded: true, boost: 100, boosting: false };
    // Hard CCD clamps a car against each face of the concave ramp mesh without reducing its
    // velocity, banking motion until it reaches the planar wall. The car is large enough relative
    // to its per-tick travel for discrete collision detection to remain reliable at maximum speed.
    this.body = world.createDynamicBody(
      {
        position: spawn.position,
        rotation: spawn.rotation,
        linearDamping: 0.08,
        angularDamping: 0.5,
      },
      [
        {
          shape: { type: 'roundConvexHull', points: tuning.colliderPoints, borderRadius: tuning.colliderBorderRadius },
          mass: tuning.mass,
          // Tire forces are modeled by WheelContactSystem; colliders only provide smooth support.
          friction: 0,
          frictionCombineRule: 'min',
          restitution: 0,
          restitutionCombineRule: 'min',
        },
        {
          // A single rounded pad avoids competing wheel contacts on curved arena seams.
          // Four-wheel tilt stabilization in CarController prevents it becoming a
          // rocking pivot after a flat landing.
          shape: {
            type: 'roundBox',
            halfExtents: { x: 0.16, y: 0.01, z: 0.24 },
            borderRadius: tuning.wheelRadius - 0.01,
          },
          localPosition: { x: 0, y: WHEEL_MOUNT_Y, z: 0 },
          mass: 0,
          friction: 0,
          frictionCombineRule: 'min',
          restitution: 0,
          restitutionCombineRule: 'min',
        },
      ],
    );
  }

  update(world: PhysicsWorld, command: PlayerCommand, deltaSeconds: number): void {
    if (this.isDemolished()) return;
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
    const state: CarState = {
      transform: { position: this.body.position(), rotation: this.body.rotation() },
      linearVelocity: this.body.linearVelocity(),
      angularVelocity: this.body.angularVelocity(),
      wheels: this.controlState.wheels,
      grounded: this.controlState.grounded,
      boost: this.controlState.boost,
      boosting: this.controlState.boosting,
      surfaceNormal: this.controlState.surfaceDebug?.surfaceNormal ?? null,
    };
    const surfaceDebug = this.controlState.surfaceDebug;
    return surfaceDebug
      && typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('vehicleDebug') === '1'
      ? { ...state, surfaceDebug }
      : state;
  }

  surfaceDebugState(): CarSurfaceDebug | undefined { return this.controlState.surfaceDebug; }

  collectBoost(amount: number): number {
    const collected = this.controller.addBoost(amount);
    this.controlState = { ...this.controlState, boost: this.controlState.boost + collected };
    return collected;
  }

  setTuning(tuning: CarTuning): void {
    this.tuning = tuning;
    this.controller.setTuning(tuning);
  }

  bodyHandle(): number { return this.body.handle; }

  contactingBodyHandles(world: PhysicsWorld): readonly number[] {
    return this.isDemolished() ? [] : world.contactingBodyHandles(this.body);
  }

  isDemolished(): boolean { return this.respawnSecondsRemaining > 0; }

  demolish(respawnSeconds: number): void {
    if (this.isDemolished()) return;
    this.respawnSecondsRemaining = respawnSeconds;
    this.body.setLinearVelocity(ZERO);
    this.body.setAngularVelocity(ZERO);
    this.body.clearForces();
    this.body.clearTorques();
    this.body.setEnabled(false);
    this.controlState = { ...this.controlState, grounded: false, boosting: false };
  }

  advanceRespawn(deltaSeconds: number): boolean {
    if (!this.isDemolished()) return false;
    this.respawnSecondsRemaining = Math.max(0, this.respawnSecondsRemaining - deltaSeconds);
    if (this.respawnSecondsRemaining > 0) return false;
    this.reset();
    return true;
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
    this.respawnSecondsRemaining = 0;
    this.body.setEnabled(true);
    this.teleport(this.spawn);
    this.controller.reset();
    this.controlState = { wheels: this.initialWheels, grounded: true, boost: 100, boosting: false };
  }
}
