import type { CarTuning } from '../../core/config/CarTuning';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { clamp } from '../../core/math/MathUtils';
import { rotateVector, slerpQuat, type Quat } from '../../core/math/Quaternion';
import { add, cross, dot, length, normalize, scale, sub, UP, type Vec3 } from '../../core/math/Vector3';
import type { PlayerCommand } from '../../input/PlayerCommand';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { BoostSystem } from './BoostSystem';
import { DodgeSystem } from './DodgeSystem';
import { WheelContactSystem } from './WheelContactSystem';
import { RecoverySystem } from './RecoverySystem';
import type { WheelState } from './WheelState';
import type { CarSurfaceDebug } from './CarState';

export interface CarControlResult {
  readonly grounded: boolean;
  readonly wheels: readonly WheelState[];
  readonly boost: number;
  readonly boosting: boolean;
  readonly surfaceDebug: CarSurfaceDebug;
}

export class CarController {
  private readonly wheelContact = new WheelContactSystem();
  private readonly dodge = new DodgeSystem();
  private readonly boost = new BoostSystem();
  private readonly recovery = new RecoverySystem();
  private ceilingRecoveryRemaining = 0;
  private debugTransitionPhase: 'none' | 'before' | 'curve' | 'wall' = 'none';

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
    const detachingFromSurface = command.jumpPressed
      && wheelContact.grounded
      && wheelContact.surfaceNormal !== null
      && wheelContact.surfaceNormal.y < 0.95;
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
      const ceilingFallSpeed = Math.max(
        this.tuning.minimumCeilingFallSpeed,
        Math.max(0, velocity.y) * this.tuning.ceilingBounceFactor,
      );
      body.setLinearVelocity({
        x: velocity.x,
        y: Math.min(velocity.y, -ceilingFallSpeed),
        z: velocity.z,
      });
    } else {
      this.ceilingRecoveryRemaining = Math.max(0, this.ceilingRecoveryRemaining - deltaSeconds);
    }

    const forwardSpeed = dot(body.linearVelocity(), wheelContact.projectedForward);
    if (wheelContact.grounded && Math.abs(forwardSpeed) > 0.35) {
      const requestedDirection = Math.sign(command.throttle);
      const travelDirection = Math.abs(forwardSpeed) > this.tuning.brakeToReverseSpeed
        || requestedDirection === 0
        ? Math.sign(forwardSpeed)
        : requestedDirection;
      const steeringAxis = wheelContact.surfaceNormal ?? axes.up;
      const yawSpeed = dot(body.angularVelocity(), steeringAxis);
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
      body.applyTorqueImpulse(scale(steeringAxis, steeringImpulse));

      const surfaceNormal = wheelContact.surfaceNormal;
      if (surfaceNormal && surfaceNormal.y < 0.999_95 && !command.powerslide && Math.abs(command.steer) >= 0.01) {
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
        const turnedTangentVelocity = scale(
          normalize(rotatedTangentVelocity),
          length(tangentVelocity),
        );
        body.setLinearVelocity(add(normalVelocity, turnedTangentVelocity));

      }
    }
    const stableSurfaceNormal = wheelContact.surfaceNormal;
    const allWheelsGrounded = wheelContact.wheels.every(({ grounded }) => grounded);
    const flatWheelContacts = wheelContact.wheels.filter(({ grounded }) => grounded).length;
    if (
      wheelContact.grounded
      && stableSurfaceNormal
      && stableSurfaceNormal.y < 0.1
      && !command.powerslide
      && Math.abs(command.steer) < 0.01
      && !detachingFromSurface
    ) {
      const velocity = body.linearVelocity();
      body.setLinearVelocity(sub(
        velocity,
        scale(stableSurfaceNormal, dot(velocity, stableSurfaceNormal)),
      ));
    }
    const acceptingFlatSupport = !command.jumpPressed && !command.jumpHeld;
    const bodyPosition = body.position();
    const bodyVelocity = body.linearVelocity();
    const flatTangentSpeed = stableSurfaceNormal
      ? length(sub(bodyVelocity, scale(stableSurfaceNormal, dot(bodyVelocity, stableSurfaceNormal))))
      : length(bodyVelocity);
    const stableFourWheelLanding = acceptingFlatSupport
      && allWheelsGrounded
      && stableSurfaceNormal !== null
      && dot(axes.up, stableSurfaceNormal) > 0.75
      // Directly rotating a fast chassis while its colliders are touching the floor can
      // introduce deep contact penetration before Rapier's next solver step. At speed,
      // angular damping settles the car without teleporting its orientation.
      && (stableSurfaceNormal.y < 0.999_95 || flatTangentSpeed < 8);
    const insideFlatInterior = Math.abs(bodyPosition.x) < (
      ARENA_TUNING.halfWidth - ARENA_TUNING.floorWallCurveRadius - 2
    ) && Math.abs(bodyPosition.z) < (
      ARENA_TUNING.halfLength - ARENA_TUNING.floorWallCurveRadius - 2
    );
    const stableFlatSupport = acceptingFlatSupport
      && flatWheelContacts >= 2
      && stableSurfaceNormal !== null
      && stableSurfaceNormal.y >= 0.999_95
      && dot(axes.up, stableSurfaceNormal) > 0.75
      && flatTangentSpeed < 8
      && insideFlatInterior;
    if (
      wheelContact.grounded
      && stableSurfaceNormal
      && (stableSurfaceNormal.y < 0.999_95 || stableFourWheelLanding || stableFlatSupport)
      && !command.powerslide
      && !detachingFromSurface
    ) {
      this.alignToSurface(
        body,
        stableSurfaceNormal,
        wheelContact.projectedForward,
        stableSurfaceNormal.y >= 0.999_95 ? 0 : command.steer,
        deltaSeconds,
      );
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

    if (wheelContact.grounded && wheelContact.surfaceNormal) {
      const maximumSurfaceSpeed = this.tuning.maximumGroundBoostSpeed + 2;
      const velocity = body.linearVelocity();
      const normalVelocity = scale(
        wheelContact.surfaceNormal,
        dot(velocity, wheelContact.surfaceNormal),
      );
      const tangentVelocity = sub(velocity, normalVelocity);
      const tangentSpeed = length(tangentVelocity);
      if (tangentSpeed > maximumSurfaceSpeed) {
        body.setLinearVelocity(add(
          normalVelocity,
          scale(tangentVelocity, maximumSurfaceSpeed / tangentSpeed),
        ));
      }
    }

    // Impacts can combine pitch, yaw, and roll beyond the angular envelope that vehicle
    // controls can produce. Besides looking like uncontrolled wobble, sufficiently large
    // combined spin destabilizes Rapier's rounded car contacts in long-running matches.
    const angularVelocity = body.angularVelocity();
    const angularSpeed = length(angularVelocity);
    const maximumAngularSpeed = this.tuning.maximumAerialAngularSpeed + 0.25;
    if (angularSpeed > maximumAngularSpeed) {
      body.setAngularVelocity(scale(angularVelocity, maximumAngularSpeed / angularSpeed));
    }

    const surfaceDebug: CarSurfaceDebug = {
      ...wheelContact.debug,
      velocity: body.linearVelocity(),
      tangentVelocity: wheelContact.surfaceNormal
        ? sub(
            body.linearVelocity(),
            scale(wheelContact.surfaceNormal, dot(body.linearVelocity(), wheelContact.surfaceNormal)),
          )
        : body.linearVelocity(),
    };
    this.logWallTransition(body, surfaceDebug);
    return {
      grounded: wheelContact.grounded,
      wheels: wheelContact.wheels,
      boost: this.boost.value(),
      boosting,
      surfaceDebug,
    };
  }

  reset(): void {
    this.boost.reset();
    this.dodge.reset();
    this.recovery.reset();
    this.wheelContact.reset();
    this.ceilingRecoveryRemaining = 0;
    this.debugTransitionPhase = 'none';
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

  private alignToSurface(
    body: PhysicsBody,
    surfaceNormal: Vec3,
    projectedForward: Vec3,
    steering: number,
    deltaSeconds: number,
  ): void {
    const velocity = body.linearVelocity();
    const tangentVelocity = sub(velocity, scale(surfaceNormal, dot(velocity, surfaceNormal)));
    const surfaceSpeed = dot(tangentVelocity, projectedForward);
    const heading = Math.abs(steering) >= 0.01 && length(tangentVelocity) > 0.35
      ? scale(normalize(tangentVelocity), Math.sign(surfaceSpeed) || 1)
      : projectedForward;
    if (length(heading) < 0.5) return;

    const targetRotation = this.surfaceRotation(heading, surfaceNormal);
    const alignmentRate = Math.abs(steering) >= 0.01
      ? this.tuning.surfaceSteeringAlignmentRate
      : this.tuning.surfaceAlignmentRate;
    const interpolation = 1 - Math.exp(-alignmentRate * deltaSeconds);
    body.setRotation(slerpQuat(body.rotation(), targetRotation, interpolation));

    const angularVelocity = body.angularVelocity();
    const surfaceYaw = scale(surfaceNormal, dot(angularVelocity, surfaceNormal));
    const tiltVelocity = sub(angularVelocity, surfaceYaw);
    const damping = Math.exp(-this.tuning.surfaceAngularDamping * deltaSeconds);
    body.setAngularVelocity(add(surfaceYaw, scale(tiltVelocity, damping)));
  }

  private logWallTransition(body: PhysicsBody, debug: CarSurfaceDebug): void {
    if (
      typeof window === 'undefined'
      || new URLSearchParams(window.location.search).get('vehicleDebug') !== '1'
      || !debug.surfaceNormal
    ) return;
    const position = body.position();
    const boundaryInset = Math.min(
      ARENA_TUNING.halfWidth - Math.abs(position.x),
      ARENA_TUNING.halfLength - Math.abs(position.z),
    );
    let phase: typeof this.debugTransitionPhase = 'none';
    if (debug.surfaceNormal.y >= 0.98 && boundaryInset <= ARENA_TUNING.floorWallCurveRadius + 2) {
      phase = 'before';
    } else if (debug.surfaceNormal.y > 0.08 && debug.surfaceNormal.y < 0.92) {
      phase = 'curve';
    } else if (debug.surfaceNormal.y <= 0.02) {
      phase = 'wall';
    }
    if (phase === 'none' || phase === this.debugTransitionPhase) return;
    this.debugTransitionPhase = phase;
    console.debug('[vehicle-wall-transition]', {
      phase,
      speed: length(debug.velocity),
      tangentSpeed: length(debug.tangentVelocity),
      grounded: debug.grounded,
      adhesionForce: length(debug.adhesionForce),
      throttleForce: length(debug.throttleForce),
    });
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
