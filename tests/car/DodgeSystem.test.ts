import { describe, expect, it } from 'vitest';
import { DEFAULT_CAR_TUNING } from '../../src/core/config/CarTuning';
import type { Quat } from '../../src/core/math/Quaternion';
import type { Vec3 } from '../../src/core/math/Vector3';
import { DodgeSystem } from '../../src/gameplay/car/DodgeSystem';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import type { PhysicsBody } from '../../src/physics/PhysicsBody';

const STEP = 1 / 120;
const AXES = {
  up: { x: 0, y: 1, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  right: { x: 1, y: 0, z: 0 },
} as const;
const JUMP_COMMAND = { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true };

describe('DodgeSystem double jump', () => {
  it('accepts a second press before suspension has cleared the floor', () => {
    const dodge = new DodgeSystem();
    const body = new RecordingBody();

    dodge.update(body, JUMP_COMMAND, true, AXES, DEFAULT_CAR_TUNING, STEP);
    dodge.update(body, NEUTRAL_COMMAND, true, AXES, DEFAULT_CAR_TUNING, STEP);
    dodge.update(body, JUMP_COMMAND, true, AXES, DEFAULT_CAR_TUNING, STEP);

    expect(body.impulses).toHaveLength(2);
    expect(body.impulses[1]?.y).toBeCloseTo(DEFAULT_CAR_TUNING.jumpImpulse * 0.88);
  });

  it('accepts one airborne second jump inside the configured time window', () => {
    const dodge = new DodgeSystem();
    const body = new RecordingBody();

    dodge.update(body, JUMP_COMMAND, true, AXES, DEFAULT_CAR_TUNING, STEP);
    advance(dodge, body, 0.5);
    dodge.update(body, JUMP_COMMAND, false, AXES, DEFAULT_CAR_TUNING, STEP);
    dodge.update(body, JUMP_COMMAND, false, AXES, DEFAULT_CAR_TUNING, STEP);

    expect(body.impulses).toHaveLength(2);
  });

  it('rejects the second jump after the configured time window', () => {
    const dodge = new DodgeSystem();
    const body = new RecordingBody();

    dodge.update(body, JUMP_COMMAND, true, AXES, DEFAULT_CAR_TUNING, STEP);
    advance(dodge, body, DEFAULT_CAR_TUNING.secondJumpWindowSeconds + STEP);
    dodge.update(body, JUMP_COMMAND, false, AXES, DEFAULT_CAR_TUNING, STEP);

    expect(body.impulses).toHaveLength(1);
  });

  it('uses axis-specific torque and locks regular pitch control during a directional dodge', () => {
    const dodge = new DodgeSystem();
    const body = new RecordingBody();
    const forwardDodge = { ...JUMP_COMMAND, throttle: 1 };

    dodge.update(body, JUMP_COMMAND, true, AXES, DEFAULT_CAR_TUNING, STEP);
    advance(dodge, body, 0.2);
    const state = dodge.update(body, forwardDodge, false, AXES, DEFAULT_CAR_TUNING, STEP);

    expect(state.controlLocked).toBe(true);
    expect(state.rotationLocked).toBe(true);
    expect(state.autoLeveling).toBe(false);
    expect(body.torqueImpulses[0]?.x).toBeCloseTo(-DEFAULT_CAR_TUNING.dodgePitchTorque);

    advance(dodge, body, DEFAULT_CAR_TUNING.dodgeAutoLevelDelaySeconds + STEP);
    const leveling = dodge.update(body, NEUTRAL_COMMAND, false, AXES, DEFAULT_CAR_TUNING, STEP);
    expect(leveling.autoLeveling).toBe(true);
  });
});

const advance = (dodge: DodgeSystem, body: PhysicsBody, durationSeconds: number): void => {
  const ticks = Math.ceil(durationSeconds / STEP);
  for (let tick = 0; tick < ticks; tick += 1) {
    dodge.update(body, NEUTRAL_COMMAND, false, AXES, DEFAULT_CAR_TUNING, STEP);
  }
};

class RecordingBody implements PhysicsBody {
  readonly handle = 1;
  readonly impulses: Vec3[] = [];
  readonly torqueImpulses: Vec3[] = [];

  position(): Vec3 { return { x: 0, y: 0, z: 0 }; }
  rotation(): Quat { return { x: 0, y: 0, z: 0, w: 1 }; }
  linearVelocity(): Vec3 { return { x: 0, y: 0, z: 0 }; }
  angularVelocity(): Vec3 { return { x: 0, y: 0, z: 0 }; }
  velocityAtPoint(): Vec3 { return { x: 0, y: 0, z: 0 }; }
  clearForces(): void {}
  clearTorques(): void {}
  applyForce(): void {}
  applyForceAtPoint(): void {}
  applyImpulse(impulse: Vec3): void { this.impulses.push(impulse); }
  applyTorqueImpulse(impulse: Vec3): void { this.torqueImpulses.push(impulse); }
  setPosition(): void {}
  setRotation(): void {}
  setLinearVelocity(): void {}
  setAngularVelocity(): void {}
  wakeUp(): void {}
}
