import { RUNTIME_CONFIG } from '../app/RuntimeConfig';
import { slerpQuat } from '../core/math/Quaternion';
import { lerpVec3 } from '../core/math/Vector3';
import type { CarState } from '../gameplay/car/CarState';
import { interpolateSnapshots } from '../gameplay/simulation/SnapshotInterpolator';
import type { AuthoritativeFrame } from './LobbyProtocol';

const MAX_BUFFERED_FRAMES = 8;

interface TimedFrame {
  readonly frame: AuthoritativeFrame;
  readonly receivedAtSeconds: number;
}

export class AuthoritativeFrameInterpolator {
  private readonly frames: TimedFrame[] = [];
  private lastTargetSequence = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly interpolationDelaySeconds: number,
    private readonly physicsHz: number = RUNTIME_CONFIG.physicsHz,
    private readonly maximumExtrapolationSeconds: number = 0,
  ) {}

  push(frame: AuthoritativeFrame, receivedAtSeconds: number): void {
    const newest = this.frames.at(-1)?.frame;
    if (newest && frame.sequence <= newest.sequence) return;
    this.frames.push({ frame, receivedAtSeconds });
    if (this.frames.length > MAX_BUFFERED_FRAMES) this.frames.shift();
  }

  sample(nowSeconds: number): AuthoritativeFrame | null {
    const newest = this.frames.at(-1);
    if (!newest) return null;
    const elapsedSinceNewest = Math.max(0, nowSeconds - newest.receivedAtSeconds);
    const desiredSequence = newest.frame.sequence
      - this.interpolationDelaySeconds * this.physicsHz
      + elapsedSinceNewest * this.physicsHz;
    const targetSequence = Math.min(
      newest.frame.sequence + this.maximumExtrapolationSeconds * this.physicsHz,
      Math.max(this.lastTargetSequence, desiredSequence),
    );
    this.lastTargetSequence = targetSequence;

    const oldest = this.frames[0];
    if (!oldest || targetSequence <= oldest.frame.sequence) return oldest?.frame ?? newest.frame;
    const newerIndex = this.frames.findIndex(({ frame }) => frame.sequence >= targetSequence);
    if (newerIndex < 0) {
      const older = this.frames.at(-2)?.frame;
      if (!older) return newest.frame;
      return interpolateBySequence(older, newest.frame, targetSequence);
    }
    const older = this.frames[newerIndex - 1]?.frame;
    const newer = this.frames[newerIndex]?.frame;
    if (!older || !newer) return newest.frame;
    return interpolateBySequence(older, newer, targetSequence);
  }
}

const interpolateBySequence = (
  older: AuthoritativeFrame,
  newer: AuthoritativeFrame,
  targetSequence: number,
): AuthoritativeFrame => {
  const sequenceRange = newer.sequence - older.sequence;
  const alpha = sequenceRange > 0 ? (targetSequence - older.sequence) / sequenceRange : 1;
  return interpolateFrames(older, newer, alpha);
};

export const interpolateFrames = (
  previous: AuthoritativeFrame,
  current: AuthoritativeFrame,
  alpha: number,
): AuthoritativeFrame => {
  const enteredVictoryPresentation = previous.snapshot.match.phase !== 'ended'
    && current.snapshot.match.phase === 'ended';
  return {
    sequence: current.sequence,
    snapshot: enteredVictoryPresentation
      ? current.snapshot
      : interpolateSnapshots(previous.snapshot, current.snapshot, alpha),
    cars: enteredVictoryPresentation
      ? current.cars
      : interpolateCars(previous.cars, current.cars, alpha),
  };
};

const interpolateCars = (
  previous: Readonly<Record<string, CarState>>,
  current: Readonly<Record<string, CarState>>,
  alpha: number,
): Readonly<Record<string, CarState>> => Object.fromEntries(
  Object.entries(current).map(([playerId, state]) => [
    playerId,
    previous[playerId] ? interpolateCar(previous[playerId], state, alpha) : state,
  ]),
);

const interpolateCar = (previous: CarState, current: CarState, alpha: number): CarState => ({
  ...current,
  transform: {
    position: lerpVec3(previous.transform.position, current.transform.position, alpha),
    rotation: slerpQuat(previous.transform.rotation, current.transform.rotation, alpha),
  },
  linearVelocity: lerpVec3(previous.linearVelocity, current.linearVelocity, alpha),
  angularVelocity: lerpVec3(previous.angularVelocity, current.angularVelocity, alpha),
  wheels: current.wheels.map((wheel, index) => {
    const oldWheel = previous.wheels[index];
    if (!oldWheel) return wheel;
    return {
      ...wheel,
      connectionPoint: lerpVec3(oldWheel.connectionPoint, wheel.connectionPoint, alpha),
      contactPoint: lerpVec3(oldWheel.contactPoint, wheel.contactPoint, alpha),
      position: lerpVec3(oldWheel.position, wheel.position, alpha),
      steeringAngle: oldWheel.steeringAngle + (wheel.steeringAngle - oldWheel.steeringAngle) * alpha,
      spinAngle: oldWheel.spinAngle + shortestAngleDelta(oldWheel.spinAngle, wheel.spinAngle) * alpha,
    };
  }),
});

const shortestAngleDelta = (from: number, to: number): number => {
  const fullTurn = Math.PI * 2;
  return ((to - from + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
};
