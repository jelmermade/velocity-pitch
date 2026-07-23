import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNTIME_CONFIG } from '../../src/app/RuntimeConfig';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { BALL_TUNING } from '../../src/core/config/BallTuning';
import { DEFAULT_CAR_TUNING } from '../../src/core/config/CarTuning';
import { MATCH_TUNING } from '../../src/core/config/MatchTuning';
import { EventBus } from '../../src/core/events/EventBus';
import type { GameEventMap } from '../../src/core/events/GameEvents';
import { rotateVector } from '../../src/core/math/Quaternion';
import { distance, dot, length, normalize, sub, type Vec3 } from '../../src/core/math/Vector3';
import { GOALS } from '../../src/gameplay/arena/ArenaDefinition';
import type { BotTacticalPlan } from '../../src/gameplay/bots/BotTeamCoordinator';
import { GameSimulation } from '../../src/gameplay/simulation/GameSimulation';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../src/input/PlayerCommand';
import { BotTrainingSession } from '../../src/networking/BotTrainingSession';
import type { AuthoritativeFrame, TeamId } from '../../src/networking/LobbyProtocol';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';
import { BotKnowledgeFileStore } from '../../server/BotKnowledgeFileStore';

const STEP_SECONDS = 1 / RUNTIME_CONFIG.physicsHz;
const MAXIMUM_TICKS = RUNTIME_CONFIG.physicsHz * 3_600;
const MAXIMUM_REGULATION_STALL_TICKS = Math.ceil(RUNTIME_CONFIG.physicsHz * (
  MATCH_TUNING.countdownSeconds
  + MATCH_TUNING.goalExplosionSeconds
  + MATCH_TUNING.replaySeconds
  + 3
));
const TOUCH_DISTANCE = BALL_TUNING.radius + 3;
const AERIAL_BALL_HEIGHT = BALL_TUNING.radius + 1.25;
const KICKOFF_EVALUATION_TICKS = RUNTIME_CONFIG.physicsHz * 12;
const DEFAULT_EVALUATION_RANDOM_SEED = 0xb075eed;
const MINIMUM_TOUCHES_PER_ACTIVE_MINUTE = 10;
const MINIMUM_PRODUCTIVE_TOUCH_RATE = 0.8;
const PRODUCTIVE_FORWARD_SPEED = 2;
const DEFENSIVE_CLEAR_FORWARD_SPEED = 0.5;
const HARD_TOUCH_MINIMUM_IMPULSE_SPEED = 8;
const HARD_TOUCH_MINIMUM_OUTGOING_SPEED = 14;

describe('five-minute bot match evaluation', () => {
  it('records comparable gameplay and learning metrics', async () => {
    const world = await RapierPhysicsWorld.create();
    const knowledgeStore = new BotKnowledgeFileStore();
    const startingKnowledge = await knowledgeStore.load();
    const session = new BotTrainingSession(
      startingKnowledge,
      undefined,
      seededRandom(evaluationRandomSeed()),
    );
    const simulation = new GameSimulation(
      world,
      new EventBus<GameEventMap>(),
      session.players,
      session.localPlayerId,
    );
    const metrics = new EvaluationMetrics(session);
    let tick = 0;
    let regulationComplete = false;
    let regulationStallTicks = 0;
    let previousTimeRemaining = simulation.snapshot(1).match.timeRemaining;

    try {
      while (tick < MAXIMUM_TICKS) {
        const frame = simulation.authoritativeFrame(tick);
        const commands = session.commandsForTick(tick, NEUTRAL_COMMAND, frame);
        metrics.observe(frame, commands, simulation.ballContactPlayerIds());
        try {
          simulation.updatePlayers(commands, STEP_SECONDS);
        } catch (error) {
          console.error('BOT_EVALUATION_PHYSICS_FAILURE', JSON.stringify({
            tick,
            ball: frame.snapshot.ball,
            cars: Object.fromEntries(Object.entries(frame.cars).map(([playerId, car]) => [
              playerId,
              {
                transform: car.transform,
                linearVelocity: car.linearVelocity,
                angularVelocity: car.angularVelocity,
                grounded: car.grounded,
                surfaceNormal: car.surfaceNormal,
                command: commands.get(playerId),
              },
            ])),
          }));
          throw error;
        }
        tick += 1;
        const match = simulation.snapshot(1).match;
        if (match.timeRemaining < previousTimeRemaining) regulationStallTicks = 0;
        else regulationStallTicks += 1;
        previousTimeRemaining = match.timeRemaining;
        if (match.timeRemaining <= 0) {
          regulationComplete = true;
          break;
        }
        if (regulationStallTicks > MAXIMUM_REGULATION_STALL_TICKS) {
          throw new Error(
            `Regulation clock stalled in ${match.phase} at ${match.timeRemaining.toFixed(2)} seconds`,
          );
        }
      }

      const finalFrame = simulation.authoritativeFrame(tick);
      const matchReport = metrics.report(finalFrame, session.trainingState(), tick, regulationComplete);
      const learnedKnowledge = session.learnedKnowledge();
      const label = sanitizeLabel(process.env.BOT_EVALUATION_LABEL ?? 'latest');
      const directory = resolve(process.cwd(), 'data');
      const outputPath = resolve(directory, `bot-evaluation-${label}.json`);
      await mkdir(directory, { recursive: true });
      expect(regulationComplete, JSON.stringify({
        simulationTicks: tick,
        phase: finalFrame.snapshot.match.phase,
        timeRemaining: finalFrame.snapshot.match.timeRemaining,
        score: {
          azure: finalFrame.snapshot.match.azureScore,
          coral: finalFrame.snapshot.match.coralScore,
        },
      })).toBe(true);
      expect(matchReport.regulationSeconds).toBeCloseTo(MATCH_TUNING.durationSeconds, 0);
      expect(matchReport.bots).toHaveLength(6);
      expect(Number.isFinite(matchReport.averageNearestTeammateDistance)).toBe(true);
      expect(Number.isFinite(matchReport.jumpsPerBotMinute)).toBe(true);
      expect(Number.isFinite(matchReport.recoveryDowntimePerBotSeconds)).toBe(true);
      expect(Number.isFinite(matchReport.reverseBotSeconds)).toBe(true);
      expect(Number.isFinite(matchReport.jumpContactConversionRate)).toBe(true);
      expect(Number.isFinite(matchReport.powerslideBotSeconds)).toBe(true);
      expect(Number.isFinite(matchReport.unstableBoostBotSeconds)).toBe(true);
      expect(Number.isFinite(matchReport.groundBoostBotSeconds)).toBe(true);
      expect(Number.isFinite(matchReport.aboveDriveTopSpeedBoostBotSeconds)).toBe(true);
      expect(Number.isFinite(matchReport.netBotReward)).toBe(true);
      expect(Number.isFinite(matchReport.shotOnTargetRate)).toBe(true);
      expect(Number.isFinite(matchReport.aerialShotOnTargetRate)).toBe(true);
      expect(Number.isFinite(matchReport.meanShotAlignment)).toBe(true);
      expect(
        matchReport.doubleCommitTeamSeconds,
        JSON.stringify(metrics.doubleCommitDiagnostics()),
      ).toBe(0);
      expect(matchReport.structuredTeamRate).toBeGreaterThanOrEqual(0.99);
      expect(matchReport.averageNearestTeammateDistance).toBeGreaterThan(15);
      const minimumTouches = Math.floor(
        matchReport.activePlaySeconds / 60 * MINIMUM_TOUCHES_PER_ACTIVE_MINUTE,
      );
      expect(matchReport.touches).toBeGreaterThanOrEqual(minimumTouches);
      if (process.env.BOT_EVALUATION_ENFORCE_TARGETS !== 'false') {
        expect(matchReport.productiveTouchRate).toBeGreaterThanOrEqual(MINIMUM_PRODUCTIVE_TOUCH_RATE);
        expect(matchReport.alignedApproachConversionRate).toBeGreaterThanOrEqual(0.9);
        expect(matchReport.aerialAttemptConversionRate).toBeGreaterThanOrEqual(0.75);
        expect(matchReport.defenseHitRate).toBeGreaterThanOrEqual(0.8);
      }
      expect(matchReport.productiveAerialTouches).toBeLessThanOrEqual(matchReport.aerialTouches);
      expect(matchReport.kickoffGoals).toBeLessThanOrEqual(matchReport.kickoffs);
      expect(matchReport.alignedApproachMisses).toBeLessThanOrEqual(matchReport.alignedApproaches);
      expect(learnedKnowledge.generation).toBe(startingKnowledge.generation + 1);

      const persistedKnowledge = process.env.BOT_EVALUATION_PERSIST_KNOWLEDGE === 'false'
        ? learnedKnowledge
        : await knowledgeStore.merge(session.knowledgeObservations());
      const report = {
        ...matchReport,
        knowledge: {
          previousGeneration: startingKnowledge.generation,
          learnedGeneration: persistedKnowledge.generation,
          roles: persistedKnowledge.roles,
          techniques: persistedKnowledge.techniques,
        },
      };
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.info(`BOT_EVALUATION ${JSON.stringify(report)}`);
    } finally {
      simulation.dispose();
    }
  });
});

class EvaluationMetrics {
  private previous: AuthoritativeFrame | null = null;
  private activeTicks = 0;
  private touches = 0;
  private productiveTouches = 0;
  private harmfulTouches = 0;
  private hardTouches = 0;
  private productiveHardTouches = 0;
  private touchImpulseSpeedTotal = 0;
  private postTouchBallSpeedTotal = 0;
  private jumpActions = 0;
  private aerialAttempts = 0;
  private successfulAerialAttempts = 0;
  private failedAerialAttempts = 0;
  private aerialTouches = 0;
  private productiveAerialTouches = 0;
  private groundTouches = 0;
  private shotAttempts = 0;
  private shotsOnTarget = 0;
  private aerialShotAttempts = 0;
  private aerialShotsOnTarget = 0;
  private shotAlignmentTotal = 0;
  private aerialBoostTicks = 0;
  private boostTicks = 0;
  private groundBoostTicks = 0;
  private fastGroundBoostTicks = 0;
  private reverseTicks = 0;
  private powerslideTicks = 0;
  private unstableBoostTicks = 0;
  private failedContactJumps = 0;
  private successfulContactJumps = 0;
  private sideStuckTicks = 0;
  private flippedStuckTicks = 0;
  private ballTravel = 0;
  private teammateDistanceTotal = 0;
  private teammateDistanceSamples = 0;
  private kickoffWindowTicks = 0;
  private kickoffs = 0;
  private kickoffGoals = 0;
  private alignedApproaches = 0;
  private alignedApproachMisses = 0;
  private defensiveApproaches = 0;
  private successfulDefensiveApproaches = 0;
  private tacticalTeamTicks = 0;
  private structuredTeamTicks = 0;
  private doubleCommitTeamTicks = 0;
  private rotationIntentTicks = 0;
  private patientIntentTicks = 0;
  private tacticalRoleChanges = 0;
  private readonly doubleCommitSamples: Array<{
    readonly tick: number;
    readonly team: TeamId;
    readonly plans: readonly {
      readonly playerId: string;
      readonly role: string;
      readonly intent: string;
    }[];
  }> = [];
  private readonly previousTacticalRoles = new Map<string, string>();
  private previousTacticalStates = new Map<string, BotTacticalPlan>();
  private previousContactPlayerIds = new Set<string>();
  private readonly activeTouchEpisodes = new Map<string, {
    readonly playerId: string;
    readonly team: TeamId;
    readonly intent: string;
    readonly defensive: boolean;
    readonly beforeProgress: number;
    readonly beforeVelocity: Vec3;
    readonly ballX: number;
    readonly ballZ: number;
    readonly approachAlignment: number;
    readonly aerial: boolean;
  }>();
  private readonly activeApproaches = new Set<string>();
  private readonly touchedApproaches = new Set<string>();
  private readonly defensiveApproachesByPlayer = new Set<string>();
  private readonly successfulDefensiveApproachesByPlayer = new Set<string>();
  private readonly defensiveClearTicks = new Map<string, number>();
  private readonly groundApproachStarts = new Map<string, {
    readonly startedTick: number;
    readonly distance: number;
    readonly alignment: number;
    readonly speed: number;
    readonly closingSpeed: number;
    readonly ballSpeed: number;
    readonly boost: number;
    readonly confidence: number;
    readonly arrivalSeconds: number;
    readonly opponentArrivalSeconds: number;
    readonly defensive: boolean;
  }>();
  private readonly groundApproachOutcomes: Array<{
    readonly success: boolean;
    readonly distance: number;
    readonly alignment: number;
    readonly speed: number;
    readonly closingSpeed: number;
    readonly ballSpeed: number;
    readonly boost: number;
    readonly confidence: number;
    readonly arrivalSeconds: number;
    readonly opponentArrivalSeconds: number;
    readonly defensive: boolean;
  }> = [];
  private readonly contactJumps = new Map<string, {
    readonly playerId: string;
    readonly tick: number;
    readonly aerial: boolean;
    readonly horizontalDistance: number;
    readonly distance: number;
    readonly ballHeight: number;
    readonly ballVerticalSpeed: number;
    readonly boost: number;
    readonly carSpeed: number;
    readonly ballHorizontalSpeed: number;
    readonly approachAlignment: number;
    readonly forwardAlignment: number;
    readonly confidence: number;
    readonly arrivalSeconds: number;
    readonly opponentArrivalSeconds: number;
    closestDistance: number;
    maxCarHeight: number;
  }>();
  private readonly aerialAttemptOutcomes: Array<{
    readonly playerId: string;
    readonly success: boolean;
    readonly horizontalDistance: number;
    readonly distance: number;
    readonly ballHeight: number;
    readonly ballVerticalSpeed: number;
    readonly boost: number;
    readonly carSpeed: number;
    readonly ballHorizontalSpeed: number;
    readonly approachAlignment: number;
    readonly forwardAlignment: number;
    readonly confidence: number;
    readonly arrivalSeconds: number;
    readonly opponentArrivalSeconds: number;
    readonly closestDistance: number;
    readonly maxCarHeight: number;
    readonly resolutionTicks: number;
    readonly landedWithoutContact: boolean;
  }> = [];
  private readonly touchOutcomes: Array<{
    readonly playerId: string;
    readonly team: TeamId;
    readonly intent: string;
    readonly defensive: boolean;
    readonly productive: boolean;
    readonly hard: boolean;
    readonly clear: boolean;
    readonly beforeProgress: number;
    readonly afterProgress: number;
    readonly impactSpeed: number;
    readonly outgoingSpeed: number;
    readonly ballX: number;
    readonly ballZ: number;
    readonly approachAlignment: number;
    readonly onTarget: boolean;
  }> = [];

  constructor(private readonly session: BotTrainingSession) {}

  doubleCommitDiagnostics(): readonly unknown[] {
    return this.doubleCommitSamples;
  }

  observe(
    frame: AuthoritativeFrame,
    commands: ReadonlyMap<string, PlayerCommand>,
    contactPlayerIds: readonly string[],
  ): void {
    if (this.previous) {
      const goalScored = frame.snapshot.match.azureScore > this.previous.snapshot.match.azureScore
        || frame.snapshot.match.coralScore > this.previous.snapshot.match.coralScore;
      if (goalScored && this.kickoffWindowTicks > 0) this.kickoffGoals += 1;
      if (isActive(frame) && !isActive(this.previous)) {
        this.kickoffs += 1;
        this.kickoffWindowTicks = KICKOFF_EVALUATION_TICKS;
      }
    }
    if (!isActive(frame)) {
      this.contactJumps.clear();
      this.activeApproaches.clear();
      this.touchedApproaches.clear();
      this.defensiveApproachesByPlayer.clear();
      this.successfulDefensiveApproachesByPlayer.clear();
      this.defensiveClearTicks.clear();
      this.groundApproachStarts.clear();
      this.previousContactPlayerIds.clear();
      this.activeTouchEpisodes.clear();
      this.previous = frame;
      this.previousTacticalStates = new Map(this.session.tacticalStates());
      return;
    }
    this.kickoffWindowTicks = Math.max(0, this.kickoffWindowTicks - 1);
    this.activeTicks += 1;
    commands.forEach((command, playerId) => {
      if (command.jumpPressed) this.jumpActions += 1;
      if (command.boost) this.boostTicks += 1;
      const car = frame.cars[playerId];
      if (!car) return;
      if (command.boost && car.grounded) {
        this.groundBoostTicks += 1;
        const toBall = normalize(sub(frame.snapshot.ball.transform.position, car.transform.position));
        const closingSpeed = dot(car.linearVelocity, toBall);
        if (closingSpeed > DEFAULT_CAR_TUNING.maximumGroundDriveSpeed) {
          this.fastGroundBoostTicks += 1;
        }
      }
      if (command.throttle < -0.05 && car.grounded) this.reverseTicks += 1;
      if (command.powerslide && car.grounded) this.powerslideTicks += 1;
      const carRight = rotateVector(car.transform.rotation, { x: 1, y: 0, z: 0 });
      const horizontalRightLength = Math.max(0.0001, Math.hypot(carRight.x, carRight.z));
      const lateralSpeed = (
        car.linearVelocity.x * carRight.x + car.linearVelocity.z * carRight.z
      ) / horizontalRightLength;
      if (car.grounded && command.boost && (Math.abs(command.steer) >= 0.18 || Math.abs(lateralSpeed) >= 2.5)) {
        this.unstableBoostTicks += 1;
      }
      const up = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
      if (
        command.jumpPressed
        && !this.contactJumps.has(playerId)
        && this.session.isAerialActive(playerId)
        && car.grounded
        && up.y > 0.55
        && frame.snapshot.ball.transform.position.y > AERIAL_BALL_HEIGHT
      ) {
        this.aerialAttempts += 1;
      }
      if (command.boost && !car.grounded) this.aerialBoostTicks += 1;
    });
    this.observeRecovery(frame);
    this.observeSpacing(frame);
    this.observeTeamStructure();
    if (this.previous && isActive(this.previous)) {
      this.updateAerialAttempts(frame);
      this.ballTravel += distance(
        this.previous.snapshot.ball.transform.position,
        frame.snapshot.ball.transform.position,
      );
      const toucherId = this.observeTouch(this.previous, frame, contactPlayerIds);
      const contactAttempt = toucherId ? this.contactJumps.get(toucherId) : undefined;
      if (contactAttempt && toucherId) {
        this.contactJumps.delete(toucherId);
        this.successfulContactJumps += 1;
        if (contactAttempt.aerial) this.aerialAttemptOutcomes.push({
          ...contactAttempt,
          success: true,
          resolutionTicks: frame.snapshot.tick - contactAttempt.tick,
          landedWithoutContact: false,
        });
        if (contactAttempt.aerial) this.successfulAerialAttempts += 1;
      }
      this.resolveContactJumps(frame);
      this.trackContactJumps(frame, commands);
      this.observeAlignedApproaches(frame, toucherId);
    }
    this.previous = frame;
    this.previousTacticalStates = new Map(this.session.tacticalStates());
  }

  report(
    frame: AuthoritativeFrame,
    training: ReturnType<BotTrainingSession['trainingState']>,
    ticks: number,
    regulationComplete: boolean,
  ) {
    const botCount = Math.max(1, training.entries.length);
    const activePlaySeconds = this.activeTicks * STEP_SECONDS;
    const recoveryDowntimeSeconds = (this.sideStuckTicks + this.flippedStuckTicks) * STEP_SECONDS;
    return {
      schemaVersion: 3,
      evaluationVersion: 'bot-evaluation-v3',
      generatedAt: new Date().toISOString(),
      regulationComplete,
      simulationTicks: ticks,
      regulationSeconds: MATCH_TUNING.durationSeconds - frame.snapshot.match.timeRemaining,
      score: {
        azure: frame.snapshot.match.azureScore,
        coral: frame.snapshot.match.coralScore,
      },
      activePlaySeconds: round(activePlaySeconds),
      touches: this.touches,
      productiveTouches: this.productiveTouches,
      harmfulTouches: this.harmfulTouches,
      productiveTouchRate: round(this.productiveTouches / Math.max(1, this.touches)),
      harmfulTouchRate: round(this.harmfulTouches / Math.max(1, this.touches)),
      hardTouches: this.hardTouches,
      hardTouchRate: round(this.hardTouches / Math.max(1, this.touches)),
      productiveHardTouches: this.productiveHardTouches,
      productiveHardTouchRate: round(this.productiveHardTouches / Math.max(1, this.touches)),
      meanTouchImpulseSpeed: round(this.touchImpulseSpeedTotal / Math.max(1, this.touches)),
      meanPostTouchBallSpeed: round(this.postTouchBallSpeedTotal / Math.max(1, this.touches)),
      ballTravel: round(this.ballTravel),
      jumpActions: this.jumpActions,
      jumpsPerBotMinute: round(this.jumpActions / botCount / Math.max(1, activePlaySeconds / 60)),
      aerialAttempts: this.aerialAttempts,
      aerialTouches: this.aerialTouches,
      productiveAerialTouches: this.productiveAerialTouches,
      groundTouches: this.groundTouches,
      shotAttempts: this.shotAttempts,
      shotsOnTarget: this.shotsOnTarget,
      shotOnTargetRate: round(this.shotsOnTarget / Math.max(1, this.shotAttempts)),
      aerialShotAttempts: this.aerialShotAttempts,
      aerialShotsOnTarget: this.aerialShotsOnTarget,
      aerialShotOnTargetRate: round(
        this.aerialShotsOnTarget / Math.max(1, this.aerialShotAttempts),
      ),
      meanShotAlignment: round(this.shotAlignmentTotal / Math.max(1, this.shotAttempts)),
      aerialTouchRate: round(this.productiveAerialTouches / Math.max(1, this.aerialTouches)),
      resolvedAerialAttempts: this.successfulAerialAttempts + this.failedAerialAttempts,
      successfulAerialAttempts: this.successfulAerialAttempts,
      aerialAttemptConversionRate: round(
        this.successfulAerialAttempts
          / Math.max(1, this.successfulAerialAttempts + this.failedAerialAttempts),
      ),
      productiveAerialAttemptRate: round(this.productiveAerialTouches / Math.max(1, this.aerialAttempts)),
      aerialAttemptDiagnostics: summarizeAerialAttempts(this.aerialAttemptOutcomes),
      groundApproachDiagnostics: summarizeGroundApproaches(this.groundApproachOutcomes),
      touchDiagnostics: summarizeTouchOutcomes(this.touchOutcomes),
      aerialBoostBotSeconds: round(this.aerialBoostTicks * STEP_SECONDS),
      boostBotSeconds: round(this.boostTicks * STEP_SECONDS),
      groundBoostBotSeconds: round(this.groundBoostTicks * STEP_SECONDS),
      aboveDriveTopSpeedBoostBotSeconds: round(this.fastGroundBoostTicks * STEP_SECONDS),
      reverseBotSeconds: round(this.reverseTicks * STEP_SECONDS),
      powerslideBotSeconds: round(this.powerslideTicks * STEP_SECONDS),
      unstableBoostBotSeconds: round(this.unstableBoostTicks * STEP_SECONDS),
      failedContactJumpActions: this.failedContactJumps,
      jumpContactConversionRate: round(
        this.successfulContactJumps / Math.max(1, this.successfulContactJumps + this.failedContactJumps),
      ),
      sideStuckBotSeconds: round(this.sideStuckTicks * STEP_SECONDS),
      flippedStuckBotSeconds: round(this.flippedStuckTicks * STEP_SECONDS),
      recoveryDowntimePerBotSeconds: round(recoveryDowntimeSeconds / botCount),
      averageNearestTeammateDistance: round(
        this.teammateDistanceTotal / Math.max(1, this.teammateDistanceSamples),
      ),
      doubleCommitTeamSeconds: round(this.doubleCommitTeamTicks * STEP_SECONDS),
      structuredTeamRate: round(this.structuredTeamTicks / Math.max(1, this.tacticalTeamTicks)),
      rotationBotSeconds: round(this.rotationIntentTicks * STEP_SECONDS),
      patientDecisionBotSeconds: round(this.patientIntentTicks * STEP_SECONDS),
      tacticalRoleChanges: this.tacticalRoleChanges,
      netBotReward: round(training.entries.reduce((total, bot) => total + bot.points, 0)),
      kickoffs: this.kickoffs,
      kickoffGoals: this.kickoffGoals,
      kickoffGoalRate: round(this.kickoffGoals / Math.max(1, this.kickoffs)),
      alignedApproaches: this.alignedApproaches,
      alignedApproachMisses: this.alignedApproachMisses,
      alignedApproachConversionRate: round(
        (this.alignedApproaches - this.alignedApproachMisses) / Math.max(1, this.alignedApproaches),
      ),
      defensiveApproaches: this.defensiveApproaches,
      successfulDefensiveApproaches: this.successfulDefensiveApproaches,
      defenseHitRate: round(
        this.successfulDefensiveApproaches / Math.max(1, this.defensiveApproaches),
      ),
      bots: training.entries,
    };
  }

  private observeRecovery(frame: AuthoritativeFrame): void {
    Object.entries(frame.cars).forEach(([, car]) => {
      const up = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
      const resting = car.transform.position.y < 2.2
        && Math.abs(car.linearVelocity.y) < 1
        && Math.hypot(car.linearVelocity.x, car.linearVelocity.z) < 0.65;
      if (!resting) return;
      if (up.y < -0.35) this.flippedStuckTicks += 1;
      else if (up.y < 0.45) this.sideStuckTicks += 1;
    });
  }

  private observeTeamStructure(): void {
    const tacticalStates = this.session.tacticalStates();
    for (const team of ['azure', 'coral'] as const) {
      const plans = this.session.players
        .filter((player) => player.team === team)
        .flatMap((player) => {
          const plan = tacticalStates.get(player.id);
          return plan ? [plan] : [];
        });
      if (plans.length === 0) continue;
      this.tacticalTeamTicks += 1;
      const challengeCount = plans.filter(({ intent }) => intent === 'challenge').length;
      if (challengeCount > 1) {
        this.doubleCommitTeamTicks += 1;
        if (this.doubleCommitSamples.length < 5) {
          this.doubleCommitSamples.push({
            tick: this.activeTicks,
            team,
            plans: plans.map(({ playerId, role, intent }) => ({ playerId, role, intent })),
          });
        }
      }
      const roles = new Set(plans.map(({ role }) => role));
      // Demolished cars are absent while respawning. Judge whether the active cars have
      // distinct assignments instead of treating the unavoidable vacancy as bad rotation.
      if (roles.size === plans.length && challengeCount <= 1) this.structuredTeamTicks += 1;
      plans.forEach((plan) => {
        if (plan.intent === 'rotate') this.rotationIntentTicks += 1;
        if (plan.intent === 'shadow' || plan.intent === 'fake-challenge') this.patientIntentTicks += 1;
        const previousRole = this.previousTacticalRoles.get(plan.playerId);
        if (previousRole && previousRole !== plan.role) this.tacticalRoleChanges += 1;
        this.previousTacticalRoles.set(plan.playerId, plan.role);
      });
    }
  }

  private trackContactJumps(
    frame: AuthoritativeFrame,
    commands: ReadonlyMap<string, PlayerCommand>,
  ): void {
    commands.forEach((command, playerId) => {
      if (!command.jumpPressed || this.contactJumps.has(playerId)) return;
      if (!this.session.isAerialActive(playerId)) return;
      const car = frame.cars[playerId];
      if (!car?.grounded || distance(car.transform.position, frame.snapshot.ball.transform.position) > 30) return;
      const up = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
      if (up.y <= 0.55) return;
      const plan = this.session.tacticalStates().get(playerId);
      this.contactJumps.set(playerId, {
        playerId,
        tick: frame.snapshot.tick,
        aerial: frame.snapshot.ball.transform.position.y > AERIAL_BALL_HEIGHT,
        horizontalDistance: Math.hypot(
          car.transform.position.x - frame.snapshot.ball.transform.position.x,
          car.transform.position.z - frame.snapshot.ball.transform.position.z,
        ),
        distance: distance(car.transform.position, frame.snapshot.ball.transform.position),
        ballHeight: frame.snapshot.ball.transform.position.y,
        ballVerticalSpeed: frame.snapshot.ball.linearVelocity.y,
        boost: car.boost,
        carSpeed: Math.hypot(car.linearVelocity.x, car.linearVelocity.z),
        ballHorizontalSpeed: Math.hypot(
          frame.snapshot.ball.linearVelocity.x,
          frame.snapshot.ball.linearVelocity.z,
        ),
        approachAlignment: plan?.approachAlignment ?? 0,
        forwardAlignment: plan?.forwardAlignment ?? 0,
        confidence: plan?.confidence ?? 0,
        arrivalSeconds: plan?.arrivalSeconds ?? 0,
        opponentArrivalSeconds: plan?.opponentArrivalSeconds ?? 0,
        closestDistance: distance(car.transform.position, frame.snapshot.ball.transform.position),
        maxCarHeight: car.transform.position.y,
      });
    });
  }

  private updateAerialAttempts(frame: AuthoritativeFrame): void {
    this.contactJumps.forEach((attempt, playerId) => {
      const car = frame.cars[playerId];
      if (!car) return;
      attempt.closestDistance = Math.min(
        attempt.closestDistance,
        distance(car.transform.position, frame.snapshot.ball.transform.position),
      );
      attempt.maxCarHeight = Math.max(attempt.maxCarHeight, car.transform.position.y);
    });
  }

  private resolveContactJumps(frame: AuthoritativeFrame): void {
    this.contactJumps.forEach((attempt, playerId) => {
      const car = frame.cars[playerId];
      const age = frame.snapshot.tick - attempt.tick;
      const timeout = attempt.aerial ? 150 : 60;
      if (age < timeout && !(age > 12 && car?.grounded)) return;
      this.failedContactJumps += 1;
      if (attempt.aerial) {
        this.failedAerialAttempts += 1;
        this.aerialAttemptOutcomes.push({
          ...attempt,
          success: false,
          resolutionTicks: age,
          landedWithoutContact: Boolean(age > 12 && car?.grounded),
        });
      }
      this.contactJumps.delete(playerId);
    });
  }

  private observeSpacing(frame: AuthoritativeFrame): void {
    for (const team of ['azure', 'coral'] as const) {
      const teamCars = this.session.players
        .filter((player) => player.team === team)
        .flatMap((player) => {
          const car = frame.cars[player.id];
          return car ? [car] : [];
        });
      teamCars.forEach((car, index) => {
        const closest = teamCars.reduce((minimum, teammate, teammateIndex) => (
          teammateIndex === index
            ? minimum
            : Math.min(minimum, distance(car.transform.position, teammate.transform.position))
        ), Number.POSITIVE_INFINITY);
        if (!Number.isFinite(closest)) return;
        this.teammateDistanceTotal += closest;
        this.teammateDistanceSamples += 1;
      });
    }
  }

  private observeTouch(
    previous: AuthoritativeFrame,
    frame: AuthoritativeFrame,
    contactPlayerIds: readonly string[],
  ): string | null {
    const newContacts = contactPlayerIds.filter((playerId) => !this.previousContactPlayerIds.has(playerId));
    const endedContacts = [...this.activeTouchEpisodes.keys()]
      .filter((playerId) => !contactPlayerIds.includes(playerId));
    endedContacts.forEach((playerId) => {
      const episode = this.activeTouchEpisodes.get(playerId);
      if (episode) this.recordTouchOutcome(episode, frame);
      this.activeTouchEpisodes.delete(playerId);
    });
    this.previousContactPlayerIds = new Set(contactPlayerIds);
    const ball = frame.snapshot.ball.transform.position;
    const contacts = this.session.players
      .filter((player) => newContacts.includes(player.id))
      .flatMap((player) => {
        const car = frame.cars[player.id];
        if (!car) return [];
        const direction = attackDirection(player.team);
        const beforeProgress = previous.snapshot.ball.linearVelocity.z * direction;
        const plan = this.previousTacticalStates.get(player.id)
          ?? this.session.tacticalStates().get(player.id);
        this.activeTouchEpisodes.set(player.id, {
          playerId: player.id,
          team: player.team,
          intent: plan?.intent ?? 'unknown',
          defensive: ball.z * direction < -ARENA_TUNING.halfLength * 0.12 || beforeProgress < -4,
          beforeProgress,
          beforeVelocity: previous.snapshot.ball.linearVelocity,
          ballX: ball.x,
          ballZ: ball.z,
          approachAlignment: plan?.approachAlignment ?? 0,
          aerial: !car.grounded && ball.y > AERIAL_BALL_HEIGHT,
        });
        return [{ player, distance: distance(car.transform.position, ball) }];
      })
      .sort((left, right) => left.distance - right.distance);
    const contact = contacts[0];
    return contact && contact.distance <= TOUCH_DISTANCE ? contact.player.id : null;
  }

  private recordTouchOutcome(
    episode: {
      readonly playerId: string;
      readonly team: TeamId;
      readonly intent: string;
      readonly defensive: boolean;
      readonly beforeProgress: number;
      readonly beforeVelocity: Vec3;
      readonly ballX: number;
      readonly ballZ: number;
      readonly approachAlignment: number;
      readonly aerial: boolean;
    },
    frame: AuthoritativeFrame,
  ): void {
    this.touches += 1;
    const direction = attackDirection(episode.team);
    const before = episode.beforeProgress;
    const afterVelocity = frame.snapshot.ball.linearVelocity;
    const after = afterVelocity.z * direction;
    const impactSpeed = length(sub(afterVelocity, episode.beforeVelocity));
    const outgoingSpeed = length(afterVelocity);
    const productive = after > before || after >= PRODUCTIVE_FORWARD_SPEED;
    const hard = impactSpeed >= HARD_TOUCH_MINIMUM_IMPULSE_SPEED
      && outgoingSpeed >= HARD_TOUCH_MINIMUM_OUTGOING_SPEED;
    const clear = episode.defensive && after > DEFENSIVE_CLEAR_FORWARD_SPEED;
    if (clear) this.defensiveClearTicks.set(episode.playerId, frame.snapshot.tick);
    if (productive) this.productiveTouches += 1;
    else this.harmfulTouches += 1;
    if (hard) this.hardTouches += 1;
    if (hard && productive) this.productiveHardTouches += 1;
    this.touchImpulseSpeedTotal += impactSpeed;
    this.postTouchBallSpeedTotal += outgoingSpeed;
    if (episode.aerial) {
      this.aerialTouches += 1;
      if (productive) this.productiveAerialTouches += 1;
    } else {
      this.groundTouches += 1;
    }
    const shot = shotTrajectory(frame, episode.team);
    this.touchOutcomes.push({
      playerId: episode.playerId,
      team: episode.team,
      intent: episode.intent,
      defensive: episode.defensive,
      productive,
      hard,
      clear,
      beforeProgress: before,
      afterProgress: after,
      impactSpeed,
      outgoingSpeed,
      ballX: episode.ballX,
      ballZ: episode.ballZ,
      approachAlignment: episode.approachAlignment,
      onTarget: shot?.onTarget ?? false,
    });
    if (shot) {
      this.shotAttempts += 1;
      this.shotAlignmentTotal += shot.alignment;
      if (shot.onTarget) this.shotsOnTarget += 1;
      if (episode.aerial) {
        this.aerialShotAttempts += 1;
        if (shot.onTarget) this.aerialShotsOnTarget += 1;
      }
    }
  }

  private observeAlignedApproaches(frame: AuthoritativeFrame, toucherId: string | null): void {
    const ball = frame.snapshot.ball.transform.position;
    const tacticalStates = this.session.tacticalStates();
    this.session.players.forEach((player) => {
      const car = frame.cars[player.id];
      if (!car) return;
      const plan = tacticalStates.get(player.id);
      const toBall = normalize({
        x: ball.x - car.transform.position.x,
        y: 0,
        z: ball.z - car.transform.position.z,
      });
      const forward = rotateVector(car.transform.rotation, { x: 0, y: 0, z: -1 });
      const ballDistance = distance(car.transform.position, ball);
      const alignedAndClose = car.grounded
        && this.kickoffWindowTicks === 0
        && plan?.intent === 'challenge'
        && plan.challengeAllowed
        && ball.y < AERIAL_BALL_HEIGHT
        && ballDistance <= TOUCH_DISTANCE + 0.9
        && dot(forward, toBall) > 0.72;
      if (alignedAndClose && !this.activeApproaches.has(player.id)) {
        this.activeApproaches.add(player.id);
        this.alignedApproaches += 1;
        const direction = attackDirection(player.team);
        const defensive = ball.z * direction < -ARENA_TUNING.halfLength * 0.12
          || frame.snapshot.ball.linearVelocity.z * direction < -4;
        const speed = Math.hypot(car.linearVelocity.x, car.linearVelocity.z);
        this.groundApproachStarts.set(player.id, {
          startedTick: frame.snapshot.tick,
          distance: ballDistance,
          alignment: dot(forward, toBall),
          speed,
          closingSpeed: dot(car.linearVelocity, toBall),
          ballSpeed: Math.hypot(
            frame.snapshot.ball.linearVelocity.x,
            frame.snapshot.ball.linearVelocity.z,
          ),
          boost: car.boost,
          confidence: plan.confidence,
          arrivalSeconds: plan.arrivalSeconds,
          opponentArrivalSeconds: plan.opponentArrivalSeconds,
          defensive,
        });
        if (defensive) {
          this.defensiveApproachesByPlayer.add(player.id);
          this.defensiveApproaches += 1;
        }
      }
      if (
        toucherId === player.id
        && this.activeApproaches.has(player.id)
        && !this.touchedApproaches.has(player.id)
      ) {
        this.touchedApproaches.add(player.id);
      }
      const approach = this.groundApproachStarts.get(player.id);
      const clearTick = this.defensiveClearTicks.get(player.id);
      if (
        this.defensiveApproachesByPlayer.has(player.id)
        && !this.successfulDefensiveApproachesByPlayer.has(player.id)
        && clearTick !== undefined
        && approach
        && clearTick >= approach.startedTick
      ) {
        this.successfulDefensiveApproachesByPlayer.add(player.id);
        this.successfulDefensiveApproaches += 1;
      }
      if (ballDistance <= TOUCH_DISTANCE + 2.5 || !this.activeApproaches.has(player.id)) return;
      const success = this.touchedApproaches.has(player.id);
      if (!success) this.alignedApproachMisses += 1;
      const start = this.groundApproachStarts.get(player.id);
      if (start) this.groundApproachOutcomes.push({ ...start, success });
      this.activeApproaches.delete(player.id);
      this.touchedApproaches.delete(player.id);
      this.defensiveApproachesByPlayer.delete(player.id);
      this.successfulDefensiveApproachesByPlayer.delete(player.id);
      this.defensiveClearTicks.delete(player.id);
      this.groundApproachStarts.delete(player.id);
    });
  }
}

const attackDirection = (team: TeamId): number => team === 'azure' ? -1 : 1;

const shotTrajectory = (
  frame: AuthoritativeFrame,
  team: TeamId,
): { readonly alignment: number; readonly onTarget: boolean } | null => {
  const ball = frame.snapshot.ball;
  const goal = GOALS.find(({ teamScored }) => teamScored === team);
  if (!goal) return null;
  const progress = ball.linearVelocity.z * attackDirection(team);
  if (progress <= 1) return null;
  const toGoal = normalize(sub(goal.center, ball.transform.position));
  const horizontalVelocityLength = Math.hypot(ball.linearVelocity.x, ball.linearVelocity.z);
  const alignment = horizontalVelocityLength <= 0.001
    ? -1
    : (
      ball.linearVelocity.x * toGoal.x + ball.linearVelocity.z * toGoal.z
    ) / horizontalVelocityLength;
  const seconds = (goal.center.z - ball.transform.position.z) / ball.linearVelocity.z;
  const crossingX = ball.transform.position.x + ball.linearVelocity.x * seconds;
  const usableHalfWidth = ARENA_TUNING.goalHalfWidth - BALL_TUNING.radius - 0.5;
  return {
    alignment,
    onTarget: seconds > 0 && seconds <= 8 && Math.abs(crossingX) <= usableHalfWidth,
  };
};

const isActive = (frame: AuthoritativeFrame): boolean => frame.snapshot.match.phase === 'playing';

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
};

const evaluationRandomSeed = (): number => {
  const configured = process.env.BOT_EVALUATION_RANDOM_SEED;
  if (configured === undefined) return DEFAULT_EVALUATION_RANDOM_SEED;
  const seed = Number(configured);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error(`BOT_EVALUATION_RANDOM_SEED must be an unsigned 32-bit integer; received ${configured}`);
  }
  return seed;
};

const round = (value: number): number => Number(value.toFixed(3));

const summarizeAerialAttempts = (
  outcomes: readonly {
    readonly playerId: string;
    readonly success: boolean;
    readonly horizontalDistance: number;
    readonly distance: number;
    readonly ballHeight: number;
    readonly ballVerticalSpeed: number;
    readonly boost: number;
    readonly carSpeed: number;
    readonly ballHorizontalSpeed: number;
    readonly approachAlignment: number;
    readonly forwardAlignment: number;
    readonly confidence: number;
    readonly arrivalSeconds: number;
    readonly opponentArrivalSeconds: number;
    readonly closestDistance: number;
    readonly maxCarHeight: number;
    readonly resolutionTicks: number;
    readonly landedWithoutContact: boolean;
  }[],
) => {
  const summarize = (success: boolean): Readonly<Record<string, number>> => {
    const matches = outcomes.filter((outcome) => outcome.success === success);
    const mean = (value: (outcome: typeof matches[number]) => number): number => round(
      matches.reduce((total, outcome) => total + value(outcome), 0) / Math.max(1, matches.length),
    );
    return {
      attempts: matches.length,
      meanHorizontalDistance: mean((outcome) => outcome.horizontalDistance),
      meanDistance: mean((outcome) => outcome.distance),
      meanBallHeight: mean((outcome) => outcome.ballHeight),
      meanBallVerticalSpeed: mean((outcome) => outcome.ballVerticalSpeed),
      meanBoost: mean((outcome) => outcome.boost),
      meanCarSpeed: mean((outcome) => outcome.carSpeed),
      meanBallHorizontalSpeed: mean((outcome) => outcome.ballHorizontalSpeed),
      meanApproachAlignment: mean((outcome) => outcome.approachAlignment),
      meanForwardAlignment: mean((outcome) => outcome.forwardAlignment),
      meanConfidence: mean((outcome) => outcome.confidence),
      meanArrivalSeconds: mean((outcome) => outcome.arrivalSeconds),
      meanOpponentArrivalSeconds: mean((outcome) => outcome.opponentArrivalSeconds),
      meanClosestDistance: mean((outcome) => outcome.closestDistance),
      meanMaxCarHeight: mean((outcome) => outcome.maxCarHeight),
      meanResolutionTicks: mean((outcome) => outcome.resolutionTicks),
      landedWithoutContact: matches.filter((outcome) => outcome.landedWithoutContact).length,
    };
  };
  return {
    successful: summarize(true),
    failed: summarize(false),
    samples: outcomes.map((outcome) => ({
      playerId: outcome.playerId,
      success: outcome.success,
      horizontalDistance: round(outcome.horizontalDistance),
      distance: round(outcome.distance),
      ballHeight: round(outcome.ballHeight),
      ballVerticalSpeed: round(outcome.ballVerticalSpeed),
      boost: round(outcome.boost),
      carSpeed: round(outcome.carSpeed),
      ballHorizontalSpeed: round(outcome.ballHorizontalSpeed),
      approachAlignment: round(outcome.approachAlignment),
      forwardAlignment: round(outcome.forwardAlignment),
      confidence: round(outcome.confidence),
      arrivalSeconds: round(outcome.arrivalSeconds),
      opponentArrivalSeconds: round(outcome.opponentArrivalSeconds),
      closestDistance: round(outcome.closestDistance),
      maxCarHeight: round(outcome.maxCarHeight),
      resolutionTicks: outcome.resolutionTicks,
      landedWithoutContact: outcome.landedWithoutContact,
    })),
  };
};

const summarizeGroundApproaches = (
  outcomes: readonly {
    readonly success: boolean;
    readonly distance: number;
    readonly alignment: number;
    readonly speed: number;
    readonly closingSpeed: number;
    readonly ballSpeed: number;
    readonly boost: number;
    readonly confidence: number;
    readonly arrivalSeconds: number;
    readonly opponentArrivalSeconds: number;
    readonly defensive: boolean;
  }[],
) => {
  const summarize = (success: boolean): Readonly<Record<string, number>> => {
    const matches = outcomes.filter((outcome) => outcome.success === success);
    const mean = (value: (outcome: typeof matches[number]) => number): number => round(
      matches.reduce((total, outcome) => total + value(outcome), 0) / Math.max(1, matches.length),
    );
    return {
      attempts: matches.length,
      meanDistance: mean((outcome) => outcome.distance),
      meanAlignment: mean((outcome) => outcome.alignment),
      meanSpeed: mean((outcome) => outcome.speed),
      meanClosingSpeed: mean((outcome) => outcome.closingSpeed),
      meanBallSpeed: mean((outcome) => outcome.ballSpeed),
      meanBoost: mean((outcome) => outcome.boost),
      meanConfidence: mean((outcome) => outcome.confidence),
      meanArrivalSeconds: mean((outcome) => outcome.arrivalSeconds),
      meanOpponentArrivalSeconds: mean((outcome) => outcome.opponentArrivalSeconds),
      defensiveAttempts: matches.filter((outcome) => outcome.defensive).length,
    };
  };
  return {
    successful: summarize(true),
    failed: summarize(false),
    samples: outcomes.map((outcome) => ({
      ...outcome,
      distance: round(outcome.distance),
      alignment: round(outcome.alignment),
      speed: round(outcome.speed),
      closingSpeed: round(outcome.closingSpeed),
      ballSpeed: round(outcome.ballSpeed),
      boost: round(outcome.boost),
      confidence: round(outcome.confidence),
      arrivalSeconds: round(outcome.arrivalSeconds),
      opponentArrivalSeconds: round(outcome.opponentArrivalSeconds),
    })),
  };
};

const summarizeTouchOutcomes = (
  outcomes: readonly {
    readonly playerId: string;
    readonly team: TeamId;
    readonly intent: string;
    readonly defensive: boolean;
    readonly productive: boolean;
    readonly hard: boolean;
    readonly clear: boolean;
    readonly beforeProgress: number;
    readonly afterProgress: number;
    readonly impactSpeed: number;
    readonly outgoingSpeed: number;
    readonly ballX: number;
    readonly ballZ: number;
    readonly approachAlignment: number;
    readonly onTarget: boolean;
  }[],
) => {
  const summarize = (matches: typeof outcomes) => ({
    touches: matches.length,
    productiveTouches: matches.filter(({ productive }) => productive).length,
    productiveRate: round(
      matches.filter(({ productive }) => productive).length / Math.max(1, matches.length),
    ),
    hardTouches: matches.filter(({ hard }) => hard).length,
    hardTouchRate: round(
      matches.filter(({ hard }) => hard).length / Math.max(1, matches.length),
    ),
    productiveHardTouches: matches.filter(({ hard, productive }) => hard && productive).length,
    productiveHardTouchRate: round(
      matches.filter(({ hard, productive }) => hard && productive).length
        / Math.max(1, matches.length),
    ),
    meanImpactSpeed: round(matches.reduce(
      (total, outcome) => total + outcome.impactSpeed,
      0,
    ) / Math.max(1, matches.length)),
    meanOutgoingSpeed: round(matches.reduce(
      (total, outcome) => total + outcome.outgoingSpeed,
      0,
    ) / Math.max(1, matches.length)),
    defensiveTouches: matches.filter(({ defensive }) => defensive).length,
    clears: matches.filter(({ clear }) => clear).length,
    shotsOnTarget: matches.filter(({ onTarget }) => onTarget).length,
    meanProgressChange: round(matches.reduce(
      (total, outcome) => total + outcome.afterProgress - outcome.beforeProgress,
      0,
    ) / Math.max(1, matches.length)),
  });
  const intents = [...new Set(outcomes.map(({ intent }) => intent))];
  return {
    overall: summarize(outcomes),
    byIntent: Object.fromEntries(intents.map((intent) => [
      intent,
      summarize(outcomes.filter((outcome) => outcome.intent === intent)),
    ])),
    samples: outcomes.map((outcome) => ({
      ...outcome,
      beforeProgress: round(outcome.beforeProgress),
      afterProgress: round(outcome.afterProgress),
      impactSpeed: round(outcome.impactSpeed),
      outgoingSpeed: round(outcome.outgoingSpeed),
      ballX: round(outcome.ballX),
      ballZ: round(outcome.ballZ),
      approachAlignment: round(outcome.approachAlignment),
    })),
  };
};

const sanitizeLabel = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'latest';
