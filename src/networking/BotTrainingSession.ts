import { ARENA_TUNING } from '../core/config/ArenaTuning';
import { BALL_TUNING } from '../core/config/BallTuning';
import { DEFAULT_CAR_TUNING } from '../core/config/CarTuning';
import { distance, dot, length, normalize, sub } from '../core/math/Vector3';
import { rotateVector } from '../core/math/Quaternion';
import { BotController } from '../gameplay/bots/BotController';
import { BotTeamCoordinator, type BotTacticalPlan } from '../gameplay/bots/BotTeamCoordinator';
import {
  BOT_POLICY_ORDER,
  BOT_TECHNIQUE_KINDS,
  BOT_TECHNIQUE_ORDER,
  BUILT_IN_BOT_KNOWLEDGE,
  createEmptyBotKnowledgeObservations,
  mergeBotKnowledge,
  type BotKnowledge,
  type BotKnowledgeObservations,
} from '../gameplay/bots/BotKnowledge';
import { botRole, createBotTrainingRoster } from '../gameplay/bots/BotRoster';
import type { BotTrainingState } from '../gameplay/bots/BotTrainingState';
import { GOALS } from '../gameplay/arena/ArenaDefinition';
import type { PlayerCommand } from '../input/PlayerCommand';
import type { GameSession } from './GameSession';
import type { AuthoritativeFrame, LobbyPlayer, TeamId } from './LobbyProtocol';

const TOUCH_DISTANCE = BALL_TUNING.radius + 3;
const AERIAL_BALL_HEIGHT = BALL_TUNING.radius + 1.25;
const SUPPORT_MINIMUM_DISTANCE = 8;
const SUPPORT_MAXIMUM_DISTANCE = 24;
const KICKOFF_REWARD_TICKS = 60 * 12;
const GROUND_ATTEMPT_TIMEOUT_TICKS = 60;
const AERIAL_ATTEMPT_TIMEOUT_TICKS = 150;
const GROUND_APPROACH_EXIT_DISTANCE = TOUCH_DISTANCE + 3;
const HARD_HIT_TARGET_IMPULSE_SPEED = 20;
const HARD_HIT_TARGET_FORWARD_SPEED = 24;

interface ContactAttempt {
  readonly startedTick: number;
  readonly aerial: boolean;
}

interface GroundApproach {
  readonly startedTick: number;
  readonly boosted: boolean;
}

export class BotTrainingSession implements GameSession {
  readonly players: readonly LobbyPlayer[];
  readonly localPlayerId: string;
  readonly authoritative = true;
  private readonly bots: ReadonlyMap<string, BotController>;
  private readonly lastRewards = new Map<string, number>();
  private readonly contactAttempts = new Map<string, ContactAttempt>();
  private readonly groundApproaches = new Map<string, GroundApproach>();
  private previousCommands: ReadonlyMap<string, PlayerCommand> = new Map();
  private previousFrame: AuthoritativeFrame | null = null;
  private lastTouchPlayerId: string | null = null;
  private lastTouchWasAerial = false;
  private kickoffRewardUntilTick = -1;
  private persistedObservationCount = 0;
  private pendingPersistence: Promise<unknown> = Promise.resolve();
  private tick = 0;

  constructor(
    private readonly knowledge: BotKnowledge = BUILT_IN_BOT_KNOWLEDGE,
    private readonly onKnowledge?: (observations: BotKnowledgeObservations) => unknown,
    random: () => number = Math.random,
  ) {
    this.players = createBotTrainingRoster(random);
    this.localPlayerId = this.players[0]?.id ?? 'bot-azure-0';
    const coordinators = new Map((['azure', 'coral'] as const).map((team) => [
      team,
      new BotTeamCoordinator(
        team,
        this.players.filter((player) => player.team === team).map(({ id }) => id),
        this.players.filter((player) => player.team !== team).map(({ id }) => id),
      ),
    ] as const));
    this.bots = new Map(this.players.map((player) => [
      player.id,
      new BotController(
        player.id,
        player.team,
        botRole(player),
        true,
        knowledge,
        this.players.filter(({ team }) => team === player.team).map(({ id }) => id),
        coordinators.get(player.team),
      ),
    ]));
  }

  commandsForTick(
    tick: number,
    localCommand: PlayerCommand,
    observedFrame?: AuthoritativeFrame,
  ): ReadonlyMap<string, PlayerCommand> {
    this.tick = tick;
    if (observedFrame) {
      this.updateLearning(observedFrame, tick);
      if (observedFrame.snapshot.match.phase === 'ended') this.persistKnowledge();
    }
    const commands = new Map<string, PlayerCommand>();
    this.bots.forEach((bot, playerId) => {
      const command = observedFrame ? bot.command(observedFrame, tick) : localCommand;
      commands.set(playerId, playerId === this.localPlayerId
        ? { ...command, togglePause: localCommand.togglePause }
        : command);
    });
    if (observedFrame) this.trackContactAttempts(observedFrame, commands, tick);
    this.previousCommands = commands;
    return commands;
  }

  isAerialActive(playerId: string): boolean {
    return this.bots.get(playerId)?.isAerialActive() ?? false;
  }

  trainingState(): BotTrainingState {
    return {
      tick: this.tick,
      knowledgeGeneration: this.knowledge.generation,
      entries: this.players.map((player) => {
        const learning = this.bots.get(player.id)?.learningState();
        return {
          playerId: player.id,
          playerName: player.name.replace(' [BOT]', ''),
          team: player.team,
          role: botRole(player),
          points: learning?.points ?? 0,
          policy: learning?.policy ?? 'balanced',
          policyValue: learning?.policyValue ?? 0,
          policyValues: learning?.policyValues ?? { balanced: 0, press: 0, rotate: 0 },
          policySamples: learning?.policySamples ?? { balanced: 0, press: 0, rotate: 0 },
          techniques: learning?.techniques ?? { ground: 'balanced', aerial: 'balanced' },
          techniqueValues: learning?.techniqueValues ?? {
            ground: { balanced: 0, safe: 0, aggressive: 0 },
            aerial: { balanced: 0, safe: 0, aggressive: 0 },
          },
          techniqueSamples: learning?.techniqueSamples ?? {
            ground: { balanced: 0, safe: 0, aggressive: 0 },
            aerial: { balanced: 0, safe: 0, aggressive: 0 },
          },
          lastReward: Number((this.lastRewards.get(player.id) ?? 0).toFixed(2)),
        };
      }),
    };
  }

  tacticalStates(): ReadonlyMap<string, BotTacticalPlan> {
    return new Map([...this.bots]
      .flatMap(([playerId, bot]) => {
        const state = bot.tacticalState();
        return state ? [[playerId, state] as const] : [];
      }));
  }

  publish(frame: AuthoritativeFrame): void { void frame; }
  latestFrame(): AuthoritativeFrame | null { return null; }
  dispose(): void { this.persistKnowledge(); }

  async flushKnowledge(): Promise<void> {
    this.persistKnowledge();
    await this.pendingPersistence;
  }

  learnedKnowledge(updatedAt?: string): BotKnowledge {
    return mergeBotKnowledge(this.knowledge, this.knowledgeObservations(), updatedAt);
  }

  knowledgeObservations(): BotKnowledgeObservations {
    const observations = createEmptyBotKnowledgeObservations();
    this.players.forEach((player) => {
      const role = botRole(player);
      const botObservations = this.bots.get(player.id)?.learningObservations();
      if (!botObservations) return;
      BOT_POLICY_ORDER.forEach((policy) => {
        const current = observations[role][policy];
        const next = botObservations[policy];
        observations[role][policy] = {
          totalValue: current.totalValue + next.totalValue,
          samples: current.samples + next.samples,
        };
      });
      const techniqueObservations = this.bots.get(player.id)?.techniqueObservations();
      if (!techniqueObservations) return;
      BOT_TECHNIQUE_KINDS.forEach((kind) => BOT_TECHNIQUE_ORDER.forEach((technique) => {
        const current = observations.techniques[kind][technique];
        const next = techniqueObservations[kind][technique];
        observations.techniques[kind][technique] = {
          totalValue: current.totalValue + next.totalValue,
          samples: current.samples + next.samples,
        };
      }));
    });
    return observations;
  }

  private persistKnowledge(): void {
    if (!this.onKnowledge) return;
    const observationCount = [...this.bots.values()].reduce((total, bot) => (
      total + BOT_POLICY_ORDER.reduce((botTotal, policy) => (
        botTotal + bot.learningObservations()[policy].samples
      ), 0) + BOT_TECHNIQUE_KINDS.reduce((kindTotal, kind) => (
        kindTotal + BOT_TECHNIQUE_ORDER.reduce((techniqueTotal, technique) => (
          techniqueTotal + bot.techniqueObservations()[kind][technique].samples
        ), 0)
      ), 0)
    ), 0);
    if (observationCount <= this.persistedObservationCount) return;
    const observations = this.knowledgeObservations();
    this.pendingPersistence = this.pendingPersistence.then(() => this.onKnowledge?.(observations));
    this.persistedObservationCount = observationCount;
  }

  private updateLearning(frame: AuthoritativeFrame, tick: number): void {
    const rewards = new Map(this.players.map(({ id }) => [id, 0]));
    const previous = this.previousFrame;
    if (previous?.snapshot.match.phase === 'countdown' && frame.snapshot.match.phase === 'playing') {
      this.kickoffRewardUntilTick = tick + KICKOFF_REWARD_TICKS;
    }
    if (previous) {
      this.rewardGoals(previous, frame, rewards);
      this.rewardDemolition(previous, frame, rewards);
      if (isActive(previous) && isActive(frame)) {
        this.rewardBallProgress(previous, frame, rewards);
        this.rewardApproach(previous, frame, rewards);
        this.rewardEfficientGroundBoost(previous, frame, rewards);
        this.rewardPositioning(frame, rewards);
        this.rewardAerialPlay(previous, frame, rewards);
        this.penalizeRecoveryDowntime(frame, rewards);
        this.penalizeReverseDriving(frame, rewards);
        this.rewardTouch(previous, frame, rewards);
        this.resolveMissedContactAttempts(frame, tick, rewards);
        this.resolveMissedGroundApproaches(frame, rewards);
      }
    }
    if (frame.snapshot.match.phase === 'countdown') {
      this.lastTouchPlayerId = null;
      this.lastTouchWasAerial = false;
      this.contactAttempts.clear();
      this.groundApproaches.clear();
    }
    if (frame.snapshot.match.phase === 'ended') {
      this.lastRewards.clear();
      this.previousFrame = frame;
      return;
    }
    this.bots.forEach((bot, playerId) => {
      const reward = rewards.get(playerId) ?? 0;
      this.lastRewards.set(playerId, reward);
      bot.reward(reward, tick);
    });
    this.previousFrame = frame;
  }

  private rewardDemolition(
    previous: AuthoritativeFrame,
    current: AuthoritativeFrame,
    rewards: Map<string, number>,
  ): void {
    const demolition = current.snapshot.demolition;
    if (!demolition || demolition.sequence === previous.snapshot.demolition?.sequence) return;
    addReward(rewards, demolition.attackerId, 8);
    addReward(rewards, demolition.victimId, -3);
  }

  private rewardGoals(
    previous: AuthoritativeFrame,
    current: AuthoritativeFrame,
    rewards: Map<string, number>,
  ): void {
    const azureGoal = current.snapshot.match.azureScore > previous.snapshot.match.azureScore;
    const coralGoal = current.snapshot.match.coralScore > previous.snapshot.match.coralScore;
    const scoringTeam = azureGoal ? 'azure' : coralGoal ? 'coral' : null;
    if (!scoringTeam) return;
    this.players.forEach((player) => {
      addReward(rewards, player.id, player.team === scoringTeam ? 20 : -25);
      if (player.team !== scoringTeam && botRole(player) === 'defender') addReward(rewards, player.id, -10);
      if (tickWithin(this.tick, this.kickoffRewardUntilTick)) {
        addReward(rewards, player.id, player.team === scoringTeam ? 10 : -20);
      }
    });
    const lastTouch = this.players.find(({ id }) => id === this.lastTouchPlayerId);
    if (lastTouch?.team === scoringTeam) {
      addReward(rewards, lastTouch.id, 70 + (this.lastTouchWasAerial ? 25 : 0));
    }
    else if (lastTouch) addReward(rewards, lastTouch.id, -40);
  }

  private rewardBallProgress(
    previous: AuthoritativeFrame,
    current: AuthoritativeFrame,
    rewards: Map<string, number>,
  ): void {
    for (const team of ['azure', 'coral'] as const) {
      const progress = (current.snapshot.ball.transform.position.z - previous.snapshot.ball.transform.position.z)
        * attackDirection(team);
      const teamPlayers = closestPlayers(this.players, current, team);
      const challenger = teamPlayers.find((player) => botRole(player) === 'striker') ?? teamPlayers[0];
      if (challenger) addReward(rewards, challenger.id, clamp(progress, -0.8, 0.8) * 0.18);
      const defender = teamPlayers.find((player) => botRole(player) === 'defender');
      const ballThreatening = current.snapshot.ball.transform.position.z * attackDirection(team) < 0;
      if (defender && ballThreatening) addReward(rewards, defender.id, clamp(progress, -0.8, 0.8) * 0.08);
    }
  }

  private rewardApproach(
    previous: AuthoritativeFrame,
    current: AuthoritativeFrame,
    rewards: Map<string, number>,
  ): void {
    for (const team of ['azure', 'coral'] as const) {
      const challenger = closestPlayers(this.players, current, team)
        .find((player) => botRole(player) === 'striker');
      if (!challenger) continue;
      const beforeCar = previous.cars[challenger.id];
      const afterCar = current.cars[challenger.id];
      if (!beforeCar || !afterCar) continue;
      const before = distance(beforeCar.transform.position, previous.snapshot.ball.transform.position);
      const after = distance(afterCar.transform.position, current.snapshot.ball.transform.position);
      addReward(rewards, challenger.id, clamp(before - after, -0.3, 0.3) * 0.1);
    }
  }

  private rewardEfficientGroundBoost(
    previous: AuthoritativeFrame,
    current: AuthoritativeFrame,
    rewards: Map<string, number>,
  ): void {
    const ball = current.snapshot.ball.transform.position;
    this.previousCommands.forEach((command, playerId) => {
      if (!command.boost) return;
      const beforeCar = previous.cars[playerId];
      const afterCar = current.cars[playerId];
      if (!beforeCar?.grounded || !afterCar?.grounded || !afterCar.boosting) return;
      const plan = this.bots.get(playerId)?.tacticalState();
      const pursuingPlay = plan?.intent === 'challenge' || plan?.intent === 'fake-challenge';
      if (!pursuingPlay) return;

      const beforeDistance = distance(
        beforeCar.transform.position,
        previous.snapshot.ball.transform.position,
      );
      const afterDistance = distance(afterCar.transform.position, ball);
      const distanceGain = beforeDistance - afterDistance;
      const toBall = normalize(sub(ball, afterCar.transform.position));
      const closingSpeed = dot(afterCar.linearVelocity, toBall);
      if (distanceGain <= 0 || closingSpeed <= 0) {
        addReward(rewards, playerId, -0.012);
        return;
      }

      const boostedSpeedFraction = clamp(
        (closingSpeed - DEFAULT_CAR_TUNING.maximumGroundDriveSpeed)
          / Math.max(
            0.1,
            DEFAULT_CAR_TUNING.maximumGroundBoostSpeed
              - DEFAULT_CAR_TUNING.maximumGroundDriveSpeed,
          ),
        0,
        1,
      );
      addReward(
        rewards,
        playerId,
        0.001 + clamp(distanceGain, 0, 0.5) * 0.012 + boostedSpeedFraction * 0.004,
      );
    });
  }

  private rewardPositioning(frame: AuthoritativeFrame, rewards: Map<string, number>): void {
    const ball = frame.snapshot.ball.transform.position;
    for (const team of ['azure', 'coral'] as const) {
      const ranked = closestPlayers(this.players, frame, team);
      const primaryStriker = ranked.find((player) => botRole(player) === 'striker');
      const primaryCar = primaryStriker ? frame.cars[primaryStriker.id] : undefined;
      for (const player of ranked) {
        const car = frame.cars[player.id];
        const ownGoal = GOALS.find(({ defendingTeam }) => defendingTeam === player.team);
        if (!car || !ownGoal) continue;
        if (botRole(player) === 'defender') {
          const ballThreatening = ball.z * attackDirection(player.team) < 0;
          const goalSide = distance(car.transform.position, ownGoal.center) < distance(ball, ownGoal.center);
          if (ballThreatening) addReward(rewards, player.id, goalSide ? 0.02 : -0.04);
          else if (distance(car.transform.position, ownGoal.center) < 35) addReward(rewards, player.id, 0.006);
          continue;
        }
        if (player.id === primaryStriker?.id || !primaryCar) continue;
        const teammateDistance = distance(car.transform.position, primaryCar.transform.position);
        const behindBall = (car.transform.position.z - ball.z) * attackDirection(player.team) < 0;
        if (behindBall && teammateDistance >= SUPPORT_MINIMUM_DISTANCE && teammateDistance <= SUPPORT_MAXIMUM_DISTANCE) {
          addReward(rewards, player.id, 0.008);
        } else if (player.distance < SUPPORT_MINIMUM_DISTANCE) {
          addReward(rewards, player.id, -0.025);
        }
      }
    }
  }

  private penalizeRecoveryDowntime(frame: AuthoritativeFrame, rewards: Map<string, number>): void {
    this.players.forEach((player) => {
      const car = frame.cars[player.id];
      if (!car) return;
      const up = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
      const stopped = car.transform.position.y < 2.2
        && Math.abs(car.linearVelocity.y) < 1
        && Math.hypot(car.linearVelocity.x, car.linearVelocity.z) < 0.65;
      if (stopped && up.y < 0.45) addReward(rewards, player.id, -0.03);
    });
  }

  private penalizeReverseDriving(frame: AuthoritativeFrame, rewards: Map<string, number>): void {
    this.previousCommands.forEach((command, playerId) => {
      const car = frame.cars[playerId];
      if (!car?.grounded || command.throttle >= -0.05) return;
      addReward(rewards, playerId, -0.012 * Math.abs(command.throttle));
    });
  }

  private rewardAerialPlay(
    previous: AuthoritativeFrame,
    current: AuthoritativeFrame,
    rewards: Map<string, number>,
  ): void {
    const ball = current.snapshot.ball.transform.position;
    if (ball.y < AERIAL_BALL_HEIGHT) return;
    this.players.forEach((player) => {
      const beforeCar = previous.cars[player.id];
      const afterCar = current.cars[player.id];
      if (!beforeCar || !afterCar || afterCar.grounded) return;
      const beforeDistance = distance(beforeCar.transform.position, previous.snapshot.ball.transform.position);
      const afterDistance = distance(afterCar.transform.position, ball);
      addReward(rewards, player.id, clamp(beforeDistance - afterDistance, -0.4, 0.4) * 0.14);
      if (!afterCar.boosting) return;
      const forward = rotateVector(afterCar.transform.rotation, { x: 0, y: 0, z: -1 });
      const toBall = normalize(sub(ball, afterCar.transform.position));
      addReward(rewards, player.id, dot(forward, toBall) > 0.72 ? 0.008 : -0.02);
    });
  }

  private rewardTouch(
    previous: AuthoritativeFrame,
    current: AuthoritativeFrame,
    rewards: Map<string, number>,
  ): void {
    const velocityChange = length(sub(current.snapshot.ball.linearVelocity, previous.snapshot.ball.linearVelocity));
    if (velocityChange < 1.35) return;
    const toucher = closestPlayers(this.players, current)[0];
    if (!toucher || toucher.distance > TOUCH_DISTANCE) return;
    this.lastTouchPlayerId = toucher.id;
    const toucherCar = current.cars[toucher.id];
    const groundApproach = this.groundApproaches.get(toucher.id);
    this.contactAttempts.delete(toucher.id);
    this.groundApproaches.delete(toucher.id);
    this.lastTouchWasAerial = Boolean(
      toucherCar
      && !toucherCar.grounded
      && current.snapshot.ball.transform.position.y >= AERIAL_BALL_HEIGHT
    );
    const beforeProgress = previous.snapshot.ball.linearVelocity.z * attackDirection(toucher.team);
    const afterProgress = current.snapshot.ball.linearVelocity.z * attackDirection(toucher.team);
    const improvement = afterProgress - beforeProgress;
    const impactPower = clamp(velocityChange / HARD_HIT_TARGET_IMPULSE_SPEED, 0, 1);
    const directedPower = clamp(afterProgress / HARD_HIT_TARGET_FORWARD_SPEED, 0, 1);
    const hardHitQuality = improvement > 0
      ? impactPower * 0.4 + directedPower * 0.6
      : -impactPower;
    addReward(
      rewards,
      toucher.id,
      improvement > 0 ? 3 + Math.min(6, improvement * 0.4) : -3 - Math.min(7, Math.abs(improvement) * 0.4),
    );
    addReward(rewards, toucher.id, hardHitQuality * 6);
    if (groundApproach?.boosted) {
      addReward(rewards, toucher.id, hardHitQuality >= 0.45 ? 1 + hardHitQuality * 3 : -1);
    }
    if (beforeProgress < -2 && afterProgress > 1) {
      addReward(rewards, toucher.id, botRole(toucher) === 'defender' ? 12 : 7);
    }
    if (this.lastTouchWasAerial) addReward(rewards, toucher.id, improvement > 0 ? 12 : -8);
    const techniqueQuality = clamp(
      shotTrajectoryQuality(current, toucher.team) * 0.4 + hardHitQuality * 0.6,
      -1,
      1,
    );
    this.bots.get(toucher.id)?.rewardTechnique(
      this.lastTouchWasAerial ? 'aerial' : 'ground',
      techniqueQuality,
    );
  }

  private trackContactAttempts(
    frame: AuthoritativeFrame,
    commands: ReadonlyMap<string, PlayerCommand>,
    tick: number,
  ): void {
    commands.forEach((command, playerId) => {
      if (!command.jumpPressed || this.contactAttempts.has(playerId)) return;
      const car = frame.cars[playerId];
      if (!car?.grounded) return;
      const up = rotateVector(car.transform.rotation, { x: 0, y: 1, z: 0 });
      const ballDistance = distance(car.transform.position, frame.snapshot.ball.transform.position);
      if (up.y <= 0.55 || ballDistance > 30) return;
      this.contactAttempts.set(playerId, {
        startedTick: tick,
        aerial: frame.snapshot.ball.transform.position.y >= AERIAL_BALL_HEIGHT,
      });
    });
    this.trackGroundApproaches(frame);
  }

  private resolveMissedContactAttempts(
    frame: AuthoritativeFrame,
    tick: number,
    rewards: Map<string, number>,
  ): void {
    this.contactAttempts.forEach((attempt, playerId) => {
      const car = frame.cars[playerId];
      const age = tick - attempt.startedTick;
      const timeout = attempt.aerial ? AERIAL_ATTEMPT_TIMEOUT_TICKS : GROUND_ATTEMPT_TIMEOUT_TICKS;
      const landedWithoutContact = age > 12 && car?.grounded;
      if (!landedWithoutContact && age < timeout) return;
      addReward(rewards, playerId, attempt.aerial ? -4 : -1.5);
      this.bots.get(playerId)?.rewardTechnique(attempt.aerial ? 'aerial' : 'ground', -1);
      this.contactAttempts.delete(playerId);
    });
  }

  private trackGroundApproaches(frame: AuthoritativeFrame): void {
    const ball = frame.snapshot.ball.transform.position;
    if (ball.y >= AERIAL_BALL_HEIGHT) return;
    this.players.forEach((player) => {
      if (this.groundApproaches.has(player.id)) return;
      const car = frame.cars[player.id];
      if (!car?.grounded) return;
      const forward = rotateVector(car.transform.rotation, { x: 0, y: 0, z: -1 });
      const toBall = normalize({
        x: ball.x - car.transform.position.x,
        y: 0,
        z: ball.z - car.transform.position.z,
      });
      if (distance(car.transform.position, ball) <= TOUCH_DISTANCE + 0.9 && dot(forward, toBall) > 0.72) {
        const speed = Math.hypot(car.linearVelocity.x, car.linearVelocity.z);
        this.groundApproaches.set(player.id, {
          startedTick: frame.snapshot.tick,
          boosted: car.boosting || speed > DEFAULT_CAR_TUNING.maximumGroundDriveSpeed + 0.5,
        });
      }
    });
  }

  private resolveMissedGroundApproaches(
    frame: AuthoritativeFrame,
    rewards: Map<string, number>,
  ): void {
    const ball = frame.snapshot.ball.transform.position;
    this.groundApproaches.forEach((approach, playerId) => {
      const car = frame.cars[playerId];
      if (!car) {
        this.groundApproaches.delete(playerId);
        return;
      }
      if (
        frame.snapshot.tick - approach.startedTick <= 5
        || distance(car.transform.position, ball) <= GROUND_APPROACH_EXIT_DISTANCE
      ) return;
      if (approach.boosted) addReward(rewards, playerId, -2.5);
      this.bots.get(playerId)?.rewardTechnique('ground', -1);
      this.groundApproaches.delete(playerId);
    });
  }
}

const closestPlayers = (
  players: readonly LobbyPlayer[],
  frame: AuthoritativeFrame,
  team?: TeamId,
): Array<LobbyPlayer & { readonly distance: number }> => players
  .filter((player) => team === undefined || player.team === team)
  .flatMap((player) => {
    const car = frame.cars[player.id];
    return car ? [{
      ...player,
      distance: distance(car.transform.position, frame.snapshot.ball.transform.position),
    }] : [];
  })
  .sort((left, right) => left.distance - right.distance);

const attackDirection = (team: TeamId): number => {
  const opponentGoal = GOALS.find(({ teamScored }) => teamScored === team);
  return Math.sign(opponentGoal?.center.z ?? 0);
};

const addReward = (rewards: Map<string, number>, playerId: string, amount: number): void => {
  rewards.set(playerId, (rewards.get(playerId) ?? 0) + amount);
};

const isActive = (frame: AuthoritativeFrame): boolean => (
  frame.snapshot.match.phase === 'playing' || frame.snapshot.match.phase === 'overtime'
);

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);

const tickWithin = (tick: number, untilTick: number): boolean => untilTick >= 0 && tick <= untilTick;

const shotTrajectoryQuality = (frame: AuthoritativeFrame, team: TeamId): number => {
  const ball = frame.snapshot.ball;
  const goal = GOALS.find(({ teamScored }) => teamScored === team);
  if (!goal) return -1;
  const goalDistance = goal.center.z - ball.transform.position.z;
  const velocity = ball.linearVelocity;
  if (velocity.z * goalDistance <= 0.1) return -1;
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizontalSpeed <= 0.1) return -1;
  const toGoal = normalize({
    x: goal.center.x - ball.transform.position.x,
    y: 0,
    z: goalDistance,
  });
  const alignment = (velocity.x * toGoal.x + velocity.z * toGoal.z) / horizontalSpeed;
  const seconds = goalDistance / velocity.z;
  if (seconds > 0 && seconds <= 8) {
    const crossingX = ball.transform.position.x + velocity.x * seconds;
    const usableHalfWidth = Math.max(1, ARENA_TUNING.goalHalfWidth - BALL_TUNING.radius - 0.5);
    const crossingQuality = 1 - Math.abs(crossingX) / usableHalfWidth;
    if (crossingQuality >= 0) return 0.75 + crossingQuality * 0.25;
  }
  // A centered midfield hit is useful even when it cannot reach the goal within the
  // shot window. Preserve goal-mouth hits as the maximum reward while giving learning
  // a directional gradient instead of collapsing every short shot to -1.
  return clamp(alignment * 1.25 - 0.5, -1, 0.75);
};
