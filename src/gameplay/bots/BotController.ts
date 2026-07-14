import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { rotateVector } from '../../core/math/Quaternion';
import type { Vec3 } from '../../core/math/Vector3';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../input/PlayerCommand';
import type { AuthoritativeFrame, TeamId } from '../../networking/LobbyProtocol';

export type BotRole = 'striker' | 'defender';

export class BotController {
  private jumpHeldUntilTick = -1;
  private jumpCooldownUntilTick = -1;

  constructor(
    private readonly playerId: string,
    private readonly team: TeamId,
    private readonly role: BotRole,
  ) {}

  command(frame: AuthoritativeFrame, tick: number): PlayerCommand {
    const car = frame.cars[this.playerId];
    if (!car) return NEUTRAL_COMMAND;

    const ball = frame.snapshot.ball;
    const carPosition = car.transform.position;
    const ballPosition = ball.transform.position;
    const ballDistance = horizontalDistance(carPosition, ballPosition);
    const attackDirection = this.team === 'azure' ? -1 : 1;
    const ballProgress = ballPosition.z * attackDirection;
    const defending = this.role === 'defender' && ballProgress > 3;
    const target = defending
      ? {
          x: ballPosition.x * 0.55,
          y: 0,
          z: attackDirection * -ARENA_TUNING.halfLength * 0.48,
        }
      : this.attackTarget(frame, attackDirection, ballDistance);
    const toTarget = horizontalDirection(carPosition, target);
    const forward = horizontalDirection(
      { x: 0, y: 0, z: 0 },
      rotateVector(car.transform.rotation, { x: 0, y: 0, z: -1 }),
    );
    const right = horizontalDirection(
      { x: 0, y: 0, z: 0 },
      rotateVector(car.transform.rotation, { x: 1, y: 0, z: 0 }),
    );
    const forwardAlignment = forward.x * toTarget.x + forward.z * toTarget.z;
    const sideAlignment = right.x * toTarget.x + right.z * toTarget.z;
    const speed = Math.hypot(car.linearVelocity.x, car.linearVelocity.z);
    const targetDistance = horizontalDistance(carPosition, target);
    const reversing = forwardAlignment < -0.45;
    const shouldJump = !defending
      && tick >= this.jumpCooldownUntilTick
      && car.grounded
      && ballDistance < 4.6
      && ballPosition.y > carPosition.y + 0.45;

    if (shouldJump) {
      this.jumpHeldUntilTick = tick + 7;
      this.jumpCooldownUntilTick = tick + 84;
    }

    return {
      ...NEUTRAL_COMMAND,
      throttle: reversing ? -0.7 : 1,
      steer: clamp(sideAlignment * 2.35, -1, 1),
      jumpPressed: shouldJump,
      jumpHeld: shouldJump || tick <= this.jumpHeldUntilTick,
      boost: !reversing
        && !defending
        && forwardAlignment > 0.9
        && targetDistance > 8
        && speed < 25
        && car.boost > 5,
      powerslide: !reversing && forwardAlignment < 0.5 && speed > 7,
    };
  }

  private attackTarget(frame: AuthoritativeFrame, attackDirection: number, ballDistance: number): Vec3 {
    const ball = frame.snapshot.ball;
    const leadSeconds = Math.min(0.4, ballDistance / 45);
    const predictedBall = {
      x: ball.transform.position.x + ball.linearVelocity.x * leadSeconds,
      y: ball.transform.position.y,
      z: ball.transform.position.z + ball.linearVelocity.z * leadSeconds,
    };
    if (ballDistance < 5.5) return predictedBall;

    const opponentGoal = { x: 0, y: 0, z: attackDirection * ARENA_TUNING.halfLength };
    const shotDirection = horizontalDirection(predictedBall, opponentGoal);
    return {
      x: predictedBall.x - shotDirection.x * 4,
      y: 0,
      z: predictedBall.z - shotDirection.z * 4,
    };
  }
}

const horizontalDirection = (from: Vec3, to: Vec3): Vec3 => {
  const x = to.x - from.x;
  const z = to.z - from.z;
  const inverseLength = 1 / Math.max(0.0001, Math.hypot(x, z));
  return { x: x * inverseLength, y: 0, z: z * inverseLength };
};

const horizontalDistance = (left: Vec3, right: Vec3): number => (
  Math.hypot(right.x - left.x, right.z - left.z)
);

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);
