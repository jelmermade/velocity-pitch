import type { CarTuning } from '../../core/config/CarTuning';
import { cross, dot, length, normalize, scale, type Vec3 } from '../../core/math/Vector3';
import type { PlayerCommand } from '../../input/PlayerCommand';
import type { PhysicsBody } from '../../physics/PhysicsBody';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const WORLD_DOWN: Vec3 = { x: 0, y: -1, z: 0 };

export class RecoverySystem {
  private cooldown = 0;

  update(
    world: PhysicsWorld,
    body: PhysicsBody,
    command: PlayerCommand,
    axes: { readonly up: Vec3; readonly forward: Vec3; readonly right: Vec3 },
    tuning: CarTuning,
    deltaSeconds: number,
  ): boolean {
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);
    if (this.cooldown > 0) return true;
    const uprightness = dot(axes.up, WORLD_UP);
    if (!command.jumpPressed || uprightness > tuning.recoveryUprightThreshold) return false;

    const verticalExtent = Math.abs(axes.right.y) * tuning.halfExtents.x
      + Math.abs(axes.up.y) * tuning.halfExtents.y
      + Math.abs(axes.forward.y) * tuning.halfExtents.z
      + tuning.colliderBorderRadius;

    const ground = world.castRay(
      body.position(),
      WORLD_DOWN,
      verticalExtent + 0.3,
      body,
      true,
    );
    if (!ground) return false;

    body.applyImpulse(scale(WORLD_UP, tuning.recoveryJumpImpulse));
    const uprightAxis = cross(axes.up, WORLD_UP);
    if (uprightness > -0.5 && length(uprightAxis) > 0.01) {
      body.applyTorqueImpulse(scale(normalize(uprightAxis), tuning.sideRecoveryTorque));
    } else {
      const usePitch = Math.abs(command.throttle) > Math.abs(command.steer);
      const recoveryAxis = usePitch
        ? scale(axes.right, command.throttle === 0 ? 1 : -command.throttle)
        : scale(axes.forward, command.steer === 0 ? 1 : command.steer);
      body.applyTorqueImpulse(scale(recoveryAxis, tuning.recoveryTorque));
    }
    this.cooldown = tuning.recoveryControlLockSeconds;
    return true;
  }

  reset(): void {
    this.cooldown = 0;
  }
}
