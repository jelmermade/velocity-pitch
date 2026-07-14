import type { CarTuning } from '../../core/config/CarTuning';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { clamp } from '../../core/math/MathUtils';
import { rotateVector } from '../../core/math/Quaternion';
import { add, cross, dot, scale, sub, UP, type Vec3 } from '../../core/math/Vector3';
import type { PlayerCommand } from '../../input/PlayerCommand';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { BoostSystem } from './BoostSystem';
import { DodgeSystem } from './DodgeSystem';
import { SuspensionSystem } from './SuspensionSystem';
import { RecoverySystem } from './RecoverySystem';
import type { WheelState } from './WheelState';

export interface CarControlResult {
  readonly grounded: boolean;
  readonly wheels: readonly WheelState[];
  readonly boost: number;
  readonly boosting: boolean;
}

export class CarController {
  private readonly suspension = new SuspensionSystem();
  private readonly dodge = new DodgeSystem();
  private readonly boost = new BoostSystem();
  private readonly recovery = new RecoverySystem();
  private ceilingRecoveryRemaining = 0;

  constructor(private tuning: CarTuning) {}

  setTuning(tuning: CarTuning): void { this.tuning = tuning; }

  update(world: PhysicsWorld, body: PhysicsBody, command: PlayerCommand, deltaSeconds: number): CarControlResult {
    // Rapier user forces persist across steps, so vehicle forces must be rebuilt every tick.
    body.clearForces();
    body.clearTorques();
    const rotation = body.rotation();
    const axes = {
      up: rotateVector(rotation, { x: 0, y: 1, z: 0 }),
      forward: rotateVector(rotation, { x: 0, y: 0, z: -1 }),
      right: rotateVector(rotation, { x: 1, y: 0, z: 0 }),
    };
    const suspension = this.suspension.update(world, body, command, axes, this.tuning, deltaSeconds);
    const recovering = this.recovery.update(world, body, command, axes, this.tuning, deltaSeconds);
    const dodge = recovering
      ? { controlLocked: false, rotationLocked: false, autoLeveling: false }
      : this.dodge.update(body, command, suspension.grounded, axes, this.tuning, deltaSeconds);

    const verticalExtent =
      Math.abs(axes.right.y) * this.tuning.halfExtents.x
      + Math.abs(axes.up.y) * this.tuning.halfExtents.y
      + Math.abs(axes.forward.y) * this.tuning.halfExtents.z
      + this.tuning.colliderBorderRadius;
    const carTop = body.position().y + verticalExtent;
    const touchingCeiling = carTop >= ARENA_TUNING.height - 0.05;
    if (touchingCeiling) {
      this.ceilingRecoveryRemaining = this.tuning.ceilingRecoverySeconds;
      const velocity = body.linearVelocity();
      if (velocity.y > 0) {
        body.setLinearVelocity({
          x: velocity.x,
          y: -Math.max(this.tuning.minimumCeilingFallSpeed, velocity.y * this.tuning.ceilingBounceFactor),
          z: velocity.z,
        });
      }
    } else {
      this.ceilingRecoveryRemaining = Math.max(0, this.ceilingRecoveryRemaining - deltaSeconds);
    }

    const forwardSpeed = dot(body.linearVelocity(), axes.forward);
    if (suspension.grounded && Math.abs(forwardSpeed) > 0.35) {
      const speedFactor = clamp(Math.abs(forwardSpeed) / 12, 0.15, 1);
      const travelDirection = Math.sign(forwardSpeed);
      const steeringTorque = command.powerslide
        ? this.tuning.powerslideSteeringTorque
        : this.tuning.groundSteeringTorque;
      const steeringImpulse = -command.steer * travelDirection * steeringTorque * speedFactor * deltaSeconds;
      body.applyTorqueImpulse(scale(axes.up, steeringImpulse));
    }

    const boosting = this.boost.update(
      command.boost,
      this.tuning.boostConsumption,
      this.tuning.boostRecharge,
      deltaSeconds,
      this.ceilingRecoveryRemaining === 0,
    );
    if (boosting) {
      const surfaceBoostScale = suspension.grounded
        ? clamp(
            (this.tuning.maximumGroundBoostSpeed - forwardSpeed) / this.tuning.groundBoostSpeedFalloffRange,
            0,
            1,
          )
        : 1;
      body.applyForce(scale(axes.forward, this.tuning.boostForce * surfaceBoostScale));
    }

    if (!suspension.grounded) {
      if (!dodge.rotationLocked && !recovering) {
        const angularVelocity = body.angularVelocity();
        const pitchTorque = this.aerialControlImpulse(
          axes.right,
          -command.throttle,
          angularVelocity,
          deltaSeconds,
        );
        const yawTorque = this.aerialControlImpulse(
          axes.up,
          -command.steer,
          angularVelocity,
          deltaSeconds,
          0.75,
        );
        const rollTorque = this.aerialControlImpulse(
          axes.forward,
          command.airRoll,
          angularVelocity,
          deltaSeconds,
        );
        body.applyTorqueImpulse(add(add(pitchTorque, yawTorque), rollTorque));
      }
      if (dodge.autoLeveling) this.applyDodgeAutoLevel(body, axes.up, deltaSeconds);
    }

    return { grounded: suspension.grounded, wheels: suspension.wheels, boost: this.boost.value(), boosting };
  }

  reset(): void {
    this.boost.reset();
    this.dodge.reset();
    this.recovery.reset();
    this.suspension.reset();
    this.ceilingRecoveryRemaining = 0;
  }

  addBoost(amount: number): number {
    return this.boost.add(amount);
  }

  refillBoost(): void { this.boost.reset(); }

  private aerialControlImpulse(
    axis: Vec3,
    input: number,
    angularVelocity: Vec3,
    deltaSeconds: number,
    speedScale = 1,
  ): Vec3 {
    const currentSpeed = dot(angularVelocity, axis);
    const targetSpeed = input * this.tuning.maximumAerialAngularSpeed * speedScale;
    const torque = clamp(
      (targetSpeed - currentSpeed) * this.tuning.aerialControlGain,
      -this.tuning.aerialTorque,
      this.tuning.aerialTorque,
    );
    return scale(axis, torque * deltaSeconds);
  }

  private applyDodgeAutoLevel(body: PhysicsBody, carUp: typeof UP, deltaSeconds: number): void {
    const uprightness = dot(carUp, UP);
    if (uprightness < -0.5) return;
    const angularVelocity = body.angularVelocity();
    const yawVelocity = scale(UP, dot(angularVelocity, UP));
    const tiltVelocity = sub(angularVelocity, yawVelocity);
    const alignmentImpulse = scale(cross(carUp, UP), this.tuning.dodgeAutoLevelTorque * deltaSeconds);
    const dampingRamp = clamp((uprightness - 0.1) / 0.8, 0, 1);
    const dampingImpulse = scale(
      tiltVelocity,
      -this.tuning.dodgeAutoLevelDamping * dampingRamp * deltaSeconds,
    );
    body.applyTorqueImpulse(add(alignmentImpulse, dampingImpulse));
  }
}
