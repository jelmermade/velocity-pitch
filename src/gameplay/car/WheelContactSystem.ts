import type { CarTuning } from '../../core/config/CarTuning';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { PHYSICS_TUNING } from '../../core/config/PhysicsTuning';
import { clamp } from '../../core/math/MathUtils';
import { add, cross, dot, length, normalize, scale, sub, UP, ZERO, type Vec3 } from '../../core/math/Vector3';
import type { PlayerCommand } from '../../input/PlayerCommand';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { RayHit } from '../../physics/PhysicsTypes';
import type { CarSurfaceDebug, SurfaceRayDebug } from './CarState';
import { WHEEL_BASE, WHEEL_CONNECTIONS, type WheelState } from './WheelState';

export interface WheelContactResult {
  readonly grounded: boolean;
  readonly wheels: readonly WheelState[];
  readonly surfaceNormal: Vec3 | null;
  readonly projectedForward: Vec3;
  readonly tangentVelocity: Vec3;
  readonly debug: CarSurfaceDebug;
}

interface WheelProbe {
  readonly connection: Vec3;
  readonly direction: Vec3;
  readonly length: number;
  readonly hit: RayHit | null;
  readonly steeringAngle: number;
}

type ContactProbe = WheelProbe & { readonly hit: RayHit };

export class WheelContactSystem {
  private wheelSpin = 0;
  private lastSurfaceNormal: Vec3 = UP;
  private adhesionGraceRemaining = 0;
  private surfaceMomentumSpeed = 0;
  private surfaceMomentumDirection: Vec3 = ZERO;
  private surfaceMomentumNormal: Vec3 = UP;
  private surfaceDetachRemaining = 0;

  update(
    world: PhysicsWorld,
    body: PhysicsBody,
    command: PlayerCommand,
    axes: { readonly up: Vec3; readonly forward: Vec3; readonly right: Vec3 },
    tuning: CarTuning,
    deltaSeconds: number,
  ): WheelContactResult {
    const chassisPosition = body.position();
    this.surfaceDetachRemaining = Math.max(0, this.surfaceDetachRemaining - deltaSeconds);
    const detachingFromSurface = this.surfaceDetachRemaining > 0;
    const rotation = body.rotation();
    const initialVelocity = body.linearVelocity();
    const provisionalSpeed = dot(initialVelocity, axes.forward);
    const provisionalYawSpeed = dot(body.angularVelocity(), axes.up);
    const requestedYawDirection = -Math.sign(command.steer) * Math.sign(provisionalSpeed);
    const counterSteering = !command.powerslide
      && Math.abs(command.steer) >= 0.01
      && Math.abs(provisionalSpeed) > 0.35
      && provisionalYawSpeed * requestedYawDirection < -0.05;
    const steeringAngle = command.powerslide
      ? command.steer * tuning.maximumSteerAngle * tuning.powerslideSteerMultiplier
      : Math.atan(command.steer * WHEEL_BASE / tuning.groundTurnRadius);

    const probes = WHEEL_CONNECTIONS.map((localConnection, index): WheelProbe => {
      const connection = add(chassisPosition, this.rotate(rotation, localConnection));
      let direction = scale(axes.up, -1);
      let rayLength = tuning.wheelRadius + tuning.wheelContactTolerance;
      let hit = detachingFromSurface
        ? null
        : world.castRay(connection, direction, rayLength, body, true);
      const followingSlope = this.lastSurfaceNormal.y < 0.999_95;
      const nearBoundary = Math.abs(chassisPosition.x) >= (
        ARENA_TUNING.halfWidth - ARENA_TUNING.floorWallCurveRadius - 2
      ) || Math.abs(chassisPosition.z) >= (
        ARENA_TUNING.halfLength - ARENA_TUNING.floorWallCurveRadius - 2
      );
      const chassisOutranContact = nearBoundary && dot(axes.up, this.lastSurfaceNormal) < 0.999_95;
      if (
        !detachingFromSurface
        && !hit
        && this.adhesionGraceRemaining > 0
        && (followingSlope || chassisOutranContact)
      ) {
        direction = scale(this.lastSurfaceNormal, -1);
        rayLength += tuning.surfaceContactProbeExtension;
        hit = world.castRay(connection, direction, rayLength, body, true);
      }
      return {
        connection,
        direction,
        length: rayLength,
        hit,
        steeringAngle: index < 2 && !counterSteering ? steeringAngle : 0,
      };
    });

    const contacts = probes.filter(
      (probe): probe is ContactProbe => probe.hit !== null,
    );
    const contactCount = contacts.length;
    const measuredNormal = contactCount > 0
      ? normalize(contacts.reduce(
          (sum, probe) => add(sum, probe.hit.normal),
          ZERO,
        ))
      : null;
    const ceilingContact = measuredNormal !== null && measuredNormal.y < -0.05;
    const driveableNormal = ceilingContact ? null : measuredNormal;
    if (driveableNormal) {
      this.lastSurfaceNormal = driveableNormal;
      this.adhesionGraceRemaining = tuning.surfaceAdhesionGraceSeconds;
    } else if (ceilingContact) {
      this.adhesionGraceRemaining = 0;
    } else {
      this.adhesionGraceRemaining = Math.max(0, this.adhesionGraceRemaining - deltaSeconds);
    }

    const slopeContactGrace = this.adhesionGraceRemaining > 0 && this.lastSurfaceNormal.y < 0.999_95;
    const grounded = !ceilingContact && (contactCount >= 2 || slopeContactGrace);
    const surfaceNormal = driveableNormal ?? (slopeContactGrace ? this.lastSurfaceNormal : null);
    const projectedForward = surfaceNormal
      ? this.tangentDirection(axes.forward, surfaceNormal, axes.forward)
      : axes.forward;
    let tangentVelocity = surfaceNormal
      ? this.tangentVector(body.linearVelocity(), surfaceNormal)
      : body.linearVelocity();
    const surfaceSpeed = dot(body.linearVelocity(), projectedForward);
    this.wheelSpin += surfaceSpeed * deltaSeconds / tuning.wheelRadius;

    let throttleForce = ZERO;
    const wheels = probes.map((probe): WheelState => {
      const hit = probe.hit;
      if (hit && driveableNormal) {
        const pointVelocity = body.velocityAtPoint(probe.connection);
        const steeredForward = normalize(add(
          scale(axes.forward, Math.cos(probe.steeringAngle)),
          scale(axes.right, Math.sin(probe.steeringAngle)),
        ));
        const wheelForward = this.tangentDirection(steeredForward, driveableNormal, projectedForward);
        const driveForward = projectedForward;
        const wheelRight = normalize(cross(wheelForward, driveableNormal));
        const lateralSpeed = dot(pointVelocity, wheelRight);
        const grip = command.powerslide ? tuning.powerslideGrip : tuning.lateralGrip;
        const maximumLateralForce = command.powerslide
          ? tuning.maximumPowerslideForce
          : tuning.maximumLateralForce;
        const lateralForce = clamp(-lateralSpeed * grip, -maximumLateralForce, maximumLateralForce);
        const surfaceSteeringControlsGrip = !command.powerslide
          && driveableNormal.y < 0.999_95
          && Math.abs(command.steer) >= 0.01;
        if (!surfaceSteeringControlsGrip) body.applyForce(scale(wheelRight, lateralForce));

        const braking = Math.abs(surfaceSpeed) > tuning.brakeToReverseSpeed
          && command.throttle * surfaceSpeed < 0;
        let wheelDriveForce = ZERO;
        if (braking) {
          wheelDriveForce = scale(
            driveForward,
            -Math.sign(surfaceSpeed) * Math.abs(command.throttle) * tuning.brakeForce / 4,
          );
        } else {
          const driveForce = command.throttle >= 0 ? tuning.engineForce : tuning.reverseForce;
          const requestedDirection = Math.sign(command.throttle);
          const speedInRequestedDirection = surfaceSpeed * requestedDirection;
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
          wheelDriveForce = scale(
            driveForward,
            command.throttle * driveForce * driveScale / 4,
          );
        }
        if (length(wheelDriveForce) > 0) {
          body.applyForce(wheelDriveForce);
          throttleForce = add(throttleForce, wheelDriveForce);
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
      }
      return {
        connectionPoint: probe.connection,
        contactPoint: hit?.point ?? add(probe.connection, scale(probe.direction, tuning.wheelRadius)),
        position: probe.connection,
        grounded: hit !== null && !ceilingContact,
        suspensionLength: 0,
        steeringAngle: probe.steeringAngle,
        spinAngle: this.wheelSpin,
      };
    });

    const wallJumpRequested = command.jumpPressed
      && driveableNormal !== null
      && driveableNormal.y < 0.95;
    if (wallJumpRequested) {
      this.surfaceDetachRemaining = tuning.surfaceJumpDetachSeconds;
      this.adhesionGraceRemaining = 0;
      this.surfaceMomentumSpeed = 0;
      this.surfaceMomentumDirection = ZERO;
      this.surfaceMomentumNormal = UP;
    } else if (driveableNormal) {
      tangentVelocity = this.preserveSurfaceMomentum(
        body,
        command,
        driveableNormal,
        tangentVelocity,
      );
    } else if (!grounded) {
      this.surfaceMomentumSpeed = 0;
    }
    const adhesionForce = this.applySurfaceAdhesion(
      body,
      command,
      axes.up,
      wallJumpRequested ? null : driveableNormal,
      contacts,
      tangentVelocity,
      projectedForward,
      tuning,
    );
    const rays: SurfaceRayDebug[] = probes.map((probe) => ({
      origin: probe.connection,
      direction: probe.direction,
      length: probe.length,
      hitPoint: probe.hit?.point ?? null,
    }));
    const debug: CarSurfaceDebug = {
      grounded,
      rays,
      surfaceNormal,
      projectedForward,
      velocity: body.linearVelocity(),
      tangentVelocity,
      adhesionForce,
      throttleForce,
    };
    return { grounded, wheels, surfaceNormal, projectedForward, tangentVelocity, debug };
  }

  reset(): void {
    this.wheelSpin = 0;
    this.lastSurfaceNormal = UP;
    this.adhesionGraceRemaining = 0;
    this.surfaceMomentumSpeed = 0;
    this.surfaceMomentumDirection = ZERO;
    this.surfaceMomentumNormal = UP;
    this.surfaceDetachRemaining = 0;
  }

  private preserveSurfaceMomentum(
    body: PhysicsBody,
    command: PlayerCommand,
    surfaceNormal: Vec3,
    tangentVelocity: Vec3,
  ): Vec3 {
    const tangentSpeed = length(tangentVelocity);
    const onFlatSurface = surfaceNormal.y >= 0.999_95;
    const braking = command.throttle * dot(tangentVelocity, this.tangentDirection(
      this.rotate(body.rotation(), { x: 0, y: 0, z: -1 }),
      surfaceNormal,
      tangentVelocity,
    )) < 0;
    if (onFlatSurface) {
      this.rememberSurfaceMomentum(tangentVelocity, surfaceNormal);
      return tangentVelocity;
    }
    const activeDrive = Math.abs(command.throttle) >= 0.01 || command.boost;
    if (!activeDrive) {
      this.rememberSurfaceMomentum(tangentVelocity, surfaceNormal);
      return tangentVelocity;
    }
    const shouldTransportMomentum = !command.powerslide
      && !braking
      && tangentSpeed >= 0.35
      && this.surfaceMomentumSpeed >= 0.35;
    if (!shouldTransportMomentum) {
      this.rememberSurfaceMomentum(tangentVelocity, surfaceNormal);
      return tangentVelocity;
    }
    if (Math.abs(command.steer) >= 0.01 && tangentSpeed >= this.surfaceMomentumSpeed) {
      this.rememberSurfaceMomentum(tangentVelocity, surfaceNormal);
      return tangentVelocity;
    }

    const targetSpeed = Math.max(tangentSpeed, this.surfaceMomentumSpeed);
    // Follow the curve by rotating the prior tangent direction with its normal. Re-projecting the
    // velocity alone preserves length but gradually leaks wallward momentum into sideways travel.
    const targetDirection = Math.abs(command.steer) < 0.01
      ? this.tangentDirection(
          this.transportBetweenSurfaceNormals(
            this.surfaceMomentumDirection,
            this.surfaceMomentumNormal,
            surfaceNormal,
          ),
          surfaceNormal,
          tangentVelocity,
        )
      : normalize(tangentVelocity);
    const transportedVelocity = scale(targetDirection, targetSpeed);
    body.setLinearVelocity(transportedVelocity);
    this.rememberSurfaceMomentum(transportedVelocity, surfaceNormal);
    return transportedVelocity;
  }

  private rememberSurfaceMomentum(tangentVelocity: Vec3, surfaceNormal: Vec3): void {
    this.surfaceMomentumSpeed = length(tangentVelocity);
    this.surfaceMomentumDirection = this.surfaceMomentumSpeed > 1e-6
      ? scale(tangentVelocity, 1 / this.surfaceMomentumSpeed)
      : ZERO;
    this.surfaceMomentumNormal = surfaceNormal;
  }

  private transportBetweenSurfaceNormals(
    direction: Vec3,
    previousNormal: Vec3,
    surfaceNormal: Vec3,
  ): Vec3 {
    const axis = cross(previousNormal, surfaceNormal);
    const sine = length(axis);
    if (sine < 1e-6) return direction;
    const unitAxis = scale(axis, 1 / sine);
    const cosine = clamp(dot(previousNormal, surfaceNormal), -1, 1);
    return add(
      add(
        scale(direction, cosine),
        scale(cross(unitAxis, direction), sine),
      ),
      scale(unitAxis, dot(unitAxis, direction) * (1 - cosine)),
    );
  }

  private applySurfaceAdhesion(
    body: PhysicsBody,
    command: PlayerCommand,
    carUp: Vec3,
    surfaceNormal: Vec3 | null,
    contacts: readonly ContactProbe[],
    tangentVelocity: Vec3,
    projectedForward: Vec3,
    tuning: CarTuning,
  ): Vec3 {
    // Grace keeps steering state stable, but forces require a real ray hit so airborne cars are untouched.
    if (!surfaceNormal || contacts.length === 0 || surfaceNormal.y < -0.05) return ZERO;
    const slopeFactor = clamp((1 - surfaceNormal.y) / 0.25, 0, 1);
    if (slopeFactor <= 0) return ZERO;
    const averageGap = contacts.reduce(
      (sum, probe) => sum + Math.max(0, probe.hit.distance - tuning.wheelRadius),
      0,
    ) / contacts.length;
    const distanceFactor = clamp(
      1 - averageGap / Math.max(tuning.wheelContactTolerance + tuning.surfaceContactProbeExtension, 1e-4),
      0,
      1,
    );
    const speed = length(tangentVelocity);
    const speedFactor = clamp(speed / 14, 0, 1);
    const contactFactor = contacts.length / WHEEL_CONNECTIONS.length;
    const alignmentFactor = clamp((dot(carUp, surfaceNormal) + 0.15) / 1.15, 0, 1);
    const adhesionFactor = tuning.surfaceMinimumAdhesionFactor
      + (1 - tuning.surfaceMinimumAdhesionFactor) * speedFactor;
    const forceScale = slopeFactor * distanceFactor * contactFactor * alignmentFactor;

    const gravityNormal = scale(surfaceNormal, dot(PHYSICS_TUNING.gravity, surfaceNormal));
    body.applyForce(scale(gravityNormal, -tuning.mass * contactFactor));
    const gravityAlongSurface = this.tangentVector(PHYSICS_TUNING.gravity, surfaceNormal);
    if (!command.powerslide) {
      const surfaceRight = normalize(cross(projectedForward, surfaceNormal));
      const lateralGravity = scale(surfaceRight, dot(gravityAlongSurface, surfaceRight));
      body.applyForce(scale(lateralGravity, -tuning.mass * contactFactor));
    }
    const requestedDriveDirection = Math.abs(command.throttle) >= 0.01
      ? Math.sign(command.throttle)
      : command.boost ? 1 : 0;
    if (requestedDriveDirection !== 0) {
      const driveDirection = scale(projectedForward, requestedDriveDirection);
      const opposingGravity = Math.max(0, -dot(gravityAlongSurface, driveDirection));
      body.applyForce(scale(
        driveDirection,
        tuning.mass
          * opposingGravity
          * tuning.surfaceGravityCompensation
          * slopeFactor
          * contactFactor,
      ));
    }
    const adhesionMagnitude = (
      tuning.surfaceAdhesionForce + tuning.surfaceAdhesionSpeedForce * speed ** 2
    ) * adhesionFactor * forceScale;
    const adhesionForce = scale(surfaceNormal, -adhesionMagnitude);
    body.applyForce(adhesionForce);
    return adhesionForce;
  }

  private tangentVector(vector: Vec3, surfaceNormal: Vec3): Vec3 {
    return sub(vector, scale(surfaceNormal, dot(vector, surfaceNormal)));
  }

  private tangentDirection(direction: Vec3, surfaceNormal: Vec3, fallback: Vec3): Vec3 {
    const tangent = this.tangentVector(direction, surfaceNormal);
    if (length(tangent) > 1e-6) return normalize(tangent);
    const fallbackTangent = this.tangentVector(fallback, surfaceNormal);
    return length(fallbackTangent) > 1e-6 ? normalize(fallbackTangent) : ZERO;
  }

  private rotate(
    rotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number },
    vector: Vec3,
  ): Vec3 {
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
