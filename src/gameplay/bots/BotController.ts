import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { rotateVector } from '../../core/math/Quaternion';
import type { Vec3 } from '../../core/math/Vector3';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../input/PlayerCommand';
import type { AuthoritativeFrame, TeamId } from '../../networking/LobbyProtocol';
import { GOALS } from '../arena/ArenaDefinition';

export type BotRole = 'striker' | 'defender';

const STUCK_SPEED = 0.65;
const STUCK_TICKS = 45;
const RECOVERY_RETRY_TICKS = 50;
const DEFENDER_CHALLENGE_DEPTH = 8;

export class BotController {
  private jumpHeldUntilTick = -1;
  private jumpCooldownUntilTick = -1;
  private slowSinceTick: number | null = null;
  private recoveryRetryTick = -1;

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
    const carUp = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
    const activePlay = frame.snapshot.match.phase === 'playing' || frame.snapshot.match.phase === 'overtime';
    const settledOnBack = activePlay
      && carUp.y < -0.35
      && carPosition.y < 2.2
      && Math.abs(car.linearVelocity.y) < 1;
    if (settledOnBack) return this.recoveryCommand(tick);

    const ownGoal = GOALS.find(({ defendingTeam }) => defendingTeam === this.team);
    const opponentGoal = GOALS.find(({ teamScored }) => teamScored === this.team);
    if (!ownGoal || !opponentGoal) return NEUTRAL_COMMAND;

    const attackDirection = Math.sign(opponentGoal.center.z);
    const ballProgress = ballPosition.z * attackDirection;
    const holdingDefense = this.role === 'defender' && ballProgress > -DEFENDER_CHALLENGE_DEPTH;
    const target = holdingDefense
      ? this.defensiveAnchor(ballPosition, ownGoal.center)
      : this.shotTarget(frame, carPosition, opponentGoal.center, ballDistance);
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
    const stuck = activePlay
      && car.grounded
      && carUp.y > 0.55
      && speed < STUCK_SPEED
      && targetDistance > 4;
    if (!stuck) {
      this.slowSinceTick = null;
    } else if (this.slowSinceTick === null) {
      this.slowSinceTick = tick;
    }
    const stuckJump = this.slowSinceTick !== null && tick - this.slowSinceTick >= STUCK_TICKS;
    const ballJump = !holdingDefense
      && car.grounded
      && ballDistance < 4.6
      && ballPosition.y > carPosition.y + 0.45;
    const shouldJump = activePlay
      && tick >= this.jumpCooldownUntilTick
      && (stuckJump || ballJump);

    if (shouldJump) {
      this.jumpHeldUntilTick = tick + 7;
      this.jumpCooldownUntilTick = tick + 84;
      this.slowSinceTick = null;
    }

    return {
      ...NEUTRAL_COMMAND,
      throttle: reversing ? -0.7 : 1,
      steer: clamp(sideAlignment * 2.35, -1, 1),
      jumpPressed: shouldJump,
      jumpHeld: shouldJump || tick <= this.jumpHeldUntilTick,
      boost: !reversing
        && !holdingDefense
        && forwardAlignment > 0.9
        && targetDistance > 8
        && speed < 25
        && car.boost > 5,
      powerslide: !reversing && forwardAlignment < 0.5 && speed > 7,
    };
  }

  private recoveryCommand(tick: number): PlayerCommand {
    this.slowSinceTick = null;
    const jumpPressed = tick >= this.recoveryRetryTick;
    if (jumpPressed) this.recoveryRetryTick = tick + RECOVERY_RETRY_TICKS;
    return {
      ...NEUTRAL_COMMAND,
      throttle: 1,
      jumpPressed,
      jumpHeld: jumpPressed,
    };
  }

  private defensiveAnchor(ballPosition: Vec3, ownGoal: Vec3): Vec3 {
    return {
      x: clamp(ballPosition.x * 0.45, -ARENA_TUNING.goalHalfWidth * 0.85, ARENA_TUNING.goalHalfWidth * 0.85),
      y: 0,
      z: ownGoal.z * 0.55,
    };
  }

  private shotTarget(
    frame: AuthoritativeFrame,
    carPosition: Vec3,
    opponentGoal: Vec3,
    ballDistance: number,
  ): Vec3 {
    const predictedBall = this.predictedBall(frame, ballDistance);
    const shotDirection = horizontalDirection(predictedBall, opponentGoal);
    const carToBall = horizontalDirection(carPosition, predictedBall);
    const approachAlignment = horizontalDot(carToBall, shotDirection);

    if (approachAlignment > 0.72) return predictedBall;
    if (approachAlignment < -0.1) {
      return this.orbitTarget(carPosition, predictedBall, shotDirection);
    }

    return {
      x: predictedBall.x - shotDirection.x * 4,
      y: 0,
      z: predictedBall.z - shotDirection.z * 4,
    };
  }

  private orbitTarget(carPosition: Vec3, ballPosition: Vec3, shotDirection: Vec3): Vec3 {
    const shotRight = { x: shotDirection.z, y: 0, z: -shotDirection.x };
    const candidate = (side: number): Vec3 => ({
      x: clamp(ballPosition.x + shotRight.x * side * 5.5, -ARENA_TUNING.halfWidth + 3, ARENA_TUNING.halfWidth - 3),
      y: 0,
      z: clamp(ballPosition.z + shotRight.z * side * 5.5, -ARENA_TUNING.halfLength + 3, ARENA_TUNING.halfLength - 3),
    });
    const left = candidate(-1);
    const right = candidate(1);
    return horizontalDistance(carPosition, left) <= horizontalDistance(carPosition, right) ? left : right;
  }

  private predictedBall(frame: AuthoritativeFrame, ballDistance: number): Vec3 {
    const ball = frame.snapshot.ball;
    const leadSeconds = Math.min(0.4, ballDistance / 45);
    return {
      x: ball.transform.position.x + ball.linearVelocity.x * leadSeconds,
      y: ball.transform.position.y,
      z: ball.transform.position.z + ball.linearVelocity.z * leadSeconds,
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

const horizontalDot = (left: Vec3, right: Vec3): number => left.x * right.x + left.z * right.z;

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);
