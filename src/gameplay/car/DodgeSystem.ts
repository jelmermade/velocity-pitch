import type { CarTuning } from '../../core/config/CarTuning';
import { add, scale, type Vec3 } from '../../core/math/Vector3';
import type { PlayerCommand } from '../../input/PlayerCommand';
import type { PhysicsBody } from '../../physics/PhysicsBody';

export interface DodgeState {
  readonly controlLocked: boolean;
  readonly rotationLocked: boolean;
  readonly autoLeveling: boolean;
}

export class DodgeSystem {
  private firstJumpAge = Number.POSITIVE_INFINITY;
  private jumpStage: 0 | 1 | 2 = 0;
  private leftGroundAfterFirstJump = false;
  private controlLockRemaining = 0;
  private autoLevelRemaining = 0;
  private autoLevelDelayRemaining = 0;

  update(
    body: PhysicsBody,
    command: PlayerCommand,
    grounded: boolean,
    axes: { readonly up: Vec3; readonly forward: Vec3; readonly right: Vec3 },
    tuning: CarTuning,
    deltaSeconds: number,
  ): DodgeState {
    this.controlLockRemaining = Math.max(0, this.controlLockRemaining - deltaSeconds);
    this.autoLevelRemaining = Math.max(0, this.autoLevelRemaining - deltaSeconds);
    this.autoLevelDelayRemaining = Math.max(0, this.autoLevelDelayRemaining - deltaSeconds);
    if (this.jumpStage > 0) {
      this.firstJumpAge += deltaSeconds;
    }
    if (this.jumpStage > 0 && !grounded) this.leftGroundAfterFirstJump = true;
    const landedAfterJump = grounded && this.leftGroundAfterFirstJump;
    const firstJumpExpiredOnGround = grounded
      && this.jumpStage === 1
      && this.firstJumpAge > tuning.secondJumpWindowSeconds;
    if (landedAfterJump || firstJumpExpiredOnGround) this.resetJumpSequence();
    if (!command.jumpPressed) return this.state();

    if (grounded && this.jumpStage === 0) {
      body.applyImpulse(scale(axes.up, tuning.jumpImpulse));
      this.firstJumpAge = 0;
      this.jumpStage = 1;
      this.leftGroundAfterFirstJump = false;
      return this.state();
    }
    if (this.jumpStage !== 1 || this.firstJumpAge > tuning.secondJumpWindowSeconds) {
      return this.state();
    }

    const hasDirection = Math.abs(command.throttle) + Math.abs(command.steer) > 0.15;
    if (!hasDirection) {
      body.applyImpulse(scale(axes.up, tuning.jumpImpulse * 0.88));
    } else {
      const direction = add(scale(axes.forward, command.throttle), scale(axes.right, command.steer));
      body.applyImpulse(add(scale(direction, tuning.dodgeImpulse), scale(axes.up, tuning.jumpImpulse * 0.25)));
      const pitch = -command.throttle * tuning.dodgePitchTorque;
      const roll = command.steer * tuning.dodgeRollTorque;
      body.applyTorqueImpulse(add(scale(axes.right, pitch), scale(axes.forward, roll)));
      this.controlLockRemaining = tuning.dodgeControlLockSeconds;
      this.autoLevelRemaining = tuning.dodgeAutoLevelSeconds;
      this.autoLevelDelayRemaining = tuning.dodgeAutoLevelDelaySeconds;
    }
    this.jumpStage = 2;
    return this.state();
  }

  reset(): void {
    this.resetJumpSequence();
  }

  private resetJumpSequence(): void {
    this.firstJumpAge = Number.POSITIVE_INFINITY;
    this.jumpStage = 0;
    this.leftGroundAfterFirstJump = false;
    this.controlLockRemaining = 0;
    this.autoLevelRemaining = 0;
    this.autoLevelDelayRemaining = 0;
  }

  private state(): DodgeState {
    return {
      controlLocked: this.controlLockRemaining > 0,
      rotationLocked: this.autoLevelRemaining > 0,
      autoLeveling: this.autoLevelRemaining > 0 && this.autoLevelDelayRemaining === 0,
    };
  }
}
