import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { BALL_TUNING } from '../../core/config/BallTuning';
import { DEFAULT_CAR_TUNING } from '../../core/config/CarTuning';
import { PHYSICS_TUNING } from '../../core/config/PhysicsTuning';
import { rotateVector } from '../../core/math/Quaternion';
import type { Vec3 } from '../../core/math/Vector3';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../input/PlayerCommand';
import type { AuthoritativeFrame, TeamId } from '../../networking/LobbyProtocol';
import { GOALS } from '../arena/ArenaDefinition';
import {
  BOT_POLICY_ORDER,
  BOT_TECHNIQUE_KINDS,
  BOT_TECHNIQUE_ORDER,
  selectBotPolicy,
  selectBotTechnique,
  type BotKnowledge,
  type BotPolicy,
  type BotPolicyObservation,
  type BotRole,
  type BotTechnique,
  type BotTechniqueKind,
} from './BotKnowledge';
import {
  BotTeamCoordinator,
  predictBallPosition,
  type BotTacticalPlan,
} from './BotTeamCoordinator';

export type { BotPolicy, BotRole } from './BotKnowledge';

export interface BotLearningState {
  readonly points: number;
  readonly policy: BotPolicy;
  readonly policyValue: number;
  readonly policyValues: Readonly<Record<BotPolicy, number>>;
  readonly policySamples: Readonly<Record<BotPolicy, number>>;
  readonly techniques: Readonly<Record<BotTechniqueKind, BotTechnique>>;
  readonly techniqueValues: Readonly<
    Record<BotTechniqueKind, Readonly<Record<BotTechnique, number>>>
  >;
  readonly techniqueSamples: Readonly<
    Record<BotTechniqueKind, Readonly<Record<BotTechnique, number>>>
  >;
}

interface BotPolicyProfile {
  readonly defenderChallengeDepth: number;
  readonly stagingDistance: number;
  readonly jumpDistance: number;
  readonly aerialMaximumDistance: number;
  readonly aerialMinimumBoost: number;
}

interface GroundTechniqueProfile {
  readonly interceptScale: number;
  readonly goalWidthFraction: number;
  readonly contactPenetration: number;
  readonly velocityCompensation: number;
  readonly contactSpeedMultiplier: number;
}

interface AerialTechniqueProfile {
  readonly interceptDelaySeconds: number;
  readonly contactPenetration: number;
  readonly contactVerticalOffset: number;
  readonly pitchGain: number;
  readonly yawGain: number;
  readonly boostAlignment: number;
  readonly velocityCompensation: number;
}

const BOT_POLICIES: Readonly<Record<BotPolicy, BotPolicyProfile>> = Object.freeze({
  balanced: Object.freeze({
    defenderChallengeDepth: 8,
    stagingDistance: 8,
    jumpDistance: 4.6,
    aerialMaximumDistance: 24,
    aerialMinimumBoost: 18,
  }),
  press: Object.freeze({
    defenderChallengeDepth: 4,
    stagingDistance: 7,
    jumpDistance: 5.1,
    aerialMaximumDistance: 24,
    aerialMinimumBoost: 10,
  }),
  rotate: Object.freeze({
    defenderChallengeDepth: 14,
    stagingDistance: 9,
    jumpDistance: 4.2,
    aerialMaximumDistance: 21,
    aerialMinimumBoost: 25,
  }),
});

const GROUND_TECHNIQUES: Readonly<Record<BotTechnique, GroundTechniqueProfile>> = Object.freeze({
  balanced: Object.freeze({
    interceptScale: 1,
    goalWidthFraction: 0,
    contactPenetration: 0.18,
    velocityCompensation: 0.7,
    contactSpeedMultiplier: 0.95,
  }),
  safe: Object.freeze({
    interceptScale: 0.92,
    goalWidthFraction: 0,
    contactPenetration: 0.25,
    velocityCompensation: 0.9,
    contactSpeedMultiplier: 0.88,
  }),
  aggressive: Object.freeze({
    interceptScale: 1.08,
    goalWidthFraction: 0.25,
    contactPenetration: 0.4,
    velocityCompensation: 0.4,
    contactSpeedMultiplier: 1.05,
  }),
});

const AERIAL_TECHNIQUES: Readonly<Record<BotTechnique, AerialTechniqueProfile>> = Object.freeze({
  balanced: Object.freeze({
    interceptDelaySeconds: 0,
    contactPenetration: 0.18,
    contactVerticalOffset: 0.45,
    pitchGain: 0.85,
    yawGain: 2,
    boostAlignment: 0.75,
    velocityCompensation: 0.65,
  }),
  safe: Object.freeze({
    interceptDelaySeconds: 0.1,
    contactPenetration: 0.25,
    contactVerticalOffset: 0.4,
    pitchGain: 0.8,
    yawGain: 1.8,
    boostAlignment: 0.8,
    velocityCompensation: 0.85,
  }),
  aggressive: Object.freeze({
    interceptDelaySeconds: 0,
    contactPenetration: 0.35,
    contactVerticalOffset: 0.3,
    pitchGain: 1,
    yawGain: 2.25,
    boostAlignment: 0.65,
    velocityCompensation: 0.35,
  }),
});

const POLICY_EVALUATION_TICKS = 300;

const STUCK_SPEED = 0.65;
const STUCK_TICKS = 75;
const SUPPORT_DISTANCE = 13;
const SUPPORT_LATERAL_OFFSET = 7;
const REQUIRED_CONTACT_CLEARANCE = 0.75;
const AERIAL_BALL_HEIGHT = BALL_TUNING.radius + 1.25;
const AERIAL_MAXIMUM_HEIGHT = Math.min(
  14,
  ARENA_TUNING.height - BALL_TUNING.radius - 2,
);
const AERIAL_MAXIMUM_TICKS = 150;
const AERIAL_SECOND_JUMP_DELAY_TICKS = 8;
const FAST_AERIAL_SECOND_JUMP_DELAY_TICKS = 16;
const AERIAL_RETRY_TICKS = 300;
const AERIAL_INTERCEPT_ACCELERATION = 18;
const AERIAL_INTERCEPT_MINIMUM_SECONDS = 0.3;
const AERIAL_INTERCEPT_MAXIMUM_SECONDS = 1.8;
const AERIAL_MINIMUM_BALL_VERTICAL_SPEED = -1.5;
const AERIAL_MINIMUM_APPROACH_ALIGNMENT = 0.45;
const AERIAL_BOOST_CUTOFF_DISTANCE = 4.25;
const AERIAL_CONTROLLED_MAXIMUM_DISTANCE = 18;
const AERIAL_ROUTINE_MAXIMUM_DISTANCE = 14;
const AERIAL_ROUTINE_MAXIMUM_HEIGHT = 5;
const AERIAL_ROUTINE_MAXIMUM_GROUND_SPEED = 30;
const AERIAL_ROUTINE_MAXIMUM_BALL_SPEED = 18;
const AERIAL_ROUTINE_MAXIMUM_ARRIVAL_SECONDS = 0.7;
const AERIAL_ROUTINE_MAXIMUM_VERTICAL_SPEED = 10;
const AERIAL_ROUTINE_MINIMUM_FORWARD_ALIGNMENT = 0.95;
const AERIAL_ROUTINE_MINIMUM_APPROACH_ALIGNMENT = 0.55;
const AERIAL_CONTROLLED_SETUP_MAXIMUM_GROUND_SPEED = 2;
const AERIAL_CONTEST_GRACE_SECONDS = 0.15;
const KICKOFF_CONTROL_TICKS = 210;
const SETUP_APPROACH_ALIGNMENT = 0.8;
const STRIKE_APPROACH_ALIGNMENT = 0.85;
const ORBIT_MAXIMUM_TICKS = 150;
const ORBIT_TIMEOUT_ALIGNMENT = 0.15;
const POSITION_ARRIVAL_DISTANCE = 3;
const POSITION_COAST_DISTANCE = 7;
const NON_CHALLENGE_BALL_AVOIDANCE_DISTANCE = 8;
const NON_CHALLENGE_BALL_AVOIDANCE_RANGE = 18;
const SCORING_JUMP_DISTANCE = ARENA_TUNING.goalDepth + 8 * ARENA_TUNING.scale;
const SCORING_JUMP_MINIMUM_CLEARANCE = 0.18;
const BOOST_MINIMUM_BALL_DISTANCE = 10;
const OFFENSIVE_CONTACT_SPEED = DEFAULT_CAR_TUNING.maximumGroundDriveSpeed * 0.88;
const DEFENSIVE_CONTACT_SPEED = DEFAULT_CAR_TUNING.maximumGroundDriveSpeed;
const MOVING_BALL_CONTACT_SPEED_GAIN = 0.45;
const MAXIMUM_CONTACT_SPEED = DEFAULT_CAR_TUNING.maximumGroundBoostSpeed - 1;
const CONTACT_SPEED_HYSTERESIS = 0.75;
const BOOSTED_APPROACH_BRAKE_BUFFER = 1.5;
const BOOSTED_APPROACH_BRAKE_DECELERATION = DEFAULT_CAR_TUNING.brakeForce
  / DEFAULT_CAR_TUNING.mass
  * 0.7;
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
const REVERSE_TURN_TICKS = 90;
const REVERSE_TURN_COOLDOWN_TICKS = 180;
const RECOVERY_RETRY_TICKS = 50;
const FLIPPED_RECOVERY_RETRY_TICKS = 100;
const FLIPPED_SECOND_JUMP_TICKS = 46;
const BALL_PREDICTION_MAXIMUM_SECONDS = 2.25;
const INTERCEPT_ACCELERATION = 12;
const INTERCEPT_MAXIMUM_SPEED = 30;
const DIRECT_STRIKE_MINIMUM_DISTANCE = 9;
const DIRECT_STRIKE_SPEED_LOOKAHEAD = 0.15;
const DIRECT_STRIKE_MINIMUM_ALIGNMENT = 0.25;
const BASE_CONTACT_OFFSET = BALL_TUNING.radius + DEFAULT_CAR_TUNING.halfExtents.z;

export class BotController {
  private jumpHeldUntilTick = -1;
  private jumpCooldownUntilTick = -1;
  private slowSinceTick: number | null = null;
  private recoveryRetryTick = -1;
  private recoverySecondJumpTick = -1;
  private aerialStartedTick = -1;
  private aerialSecondJumpTick = -1;
  private aerialRetryTick = -1;
  private aerialInterceptTick = -1;
  private aerialClosestDistance = Number.POSITIVE_INFINITY;
  private orbitSide: -1 | 0 | 1 = 0;
  private orbitStartedTick = -1;
  private strikeLaneCommitted = false;
  private powerslideNeededSinceTick: number | null = null;
  private powerslideHeldUntilTick = -1;
  private powerslideCooldownUntilTick = -1;
  private reverseTurnUntilTick = -1;
  private reverseTurnCooldownUntilTick = -1;
  private kickoffCount = 0;
  private kickoffStartedTick = -1;
  private sawKickoffCountdown = false;
  private policy: BotPolicy = 'balanced';
  private readonly policyValues = new Map<BotPolicy, number>(BOT_POLICY_ORDER.map((policy) => [policy, 0]));
  private readonly policyObservationTotals = new Map<BotPolicy, number>(BOT_POLICY_ORDER.map((policy) => [policy, 0]));
  private readonly policyObservationSamples = new Map<BotPolicy, number>(BOT_POLICY_ORDER.map((policy) => [policy, 0]));
  private readonly techniqueValues = createTechniqueMaps();
  private readonly techniqueObservationTotals = createTechniqueMaps();
  private readonly techniqueObservationSamples = createTechniqueMaps();
  private groundTechnique: BotTechnique = 'balanced';
  private aerialTechnique: BotTechnique = 'balanced';
  private rewardAccumulator = 0;
  private earnedPoints = 0;
  private nextPolicyEvaluationTick = POLICY_EVALUATION_TICKS;
  private latestTacticalPlan: BotTacticalPlan | null = null;
  private readonly teamPlayerCount: number;

  constructor(
    private readonly playerId: string,
    private readonly team: TeamId,
    private readonly role: BotRole,
    private readonly learning = false,
    knowledge?: BotKnowledge,
    teamPlayerIds: readonly string[] = [playerId],
    private readonly teamCoordinator = new BotTeamCoordinator(team, teamPlayerIds),
  ) {
    this.teamPlayerCount = teamPlayerIds.length;
    if (knowledge) {
      BOT_POLICY_ORDER.forEach((policy) => this.policyValues.set(policy, knowledge.roles[role][policy].value));
      BOT_TECHNIQUE_KINDS.forEach((kind) => BOT_TECHNIQUE_ORDER.forEach((technique) => {
        this.techniqueValues[kind].set(technique, knowledge.techniques[kind][technique].value);
      }));
    }
    this.groundTechnique = this.initialTechnique('ground', knowledge);
    this.aerialTechnique = this.initialTechnique('aerial', knowledge);
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

  isAerialActive(): boolean {
    return this.aerialStartedTick >= 0;
  }

  command(frame: AuthoritativeFrame, tick: number): PlayerCommand {
    const car = frame.cars[this.playerId];
    if (!car) {
      // Demolished cars are temporarily absent from the authoritative frame. Do not let
      // their last first-man assignment survive into the respawn window.
      this.latestTacticalPlan = null;
      this.finishAerial();
      return NEUTRAL_COMMAND;
    }

    const ball = frame.snapshot.ball;
    const carPosition = car.transform.position;
    const ballPosition = ball.transform.position;
    const ballHorizontalSpeed = Math.hypot(ball.linearVelocity.x, ball.linearVelocity.z);
    const carUp = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
    const driveSurfaceNormal = car.grounded && car.surfaceNormal
      ? normalized3D(car.surfaceNormal, { x: 0, y: 1, z: 0 })
      : { x: 0, y: 1, z: 0 };
    const drivingOnWall = car.grounded && Math.abs(driveSurfaceNormal.y) < 0.75;
    const ballDistance = drivingOnWall
      ? surfaceDistance(carPosition, ballPosition, driveSurfaceNormal)
      : horizontalDistance(carPosition, ballPosition);
    const activePlay = frame.snapshot.match.phase === 'playing' || frame.snapshot.match.phase === 'overtime';
    // Tactical ownership must remain current even while this car is recovering or airborne.
    // Otherwise a former first man can keep publishing a stale challenge while a teammate
    // correctly takes over the play.
    const tacticalPlan = this.teamCoordinator.planFor(this.playerId, frame, tick);
    this.latestTacticalPlan = tacticalPlan ?? null;
    this.updateKickoffState(frame, tick, activePlay);
    if (!activePlay) {
      this.finishAerial();
    }
    const alignedToDriveableSurface = car.grounded
      && car.surfaceNormal !== undefined
      && car.surfaceNormal !== null
      && dot3D(carUp, driveSurfaceNormal) > 0.55;
    const needsRecovery = activePlay
      && !alignedToDriveableSurface
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
    const forward = drivingOnWall
      ? tangentDirection(forward3D, driveSurfaceNormal, forward3D)
      : horizontalDirection({ x: 0, y: 0, z: 0 }, forward3D);
    const right = drivingOnWall
      ? tangentDirection(right3D, driveSurfaceNormal, right3D)
      : horizontalDirection({ x: 0, y: 0, z: 0 }, right3D);

    const attackDirection = Math.sign(opponentGoal.center.z);
    const ballProgress = ballPosition.z * attackDirection;
    const shotAlignment = tacticalPlan?.approachAlignment
      ?? this.shotApproachAlignment(frame, carPosition, opponentGoal.center);
    const hasChallengePriority = tacticalPlan?.role === 'first';
    const challenging = tacticalPlan?.intent === 'challenge' && tacticalPlan.challengeAllowed;
    const defensiveChallenge = challenging && (
      ballProgress < -ARENA_TUNING.halfLength * 0.12
      || ball.linearVelocity.z * attackDirection < -4
    );
    if (!hasChallengePriority) {
      this.orbitSide = 0;
      this.orbitStartedTick = -1;
      this.strikeLaneCommitted = false;
    } else if (ballHorizontalSpeed >= 5) {
      this.orbitStartedTick = -1;
      this.strikeLaneCommitted = false;
    }
    const holdingDefense = tacticalPlan
      ? tacticalPlan.intent === 'cover' || tacticalPlan.intent === 'shadow'
      : this.role === 'defender' && ballProgress > -profile.defenderChallengeDepth;
    const supportingAttack = tacticalPlan
      ? tacticalPlan.intent === 'support'
        || tacticalPlan.intent === 'rotate'
        || tacticalPlan.intent === 'fake-challenge'
      : this.role === 'striker' && !hasChallengePriority;
    const kickoffActive = this.kickoffStartedTick >= 0
      && tick - this.kickoffStartedTick <= KICKOFF_CONTROL_TICKS
      && Math.hypot(ballPosition.x, ballPosition.z) < 18;
    const aerialActive = this.aerialStartedTick >= 0
      && tick - this.aerialStartedTick <= AERIAL_MAXIMUM_TICKS
      && ballPosition.y > BALL_TUNING.radius + 0.35
      && (tick - this.aerialStartedTick <= AERIAL_SECOND_JUMP_DELAY_TICKS + 4 || !car.grounded);
    if (aerialActive) {
      return this.aerialCommand(
        frame,
        tick,
        profile.aerialMinimumBoost,
        opponentGoal.center,
        AERIAL_TECHNIQUES[this.aerialTechnique],
      );
    }
    if (this.aerialStartedTick >= 0) this.finishAerial();

    const aerialIntercept = this.aerialIntercept(
      frame,
      carPosition,
      AERIAL_TECHNIQUES[this.aerialTechnique],
    );
    const predictedAerial = aerialIntercept.position;
    const toPredictedAerial = horizontalDirection(carPosition, predictedAerial);
    const aerialFacing = horizontalDot(forward, toPredictedAerial);
    const aerialDistance = horizontalDistance(carPosition, predictedAerial);
    const carHorizontalSpeed = Math.hypot(car.linearVelocity.x, car.linearVelocity.z);
    const currentAerialDistance = horizontalDistance(carPosition, ballPosition);
    const controlledSetupAerial = carHorizontalSpeed <= AERIAL_CONTROLLED_SETUP_MAXIMUM_GROUND_SPEED
      && currentAerialDistance <= AERIAL_CONTROLLED_MAXIMUM_DISTANCE;
    const winningAerialRace = !tacticalPlan
      || tacticalPlan.arrivalSeconds <= tacticalPlan.opponentArrivalSeconds + AERIAL_CONTEST_GRACE_SECONDS;
    const routineAerial = currentAerialDistance <= AERIAL_ROUTINE_MAXIMUM_DISTANCE
      && ballPosition.y <= AERIAL_ROUTINE_MAXIMUM_HEIGHT
      && ball.linearVelocity.y <= AERIAL_ROUTINE_MAXIMUM_VERTICAL_SPEED
      && ballHorizontalSpeed <= AERIAL_ROUTINE_MAXIMUM_BALL_SPEED
      && carHorizontalSpeed <= AERIAL_ROUTINE_MAXIMUM_GROUND_SPEED
      && (tacticalPlan?.arrivalSeconds ?? 0) <= AERIAL_ROUTINE_MAXIMUM_ARRIVAL_SECONDS
      && (tacticalPlan?.forwardAlignment ?? 1) >= AERIAL_ROUTINE_MINIMUM_FORWARD_ALIGNMENT
      && shotAlignment >= AERIAL_ROUTINE_MINIMUM_APPROACH_ALIGNMENT
      && winningAerialRace;
    const aerialOpportunity = activePlay
      && !drivingOnWall
      && !holdingDefense
      && !supportingAttack
      && challenging
      && car.grounded
      && tick >= this.aerialRetryTick
      && ballPosition.y >= AERIAL_BALL_HEIGHT
      && ballPosition.y <= AERIAL_MAXIMUM_HEIGHT
      && predictedAerial.y <= AERIAL_MAXIMUM_HEIGHT
      && (controlledSetupAerial || routineAerial)
      && aerialDistance <= Math.min(profile.aerialMaximumDistance, AERIAL_CONTROLLED_MAXIMUM_DISTANCE)
      && car.boost >= profile.aerialMinimumBoost
      && aerialFacing > 0.9
      && shotAlignment > AERIAL_MINIMUM_APPROACH_ALIGNMENT
      && ball.linearVelocity.y > AERIAL_MINIMUM_BALL_VERTICAL_SPEED;
    if (aerialOpportunity) {
      this.aerialStartedTick = tick;
      const carryingGroundMomentum = carHorizontalSpeed > 18 && aerialDistance > 12;
      this.aerialSecondJumpTick = tick + (
        carryingGroundMomentum ? FAST_AERIAL_SECOND_JUMP_DELAY_TICKS : AERIAL_SECOND_JUMP_DELAY_TICKS
      );
      this.aerialInterceptTick = tick + Math.round(aerialIntercept.seconds * 60);
      this.aerialClosestDistance = distance3D(carPosition, ballPosition);
      this.aerialRetryTick = tick + AERIAL_RETRY_TICKS;
      this.jumpCooldownUntilTick = tick + AERIAL_RETRY_TICKS;
      return { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true };
    }

    // Ground throttle is pitch input in the air, so never reuse navigation commands while landing.
    if (!car.grounded) return this.airborneRecoveryCommand(car.transform.rotation);

    let target = kickoffActive && hasChallengePriority
      ? this.kickoffTarget(ballPosition)
      : tacticalPlan && !challenging
        ? tacticalPlan.target
        : holdingDefense
          ? this.defensiveAnchor(ballPosition, ownGoal.center)
          : supportingAttack
            ? this.supportTarget(ballPosition, opponentGoal.center)
            : this.shotTarget(
            frame,
            carPosition,
            opponentGoal.center,
            ballDistance,
            ballHorizontalSpeed >= 5 ? profile.stagingDistance * 0.5 : profile.stagingDistance,
            tacticalPlan?.intercept,
            tick,
            defensiveChallenge,
          );
    if (tacticalPlan && !challenging && !kickoffActive) {
      target = this.nonChallengeAvoidanceTarget(carPosition, ballPosition, target);
    }
    // Publish the exact navigation target used by the controller. The Bot Lab arrow now
    // exposes the strike-side offset and trajectory intercept rather than the coordinator's
    // earlier, less specific role target.
    if (tacticalPlan) this.latestTacticalPlan = { ...tacticalPlan, target };
    const toTarget = drivingOnWall
      ? surfaceDirection(carPosition, target, driveSurfaceNormal, forward)
      : horizontalDirection(carPosition, target);
    const toBall = drivingOnWall
      ? surfaceDirection(carPosition, ballPosition, driveSurfaceNormal, forward)
      : horizontalDirection(carPosition, ballPosition);
    const navigationVelocity = drivingOnWall
      ? tangentVector(car.linearVelocity, driveSurfaceNormal)
      : { x: car.linearVelocity.x, y: 0, z: car.linearVelocity.z };
    const forwardAlignment = dot3D(forward, toTarget);
    const sideAlignment = dot3D(right, toTarget);
    const ballFacing = dot3D(forward, toBall);
    const speed = length3D(navigationVelocity);
    const longitudinalSpeed = dot3D(navigationVelocity, forward);
    const lateralSpeed = dot3D(navigationVelocity, right);
    const targetClosingSpeed = dot3D(navigationVelocity, toTarget);
    const targetDistance = drivingOnWall
      ? surfaceDistance(carPosition, target, driveSurfaceNormal)
      : horizontalDistance(carPosition, target);
    const positioning = Boolean(tacticalPlan && !challenging) || holdingDefense || supportingAttack;
    const positionArrived = positioning && targetDistance <= POSITION_ARRIVAL_DISTANCE;
    const coastingIntoPosition = positioning
      && targetDistance <= POSITION_COAST_DISTANCE
      && speed > Math.max(4, targetDistance);
    const turningAround = forwardAlignment < -0.25;
    const turnaroundSteer = Math.abs(sideAlignment) > 0.08
      ? Math.sign(sideAlignment)
      : (hashString(this.playerId) + this.kickoffCount) % 2 === 0 ? -1 : 1;
    const closeShotCorrection = !holdingDefense
      && !supportingAttack
      && ballDistance < 8
      && Math.abs(sideAlignment) > 0.24;
    const needsReverseTurn = activePlay
      && !positioning
      && !kickoffActive
      && targetDistance > 6
      && speed < 1.5
      && forwardAlignment < 0.2
      && Math.abs(sideAlignment) > 0.2;
    if (needsReverseTurn && tick >= this.reverseTurnCooldownUntilTick) {
      this.reverseTurnUntilTick = tick + REVERSE_TURN_TICKS;
      this.reverseTurnCooldownUntilTick = tick + REVERSE_TURN_COOLDOWN_TICKS;
    }
    const reverseTurning = tick <= this.reverseTurnUntilTick;
    const deliberateShotSetup = ballHorizontalSpeed < 5 && ballDistance < 20;
    const brakingForAlignedTurn = deliberateShotSetup
      && !positioning
      && shotAlignment > STRIKE_APPROACH_ALIGNMENT
      && turningAround
      && longitudinalSpeed > 3;
    const settingUpShot = deliberateShotSetup
      && !positioning
      && !kickoffActive
      && shotAlignment < STRIKE_APPROACH_ALIGNMENT;
    const strikingBall = !positioning
      && shotAlignment >= (deliberateShotSetup ? STRIKE_APPROACH_ALIGNMENT : 0.72);
    const setupSpeedLimit = clamp(targetDistance * 1.2, 6, 14);
    const brakingForShotSetup = settingUpShot
      && targetDistance < 8
      && speed > setupSpeedLimit;
    const turnSpeedLimit = clamp(6 + Math.max(0, forwardAlignment) * 10, 6, 16);
    const brakingForHighSpeedSetupTurn = deliberateShotSetup
      && speed > turnSpeedLimit
      && Math.abs(sideAlignment) > 0.25
      && forwardAlignment < 0.85;
    const ballEscapeSpeed = Math.max(
      0,
      ball.linearVelocity.x * toTarget.x + ball.linearVelocity.z * toTarget.z,
    );
    const groundTechnique = GROUND_TECHNIQUES[this.groundTechnique];
    const desiredStrikeSpeed = Math.max(
      defensiveChallenge ? DEFENSIVE_CONTACT_SPEED : OFFENSIVE_CONTACT_SPEED,
      DEFAULT_CAR_TUNING.maximumGroundDriveSpeed * groundTechnique.contactSpeedMultiplier,
    );
    const boostedApproachContactSpeed = clamp(
      desiredStrikeSpeed + ballEscapeSpeed * MOVING_BALL_CONTACT_SPEED_GAIN,
      OFFENSIVE_CONTACT_SPEED,
      MAXIMUM_CONTACT_SPEED,
    );
    const boostedApproachBrakingDistance = BOOSTED_APPROACH_BRAKE_BUFFER + Math.max(
      0,
      (targetClosingSpeed ** 2 - boostedApproachContactSpeed ** 2)
        / (2 * BOOSTED_APPROACH_BRAKE_DECELERATION),
    );
    const committedPowerStrike = challenging
      && strikingBall
      && targetDistance < 8
      && ballFacing > 0.95
      && Math.abs(sideAlignment) < 0.16
      && Math.abs(lateralSpeed) < BOOST_MAXIMUM_LATERAL_SPEED
      && targetClosingSpeed <= MAXIMUM_CONTACT_SPEED + CONTACT_SPEED_HYSTERESIS;
    const brakingAfterBoostedApproach = challenging
      && !committedPowerStrike
      && targetDistance <= boostedApproachBrakingDistance
      && targetClosingSpeed > boostedApproachContactSpeed + CONTACT_SPEED_HYSTERESIS;
    const precisionBraking = brakingForAlignedTurn
      || brakingForShotSetup
      || brakingForHighSpeedSetupTurn
      || brakingAfterBoostedApproach;
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
    const scoringJump = horizontalDistance(ballPosition, opponentGoal.center) < SCORING_JUMP_DISTANCE
      && predictedBallBottom > carPosition.y + SCORING_JUMP_MINIMUM_CLEARANCE;
    const ballJump = !holdingDefense
      && !supportingAttack
      && ballDistance < profile.jumpDistance
      && ballFacing > 0.8
      && (ballRequiresJump || scoringJump)
      && shotAlignment > 0.78;
    const shouldJump = activePlay
      && tick >= this.jumpCooldownUntilTick
      && (stuckJump || ballJump);
    const steer = positionArrived
      ? 0
      : turningAround
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
      && challenging
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
    const rotationPowerslide = tacticalPlan?.intent === 'rotate'
      && speed > POWERSLIDE_MINIMUM_SPEED
      && Math.abs(steer) > 0.78
      && forwardAlignment < 0.65;
    const setupPowerslide = deliberateShotSetup
      && speed > 5
      && Math.abs(steer) > 0.8
      && forwardAlignment < 0.65
      && requiredTurnRadius < naturalTurnRadius;
    const powerslide = (powerslideOpportunity && tick <= this.powerslideHeldUntilTick)
      || rotationPowerslide
      || setupPowerslide;
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
      throttle: reverseTurning
        ? -1
        : precisionBraking
          ? -1
          : positionArrived || coastingIntoPosition
            ? 0
            : (!turningAround && closeShotCorrection) || powerslide
              ? 0.35
              : sharpNaturalTurn ? 0.55 : 1,
      steer: reverseTurning ? -Math.sign(sideAlignment || turnaroundSteer) : steer,
      jumpPressed: shouldJump,
      jumpHeld: shouldJump || tick <= this.jumpHeldUntilTick,
      boost: activePlay
        && !reverseTurning
        && !precisionBraking
        && !turningAround
        && (!kickoffActive || hasChallengePriority)
        && !settingUpShot
        && !closeShotCorrection
        && (challenging
          ? ballDistance > (
            (defensiveChallenge || (strikingBall && speed <= DEFAULT_CAR_TUNING.maximumGroundDriveSpeed))
              ? 3.5
              : BOOST_MINIMUM_BALL_DISTANCE
          )
          : targetDistance > 14 && car.boost > 18)
        && forwardAlignment > 0.96
        && Math.abs(steer) < BOOST_MAXIMUM_STEER
        && Math.abs(lateralSpeed) < BOOST_MAXIMUM_LATERAL_SPEED
        && targetDistance > (strikingBall ? 3 : 8)
        && (
          !strikingBall
          || targetDistance > boostedApproachBrakingDistance + 3
          || speed < boostedApproachContactSpeed - CONTACT_SPEED_HYSTERESIS
        )
        && speed < DEFAULT_CAR_TUNING.maximumGroundBoostSpeed - 0.25
        && car.boost > 5,
      powerslide: reverseTurning
        ? false
        : brakingForHighSpeedSetupTurn || (!precisionBraking && powerslide),
    };
  }

  tacticalState(): BotTacticalPlan | null {
    return this.latestTacticalPlan;
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
    const techniqueValues = mapTechniqueRecords((kind, technique) => Number(
      (this.techniqueValues[kind].get(technique) ?? 0).toFixed(3),
    ));
    const techniqueSamples = mapTechniqueRecords((kind, technique) => (
      this.techniqueObservationSamples[kind].get(technique) ?? 0
    ));
    return {
      points: Number(this.earnedPoints.toFixed(1)),
      policy: this.policy,
      policyValue: policyValues[this.policy],
      policyValues,
      policySamples,
      techniques: { ground: this.groundTechnique, aerial: this.aerialTechnique },
      techniqueValues,
      techniqueSamples,
    };
  }

  learningObservations(): Readonly<Record<BotPolicy, BotPolicyObservation>> {
    return Object.fromEntries(BOT_POLICY_ORDER.map((policy) => [policy, {
      totalValue: this.policyObservationTotals.get(policy) ?? 0,
      samples: this.policyObservationSamples.get(policy) ?? 0,
    }])) as Record<BotPolicy, BotPolicyObservation>;
  }

  techniqueObservations(): Readonly<
    Record<BotTechniqueKind, Readonly<Record<BotTechnique, BotPolicyObservation>>>
  > {
    return mapTechniqueRecords((kind, technique) => ({
      totalValue: this.techniqueObservationTotals[kind].get(technique) ?? 0,
      samples: this.techniqueObservationSamples[kind].get(technique) ?? 0,
    }));
  }

  rewardTechnique(kind: BotTechniqueKind, value: number): void {
    if (!this.learning || !Number.isFinite(value)) return;
    const technique = kind === 'ground' ? this.groundTechnique : this.aerialTechnique;
    const previousValue = this.techniqueValues[kind].get(technique) ?? 0;
    this.techniqueValues[kind].set(technique, previousValue + (value - previousValue) * 0.25);
    this.techniqueObservationTotals[kind].set(
      technique,
      (this.techniqueObservationTotals[kind].get(technique) ?? 0) + clamp(value, -1, 1),
    );
    this.techniqueObservationSamples[kind].set(
      technique,
      (this.techniqueObservationSamples[kind].get(technique) ?? 0) + 1,
    );
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
    opponentGoal: Vec3,
    technique: AerialTechniqueProfile,
  ): PlayerCommand {
    const car = frame.cars[this.playerId];
    if (!car) return NEUTRAL_COMMAND;
    const secondJump = tick === this.aerialSecondJumpTick;
    if (secondJump) this.aerialSecondJumpTick = -1;

    const carPosition = car.transform.position;
    const remainingSeconds = clamp(
      (this.aerialInterceptTick - tick) / 60,
      0.05,
      AERIAL_INTERCEPT_MAXIMUM_SECONDS,
    );
    const predictedBall = this.predictedAerialBall(frame, remainingSeconds);
    const shotDirection = compensatedShotDirection(
      predictedBall,
      opponentGoal,
      frame.snapshot.ball.linearVelocity,
      technique.velocityCompensation,
    );
    const approachAlignment = this.latestTacticalPlan?.approachAlignment ?? 1;
    const contactOffset = approachAlignment < AERIAL_MINIMUM_APPROACH_ALIGNMENT + 0.2
      ? 0
      : BASE_CONTACT_OFFSET - technique.contactPenetration;
    const target = {
      x: predictedBall.x - shotDirection.x * contactOffset,
      y: Math.max(BALL_TUNING.radius, predictedBall.y - technique.contactVerticalOffset),
      z: predictedBall.z - shotDirection.z * contactOffset,
    };
    const desired = direction3D(carPosition, target);
    const forward = rotateVector(car.transform.rotation, { x: 0, y: 0, z: -1 });
    const right = rotateVector(car.transform.rotation, { x: 1, y: 0, z: 0 });
    const up = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
    const forwardAlignment = dot3D(forward, desired);
    const rightAlignment = dot3D(right, desired);
    const verticalAlignment = dot3D(up, desired);
    const targetDistance = distance3D(carPosition, target);
    const ballDistance = distance3D(carPosition, frame.snapshot.ball.transform.position);
    this.aerialClosestDistance = Math.min(this.aerialClosestDistance, ballDistance);
    const pitchError = Math.atan2(verticalAlignment, Math.max(0.05, forwardAlignment));
    const pitchInput = clamp(-pitchError * technique.pitchGain, -0.95, 0.95);
    const yawInput = clamp(rightAlignment * technique.yawGain, -0.95, 0.95);
    const closingSpeed = dot3D(car.linearVelocity, desired);
    const desiredClosingSpeed = targetDistance / Math.max(0.12, remainingSeconds);
    const passedIntercept = tick > this.aerialInterceptTick + 10;
    const movingAwayAfterMiss = ballDistance > this.aerialClosestDistance + 2
      && forwardAlignment < -0.15;

    if (tick - this.aerialStartedTick > 18 && passedIntercept && movingAwayAfterMiss) {
      this.finishAerial();
      return this.airborneRecoveryCommand(car.transform.rotation);
    }

    return {
      ...NEUTRAL_COMMAND,
      throttle: car.grounded ? 0 : pitchInput,
      steer: car.grounded ? 0 : yawInput,
      airRoll: car.grounded ? 0 : clamp(right.y * 1.1, -0.7, 0.7),
      jumpPressed: secondJump,
      jumpHeld: secondJump || tick - this.aerialStartedTick <= 7,
      boost: !car.grounded
        && !secondJump
        && forwardAlignment > technique.boostAlignment
        && targetDistance > AERIAL_BOOST_CUTOFF_DISTANCE
        && closingSpeed < desiredClosingSpeed + 4
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

  private aerialIntercept(
    frame: AuthoritativeFrame,
    carPosition: Vec3,
    technique: AerialTechniqueProfile,
  ): { readonly position: Vec3; readonly seconds: number } {
    const car = frame.cars[this.playerId];
    const speed = car ? Math.hypot(
      car.linearVelocity.x,
      car.linearVelocity.y,
      car.linearVelocity.z,
    ) : 0;
    let bestSeconds = AERIAL_INTERCEPT_MAXIMUM_SECONDS;
    for (
      let seconds = AERIAL_INTERCEPT_MINIMUM_SECONDS;
      seconds <= AERIAL_INTERCEPT_MAXIMUM_SECONDS;
      seconds += 1 / 30
    ) {
      const position = this.predictedAerialBall(frame, seconds);
      const requiredDistance = distance3D(carPosition, position);
      const reachableDistance = 2.5
        + speed * seconds
        + AERIAL_INTERCEPT_ACCELERATION * seconds ** 2 * 0.5;
      bestSeconds = seconds;
      if (reachableDistance >= requiredDistance) break;
    }
    const seconds = clamp(
      bestSeconds + technique.interceptDelaySeconds,
      AERIAL_INTERCEPT_MINIMUM_SECONDS,
      AERIAL_INTERCEPT_MAXIMUM_SECONDS,
    );
    return { position: this.predictedAerialBall(frame, seconds), seconds };
  }

  private predictedAerialBall(frame: AuthoritativeFrame, seconds: number): Vec3 {
    const ball = frame.snapshot.ball;
    const predicted = predictBallPosition(ball.transform.position, ball.linearVelocity, seconds);
    return {
      x: clamp(predicted.x, -ARENA_TUNING.halfWidth + 2, ARENA_TUNING.halfWidth - 2),
      y: clamp(predicted.y, BALL_TUNING.radius, AERIAL_MAXIMUM_HEIGHT),
      z: clamp(predicted.z, -ARENA_TUNING.halfLength + 2, ARENA_TUNING.halfLength - 2),
    };
  }

  private finishAerial(): void {
    this.aerialStartedTick = -1;
    this.aerialSecondJumpTick = -1;
    this.aerialInterceptTick = -1;
    this.aerialClosestDistance = Number.POSITIVE_INFINITY;
  }

  private defensiveAnchor(ballPosition: Vec3, ownGoal: Vec3): Vec3 {
    return {
      x: clamp(ballPosition.x * 0.45, -ARENA_TUNING.goalHalfWidth * 0.85, ARENA_TUNING.goalHalfWidth * 0.85),
      y: 0,
      z: ownGoal.z * 0.55,
    };
  }

  private updateKickoffState(frame: AuthoritativeFrame, tick: number, activePlay: boolean): void {
    if (frame.snapshot.match.phase === 'countdown') {
      this.sawKickoffCountdown = true;
      this.kickoffStartedTick = -1;
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

  private nonChallengeAvoidanceTarget(
    carPosition: Vec3,
    ballPosition: Vec3,
    destination: Vec3,
  ): Vec3 {
    if (horizontalDistance(carPosition, ballPosition) > NON_CHALLENGE_BALL_AVOIDANCE_RANGE) {
      return destination;
    }
    const pathX = destination.x - carPosition.x;
    const pathZ = destination.z - carPosition.z;
    const pathLength = Math.hypot(pathX, pathZ);
    if (pathLength < 0.1) return destination;
    const pathDirection = { x: pathX / pathLength, y: 0, z: pathZ / pathLength };
    const ballX = ballPosition.x - carPosition.x;
    const ballZ = ballPosition.z - carPosition.z;
    const alongPath = ballX * pathDirection.x + ballZ * pathDirection.z;
    const lateralDistance = Math.abs(ballX * pathDirection.z - ballZ * pathDirection.x);
    if (
      alongPath <= 0
      || alongPath >= pathLength
      || lateralDistance >= NON_CHALLENGE_BALL_AVOIDANCE_DISTANCE
    ) return destination;

    const perpendicular = { x: pathDirection.z, y: 0, z: -pathDirection.x };
    const candidate = (side: number): Vec3 => ({
      x: clamp(
        ballPosition.x + perpendicular.x * side * NON_CHALLENGE_BALL_AVOIDANCE_DISTANCE,
        -ARENA_TUNING.halfWidth + 3,
        ARENA_TUNING.halfWidth - 3,
      ),
      y: 0,
      z: clamp(
        ballPosition.z + perpendicular.z * side * NON_CHALLENGE_BALL_AVOIDANCE_DISTANCE,
        -ARENA_TUNING.halfLength + 3,
        ARENA_TUNING.halfLength - 3,
      ),
    });
    const left = candidate(-1);
    const right = candidate(1);
    const routeDistance = (waypoint: Vec3): number => (
      horizontalDistance(carPosition, waypoint) + horizontalDistance(waypoint, destination)
    );
    return routeDistance(left) <= routeDistance(right) ? left : right;
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
    predictedIntercept?: Vec3,
    tick = 0,
    defensiveChallenge = false,
  ): Vec3 {
    const predictedBall = predictedIntercept ?? this.predictedBall(frame, carPosition);
    const technique = GROUND_TECHNIQUES[this.groundTechnique];
    const goalTarget = this.goalTarget(predictedBall, opponentGoal, technique.goalWidthFraction);
    const shotDirection = compensatedShotDirection(
      predictedBall,
      goalTarget,
      frame.snapshot.ball.linearVelocity,
      technique.velocityCompensation,
    );
    const approachAlignment = this.shotApproachAlignment(frame, carPosition, opponentGoal);
    const ballSpeed = Math.hypot(
      frame.snapshot.ball.linearVelocity.x,
      frame.snapshot.ball.linearVelocity.z,
    );
    const car = frame.cars[this.playerId];
    const speed = car ? Math.hypot(car.linearVelocity.x, car.linearVelocity.z) : 0;
    const directStrikeDistance = DIRECT_STRIKE_MINIMUM_DISTANCE
      + Math.min(3, speed * DIRECT_STRIKE_SPEED_LOOKAHEAD);
    const contactOffset = BASE_CONTACT_OFFSET
      - technique.contactPenetration
      - (defensiveChallenge ? 0.5 : 0);
    const strikeTarget = {
      x: predictedBall.x - shotDirection.x * contactOffset,
      y: predictedBall.y,
      z: predictedBall.z - shotDirection.z * contactOffset,
    };
    const strikeFacing = car
      ? horizontalDot(
        horizontalDirection(
          { x: 0, y: 0, z: 0 },
          rotateVector(car.transform.rotation, { x: 0, y: 0, z: -1 }),
        ),
        horizontalDirection(carPosition, strikeTarget),
      )
      : 1;
    const requiresControlledSoloSetup = this.teamPlayerCount === 1 && ballSpeed < 5;
    // Once the car is close enough to make contact, stop moving an approach point around the
    // ball. Continuing to orbit here makes a pursuing car describe a circle and miss the ball.
    const strikeAlignment = ballSpeed < 5 ? STRIKE_APPROACH_ALIGNMENT : 0.72;
    const orbitAlignment = ballSpeed < 5 ? SETUP_APPROACH_ALIGNMENT : -0.1;
    if (
      ballSpeed < 5
      && approachAlignment >= STRIKE_APPROACH_ALIGNMENT
      && (!requiresControlledSoloSetup || strikeFacing >= 0.85)
    ) {
      this.strikeLaneCommitted = true;
      this.orbitStartedTick = -1;
    }
    if (this.strikeLaneCommitted) return strikeTarget;
    if (approachAlignment > strikeAlignment && (!requiresControlledSoloSetup || strikeFacing >= 0.6)) {
      return strikeTarget;
    }
    if (
      !requiresControlledSoloSetup
      && ballDistance <= directStrikeDistance
      && approachAlignment > DIRECT_STRIKE_MINIMUM_ALIGNMENT
    ) {
      return strikeTarget;
    }
    if (approachAlignment < orbitAlignment) {
      if (this.orbitStartedTick < 0) this.orbitStartedTick = tick;
      if (
        ballSpeed < 5
        && tick - this.orbitStartedTick >= ORBIT_MAXIMUM_TICKS
        && approachAlignment >= ORBIT_TIMEOUT_ALIGNMENT
      ) {
        this.strikeLaneCommitted = true;
        this.orbitStartedTick = -1;
        return strikeTarget;
      }
      return this.orbitTarget(
        carPosition,
        predictedBall,
        shotDirection,
        stagingDistance,
        ballSpeed < 5,
      );
    }

    this.orbitStartedTick = -1;

    return {
      x: predictedBall.x - shotDirection.x * stagingDistance,
      y: predictedBall.y,
      z: predictedBall.z - shotDirection.z * stagingDistance,
    };
  }

  private shotApproachAlignment(
    frame: AuthoritativeFrame,
    carPosition: Vec3,
    opponentGoal: Vec3,
  ): number {
    const predictedBall = this.predictedBall(frame, carPosition);
    const goalTarget = this.goalTarget(
      predictedBall,
      opponentGoal,
      GROUND_TECHNIQUES[this.groundTechnique].goalWidthFraction,
    );
    return horizontalDot(
      horizontalDirection(carPosition, predictedBall),
      horizontalDirection(predictedBall, goalTarget),
    );
  }

  private goalTarget(ballPosition: Vec3, opponentGoal: Vec3, widthFraction: number): Vec3 {
    const openSide = Math.abs(ballPosition.x) > 0.5
      ? -Math.sign(ballPosition.x)
      : hashString(this.playerId) % 2 === 0 ? -1 : 1;
    const usableHalfWidth = Math.max(0, ARENA_TUNING.goalHalfWidth - BALL_TUNING.radius - 0.5);
    return {
      ...opponentGoal,
      x: openSide * usableHalfWidth * widthFraction,
    };
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

  private orbitTarget(
    carPosition: Vec3,
    ballPosition: Vec3,
    shotDirection: Vec3,
    stagingDistance: number,
    preserveCurrentLane: boolean,
  ): Vec3 {
    const shotRight = { x: shotDirection.z, y: 0, z: -shotDirection.x };
    const currentLateralOffset = Math.abs(
      (carPosition.x - ballPosition.x) * shotRight.x
      + (carPosition.z - ballPosition.z) * shotRight.z,
    );
    const controlledSoloOrbit = preserveCurrentLane && this.teamPlayerCount === 1;
    const lateralDistance = controlledSoloOrbit
      ? clamp(
        currentLateralOffset,
        Math.max(stagingDistance * 0.4, BASE_CONTACT_OFFSET + 1.5),
        stagingDistance * 0.52,
      )
      : preserveCurrentLane
        ? clamp(currentLateralOffset, stagingDistance * 0.3, stagingDistance * 0.45)
        : stagingDistance * 0.8;
    const longitudinalDistance = controlledSoloOrbit ? stagingDistance * 1.5 : stagingDistance;
    const candidate = (side: number): Vec3 => ({
      x: clamp(
        ballPosition.x - shotDirection.x * longitudinalDistance + shotRight.x * side * lateralDistance,
        -ARENA_TUNING.halfWidth + 3,
        ARENA_TUNING.halfWidth - 3,
      ),
      y: ballPosition.y,
      z: clamp(
        ballPosition.z - shotDirection.z * longitudinalDistance + shotRight.z * side * lateralDistance,
        -ARENA_TUNING.halfLength + 3,
        ARENA_TUNING.halfLength - 3,
      ),
    });
    const left = candidate(-1);
    const right = candidate(1);
    if (!preserveCurrentLane) {
      return horizontalDistance(carPosition, left) <= horizontalDistance(carPosition, right) ? left : right;
    }
    if (this.orbitSide === 0) {
      this.orbitSide = horizontalDistance(carPosition, left) <= horizontalDistance(carPosition, right) ? -1 : 1;
    }
    return this.orbitSide < 0 ? left : right;
  }

  private predictedBall(frame: AuthoritativeFrame, carPosition: Vec3): Vec3 {
    const ball = frame.snapshot.ball;
    const car = frame.cars[this.playerId];
    const carSpeed = car ? Math.hypot(car.linearVelocity.x, car.linearVelocity.z) : 0;
    const interceptScale = GROUND_TECHNIQUES[this.groundTechnique].interceptScale;
    let leadSeconds = this.interceptSeconds(
      horizontalDistance(carPosition, ball.transform.position),
      carSpeed,
    ) * interceptScale;
    let predicted = predictBallPosition(ball.transform.position, ball.linearVelocity, leadSeconds);
    // Recalculate twice because a moving or rebounding ball changes the distance the car must cover.
    for (let iteration = 0; iteration < 2; iteration += 1) {
      leadSeconds = this.interceptSeconds(horizontalDistance(carPosition, predicted), carSpeed)
        * interceptScale;
      predicted = predictBallPosition(ball.transform.position, ball.linearVelocity, leadSeconds);
    }
    return predicted;
  }

  private interceptSeconds(distance: number, speed: number): number {
    const clampedSpeed = Math.min(INTERCEPT_MAXIMUM_SPEED, Math.max(0, speed));
    const accelerationSeconds = (INTERCEPT_MAXIMUM_SPEED - clampedSpeed) / INTERCEPT_ACCELERATION;
    const accelerationDistance = clampedSpeed * accelerationSeconds
      + INTERCEPT_ACCELERATION * accelerationSeconds ** 2 * 0.5;
    const seconds = distance <= accelerationDistance
      ? (-clampedSpeed + Math.sqrt(clampedSpeed ** 2 + 2 * INTERCEPT_ACCELERATION * distance))
        / INTERCEPT_ACCELERATION
      : accelerationSeconds + (distance - accelerationDistance) / INTERCEPT_MAXIMUM_SPEED;
    return clamp(seconds, 0.05, BALL_PREDICTION_MAXIMUM_SECONDS);
  }

  private initialTechnique(kind: BotTechniqueKind, knowledge?: BotKnowledge): BotTechnique {
    if (!this.learning) return knowledge ? selectBotTechnique(knowledge, kind) : 'balanced';
    // Cover every variant twice in the standard six-bot roster and rotate the assignment each
    // generation, preventing a technique score from becoming tied to one bot identity or role.
    const rosterMatch = /^bot-(azure|coral)-(\d+)$/.exec(this.playerId);
    if (rosterMatch) {
      const slot = Number(rosterMatch[2]);
      const identitySide = rosterMatch[1] === 'coral' ? 1 : 0;
      const kindOffset = identitySide * (kind === 'ground' ? 1 : 2);
      const knowledgeGeneration = knowledge?.generation ?? 0;
      // Keep assignments for a pair of generations before rotating the whole roster.
      // Every match still covers all variants twice, while avoiding an abrupt six-car
      // behavior swap immediately after each knowledge merge.
      const assignmentGeneration = knowledgeGeneration - knowledgeGeneration % 2;
      return BOT_TECHNIQUE_ORDER[
        (slot + kindOffset + assignmentGeneration) % BOT_TECHNIQUE_ORDER.length
      ] ?? 'balanced';
    }
    return BOT_TECHNIQUE_ORDER[
      hashString(`${this.playerId}:${kind}`) % BOT_TECHNIQUE_ORDER.length
    ] ?? 'balanced';
  }
}

const horizontalDirection = (from: Vec3, to: Vec3): Vec3 => {
  const x = to.x - from.x;
  const z = to.z - from.z;
  const inverseLength = 1 / Math.max(0.0001, Math.hypot(x, z));
  return { x: x * inverseLength, y: 0, z: z * inverseLength };
};

const compensatedShotDirection = (
  ballPosition: Vec3,
  target: Vec3,
  ballVelocity: Vec3,
  compensation: number,
): Vec3 => {
  const goalDirection = horizontalDirection(ballPosition, target);
  const ballSpeed = Math.hypot(ballVelocity.x, ballVelocity.z);
  // Contact adds velocity; it does not replace the ball's existing trajectory. Aim the
  // impulse against lateral motion so the resulting velocity, rather than the raw hit,
  // travels through the selected point in the goal mouth.
  const desiredSpeed = Math.max(18, ballSpeed + 4);
  const x = goalDirection.x * desiredSpeed - ballVelocity.x * compensation;
  const z = goalDirection.z * desiredSpeed - ballVelocity.z * compensation;
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

const length3D = (vector: Vec3): number => Math.hypot(vector.x, vector.y, vector.z);

const normalized3D = (vector: Vec3, fallback: Vec3): Vec3 => {
  const vectorLength = length3D(vector);
  if (vectorLength > 1e-6) return {
    x: vector.x / vectorLength,
    y: vector.y / vectorLength,
    z: vector.z / vectorLength,
  };
  return fallback;
};

const tangentVector = (vector: Vec3, surfaceNormal: Vec3): Vec3 => {
  const normalComponent = dot3D(vector, surfaceNormal);
  return {
    x: vector.x - surfaceNormal.x * normalComponent,
    y: vector.y - surfaceNormal.y * normalComponent,
    z: vector.z - surfaceNormal.z * normalComponent,
  };
};

const tangentDirection = (direction: Vec3, surfaceNormal: Vec3, fallback: Vec3): Vec3 => {
  const tangent = tangentVector(direction, surfaceNormal);
  if (length3D(tangent) > 1e-6) return normalized3D(tangent, fallback);
  const fallbackTangent = tangentVector(fallback, surfaceNormal);
  return normalized3D(fallbackTangent, fallback);
};

const surfaceDirection = (
  from: Vec3,
  to: Vec3,
  surfaceNormal: Vec3,
  fallback: Vec3,
): Vec3 => tangentDirection({
  x: to.x - from.x,
  y: to.y - from.y,
  z: to.z - from.z,
}, surfaceNormal, fallback);

const surfaceDistance = (from: Vec3, to: Vec3, surfaceNormal: Vec3): number => length3D(
  tangentVector({
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z,
  }, surfaceNormal),
);

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

const createTechniqueMaps = (): Record<BotTechniqueKind, Map<BotTechnique, number>> => ({
  ground: new Map(BOT_TECHNIQUE_ORDER.map((technique) => [technique, 0])),
  aerial: new Map(BOT_TECHNIQUE_ORDER.map((technique) => [technique, 0])),
});

const mapTechniqueRecords = <T>(
  map: (kind: BotTechniqueKind, technique: BotTechnique) => T,
): Record<BotTechniqueKind, Record<BotTechnique, T>> => ({
  ground: Object.fromEntries(BOT_TECHNIQUE_ORDER.map((technique) => [
    technique,
    map('ground', technique),
  ])) as Record<BotTechnique, T>,
  aerial: Object.fromEntries(BOT_TECHNIQUE_ORDER.map((technique) => [
    technique,
    map('aerial', technique),
  ])) as Record<BotTechnique, T>,
});
