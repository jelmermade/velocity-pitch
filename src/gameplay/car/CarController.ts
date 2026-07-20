import type { CarTuning } from '../../core/config/CarTuning';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { clamp } from '../../core/math/MathUtils';
import { rotateVector, type Quat } from '../../core/math/Quaternion';
import { add, cross, dot, length, normalize, scale, sub, UP, type Vec3 } from '../../core/math/Vector3';
import type { PlayerCommand } from '../../input/PlayerCommand';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { BoostSystem } from './BoostSystem';
import { DodgeSystem } from './DodgeSystem';
import { WheelContactSystem } from './WheelContactSystem';
import { RecoverySystem } from './RecoverySystem';
import type { WheelState } from './WheelState';

export interface CarControlResult {
  readonly grounded: boolean;
  readonly wheels: readonly WheelState[];
  readonly boost: number;
  readonly boosting: boolean;
}

export class CarController {
  private readonly wheelContact = new WheelContactSystem();
  private readonly dodge = new DodgeSystem();
  private readonly boost = new BoostSystem();
  private readonly recovery = new RecoverySystem();
  private ceilingRecoveryRemaining = 0;
  private surfaceSteeringSpeed = 0;

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
    const wheelContact = this.wheelContact.update(world, body, command, axes, this.tuning, deltaSeconds);
    const recovering = this.recovery.update(world, body, command, axes, this.tuning, deltaSeconds);
    const dodge = recovering
      ? { controlLocked: false, rotationLocked: false, autoLeveling: false }
      : this.dodge.update(body, command, wheelContact.grounded, axes, this.tuning, deltaSeconds);

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
    let appliedSurfaceSteering = false;
    if (wheelContact.grounded && Math.abs(forwardSpeed) > 0.35) {
      const requestedDirection = Math.sign(command.throttle);
      const travelDirection = Math.abs(forwardSpeed) > this.tuning.brakeToReverseSpeed
        || requestedDirection === 0
        ? Math.sign(forwardSpeed)
        : requestedDirection;
      const yawSpeed = dot(body.angularVelocity(), axes.up);
      const steeringTorque = command.powerslide
        ? -command.steer
          * travelDirection
          * this.tuning.powerslideSteeringTorque
          * clamp(Math.abs(forwardSpeed) / 12, 0.15, 1)
        : clamp(
            (-command.steer * travelDirection * Math.abs(forwardSpeed) / this.tuning.groundTurnRadius - yawSpeed)
              * this.tuning.groundSteeringResponse,
            -this.tuning.groundSteeringTorque,
            this.tuning.groundSteeringTorque,
          );
      const steeringImpulse = steeringTorque * deltaSeconds;
      body.applyTorqueImpulse(scale(axes.up, steeringImpulse));

      const surfaceNormal = wheelContact.surfaceNormal;
      if (surfaceNormal && surfaceNormal.y < 0.999_95 && !command.powerslide && Math.abs(command.steer) >= 0.01) {
        appliedSurfaceSteering = true;
        const slopeFactor = clamp((1 - surfaceNormal.y) / 0.3, 0, 1);
        const targetSurfaceYaw = -command.steer
          * travelDirection
          * Math.abs(forwardSpeed)
          / this.tuning.groundTurnRadius;
        const velocity = body.linearVelocity();
        const normalVelocity = scale(surfaceNormal, dot(velocity, surfaceNormal));
        const tangentVelocity = sub(velocity, normalVelocity);
        const turnAngle = targetSurfaceYaw
          * this.tuning.surfaceSteeringAssist
          * slopeFactor
          * deltaSeconds;
        const rotatedTangentVelocity = add(
          scale(tangentVelocity, Math.cos(turnAngle)),
          scale(cross(surfaceNormal, tangentVelocity), Math.sin(turnAngle)),
        );
        this.surfaceSteeringSpeed = Math.max(this.surfaceSteeringSpeed, length(tangentVelocity));
        const turnedTangentVelocity = scale(
          normalize(rotatedTangentVelocity),
          this.surfaceSteeringSpeed,
        );
        body.setLinearVelocity(add(normalVelocity, turnedTangentVelocity));

        const travelForward = scale(normalize(turnedTangentVelocity), travelDirection);
        body.setRotation(this.surfaceRotation(travelForward, surfaceNormal));
        body.setAngularVelocity({ x: 0, y: 0, z: 0 });
      }
    }
    if (!appliedSurfaceSteering) this.surfaceSteeringSpeed = 0;
    const stableSurfaceNormal = wheelContact.surfaceNormal;
    if (
      wheelContact.grounded
      && stableSurfaceNormal
      && stableSurfaceNormal.y < 0.1
      && !command.powerslide
      && Math.abs(command.steer) < 0.01
    ) {
      const surfaceForward = normalize(sub(
        axes.forward,
        scale(stableSurfaceNormal, dot(axes.forward, stableSurfaceNormal)),
      ));
      if (length(surfaceForward) > 0.5) {
        body.setRotation(this.surfaceRotation(surfaceForward, stableSurfaceNormal));
      }
      const velocity = body.linearVelocity();
      const awayFromSurfaceSpeed = dot(velocity, stableSurfaceNormal);
      if (awayFromSurfaceSpeed > 0) {
        body.setLinearVelocity(sub(velocity, scale(stableSurfaceNormal, awayFromSurfaceSpeed)));
      }
      const angularVelocity = body.angularVelocity();
      body.setAngularVelocity(scale(
        stableSurfaceNormal,
        dot(angularVelocity, stableSurfaceNormal),
      ));
    }
    const onFlatSurface = wheelContact.surfaceNormal !== null
      && wheelContact.surfaceNormal.y >= 0.999_95;
    if (onFlatSurface && !command.powerslide && Math.abs(forwardSpeed) > 0.35) {
      const travelDirection = Math.sign(forwardSpeed);
      const lateralSpeed = dot(body.linearVelocity(), axes.right) * travelDirection;
      const slipAngle = Math.atan2(lateralSpeed, Math.abs(forwardSpeed));
      const alignmentTorque = clamp(
        -slipAngle * this.tuning.groundTractionAlignmentTorque,
        -this.tuning.maximumGroundTractionAlignmentTorque,
        this.tuning.maximumGroundTractionAlignmentTorque,
      );
      body.applyTorqueImpulse(scale(axes.up, alignmentTorque * deltaSeconds));
    }
    const yawSpeed = dot(body.angularVelocity(), axes.up);
    const steeringYawDirection = -Math.sign(command.steer) * Math.sign(forwardSpeed);
    const counterSteering = Math.abs(command.steer) >= 0.01
      && Math.abs(forwardSpeed) > 0.35
      && yawSpeed * steeringYawDirection < -0.05;
    if (onFlatSurface && !command.powerslide && (Math.abs(command.steer) < 0.01 || counterSteering)) {
      body.applyTorqueImpulse(scale(
        axes.up,
        -yawSpeed * this.tuning.groundYawDamping * deltaSeconds,
      ));
    }

    const boosting = this.boost.update(
      command.boost,
      this.tuning.boostConsumption,
      this.tuning.boostRecharge,
      deltaSeconds,
      this.ceilingRecoveryRemaining === 0,
    );
    if (boosting) {
      const rampForward = wheelContact.surfaceNormal
        ? normalize(sub(
            axes.forward,
            scale(wheelContact.surfaceNormal, dot(axes.forward, wheelContact.surfaceNormal)),
          ))
        : axes.forward;
      const boostDirection = wheelContact.surfaceNormal
        && wheelContact.surfaceNormal.y < 0.999_95
        && dot(rampForward, rampForward) > 0.5
        ? rampForward
        : axes.forward;
      const surfaceBoostScale = wheelContact.grounded
        ? clamp(
            (this.tuning.maximumGroundBoostSpeed - forwardSpeed) / this.tuning.groundBoostSpeedFalloffRange,
            0,
            1,
          )
        : 1;
      body.applyForce(scale(boostDirection, this.tuning.boostForce * surfaceBoostScale));
    }

    if (!wheelContact.grounded) {
      const closeToFloor = body.position().y < this.tuning.halfExtents.x + this.tuning.colliderBorderRadius + 0.2;
      if (closeToFloor && axes.up.y > -0.2) {
        body.applyTorqueImpulse(scale(
          cross(axes.up, UP),
          this.tuning.surfaceAlignmentTorque * 0.35 * deltaSeconds,
        ));
      }
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

    return { grounded: wheelContact.grounded, wheels: wheelContact.wheels, boost: this.boost.value(), boosting };
  }

  reset(): void {
    this.boost.reset();
    this.dodge.reset();
    this.recovery.reset();
    this.wheelContact.reset();
    this.ceilingRecoveryRemaining = 0;
    this.surfaceSteeringSpeed = 0;
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

  private surfaceRotation(forward: Vec3, up: Vec3): Quat {
    const right = normalize(cross(forward, up));
    const m00 = right.x;
    const m01 = up.x;
    const m02 = -forward.x;
    const m10 = right.y;
    const m11 = up.y;
    const m12 = -forward.y;
    const m20 = right.z;
    const m21 = up.z;
    const m22 = -forward.z;
    const trace = m00 + m11 + m22;

    if (trace > 0) {
      const scale = Math.sqrt(trace + 1) * 2;
      return {
        x: (m21 - m12) / scale,
        y: (m02 - m20) / scale,
        z: (m10 - m01) / scale,
        w: scale * 0.25,
      };
    }
    if (m00 > m11 && m00 > m22) {
      const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
      return {
        x: scale * 0.25,
        y: (m01 + m10) / scale,
        z: (m02 + m20) / scale,
        w: (m21 - m12) / scale,
      };
    }
    if (m11 > m22) {
      const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
      return {
        x: (m01 + m10) / scale,
        y: scale * 0.25,
        z: (m12 + m21) / scale,
        w: (m02 - m20) / scale,
      };
    }
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
    return {
      x: (m02 + m20) / scale,
      y: (m12 + m21) / scale,
      z: scale * 0.25,
      w: (m10 - m01) / scale,
    };
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
