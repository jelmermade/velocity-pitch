import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNTIME_CONFIG } from '../../src/app/RuntimeConfig';
import { BALL_TUNING } from '../../src/core/config/BallTuning';
import { MATCH_TUNING } from '../../src/core/config/MatchTuning';
import { EventBus } from '../../src/core/events/EventBus';
import type { GameEventMap } from '../../src/core/events/GameEvents';
import { rotateVector } from '../../src/core/math/Quaternion';
import { distance, dot, length, normalize, sub } from '../../src/core/math/Vector3';
import { GameSimulation } from '../../src/gameplay/simulation/GameSimulation';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../src/input/PlayerCommand';
import { BotTrainingSession } from '../../src/networking/BotTrainingSession';
import type { AuthoritativeFrame, TeamId } from '../../src/networking/LobbyProtocol';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';
import { BotKnowledgeFileStore } from '../../server/BotKnowledgeFileStore';

const STEP_SECONDS = 1 / RUNTIME_CONFIG.physicsHz;
const MAXIMUM_TICKS = RUNTIME_CONFIG.physicsHz * 600;
const TOUCH_DISTANCE = BALL_TUNING.radius + 3;
const AERIAL_BALL_HEIGHT = BALL_TUNING.radius + 1.25;
const KICKOFF_EVALUATION_TICKS = RUNTIME_CONFIG.physicsHz * 12;

describe('five-minute bot match evaluation', () => {
  it('records comparable gameplay and learning metrics', async () => {
    const world = await RapierPhysicsWorld.create();
    const knowledgeStore = new BotKnowledgeFileStore();
    const startingKnowledge = await knowledgeStore.load();
    const session = new BotTrainingSession(startingKnowledge);
    const simulation = new GameSimulation(
      world,
      new EventBus<GameEventMap>(),
      session.players,
      session.localPlayerId,
    );
    const metrics = new EvaluationMetrics(session);
    let tick = 0;
    let regulationComplete = false;

    try {
      while (tick < MAXIMUM_TICKS) {
        const frame = simulation.authoritativeFrame(tick);
        const commands = session.commandsForTick(tick, NEUTRAL_COMMAND, frame);
        metrics.observe(frame, commands);
        simulation.updatePlayers(commands, STEP_SECONDS);
        tick += 1;
        if (simulation.snapshot(1).match.timeRemaining <= 0) {
          regulationComplete = true;
          break;
        }
      }

      const finalFrame = simulation.authoritativeFrame(tick);
      const matchReport = metrics.report(finalFrame, session.trainingState(), tick, regulationComplete);
      const learnedKnowledge = session.learnedKnowledge();
      const label = sanitizeLabel(process.env.BOT_EVALUATION_LABEL ?? 'latest');
      const directory = resolve(process.cwd(), 'data');
      const outputPath = resolve(directory, `bot-evaluation-${label}.json`);
      await mkdir(directory, { recursive: true });
      expect(regulationComplete).toBe(true);
      expect(matchReport.regulationSeconds).toBeCloseTo(MATCH_TUNING.durationSeconds, 0);
      expect(matchReport.bots).toHaveLength(6);
      expect(Number.isFinite(matchReport.averageNearestTeammateDistance)).toBe(true);
      expect(Number.isFinite(matchReport.jumpsPerBotMinute)).toBe(true);
      expect(Number.isFinite(matchReport.recoveryDowntimePerBotSeconds)).toBe(true);
      expect(Number.isFinite(matchReport.reverseBotSeconds)).toBe(true);
      expect(Number.isFinite(matchReport.jumpContactConversionRate)).toBe(true);
      expect(Number.isFinite(matchReport.powerslideBotSeconds)).toBe(true);
      expect(Number.isFinite(matchReport.unstableBoostBotSeconds)).toBe(true);
      expect(Number.isFinite(matchReport.netBotReward)).toBe(true);
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
  private jumpActions = 0;
  private aerialAttempts = 0;
  private aerialTouches = 0;
  private productiveAerialTouches = 0;
  private aerialBoostTicks = 0;
  private boostTicks = 0;
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
  private readonly activeApproaches = new Set<string>();
  private readonly touchedApproaches = new Set<string>();
  private readonly contactJumps = new Map<string, { readonly tick: number; readonly aerial: boolean }>();

  constructor(private readonly session: BotTrainingSession) {}

  observe(frame: AuthoritativeFrame, commands: ReadonlyMap<string, PlayerCommand>): void {
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
      this.previous = frame;
      return;
    }
    this.kickoffWindowTicks = Math.max(0, this.kickoffWindowTicks - 1);
    this.activeTicks += 1;
    commands.forEach((command, playerId) => {
      if (command.jumpPressed) this.jumpActions += 1;
      if (command.boost) this.boostTicks += 1;
      const car = frame.cars[playerId];
      if (!car) return;
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
    if (this.previous && isActive(this.previous)) {
      this.ballTravel += distance(
        this.previous.snapshot.ball.transform.position,
        frame.snapshot.ball.transform.position,
      );
      const toucherId = this.observeTouch(this.previous, frame);
      if (toucherId && this.contactJumps.delete(toucherId)) this.successfulContactJumps += 1;
      this.resolveContactJumps(frame);
      this.trackContactJumps(frame, commands);
      this.observeAlignedApproaches(frame, toucherId);
    }
    this.previous = frame;
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
      schemaVersion: 1,
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
      ballTravel: round(this.ballTravel),
      jumpActions: this.jumpActions,
      jumpsPerBotMinute: round(this.jumpActions / botCount / Math.max(1, activePlaySeconds / 60)),
      aerialAttempts: this.aerialAttempts,
      aerialTouches: this.aerialTouches,
      productiveAerialTouches: this.productiveAerialTouches,
      aerialTouchRate: round(this.productiveAerialTouches / Math.max(1, this.aerialTouches)),
      aerialAttemptConversionRate: round(this.aerialTouches / Math.max(1, this.aerialAttempts)),
      productiveAerialAttemptRate: round(this.productiveAerialTouches / Math.max(1, this.aerialAttempts)),
      aerialBoostBotSeconds: round(this.aerialBoostTicks * STEP_SECONDS),
      boostBotSeconds: round(this.boostTicks * STEP_SECONDS),
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
      netBotReward: round(training.entries.reduce((total, bot) => total + bot.points, 0)),
      kickoffs: this.kickoffs,
      kickoffGoals: this.kickoffGoals,
      kickoffGoalRate: round(this.kickoffGoals / Math.max(1, this.kickoffs)),
      alignedApproaches: this.alignedApproaches,
      alignedApproachMisses: this.alignedApproachMisses,
      alignedApproachConversionRate: round(
        (this.alignedApproaches - this.alignedApproachMisses) / Math.max(1, this.alignedApproaches),
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

  private trackContactJumps(
    frame: AuthoritativeFrame,
    commands: ReadonlyMap<string, PlayerCommand>,
  ): void {
    commands.forEach((command, playerId) => {
      if (!command.jumpPressed || this.contactJumps.has(playerId)) return;
      const car = frame.cars[playerId];
      if (!car?.grounded || distance(car.transform.position, frame.snapshot.ball.transform.position) > 30) return;
      const up = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
      if (up.y <= 0.55) return;
      this.contactJumps.set(playerId, {
        tick: frame.snapshot.tick,
        aerial: frame.snapshot.ball.transform.position.y > AERIAL_BALL_HEIGHT,
      });
    });
  }

  private resolveContactJumps(frame: AuthoritativeFrame): void {
    this.contactJumps.forEach((attempt, playerId) => {
      const car = frame.cars[playerId];
      const age = frame.snapshot.tick - attempt.tick;
      const timeout = attempt.aerial ? 120 : 60;
      if (age < timeout && !(age > 12 && car?.grounded)) return;
      this.failedContactJumps += 1;
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

  private observeTouch(previous: AuthoritativeFrame, frame: AuthoritativeFrame): string | null {
    const velocityChange = length(sub(frame.snapshot.ball.linearVelocity, previous.snapshot.ball.linearVelocity));
    if (velocityChange < 1.35) return null;
    const ball = frame.snapshot.ball.transform.position;
    const closest = this.session.players
      .flatMap((player) => {
        const car = frame.cars[player.id];
        return car ? [{ player, distance: distance(car.transform.position, ball) }] : [];
      })
      .sort((left, right) => left.distance - right.distance)[0];
    if (!closest || closest.distance > TOUCH_DISTANCE) return null;
    this.touches += 1;
    const direction = attackDirection(closest.player.team);
    const before = previous.snapshot.ball.linearVelocity.z * direction;
    const after = frame.snapshot.ball.linearVelocity.z * direction;
    const productive = after > before;
    if (productive) this.productiveTouches += 1;
    else this.harmfulTouches += 1;
    const car = frame.cars[closest.player.id];
    if (car && !car.grounded && ball.y > AERIAL_BALL_HEIGHT) {
      this.aerialTouches += 1;
      if (productive) this.productiveAerialTouches += 1;
    }
    return closest.player.id;
  }

  private observeAlignedApproaches(frame: AuthoritativeFrame, toucherId: string | null): void {
    const ball = frame.snapshot.ball.transform.position;
    this.session.players.forEach((player) => {
      const car = frame.cars[player.id];
      if (!car) return;
      const toBall = normalize({
        x: ball.x - car.transform.position.x,
        y: 0,
        z: ball.z - car.transform.position.z,
      });
      const forward = rotateVector(car.transform.rotation, { x: 0, y: 0, z: -1 });
      const ballDistance = distance(car.transform.position, ball);
      const alignedAndClose = car.grounded
        && ball.y < AERIAL_BALL_HEIGHT
        && ballDistance <= TOUCH_DISTANCE + 0.9
        && dot(forward, toBall) > 0.72;
      if (alignedAndClose && !this.activeApproaches.has(player.id)) {
        this.activeApproaches.add(player.id);
        this.alignedApproaches += 1;
      }
      if (toucherId === player.id && this.activeApproaches.has(player.id)) {
        this.touchedApproaches.add(player.id);
      }
      if (ballDistance <= TOUCH_DISTANCE + 2.5 || !this.activeApproaches.has(player.id)) return;
      if (!this.touchedApproaches.has(player.id)) this.alignedApproachMisses += 1;
      this.activeApproaches.delete(player.id);
      this.touchedApproaches.delete(player.id);
    });
  }
}

const attackDirection = (team: TeamId): number => team === 'azure' ? -1 : 1;

const isActive = (frame: AuthoritativeFrame): boolean => frame.snapshot.match.phase === 'playing';

const round = (value: number): number => Number(value.toFixed(3));

const sanitizeLabel = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'latest';
