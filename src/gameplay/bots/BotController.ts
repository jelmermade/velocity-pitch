import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { BALL_TUNING } from '../../core/config/BallTuning';
import { PHYSICS_TUNING } from '../../core/config/PhysicsTuning';
import { rotateVector } from '../../core/math/Quaternion';
import type { Vec3 } from '../../core/math/Vector3';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../input/PlayerCommand';
import type { AuthoritativeFrame, TeamId } from '../../networking/LobbyProtocol';
import { GOALS } from '../arena/ArenaDefinition';
import {
  BOT_POLICY_ORDER,
  selectBotPolicy,
  type BotKnowledge,
  type BotPolicy,
  type BotPolicyObservation,
  type BotRole,
} from './BotKnowledge';

export type { BotPolicy, BotRole } from './BotKnowledge';

export interface BotLearningState {
  readonly points: number;
  readonly policy: BotPolicy;
  readonly policyValue: number;
  readonly policyValues: Readonly<Record<BotPolicy, number>>;
  readonly policySamples: Readonly<Record<BotPolicy, number>>;
}

interface BotPolicyProfile {
  readonly defenderChallengeDepth: number;
  readonly stagingDistance: number;
  readonly jumpDistance: number;
  readonly boostMaximumSpeed: number;
  readonly aerialMaximumDistance: number;
  readonly aerialMinimumBoost: number;
}

const BOT_POLICIES: Readonly<Record<BotPolicy, BotPolicyProfile>> = Object.freeze({
  balanced: Object.freeze({
    defenderChallengeDepth: 8,
    stagingDistance: 4,
    jumpDistance: 4.6,
    boostMaximumSpeed: 25,
    aerialMaximumDistance: 24,
    aerialMinimumBoost: 18,
  }),
  press: Object.freeze({
    defenderChallengeDepth: 4,
    stagingDistance: 3.1,
    jumpDistance: 5.1,
    boostMaximumSpeed: 28,
    aerialMaximumDistance: 29,
    aerialMinimumBoost: 10,
  }),
  rotate: Object.freeze({
    defenderChallengeDepth: 14,
    stagingDistance: 5.4,
    jumpDistance: 4.2,
    boostMaximumSpeed: 22,
    aerialMaximumDistance: 21,
    aerialMinimumBoost: 25,
  }),
});

const POLICY_EVALUATION_TICKS = 300;

const STUCK_SPEED = 0.65;
const STUCK_TICKS = 75;
const SUPPORT_DISTANCE = 13;
const SUPPORT_LATERAL_OFFSET = 7;
const REQUIRED_CONTACT_CLEARANCE = 0.75;
const AERIAL_BALL_HEIGHT = BALL_TUNING.radius + 1.25;
const AERIAL_MAXIMUM_HEIGHT = Math.min(10, ARENA_TUNING.goalHeight * 0.8);
const AERIAL_MAXIMUM_TICKS = 84;
const AERIAL_SECOND_JUMP_DELAY_TICKS = 8;
const AERIAL_RETRY_TICKS = 300;
const KICKOFF_CONTROL_TICKS = 210;
const SHOT_COMMITMENT_TICKS = 24;
const SCORING_JUMP_DISTANCE = ARENA_TUNING.goalDepth + 8 * ARENA_TUNING.scale;
const BOOST_MINIMUM_BALL_DISTANCE = 10;
const BOOST_MAXIMUM_STEER = 0.18;
const BOOST_MAXIMUM_LATERAL_SPEED = 2.5;
const POWERSLIDE_MINIMUM_BALL_DISTANCE = 10;
const POWERSLIDE_MINIMUM_SPEED = 12;
const POWERSLIDE_NATURAL_TURN_TICKS = 24;
const POWERSLIDE_BURST_TICKS = 6;
const POWERSLIDE_COOLDOWN_TICKS = 120;
const NATURAL_TURN_RADIUS_AT_MINIMUM_SPEED = 8;
const NATURAL_TURN_RADIUS_SPEED_FACTOR = 0.55;
const POWERSLIDE_TURN_RADIUS_MARGIN = 0.85;
const RECOVERY_RETRY_TICKS = 50;
const FLIPPED_RECOVERY_RETRY_TICKS = 100;
const FLIPPED_SECOND_JUMP_TICKS = 46;

export class BotController {
  private jumpHeldUntilTick = -1;
  private jumpCooldownUntilTick = -1;
  private slowSinceTick: number | null = null;
  private recoveryRetryTick = -1;
  private recoverySecondJumpTick = -1;
  private aerialStartedTick = -1;
  private aerialSecondJumpTick = -1;
  private aerialRetryTick = -1;
  private challengeCommittedUntilTick = -1;
  private powerslideNeededSinceTick: number | null = null;
  private powerslideHeldUntilTick = -1;
  private powerslideCooldownUntilTick = -1;
  private kickoffCount = 0;
  private kickoffStartedTick = -1;
  private sawKickoffCountdown = false;
  private policy: BotPolicy = 'balanced';
  private readonly policyValues = new Map<BotPolicy, number>(BOT_POLICY_ORDER.map((policy) => [policy, 0]));
  private readonly policyObservationTotals = new Map<BotPolicy, number>(BOT_POLICY_ORDER.map((policy) => [policy, 0]));
  private readonly policyObservationSamples = new Map<BotPolicy, number>(BOT_POLICY_ORDER.map((policy) => [policy, 0]));
  private rewardAccumulator = 0;
  private earnedPoints = 0;
  private nextPolicyEvaluationTick = POLICY_EVALUATION_TICKS;

  constructor(
    private readonly playerId: string,
    private readonly team: TeamId,
    private readonly role: BotRole,
    private readonly learning = false,
    knowledge?: BotKnowledge,
    private readonly teamPlayerIds: readonly string[] = [playerId],
  ) {
    if (knowledge) {
      BOT_POLICY_ORDER.forEach((policy) => this.policyValues.set(policy, knowledge.roles[role][policy].value));
    }
    if (!learning) {
      this.policy = knowledge ? selectBotPolicy(knowledge, role) : 'balanced';
      return;
    }
    if (!knowledge) {
      this.policy = BOT_POLICY_ORDER[hashString(playerId) % BOT_POLICY_ORDER.length] ?? 'balanced';
      return;
    }
    const hasKnowledge = BOT_POLICY_ORDER.some((policy) => knowledge.roles[role][policy].samples > 0);
    if (!hasKnowledge) {
      this.policy = BOT_POLICY_ORDER[hashString(playerId) % BOT_POLICY_ORDER.length] ?? 'balanced';
      return;
    }
    const learnedPolicy = selectBotPolicy(knowledge, role);
    const learnedIndex = BOT_POLICY_ORDER.indexOf(learnedPolicy);
    this.policy = hashString(playerId) % 5 === 0
      ? BOT_POLICY_ORDER[(learnedIndex + 1) % BOT_POLICY_ORDER.length] ?? learnedPolicy
      : learnedPolicy;
  }

  command(frame: AuthoritativeFrame, tick: number): PlayerCommand {
    const car = frame.cars[this.playerId];
    if (!car) return NEUTRAL_COMMAND;

    const ball = frame.snapshot.ball;
    const carPosition = car.transform.position;
    const ballPosition = ball.transform.position;
    const ballDistance = horizontalDistance(carPosition, ballPosition);
    const carUp = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
    const activePlay = frame.snapshot.match.phase === 'playing' || frame.snapshot.match.phase === 'overtime';
    this.updateKickoffState(frame, tick, activePlay);
    if (!activePlay) this.finishAerial();
    const needsRecovery = activePlay
      && carUp.y < 0.45
      && carPosition.y < 2.2
      && Math.abs(car.linearVelocity.y) < 1;
    const completingFlippedRecovery = activePlay && this.recoverySecondJumpTick >= 0;
    if (needsRecovery || completingFlippedRecovery) {
      return this.recoveryCommand(tick, needsRecovery ? carUp.y < -0.35 : true);
    }
    this.recoverySecondJumpTick = -1;
    if (car.grounded && carUp.y > 0.55) this.recoveryRetryTick = -1;

    const ownGoal = GOALS.find(({ defendingTeam }) => defendingTeam === this.team);
    const opponentGoal = GOALS.find(({ teamScored }) => teamScored === this.team);
    if (!ownGoal || !opponentGoal) return NEUTRAL_COMMAND;
    const profile = BOT_POLICIES[this.policy];
    const forward3D = rotateVector(car.transform.rotation, { x: 0, y: 0, z: -1 });
    const right3D = rotateVector(car.transform.rotation, { x: 1, y: 0, z: 0 });
    const forward = horizontalDirection({ x: 0, y: 0, z: 0 }, forward3D);
    const right = horizontalDirection({ x: 0, y: 0, z: 0 }, right3D);

    const attackDirection = Math.sign(opponentGoal.center.z);
    const ballProgress = ballPosition.z * attackDirection;
    const rawChallengePriority = this.hasChallengePriority(frame, ballPosition);
    const shotAlignment = this.shotApproachAlignment(frame, carPosition, opponentGoal.center, ballDistance);
    if (rawChallengePriority && ballDistance < 10 && shotAlignment > 0.55) {
      this.challengeCommittedUntilTick = tick + SHOT_COMMITMENT_TICKS;
    }
    const hasChallengePriority = rawChallengePriority || tick <= this.challengeCommittedUntilTick;
    const holdingDefense = this.role === 'defender' && ballProgress > -profile.defenderChallengeDepth;
    const supportingAttack = this.role === 'striker' && !hasChallengePriority;
    const kickoffActive = this.kickoffStartedTick >= 0
      && tick - this.kickoffStartedTick <= KICKOFF_CONTROL_TICKS
      && Math.hypot(ballPosition.x, ballPosition.z) < 18;
    const aerialActive = this.aerialStartedTick >= 0
      && tick - this.aerialStartedTick <= AERIAL_MAXIMUM_TICKS
      && ballPosition.y > BALL_TUNING.radius + 0.35
      && (tick - this.aerialStartedTick <= AERIAL_SECOND_JUMP_DELAY_TICKS + 4 || !car.grounded);
    if (aerialActive) return this.aerialCommand(frame, tick, profile.aerialMinimumBoost);
    if (this.aerialStartedTick >= 0) this.finishAerial();

    const predictedAerial = this.predictedAerialBall(frame, carPosition);
    const toPredictedAerial = horizontalDirection(carPosition, predictedAerial);
    const aerialFacing = horizontalDot(forward, toPredictedAerial);
    const aerialDistance = horizontalDistance(carPosition, predictedAerial);
    const aerialOpportunity = activePlay
      && !holdingDefense
      && !supportingAttack
      && hasChallengePriority
      && car.grounded
      && tick >= this.aerialRetryTick
      && ballPosition.y >= AERIAL_BALL_HEIGHT
      && ballPosition.y <= AERIAL_MAXIMUM_HEIGHT
      && predictedAerial.y >= carPosition.y + 1.25
      && predictedAerial.y <= AERIAL_MAXIMUM_HEIGHT
      && aerialDistance <= profile.aerialMaximumDistance * 0.5
      && car.boost >= profile.aerialMinimumBoost
      && aerialFacing > 0.9
      && shotAlignment > 0.78
      && ball.linearVelocity.y > -2;
    if (aerialOpportunity) {
      this.aerialStartedTick = tick;
      this.aerialSecondJumpTick = tick + AERIAL_SECOND_JUMP_DELAY_TICKS;
      this.aerialRetryTick = tick + AERIAL_RETRY_TICKS;
      this.jumpCooldownUntilTick = tick + AERIAL_RETRY_TICKS;
      return { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true };
    }

    // Ground throttle is pitch input in the air, so never reuse navigation commands while landing.
    if (!car.grounded) return this.airborneRecoveryCommand(car.transform.rotation);

    const target = holdingDefense
      ? this.defensiveAnchor(ballPosition, ownGoal.center)
      : supportingAttack
        ? this.supportTarget(ballPosition, opponentGoal.center)
        : kickoffActive
          ? this.kickoffTarget(ballPosition)
          : this.shotTarget(frame, carPosition, opponentGoal.center, ballDistance, profile.stagingDistance);
    const toTarget = horizontalDirection(carPosition, target);
    const forwardAlignment = forward.x * toTarget.x + forward.z * toTarget.z;
    const sideAlignment = right.x * toTarget.x + right.z * toTarget.z;
    const ballFacing = horizontalDot(forward, horizontalDirection(carPosition, ballPosition));
    const speed = Math.hypot(car.linearVelocity.x, car.linearVelocity.z);
    const lateralSpeed = car.linearVelocity.x * right.x + car.linearVelocity.z * right.z;
    const targetDistance = horizontalDistance(carPosition, target);
    const turningAround = forwardAlignment < -0.25;
    const turnaroundSteer = Math.abs(sideAlignment) > 0.08
      ? Math.sign(sideAlignment)
      : (hashString(this.playerId) + this.kickoffCount) % 2 === 0 ? -1 : 1;
    const closeShotCorrection = !holdingDefense
      && !supportingAttack
      && ballDistance < 8
      && Math.abs(sideAlignment) > 0.24;
    const stuck = activePlay
      && carUp.y > 0.55
      && speed < STUCK_SPEED
      && targetDistance > 4;
    if (!stuck) {
      this.slowSinceTick = null;
    } else if (this.slowSinceTick === null) {
      this.slowSinceTick = tick;
    }
    const stuckJump = this.slowSinceTick !== null && tick - this.slowSinceTick >= STUCK_TICKS;
    const contactLeadSeconds = Math.min(0.25, ballDistance / 25);
    const predictedBallBottom = ballPosition.y
      + ball.linearVelocity.y * contactLeadSeconds
      + PHYSICS_TUNING.gravity.y * contactLeadSeconds ** 2 * 0.5
      - BALL_TUNING.radius;
    const ballRequiresJump = predictedBallBottom > carPosition.y + REQUIRED_CONTACT_CLEARANCE;
    const scoringJump = horizontalDistance(ballPosition, opponentGoal.center) < SCORING_JUMP_DISTANCE;
    const ballJump = !holdingDefense
      && !supportingAttack
      && ballDistance < profile.jumpDistance
      && ballFacing > 0.8
      && (ballRequiresJump || scoringJump)
      && shotAlignment > 0.78;
    const shouldJump = activePlay
      && tick >= this.jumpCooldownUntilTick
      && (stuckJump || ballJump);
    const steer = turningAround
      ? turnaroundSteer
      : clamp(sideAlignment * (closeShotCorrection ? 3 : 2.35), -1, 1);
    const requiredTurnRadius = targetDistance / Math.max(0.01, 2 * Math.abs(sideAlignment));
    const naturalTurnRadius = NATURAL_TURN_RADIUS_AT_MINIMUM_SPEED
      + Math.max(0, speed - POWERSLIDE_MINIMUM_SPEED) * NATURAL_TURN_RADIUS_SPEED_FACTOR;
    const radiusRequiresPowerslide = Math.abs(steer) > 0.85
      && forwardAlignment < 0.7
      && requiredTurnRadius < naturalTurnRadius * POWERSLIDE_TURN_RADIUS_MARGIN;
    const powerslideNeeded = activePlay
      && !holdingDefense
      && !supportingAttack
      && !kickoffActive
      && hasChallengePriority
      && speed > POWERSLIDE_MINIMUM_SPEED
      && ballDistance > POWERSLIDE_MINIMUM_BALL_DISTANCE
      && targetDistance > 6
      && Math.abs(sideAlignment) > 0.35
      && (forwardAlignment < -0.45 || radiusRequiresPowerslide);
    if (!powerslideNeeded) {
      this.powerslideNeededSinceTick = null;
    } else if (this.powerslideNeededSinceTick === null) {
      this.powerslideNeededSinceTick = tick;
    }
    const powerslideOpportunity = powerslideNeeded
      && this.powerslideNeededSinceTick !== null
      && tick - this.powerslideNeededSinceTick >= POWERSLIDE_NATURAL_TURN_TICKS;
    if (!powerslideOpportunity) {
      this.powerslideHeldUntilTick = -1;
    } else if (tick > this.powerslideHeldUntilTick && tick >= this.powerslideCooldownUntilTick) {
      this.powerslideHeldUntilTick = tick + POWERSLIDE_BURST_TICKS;
      this.powerslideCooldownUntilTick = tick + POWERSLIDE_COOLDOWN_TICKS;
    }
    const powerslide = powerslideOpportunity && tick <= this.powerslideHeldUntilTick;
    const sharpNaturalTurn = speed > POWERSLIDE_MINIMUM_SPEED
      && Math.abs(steer) > 0.8
      && forwardAlignment < 0.75;

    if (shouldJump) {
      this.jumpHeldUntilTick = tick + 7;
      this.jumpCooldownUntilTick = tick + 120;
      this.slowSinceTick = null;
    }

    return {
      ...NEUTRAL_COMMAND,
      throttle: (!turningAround && closeShotCorrection) || powerslide
        ? 0.35
        : sharpNaturalTurn ? 0.55 : 1,
      steer,
      jumpPressed: shouldJump,
      jumpHeld: shouldJump || tick <= this.jumpHeldUntilTick,
      boost: activePlay
        && !turningAround
        && !holdingDefense
        && !closeShotCorrection
        && ballDistance > BOOST_MINIMUM_BALL_DISTANCE
        && forwardAlignment > 0.96
        && Math.abs(steer) < BOOST_MAXIMUM_STEER
        && Math.abs(lateralSpeed) < BOOST_MAXIMUM_LATERAL_SPEED
        && targetDistance > 8
        && speed < profile.boostMaximumSpeed
        && car.boost > 5,
      powerslide,
    };
  }

  reward(value: number, tick: number): void {
    if (!this.learning || !Number.isFinite(value)) return;
    this.rewardAccumulator += value;
    this.earnedPoints += value;
    if (tick < this.nextPolicyEvaluationTick) return;

    const previousValue = this.policyValues.get(this.policy) ?? 0;
    const observedValue = this.rewardAccumulator / POLICY_EVALUATION_TICKS;
    this.policyValues.set(this.policy, previousValue + (observedValue - previousValue) * 0.35);
    this.policyObservationTotals.set(
      this.policy,
      (this.policyObservationTotals.get(this.policy) ?? 0) + observedValue,
    );
    this.policyObservationSamples.set(
      this.policy,
      (this.policyObservationSamples.get(this.policy) ?? 0) + 1,
    );
    this.rewardAccumulator = 0;
    this.nextPolicyEvaluationTick = tick + POLICY_EVALUATION_TICKS;
    this.policy = this.selectNextPolicy(tick);
  }

  learningState(): BotLearningState {
    const policyValues = Object.fromEntries(BOT_POLICY_ORDER.map((policy) => [
      policy,
      Number((this.policyValues.get(policy) ?? 0).toFixed(3)),
    ])) as Record<BotPolicy, number>;
    const policySamples = Object.fromEntries(BOT_POLICY_ORDER.map((policy) => [
      policy,
      this.policyObservationSamples.get(policy) ?? 0,
    ])) as Record<BotPolicy, number>;
    return {
      points: Number(this.earnedPoints.toFixed(1)),
      policy: this.policy,
      policyValue: policyValues[this.policy],
      policyValues,
      policySamples,
    };
  }

  learningObservations(): Readonly<Record<BotPolicy, BotPolicyObservation>> {
    return Object.fromEntries(BOT_POLICY_ORDER.map((policy) => [policy, {
      totalValue: this.policyObservationTotals.get(policy) ?? 0,
      samples: this.policyObservationSamples.get(policy) ?? 0,
    }])) as Record<BotPolicy, BotPolicyObservation>;
  }

  private recoveryCommand(tick: number, flipped: boolean): PlayerCommand {
    this.finishAerial();
    this.slowSinceTick = null;
    const secondJump = flipped && this.recoverySecondJumpTick >= 0 && tick >= this.recoverySecondJumpTick;
    const firstJump = !secondJump && tick >= this.recoveryRetryTick;
    if (secondJump) this.recoverySecondJumpTick = -1;
    if (firstJump) {
      this.recoveryRetryTick = tick + (flipped ? FLIPPED_RECOVERY_RETRY_TICKS : RECOVERY_RETRY_TICKS);
      this.recoverySecondJumpTick = flipped ? tick + FLIPPED_SECOND_JUMP_TICKS : -1;
    }
    const jumpPressed = firstJump || secondJump;
    return {
      ...NEUTRAL_COMMAND,
      throttle: flipped ? 1 : 0,
      jumpPressed,
      jumpHeld: jumpPressed,
    };
  }

  private aerialCommand(
    frame: AuthoritativeFrame,
    tick: number,
    minimumBoost: number,
  ): PlayerCommand {
    const car = frame.cars[this.playerId];
    if (!car) return NEUTRAL_COMMAND;
    if (tick === this.aerialSecondJumpTick) {
      this.aerialSecondJumpTick = -1;
      return { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true };
    }

    const carPosition = car.transform.position;
    const target = this.predictedAerialBall(frame, carPosition);
    const desired = direction3D(carPosition, target);
    const forward = rotateVector(car.transform.rotation, { x: 0, y: 0, z: -1 });
    const right = rotateVector(car.transform.rotation, { x: 1, y: 0, z: 0 });
    const up = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
    const forwardAlignment = dot3D(forward, desired);
    const rightAlignment = dot3D(right, desired);
    const verticalAlignment = dot3D(up, desired);
    const targetDistance = distance3D(carPosition, target);
    const pitchError = Math.atan2(verticalAlignment, Math.max(0.05, forwardAlignment));

    if (tick - this.aerialStartedTick > 18 && (forwardAlignment < 0.1 || target.y < carPosition.y - 0.5)) {
      this.finishAerial();
      return this.airborneRecoveryCommand(car.transform.rotation);
    }

    return {
      ...NEUTRAL_COMMAND,
      throttle: car.grounded ? 0 : clamp(-pitchError * 0.65, -0.75, 0.75),
      steer: car.grounded ? 0 : clamp(rightAlignment * 1.6, -0.8, 0.8),
      airRoll: car.grounded ? 0 : clamp(right.y * 1.1, -0.7, 0.7),
      jumpHeld: tick - this.aerialStartedTick <= 7,
      boost: !car.grounded
        && forwardAlignment > 0.9
        && targetDistance > 2.5
        && car.boost > minimumBoost * 0.5,
    };
  }

  private airborneRecoveryCommand(rotation: AuthoritativeFrame['cars'][string]['transform']['rotation']): PlayerCommand {
    const forward = rotateVector(rotation, { x: 0, y: 0, z: -1 });
    const right = rotateVector(rotation, { x: 1, y: 0, z: 0 });
    const up = rotateVector(rotation, { x: 0, y: 1, z: 0 });
    const fallbackRoll = up.y < 0 && Math.abs(right.y) < 0.08
      ? (hashString(this.playerId) % 2 === 0 ? -0.55 : 0.55)
      : 0;
    return {
      ...NEUTRAL_COMMAND,
      throttle: clamp(forward.y * 1.15, -0.7, 0.7),
      airRoll: fallbackRoll || clamp(right.y * 1.2, -0.8, 0.8),
    };
  }

  private predictedAerialBall(frame: AuthoritativeFrame, carPosition: Vec3): Vec3 {
    const ball = frame.snapshot.ball;
    const travelSeconds = clamp(horizontalDistance(carPosition, ball.transform.position) / 30, 0.12, 0.55);
    return {
      x: clamp(
        ball.transform.position.x + ball.linearVelocity.x * travelSeconds,
        -ARENA_TUNING.halfWidth + 2,
        ARENA_TUNING.halfWidth - 2,
      ),
      y: clamp(
        ball.transform.position.y
          + ball.linearVelocity.y * travelSeconds
          + PHYSICS_TUNING.gravity.y * travelSeconds ** 2 * 0.5,
        BALL_TUNING.radius,
        AERIAL_MAXIMUM_HEIGHT,
      ),
      z: clamp(
        ball.transform.position.z + ball.linearVelocity.z * travelSeconds,
        -ARENA_TUNING.halfLength + 2,
        ARENA_TUNING.halfLength - 2,
      ),
    };
  }

  private finishAerial(): void {
    this.aerialStartedTick = -1;
    this.aerialSecondJumpTick = -1;
  }

  private defensiveAnchor(ballPosition: Vec3, ownGoal: Vec3): Vec3 {
    return {
      x: clamp(ballPosition.x * 0.45, -ARENA_TUNING.goalHalfWidth * 0.85, ARENA_TUNING.goalHalfWidth * 0.85),
      y: 0,
      z: ownGoal.z * 0.55,
    };
  }

  private hasChallengePriority(frame: AuthoritativeFrame, ballPosition: Vec3): boolean {
    const challenger = this.teamPlayerIds
      .flatMap((playerId) => {
        const car = frame.cars[playerId];
        if (!car) return [];
        const toBall = horizontalDirection(car.transform.position, ballPosition);
        const forward = horizontalDirection(
          { x: 0, y: 0, z: 0 },
          rotateVector(car.transform.rotation, { x: 0, y: 0, z: -1 }),
        );
        const alignment = horizontalDot(forward, toBall);
        return [{
          playerId,
          score: horizontalDistance(car.transform.position, ballPosition) + (1 - alignment) * 4,
        }];
      })
      .sort((left, right) => left.score - right.score || left.playerId.localeCompare(right.playerId))[0];
    return challenger?.playerId === this.playerId;
  }

  private updateKickoffState(frame: AuthoritativeFrame, tick: number, activePlay: boolean): void {
    if (frame.snapshot.match.phase === 'countdown') {
      this.sawKickoffCountdown = true;
      this.kickoffStartedTick = -1;
      this.challengeCommittedUntilTick = -1;
      return;
    }
    if (activePlay && this.sawKickoffCountdown) {
      this.kickoffCount += 1;
      this.kickoffStartedTick = tick;
      this.sawKickoffCountdown = false;
    }
  }

  private kickoffTarget(ballPosition: Vec3): Vec3 {
    const policyOffset = BOT_POLICY_ORDER.indexOf(this.policy);
    const lane = (hashString(this.playerId) + this.kickoffCount + policyOffset) % 3 - 1;
    return {
      x: ballPosition.x + lane * 0.9,
      y: 0,
      z: ballPosition.z,
    };
  }

  private supportTarget(ballPosition: Vec3, opponentGoal: Vec3): Vec3 {
    const attackDirection = Math.sign(opponentGoal.z);
    const side = hashString(this.playerId) % 2 === 0 ? -1 : 1;
    return {
      x: clamp(
        ballPosition.x + side * SUPPORT_LATERAL_OFFSET,
        -ARENA_TUNING.halfWidth + 4,
        ARENA_TUNING.halfWidth - 4,
      ),
      y: 0,
      z: clamp(
        ballPosition.z - attackDirection * SUPPORT_DISTANCE,
        -ARENA_TUNING.halfLength + 8,
        ARENA_TUNING.halfLength - 8,
      ),
    };
  }

  private shotTarget(
    frame: AuthoritativeFrame,
    carPosition: Vec3,
    opponentGoal: Vec3,
    ballDistance: number,
    stagingDistance: number,
  ): Vec3 {
    const predictedBall = this.predictedBall(frame, ballDistance);
    const shotDirection = horizontalDirection(predictedBall, opponentGoal);
    const approachAlignment = this.shotApproachAlignment(frame, carPosition, opponentGoal, ballDistance);

    if (approachAlignment > 0.78) return predictedBall;
    if (approachAlignment < -0.1) {
      return this.orbitTarget(carPosition, predictedBall, shotDirection);
    }

    return {
      x: predictedBall.x - shotDirection.x * stagingDistance,
      y: 0,
      z: predictedBall.z - shotDirection.z * stagingDistance,
    };
  }

  private shotApproachAlignment(
    frame: AuthoritativeFrame,
    carPosition: Vec3,
    opponentGoal: Vec3,
    ballDistance: number,
  ): number {
    const predictedBall = this.predictedBall(frame, ballDistance);
    return horizontalDot(
      horizontalDirection(carPosition, predictedBall),
      horizontalDirection(predictedBall, opponentGoal),
    );
  }

  private selectNextPolicy(tick: number): BotPolicy {
    const evaluation = Math.floor(tick / POLICY_EVALUATION_TICKS);
    if ((evaluation + hashString(this.playerId)) % 5 === 0) {
      const currentIndex = BOT_POLICY_ORDER.indexOf(this.policy);
      return BOT_POLICY_ORDER[(currentIndex + 1) % BOT_POLICY_ORDER.length] ?? 'balanced';
    }
    return BOT_POLICY_ORDER.reduce((best, candidate) => (
      (this.policyValues.get(candidate) ?? 0) > (this.policyValues.get(best) ?? 0) ? candidate : best
    ), this.policy);
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

const direction3D = (from: Vec3, to: Vec3): Vec3 => {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const z = to.z - from.z;
  const inverseLength = 1 / Math.max(0.0001, Math.hypot(x, y, z));
  return { x: x * inverseLength, y: y * inverseLength, z: z * inverseLength };
};

const distance3D = (left: Vec3, right: Vec3): number => (
  Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z)
);

const dot3D = (left: Vec3, right: Vec3): number => left.x * right.x + left.y * right.y + left.z * right.z;

const horizontalDot = (left: Vec3, right: Vec3): number => left.x * right.x + left.z * right.z;

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);

const hashString = (value: string): number => {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
};
