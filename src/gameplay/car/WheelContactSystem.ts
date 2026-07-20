import type { CarTuning } from '../../core/config/CarTuning';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { PHYSICS_TUNING } from '../../core/config/PhysicsTuning';
import { clamp } from '../../core/math/MathUtils';
import { add, cross, dot, length, normalize, scale, sub, UP, type Vec3 } from '../../core/math/Vector3';
import type { PlayerCommand } from '../../input/PlayerCommand';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { WHEEL_BASE, WHEEL_CONNECTIONS, type WheelState } from './WheelState';

export interface WheelContactResult {
  readonly grounded: boolean;
  readonly wheels: readonly WheelState[];
  readonly surfaceNormal: Vec3 | null;
}

export class WheelContactSystem {
  private wheelSpin = 0;
  private lastSurfaceNormal: Vec3 = UP;
  private surfaceHeading: Vec3 = { x: 0, y: 0, z: -1 };
  private adhesionGraceRemaining = 0;

  update(
    world: PhysicsWorld,
    body: PhysicsBody,
    command: PlayerCommand,
    axes: { readonly up: Vec3; readonly forward: Vec3; readonly right: Vec3 },
    tuning: CarTuning,
    deltaSeconds: number,
  ): WheelContactResult {
    const wheels: WheelState[] = [];
    const chassisPosition = body.position();
    const rotation = body.rotation();
    const steeringAngle = command.powerslide
      ? command.steer * tuning.maximumSteerAngle * tuning.powerslideSteerMultiplier
      : Math.atan(command.steer * WHEEL_BASE / tuning.groundTurnRadius);
    const speed = dot(body.linearVelocity(), axes.forward);
    const yawSpeed = dot(body.angularVelocity(), axes.up);
    const requestedYawDirection = -Math.sign(command.steer) * Math.sign(speed);
    const counterSteering = !command.powerslide
      && Math.abs(command.steer) >= 0.01
      && Math.abs(speed) > 0.35
      && yawSpeed * requestedYawDirection < -0.05;
    this.wheelSpin += speed * deltaSeconds / tuning.wheelRadius;
    let contactCount = 0;
    let contactNormalSum: Vec3 = { x: 0, y: 0, z: 0 };

    WHEEL_CONNECTIONS.forEach((localConnection, index) => {
      const rotatedConnection = this.rotate(rotation, localConnection);
      const connection = add(chassisPosition, rotatedConnection);
      let rayDirection = scale(axes.up, -1);
      let rayLength = tuning.wheelRadius + tuning.wheelContactTolerance;
      let hit = world.castRay(connection, rayDirection, rayLength, body, true);
      // Keep sampling a curved wall when chassis rotation briefly outruns the rigid wheel probe.
      const followingSlope = this.lastSurfaceNormal.y < 0.999_95;
      const nearBoundary = Math.abs(chassisPosition.x) >= (
        ARENA_TUNING.halfWidth - ARENA_TUNING.floorWallCurveRadius - 2
      ) || Math.abs(chassisPosition.z) >= (
        ARENA_TUNING.halfLength - ARENA_TUNING.floorWallCurveRadius - 2
      );
      const chassisOutranContact = nearBoundary
        && dot(axes.up, this.lastSurfaceNormal) < 0.999_95;
      if (!hit && this.adhesionGraceRemaining > 0 && (followingSlope || chassisOutranContact)) {
        rayDirection = scale(this.lastSurfaceNormal, -1);
        rayLength += tuning.surfaceContactProbeExtension;
        hit = world.castRay(connection, rayDirection, rayLength, body, true);
      }
      const isFront = index < 2;
      const wheelSteer = isFront && !counterSteering ? steeringAngle : 0;

      if (hit) {
        contactCount += 1;
        contactNormalSum = add(contactNormalSum, hit.normal);
        const pointVelocity = body.velocityAtPoint(connection);
        // Preserve flat-ground steering while following the true contact plane on ramps.
        const surfaceFollowingBlend = Math.abs(command.steer) < 0.01 || hit.normal.y < 0.999_95 ? 1 : 0;
        const steeredForward = normalize(add(
          scale(axes.forward, Math.cos(wheelSteer)),
          scale(axes.right, Math.sin(wheelSteer)),
        ));
        const wheelSurfaceForward = normalize(sub(
          steeredForward,
          scale(hit.normal, dot(steeredForward, hit.normal)),
        ));
        const wheelForward = normalize(add(
          scale(steeredForward, 1 - surfaceFollowingBlend),
          scale(wheelSurfaceForward, surfaceFollowingBlend),
        ));
        // Steering changes tire grip and yaw; it must not turn engine thrust into sideways force.
        const driveForward = normalize(sub(
          axes.forward,
          scale(hit.normal, dot(axes.forward, hit.normal)),
        ));
        const wheelRight = normalize(cross(wheelForward, hit.normal));
        const lateralSpeed = dot(pointVelocity, wheelRight);
        const grip = command.powerslide ? tuning.powerslideGrip : tuning.lateralGrip;
        const maximumLateralForce = command.powerslide ? tuning.maximumPowerslideForce : tuning.maximumLateralForce;
        const lateralForce = clamp(-lateralSpeed * grip, -maximumLateralForce, maximumLateralForce);
        const surfaceControllerOwnsGrip = !command.powerslide && hit.normal.y < 0.999_95;
        if (!surfaceControllerOwnsGrip) body.applyForce(scale(wheelRight, lateralForce));

        const braking = Math.abs(speed) > tuning.brakeToReverseSpeed
          && command.throttle * speed < 0;
        if (braking) {
          const brakeForce = -Math.sign(speed) * Math.abs(command.throttle) * tuning.brakeForce / 4;
          body.applyForce(scale(driveForward, brakeForce));
        } else {
          const driveForce = command.throttle >= 0 ? tuning.engineForce : tuning.reverseForce;
          const requestedDirection = Math.sign(command.throttle);
          const speedInRequestedDirection = speed * requestedDirection;
          const maximumDriveSpeed = command.boost
            ? tuning.maximumGroundBoostSpeed
            : requestedDirection < 0
              ? tuning.maximumGroundReverseSpeed
              : tuning.maximumGroundDriveSpeed;
          const falloffRange = command.boost
            ? tuning.groundBoostSpeedFalloffRange
            : tuning.groundDriveSpeedFalloffRange;
          const driveScale = clamp(
            (maximumDriveSpeed - speedInRequestedDirection) / falloffRange,
            0,
            1,
          );
          body.applyForce(scale(driveForward, command.throttle * driveForce * driveScale / 4));
        }
        if (Math.abs(command.throttle) < 0.01 && !command.powerslide) {
          const longitudinalSpeed = dot(pointVelocity, driveForward);
          const drag = Math.abs(longitudinalSpeed) < tuning.idleBrakeSpeed
            ? tuning.idleBrakeDrag
            : tuning.coastDrag;
          const coastForce = clamp(
            -longitudinalSpeed * drag,
            -tuning.maximumCoastForce,
            tuning.maximumCoastForce,
          );
          body.applyForce(scale(driveForward, coastForce));
        }
        wheels.push({
          connectionPoint: connection,
          contactPoint: hit.point,
          position: connection,
          grounded: true,
          suspensionLength: 0,
          steeringAngle: wheelSteer,
          spinAngle: this.wheelSpin,
        });
      } else {
        wheels.push({
          connectionPoint: connection,
          contactPoint: add(connection, scale(axes.up, -tuning.wheelRadius)),
          position: connection,
          grounded: false,
          suspensionLength: 0,
          steeringAngle: wheelSteer,
          spinAngle: this.wheelSpin,
        });
      }
    });

    if (contactCount > 0) {
      const surfaceNormal = normalize(contactNormalSum);
      this.surfaceHeading = this.updatedSurfaceHeading(
        axes.forward,
        command.steer,
        this.lastSurfaceNormal,
        surfaceNormal,
      );
      this.lastSurfaceNormal = surfaceNormal;
      this.adhesionGraceRemaining = tuning.surfaceAdhesionGraceSeconds;
    } else {
      this.adhesionGraceRemaining = Math.max(0, this.adhesionGraceRemaining - deltaSeconds);
    }
    this.applySurfaceAdhesion(body, command, axes.up, speed, contactCount > 0, tuning, deltaSeconds);

    const slopeContactGrace = this.adhesionGraceRemaining > 0 && this.lastSurfaceNormal.y < 0.999_95;
    return {
      grounded: contactCount >= 2 || slopeContactGrace,
      wheels,
      surfaceNormal: contactCount > 0 || slopeContactGrace ? this.lastSurfaceNormal : null,
    };
  }

  reset(): void {
    this.wheelSpin = 0;
    this.lastSurfaceNormal = UP;
    this.surfaceHeading = { x: 0, y: 0, z: -1 };
    this.adhesionGraceRemaining = 0;
  }

  private applySurfaceAdhesion(
    body: PhysicsBody,
    command: PlayerCommand,
    carUp: Vec3,
    speed: number,
    hasWheelContact: boolean,
    tuning: CarTuning,
    deltaSeconds: number,
  ): void {
    if (this.adhesionGraceRemaining <= 0) return;
    if (this.lastSurfaceNormal.y < -0.05) return;
    const slopeFactor = clamp((1 - this.lastSurfaceNormal.y) / 0.25, 0, 1);
    const speedFactor = clamp(Math.abs(speed) / 14, 0, 1);
    const graceFactor = hasWheelContact
      ? 1
      : clamp(this.adhesionGraceRemaining / tuning.surfaceAdhesionGraceSeconds, 0, 1);
    const adhesionFactor = tuning.surfaceMinimumAdhesionFactor
      + (1 - tuning.surfaceMinimumAdhesionFactor) * speedFactor;
    const assist = slopeFactor * adhesionFactor * graceFactor;
    if (assist <= 0) return;

    const gravityNormal = scale(
      this.lastSurfaceNormal,
      dot(PHYSICS_TUNING.gravity, this.lastSurfaceNormal),
    );
    body.applyForce(scale(gravityNormal, -tuning.mass * graceFactor));
    const adhesionForce = tuning.surfaceAdhesionForce
      + tuning.surfaceAdhesionSpeedForce * speed ** 2;
    body.applyForce(scale(this.lastSurfaceNormal, -adhesionForce * assist));
    const gravityAlongSurface = sub(
      PHYSICS_TUNING.gravity,
      scale(this.lastSurfaceNormal, dot(PHYSICS_TUNING.gravity, this.lastSurfaceNormal)),
    );
    body.applyForce(scale(
      gravityAlongSurface,
      -tuning.mass * tuning.surfaceGravityCompensation * slopeFactor * graceFactor,
    ));
    const alignmentAxis = cross(carUp, this.lastSurfaceNormal);
    const alignmentFactor = hasWheelContact ? 1 : slopeFactor * graceFactor;
    body.applyTorqueImpulse(scale(
      alignmentAxis,
      tuning.surfaceAlignmentTorque * alignmentFactor * deltaSeconds,
    ));
    if (Math.abs(command.steer) < 0.01) {
      const carForward = this.tangentDirection(
        this.rotate(body.rotation(), { x: 0, y: 0, z: -1 }),
        this.lastSurfaceNormal,
      );
      const headingError = Math.atan2(
        dot(this.lastSurfaceNormal, cross(carForward, this.surfaceHeading)),
        dot(carForward, this.surfaceHeading),
      );
      body.applyTorqueImpulse(scale(
        this.lastSurfaceNormal,
        headingError * tuning.surfaceHeadingTorque * slopeFactor * graceFactor * deltaSeconds,
      ));
      const headingSpeed = dot(body.angularVelocity(), this.lastSurfaceNormal);
      body.applyTorqueImpulse(scale(
        this.lastSurfaceNormal,
        -headingSpeed * tuning.surfaceHeadingDamping * slopeFactor * graceFactor * deltaSeconds,
      ));
    }
  }

  private updatedSurfaceHeading(
    carForward: Vec3,
    steering: number,
    previousNormal: Vec3,
    surfaceNormal: Vec3,
  ): Vec3 {
    if (surfaceNormal.y >= 0.999_95 || Math.abs(steering) >= 0.01) {
      return this.tangentDirection(carForward, surfaceNormal);
    }
    const axis = cross(previousNormal, surfaceNormal);
    const sine = length(axis);
    if (sine < 1e-6) return this.tangentDirection(this.surfaceHeading, surfaceNormal);
    const unitAxis = scale(axis, 1 / sine);
    const cosine = clamp(dot(previousNormal, surfaceNormal), -1, 1);
    const transported = add(
      add(
        scale(this.surfaceHeading, cosine),
        scale(cross(unitAxis, this.surfaceHeading), sine),
      ),
      scale(unitAxis, dot(unitAxis, this.surfaceHeading) * (1 - cosine)),
    );
    return this.tangentDirection(transported, surfaceNormal);
  }

  private tangentDirection(direction: Vec3, surfaceNormal: Vec3): Vec3 {
    return normalize(sub(direction, scale(surfaceNormal, dot(direction, surfaceNormal))));
  }

  private rotate(rotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }, vector: Vec3): Vec3 {
    const tx = 2 * (rotation.y * vector.z - rotation.z * vector.y);
    const ty = 2 * (rotation.z * vector.x - rotation.x * vector.z);
    const tz = 2 * (rotation.x * vector.y - rotation.y * vector.x);
    return {
      x: vector.x + rotation.w * tx + rotation.y * tz - rotation.z * ty,
      y: vector.y + rotation.w * ty + rotation.z * tx - rotation.x * tz,
      z: vector.z + rotation.w * tz + rotation.x * ty - rotation.y * tx,
    };
  }
}
