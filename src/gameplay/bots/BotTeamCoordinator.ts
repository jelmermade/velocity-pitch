import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { BALL_TUNING } from '../../core/config/BallTuning';
import { rotateVector } from '../../core/math/Quaternion';
import type { Vec3 } from '../../core/math/Vector3';
import type { AuthoritativeFrame, TeamId } from '../../networking/LobbyProtocol';
import { GOALS } from '../arena/ArenaDefinition';
import { predictBallPosition } from './BallTrajectory';

export { predictBallPosition } from './BallTrajectory';

export type BotTacticalRole = 'first' | 'second' | 'third';
export type BotTacticalIntent = 'challenge' | 'fake-challenge' | 'shadow' | 'support' | 'cover' | 'rotate';

export interface BotTacticalPlan {
  readonly playerId: string;
  readonly role: BotTacticalRole;
  readonly intent: BotTacticalIntent;
  readonly target: Vec3;
  readonly intercept: Vec3;
  readonly interceptSeconds: number;
  readonly timingErrorSeconds: number;
  readonly arrivalSeconds: number;
  readonly confidence: number;
  readonly approachAlignment: number;
  readonly forwardAlignment: number;
  readonly momentum: number;
  readonly teammateConfidence: number;
  readonly opponentArrivalSeconds: number;
  readonly possession: 'team' | 'opponent' | 'contested';
  readonly challengeAllowed: boolean;
}

interface Candidate {
  readonly playerId: string;
  readonly intercept: Vec3;
  readonly interceptSeconds: number;
  readonly arrivalSeconds: number;
  readonly confidence: number;
  readonly approachAlignment: number;
  readonly forwardAlignment: number;
  readonly momentum: number;
  readonly rotating: boolean;
}

interface RotationWindow {
  readonly started: number;
  readonly until: number;
}

const BALL_PREDICTION_MAXIMUM_SECONDS = 2.5;
const INTERCEPT_ACCELERATION = 12;
const BOOST_INTERCEPT_ACCELERATION = 16;
const INTERCEPT_MAXIMUM_SPEED = 24;
const BOOST_INTERCEPT_MAXIMUM_SPEED = 30;
const FIRST_MAN_TIE_SECONDS = 0.08;
const POSSESSION_MARGIN_SECONDS = 0.18;
const TOUCH_DISTANCE = BALL_TUNING.radius + 3;
const TOUCH_VELOCITY_CHANGE = 1.2;
const MISSED_CHALLENGE_EXIT_DISTANCE = TOUCH_DISTANCE + 4;
const TOUCH_ROTATION_TICKS = 150;
const MISS_ROTATION_TICKS = 105;
const ROTATION_MINIMUM_TICKS = 45;
const CHALLENGE_COMMITMENT_TICKS = 300;
const SUPPORT_DEPTH = 14;
const SUPPORT_WIDTH = 11;
const SHADOW_DISTANCE = 10;
const DEFENSIVE_COVER_DISTANCE = 17;
const LOW_BOOST = 35;

export class BotTeamCoordinator {
  private cachedTick = Number.NEGATIVE_INFINITY;
  private cachedPlans: ReadonlyMap<string, BotTacticalPlan> = new Map();
  private previousFrame: AuthoritativeFrame | null = null;
  private previousPlans: ReadonlyMap<string, BotTacticalPlan> = new Map();
  private readonly closestChallengeDistance = new Map<string, number>();
  private readonly rotating = new Map<string, RotationWindow>();
  private committedChallengerId: string | null = null;
  private challengeCommitUntilTick = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly team: TeamId,
    private readonly teamPlayerIds: readonly string[],
    private readonly opponentPlayerIds: readonly string[] = [],
  ) {}

  planFor(playerId: string, frame: AuthoritativeFrame, tick: number): BotTacticalPlan | undefined {
    if (this.cachedTick !== tick) this.recalculate(frame, tick);
    return this.cachedPlans.get(playerId);
  }

  plans(frame: AuthoritativeFrame, tick: number): ReadonlyMap<string, BotTacticalPlan> {
    if (this.cachedTick !== tick) this.recalculate(frame, tick);
    return this.cachedPlans;
  }

  private recalculate(frame: AuthoritativeFrame, tick: number): void {
    this.updateRotationState(frame, tick);
    const ownGoal = GOALS.find(({ defendingTeam }) => defendingTeam === this.team);
    const opponentGoal = GOALS.find(({ teamScored }) => teamScored === this.team);
    if (!ownGoal || !opponentGoal) {
      this.cachedPlans = new Map();
      this.cachedTick = tick;
      return;
    }

    const candidates = this.teamPlayerIds
      .flatMap((playerId) => frame.cars[playerId]
        ? [this.candidate(frame, playerId, opponentGoal.center, this.rotating.has(playerId))]
        : [])
      .sort(compareCandidates);
    const previousRanks = new Map([...this.previousPlans.values()].map((plan) => [
      plan.playerId,
      roleRank(plan.role),
    ]));
    candidates.sort((left, right) => {
      const leftRank = previousRanks.get(left.playerId);
      const rightRank = previousRanks.get(right.playerId);
      const comparable = Math.abs(left.arrivalSeconds - right.arrivalSeconds) <= 0.18
        && Math.abs(left.confidence - right.confidence) <= 0.08;
      if (comparable && leftRank !== undefined && rightRank !== undefined && leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return compareCandidates(left, right);
    });
    const previousFirstId = [...this.previousPlans.values()].find(({ role }) => role === 'first')?.playerId;
    const previousFirstIndex = candidates.findIndex(({ playerId }) => playerId === previousFirstId);
    const newLeader = candidates[0];
    const previousFirst = candidates[previousFirstIndex];
    if (
      previousFirstIndex > 0
      && newLeader
      && previousFirst
      && !previousFirst.rotating
      && previousFirst.arrivalSeconds <= newLeader.arrivalSeconds + 0.12
      && previousFirst.confidence + 0.08 >= newLeader.confidence
    ) {
      candidates.splice(previousFirstIndex, 1);
      candidates.unshift(previousFirst);
    }
    const opponents = this.opponentPlayerIds
      .flatMap((playerId) => frame.cars[playerId]
        ? [this.candidate(frame, playerId, ownGoal.center, false)]
        : [])
      .sort(compareCandidates);
    const fastestOpponent = opponents[0];
    const fastestTeam = candidates[0];
    const possession = possessionFor(fastestTeam?.arrivalSeconds, fastestOpponent?.arrivalSeconds);
    const ball = frame.snapshot.ball.transform.position;
    const attackDirection = Math.sign(opponentGoal.center.z);
    const ballProgress = ball.z * attackDirection;
    const ballThreatening = ballProgress < -ARENA_TUNING.halfLength * 0.12
      || frame.snapshot.ball.linearVelocity.z * attackDirection < -4;
    const firstId = fastestTeam?.playerId;
    const hasCover = candidates.some((candidate) => candidate.playerId !== firstId
      && isGoalSide(frame.cars[candidate.playerId]?.transform.position, ball, attackDirection));
    const plans = new Map<string, BotTacticalPlan>();

    candidates.forEach((candidate, index) => {
      const role = tacticalRole(index, candidates.length);
      const teammateConfidence = candidates
        .filter(({ playerId }) => playerId !== candidate.playerId)
        .reduce((maximum, teammate) => Math.max(maximum, teammate.confidence), 0);
      const car = frame.cars[candidate.playerId];
      if (!car) return;

      let intent: BotTacticalIntent;
      let challengeAllowed = false;
      if (candidate.rotating) {
        intent = 'rotate';
      } else if (role === 'first') {
        const momentumReady = candidate.momentum > -1 || candidate.arrivalSeconds < 0.65;
        const approachReady = candidate.approachAlignment > -0.22 && candidate.forwardAlignment > -0.1;
        const confidenceReady = candidate.confidence >= 0.44;
        const safeAsLast = hasCover
          || candidates.length === 1
          || (ballThreatening
            && isGoalSide(car.transform.position, ball, attackDirection)
            && candidate.arrivalSeconds + 0.12 < (fastestOpponent?.arrivalSeconds ?? Number.POSITIVE_INFINITY));
        const teammateClearlyBetter = candidates.some((teammate) => (
          teammate.playerId !== candidate.playerId
          && teammate.arrivalSeconds + FIRST_MAN_TIE_SECONDS < candidate.arrivalSeconds
          && teammate.confidence > candidate.confidence + 0.05
        ));
        const committed = this.committedChallengerId === candidate.playerId
          && tick <= this.challengeCommitUntilTick
          && candidate.confidence >= 0.35
          && (this.teamPlayerIds.length === 1 || (
            candidate.approachAlignment > -0.35
            && candidate.forwardAlignment > -0.2
          ));
        challengeAllowed = (committed || (confidenceReady && momentumReady && approachReady))
          && safeAsLast
          && !teammateClearlyBetter;
        if (challengeAllowed && !committed) {
          this.committedChallengerId = candidate.playerId;
          this.challengeCommitUntilTick = tick + CHALLENGE_COMMITMENT_TICKS;
        }
        intent = challengeAllowed
          ? 'challenge'
          : ballThreatening || possession === 'opponent' ? 'shadow' : 'fake-challenge';
      } else if (role === 'second') {
        intent = ballThreatening && possession !== 'team' ? 'shadow' : 'support';
      } else {
        intent = 'cover';
      }

      let target = this.targetFor(
        intent,
        candidate,
        candidates,
        frame,
        ownGoal.center,
        attackDirection,
      );
      if ((intent === 'rotate' || intent === 'cover') && car.boost < LOW_BOOST) {
        target = boostDetour(frame, car.transform.position, target, ball, attackDirection) ?? target;
      }
      plans.set(candidate.playerId, {
        playerId: candidate.playerId,
        role,
        intent,
        target,
        intercept: candidate.intercept,
        interceptSeconds: candidate.interceptSeconds,
        timingErrorSeconds: candidate.arrivalSeconds - candidate.interceptSeconds,
        arrivalSeconds: candidate.arrivalSeconds,
        confidence: candidate.confidence,
        approachAlignment: candidate.approachAlignment,
        forwardAlignment: candidate.forwardAlignment,
        momentum: candidate.momentum,
        teammateConfidence,
        opponentArrivalSeconds: fastestOpponent?.arrivalSeconds ?? Number.POSITIVE_INFINITY,
        possession,
        challengeAllowed,
      });
    });

    this.previousFrame = frame;
    this.previousPlans = plans;
    this.cachedPlans = plans;
    this.cachedTick = tick;
  }

  private updateRotationState(frame: AuthoritativeFrame, tick: number): void {
    const previous = this.previousFrame;
    if (!previous) return;
    const velocityChange = distance3D(
      previous.snapshot.ball.linearVelocity,
      frame.snapshot.ball.linearVelocity,
    );
    const opponentGoal = GOALS.find(({ teamScored }) => teamScored === this.team);
    const attackDirection = Math.sign(opponentGoal?.center.z ?? 1);

    this.previousPlans.forEach((plan, playerId) => {
      if (plan.intent !== 'challenge') return;
      const car = frame.cars[playerId];
      if (!car) return;
      const ball = frame.snapshot.ball.transform.position;
      const currentDistance = horizontalDistance(car.transform.position, ball);
      const closest = Math.min(this.closestChallengeDistance.get(playerId) ?? currentDistance, currentDistance);
      this.closestChallengeDistance.set(playerId, closest);
      const touched = closest <= TOUCH_DISTANCE && velocityChange >= TOUCH_VELOCITY_CHANGE;
      const passedBall = (car.transform.position.z - ball.z) * attackDirection > 3;
      const missed = closest <= TOUCH_DISTANCE + 1.5
        && currentDistance >= MISSED_CHALLENGE_EXIT_DISTANCE
        && passedBall;
      if (!touched && !missed) return;
      this.rotating.set(playerId, {
        started: tick,
        until: tick + (touched ? TOUCH_ROTATION_TICKS : MISS_ROTATION_TICKS),
      });
      if (this.committedChallengerId === playerId) {
        this.committedChallengerId = null;
        this.challengeCommitUntilTick = Number.NEGATIVE_INFINITY;
      }
      this.closestChallengeDistance.delete(playerId);
    });

    this.rotating.forEach((window, playerId) => {
      const car = frame.cars[playerId];
      if (!car || tick > window.until) {
        this.rotating.delete(playerId);
        return;
      }
      const ball = frame.snapshot.ball.transform.position;
      const recoveredBehindPlay = tick - window.started >= ROTATION_MINIMUM_TICKS
        && (car.transform.position.z - ball.z) * attackDirection < -SUPPORT_DEPTH
        && horizontalDistance(car.transform.position, ball) > SUPPORT_DEPTH;
      if (recoveredBehindPlay) this.rotating.delete(playerId);
    });
  }

  private candidate(
    frame: AuthoritativeFrame,
    playerId: string,
    targetGoal: Vec3,
    rotating: boolean,
  ): Candidate {
    const car = frame.cars[playerId];
    if (!car) throw new Error(`Car ${playerId} is unavailable`);
    const speed = Math.hypot(car.linearVelocity.x, car.linearVelocity.z);
    const ball = frame.snapshot.ball;
    let intercept = ball.transform.position;
    let interceptSeconds = 0;
    let arrivalSeconds = 0;
    let forwardAlignment = 0;
    let momentum = 0;

    // Converge the car arrival and ball path onto the same point. This uses the exact
    // trajectory model drawn in Bot Lab while avoiding a naive chase of the current ball.
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const direction = horizontalDirection(car.transform.position, intercept);
      const forward = horizontalDirection(
        { x: 0, y: 0, z: 0 },
        rotateVector(car.transform.rotation, { x: 0, y: 0, z: -1 }),
      );
      forwardAlignment = horizontalDot(forward, direction);
      momentum = car.linearVelocity.x * direction.x + car.linearVelocity.z * direction.z;
      arrivalSeconds = estimateArrivalSeconds(
        horizontalDistance(car.transform.position, intercept),
        speed,
        momentum,
        forwardAlignment,
        car.boost,
      );
      interceptSeconds = arrivalSeconds;
      intercept = predictBallPosition(
        ball.transform.position,
        ball.linearVelocity,
        interceptSeconds,
      );
    }

    const approachAlignment = horizontalDot(
      horizontalDirection(car.transform.position, intercept),
      horizontalDirection(intercept, targetGoal),
    );
    const arrivalScore = 1 / (1 + arrivalSeconds * 0.72);
    const orientationScore = clamp((forwardAlignment + 1) * 0.5, 0, 1);
    const approachScore = clamp((approachAlignment + 1) * 0.5, 0, 1);
    const momentumScore = clamp(momentum / 18, 0, 1);
    const heightReach = clamp(1 - Math.max(0, intercept.y - 2.5) / 13, 0.15, 1);
    const boostScore = clamp(car.boost / 70, 0, 1);
    const confidence = clamp(
      arrivalScore * 0.4
      + orientationScore * 0.2
      + approachScore * 0.2
      + momentumScore * 0.1
      + heightReach * 0.06
      + boostScore * 0.04,
      0,
      1,
    );
    return {
      playerId,
      intercept,
      interceptSeconds,
      arrivalSeconds: arrivalSeconds + (rotating ? 20 : 0),
      confidence: rotating ? confidence * 0.2 : confidence,
      approachAlignment,
      forwardAlignment,
      momentum,
      rotating,
    };
  }

  private targetFor(
    intent: BotTacticalIntent,
    candidate: Candidate,
    teammates: readonly Candidate[],
    frame: AuthoritativeFrame,
    ownGoal: Vec3,
    attackDirection: number,
  ): Vec3 {
    const ball = candidate.intercept;
    if (intent === 'challenge') return ball;
    const towardOwnGoal = horizontalDirection(ball, ownGoal);
    if (intent === 'fake-challenge') {
      const car = frame.cars[candidate.playerId];
      const needsSafeLane = car
        && (car.transform.position.z - ball.z) * attackDirection > -2;
      const lateralOffset = needsSafeLane ? hashSide(candidate.playerId) * SUPPORT_WIDTH * 0.75 : 0;
      return clampToField({
        x: ball.x + towardOwnGoal.x * SHADOW_DISTANCE * 0.72 + lateralOffset,
        y: 0,
        z: ball.z + towardOwnGoal.z * SHADOW_DISTANCE * 0.72,
      });
    }
    if (intent === 'shadow') {
      const laneBlend = clamp(Math.abs(ball.z - ownGoal.z) / ARENA_TUNING.halfLength, 0.25, 0.8);
      return clampToField({
        x: ball.x * laneBlend,
        y: 0,
        z: ball.z + towardOwnGoal.z * SHADOW_DISTANCE,
      });
    }
    if (intent === 'support') {
      const first = teammates[0];
      const firstCar = first ? frame.cars[first.playerId] : undefined;
      const preferredSide = firstCar?.transform.position.x && Math.abs(firstCar.transform.position.x - ball.x) > 2
        ? -Math.sign(firstCar.transform.position.x - ball.x)
        : hashSide(candidate.playerId);
      return clampToField({
        x: ball.x + preferredSide * SUPPORT_WIDTH,
        y: 0,
        z: ball.z - attackDirection * SUPPORT_DEPTH,
      });
    }

    const ballSide = Math.abs(ball.x) > 2 ? Math.sign(ball.x) : hashSide(candidate.playerId);
    const backPostX = -ballSide * ARENA_TUNING.goalHalfWidth * 0.78;
    if (intent === 'rotate') {
      return clampToField({
        x: backPostX,
        y: 0,
        z: ownGoal.z - Math.sign(ownGoal.z) * 5,
      });
    }
    const laneDirection = horizontalDirection(ownGoal, ball);
    const coverDistance = frame.snapshot.ball.linearVelocity.z * attackDirection < -5
      ? DEFENSIVE_COVER_DISTANCE * 0.72
      : DEFENSIVE_COVER_DISTANCE;
    return clampToField({
      x: clamp(
        ownGoal.x + laneDirection.x * coverDistance + backPostX * 0.45,
        -ARENA_TUNING.goalHalfWidth,
        ARENA_TUNING.goalHalfWidth,
      ),
      y: 0,
      z: ownGoal.z + laneDirection.z * coverDistance,
    });
  }
}

const compareCandidates = (left: Candidate, right: Candidate): number => {
  const arrivalDifference = left.arrivalSeconds - right.arrivalSeconds;
  if (Math.abs(arrivalDifference) > FIRST_MAN_TIE_SECONDS) return arrivalDifference;
  const confidenceDifference = right.confidence - left.confidence;
  return Math.abs(confidenceDifference) > 0.001
    ? confidenceDifference
    : left.playerId.localeCompare(right.playerId);
};

const tacticalRole = (index: number, playerCount: number): BotTacticalRole => {
  if (index === 0) return 'first';
  if (index === 1 && playerCount > 2) return 'second';
  return 'third';
};

const roleRank = (role: BotTacticalRole): number => role === 'first' ? 0 : role === 'second' ? 1 : 2;

const possessionFor = (
  teamArrival = Number.POSITIVE_INFINITY,
  opponentArrival = Number.POSITIVE_INFINITY,
): BotTacticalPlan['possession'] => {
  if (teamArrival + POSSESSION_MARGIN_SECONDS < opponentArrival) return 'team';
  if (opponentArrival + POSSESSION_MARGIN_SECONDS < teamArrival) return 'opponent';
  return 'contested';
};

const estimateArrivalSeconds = (
  distance: number,
  speed: number,
  momentum: number,
  forwardAlignment: number,
  boost: number,
): number => {
  const hasBoost = boost > 8;
  const acceleration = hasBoost ? BOOST_INTERCEPT_ACCELERATION : INTERCEPT_ACCELERATION;
  const maximumSpeed = hasBoost ? BOOST_INTERCEPT_MAXIMUM_SPEED : INTERCEPT_MAXIMUM_SPEED;
  const usableSpeed = clamp(momentum * 0.72 + speed * 0.18, 0, maximumSpeed);
  const accelerationSeconds = Math.max(0, (maximumSpeed - usableSpeed) / acceleration);
  const accelerationDistance = usableSpeed * accelerationSeconds
    + acceleration * accelerationSeconds ** 2 * 0.5;
  const travelSeconds = distance <= accelerationDistance
    ? (-usableSpeed + Math.sqrt(usableSpeed ** 2 + 2 * acceleration * distance)) / acceleration
    : accelerationSeconds + (distance - accelerationDistance) / maximumSpeed;
  const turnPenalty = Math.acos(clamp(forwardAlignment, -1, 1)) / Math.PI
    * clamp(0.75 + speed / 32, 0.75, 1.65);
  const boostPenalty = boost < 15 && distance > 18 ? 0.16 : 0;
  return clamp(travelSeconds + turnPenalty + boostPenalty, 0.05, BALL_PREDICTION_MAXIMUM_SECONDS);
};

const boostDetour = (
  frame: AuthoritativeFrame,
  car: Vec3,
  target: Vec3,
  ball: Vec3,
  attackDirection: number,
): Vec3 | null => {
  const directDistance = horizontalDistance(car, target);
  const pickup = frame.snapshot.boostPickups
    .filter(({ active }) => active)
    .filter(({ position }) => position.z * attackDirection < ball.z * attackDirection - 2)
    .map(({ position, kind }) => ({
      position,
      detour: horizontalDistance(car, position) + horizontalDistance(position, target) - directDistance,
      allowance: kind === 'large' ? 13 : 8,
    }))
    .filter(({ detour, allowance }) => detour <= allowance)
    .sort((left, right) => left.detour - right.detour)[0];
  return pickup?.position ?? null;
};

const isGoalSide = (car: Vec3 | undefined, ball: Vec3, attackDirection: number): boolean => (
  Boolean(car && (car.z - ball.z) * attackDirection < -4)
);

const clampToField = (target: Vec3): Vec3 => ({
  x: clamp(target.x, -ARENA_TUNING.halfWidth + 4, ARENA_TUNING.halfWidth - 4),
  y: target.y,
  z: clamp(target.z, -ARENA_TUNING.halfLength + 5, ARENA_TUNING.halfLength - 5),
});

const horizontalDirection = (from: Vec3, to: Vec3): Vec3 => {
  const x = to.x - from.x;
  const z = to.z - from.z;
  const inverseLength = 1 / Math.max(0.0001, Math.hypot(x, z));
  return { x: x * inverseLength, y: 0, z: z * inverseLength };
};

const horizontalDistance = (left: Vec3, right: Vec3): number => (
  Math.hypot(right.x - left.x, right.z - left.z)
);

const distance3D = (left: Vec3, right: Vec3): number => (
  Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z)
);

const horizontalDot = (left: Vec3, right: Vec3): number => left.x * right.x + left.z * right.z;

const hashSide = (value: string): -1 | 1 => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  return hash % 2 === 0 ? -1 : 1;
};

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);
