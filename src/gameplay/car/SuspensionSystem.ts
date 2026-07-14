import type { CarTuning } from '../../core/config/CarTuning';
import { PHYSICS_TUNING } from '../../core/config/PhysicsTuning';
import { clamp } from '../../core/math/MathUtils';
import { add, cross, dot, normalize, scale, sub, UP, type Vec3 } from '../../core/math/Vector3';
import type { PlayerCommand } from '../../input/PlayerCommand';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { WHEEL_CONNECTIONS, type WheelState } from './WheelState';

export interface SuspensionResult {
  readonly grounded: boolean;
  readonly wheels: readonly WheelState[];
}

export class SuspensionSystem {
  private wheelSpin = 0;
  private lastSurfaceNormal: Vec3 = UP;
  private adhesionGraceRemaining = 0;

  update(
    world: PhysicsWorld,
    body: PhysicsBody,
    command: PlayerCommand,
    axes: { readonly up: Vec3; readonly forward: Vec3; readonly right: Vec3 },
    tuning: CarTuning,
    deltaSeconds: number,
  ): SuspensionResult {
    const wheels: WheelState[] = [];
    const chassisPosition = body.position();
    const rotation = body.rotation();
    const steeringMultiplier = command.powerslide ? tuning.powerslideSteerMultiplier : 1;
    const steeringAngle = command.steer * tuning.maximumSteerAngle * steeringMultiplier;
    const speed = dot(body.linearVelocity(), axes.forward);
    this.wheelSpin += speed * deltaSeconds / tuning.wheelRadius;
    let contactCount = 0;
    let contactNormalSum: Vec3 = { x: 0, y: 0, z: 0 };

    WHEEL_CONNECTIONS.forEach((localConnection, index) => {
      const rotatedConnection = this.rotate(rotation, localConnection);
      const connection = add(chassisPosition, rotatedConnection);
      const rayDirection = scale(axes.up, -1);
      const rayLength = tuning.suspensionRestLength + tuning.wheelRadius;
      const hit = world.castRay(connection, rayDirection, rayLength, body);
      const isFront = index < 2;
      const wheelSteer = isFront ? steeringAngle : 0;

      if (hit) {
        contactCount += 1;
        contactNormalSum = add(contactNormalSum, hit.normal);
        const suspensionLength = Math.max(0, hit.distance - tuning.wheelRadius);
        const compression = tuning.suspensionRestLength - suspensionLength;
        const pointVelocity = body.velocityAtPoint(connection);
        const suspensionSpeed = dot(pointVelocity, axes.up);
        const suspensionForce = clamp(
          compression * tuning.springStrength - suspensionSpeed * tuning.damperStrength,
          0,
          tuning.maximumSuspensionForce,
        );
        body.applyForceAtPoint(scale(axes.up, suspensionForce), connection);

        const wheelForward = normalize(add(scale(axes.forward, Math.cos(wheelSteer)), scale(axes.right, Math.sin(wheelSteer))));
        const wheelRight = normalize(cross(wheelForward, hit.normal));
        const lateralSpeed = dot(pointVelocity, wheelRight);
        const grip = command.powerslide ? tuning.powerslideGrip : tuning.lateralGrip;
        const maximumLateralForce = command.powerslide ? tuning.maximumPowerslideForce : tuning.maximumLateralForce;
        const lateralForce = clamp(-lateralSpeed * grip, -maximumLateralForce, maximumLateralForce);
        body.applyForceAtPoint(scale(wheelRight, lateralForce), connection);

        const braking = Math.abs(speed) > tuning.brakeToReverseSpeed
          && command.throttle * speed < 0;
        if (braking) {
          const brakeForce = -Math.sign(speed) * Math.abs(command.throttle) * tuning.brakeForce / 4;
          body.applyForceAtPoint(scale(wheelForward, brakeForce), connection);
        } else {
          const driveForce = command.throttle >= 0 ? tuning.engineForce : tuning.reverseForce;
          const requestedDirection = Math.sign(command.throttle);
          const speedInRequestedDirection = speed * requestedDirection;
          const driveScale = command.boost
            ? clamp(
                (tuning.maximumGroundBoostSpeed - speedInRequestedDirection)
                  / tuning.groundBoostSpeedFalloffRange,
                0,
                1,
              )
            : 1;
          body.applyForceAtPoint(
            scale(wheelForward, command.throttle * driveForce * driveScale / 4),
            connection,
          );
        }
        if (Math.abs(command.throttle) < 0.01 && !command.powerslide) {
          const longitudinalSpeed = dot(pointVelocity, wheelForward);
          const drag = Math.abs(longitudinalSpeed) < tuning.idleBrakeSpeed
            ? tuning.idleBrakeDrag
            : tuning.coastDrag;
          const coastForce = clamp(
            -longitudinalSpeed * drag,
            -tuning.maximumCoastForce,
            tuning.maximumCoastForce,
          );
          body.applyForceAtPoint(scale(wheelForward, coastForce), connection);
        }
        const wheelPosition = add(hit.point, scale(hit.normal, tuning.wheelRadius));
        wheels.push({
          connectionPoint: connection,
          contactPoint: hit.point,
          position: wheelPosition,
          grounded: true,
          suspensionLength,
          steeringAngle: wheelSteer,
          spinAngle: this.wheelSpin,
        });
      } else {
        const wheelPosition = add(connection, scale(rayDirection, tuning.suspensionRestLength));
        wheels.push({
          connectionPoint: connection,
          contactPoint: add(wheelPosition, scale(rayDirection, tuning.wheelRadius)),
          position: wheelPosition,
          grounded: false,
          suspensionLength: tuning.suspensionRestLength,
          steeringAngle: wheelSteer,
          spinAngle: this.wheelSpin,
        });
      }
    });

    if (contactCount > 0) {
      this.lastSurfaceNormal = normalize(contactNormalSum);
      this.adhesionGraceRemaining = tuning.surfaceAdhesionGraceSeconds;
    } else {
      this.adhesionGraceRemaining = Math.max(0, this.adhesionGraceRemaining - deltaSeconds);
    }
    this.applySurfaceAdhesion(body, axes.up, speed, contactCount > 0, tuning, deltaSeconds);

    const slopeContactGrace = this.adhesionGraceRemaining > 0 && this.lastSurfaceNormal.y < 0.98;
    return { grounded: contactCount >= 2 || slopeContactGrace, wheels };
  }

  reset(): void {
    this.wheelSpin = 0;
    this.lastSurfaceNormal = UP;
    this.adhesionGraceRemaining = 0;
  }

  private applySurfaceAdhesion(
    body: PhysicsBody,
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

    body.applyForce(scale(this.lastSurfaceNormal, -tuning.surfaceAdhesionForce * assist));
    const gravityAlongSurface = sub(
      PHYSICS_TUNING.gravity,
      scale(this.lastSurfaceNormal, dot(PHYSICS_TUNING.gravity, this.lastSurfaceNormal)),
    );
    body.applyForce(scale(
      gravityAlongSurface,
      -tuning.mass * tuning.surfaceGravityCompensation * slopeFactor * graceFactor,
    ));
    const alignmentAxis = cross(carUp, this.lastSurfaceNormal);
    body.applyTorqueImpulse(scale(alignmentAxis, tuning.surfaceAlignmentTorque * slopeFactor * graceFactor * deltaSeconds));
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
