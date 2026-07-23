import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIME_CONFIG } from '../../src/app/RuntimeConfig';
import { EventBus } from '../../src/core/events/EventBus';
import type { GameEventMap } from '../../src/core/events/GameEvents';
import { GameSimulation } from '../../src/gameplay/simulation/GameSimulation';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../src/input/PlayerCommand';
import { LocalSession } from '../../src/networking/LocalSession';
import { BotTrainingSession } from '../../src/networking/BotTrainingSession';
import type { AuthoritativeFrame } from '../../src/networking/LobbyProtocol';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';
import { BALL_TUNING } from '../../src/core/config/BallTuning';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { GOALS } from '../../src/gameplay/arena/ArenaDefinition';

describe('singleplayer bot simulation', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => world?.dispose());

  it('spawns four separate cars and drives the bots after kickoff', async () => {
    world = await RapierPhysicsWorld.create();
    const session = new LocalSession();
    const simulation = new GameSimulation(
      world,
      new EventBus<GameEventMap>(),
      session.players,
      session.localPlayerId,
    );
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    const kickoffTicks = RUNTIME_CONFIG.physicsHz * 4;
    const spawned = simulation.authoritativeFrame(0);

    for (let tick = 0; tick < kickoffTicks; tick += 1) {
      const frame = simulation.authoritativeFrame(tick);
      simulation.updatePlayers(session.commandsForTick(tick, NEUTRAL_COMMAND, frame), step);
    }
    const before = simulation.authoritativeFrame(kickoffTicks);

    for (let tick = kickoffTicks; tick < kickoffTicks + RUNTIME_CONFIG.physicsHz; tick += 1) {
      const frame = simulation.authoritativeFrame(tick);
      simulation.updatePlayers(session.commandsForTick(tick, NEUTRAL_COMMAND, frame), step);
    }
    const after = simulation.authoritativeFrame(kickoffTicks + RUNTIME_CONFIG.physicsHz);
    const positions = Object.values(spawned.cars).map(({ transform }) => transform.position);
    const botMoved = Object.entries(before.cars).some(([playerId, car]) => {
      if (playerId === session.localPlayerId) return false;
      const afterCar = after.cars[playerId];
      return Boolean(afterCar && Math.hypot(
        afterCar.transform.position.x - car.transform.position.x,
        afterCar.transform.position.z - car.transform.position.z,
      ) > 2);
    });

    expect(Object.keys(spawned.cars)).toHaveLength(4);
    expect(new Set(positions.map(({ x, z }) => `${x.toFixed(2)}:${z.toFixed(2)}`)).size).toBe(4);
    expect(botMoved).toBe(true);
  });

  it('spawns six separate cars for a 3v3 match', async () => {
    world = await RapierPhysicsWorld.create();
    const session = new LocalSession(3);
    const simulation = new GameSimulation(
      world,
      new EventBus<GameEventMap>(),
      session.players,
      session.localPlayerId,
    );

    const frame = simulation.authoritativeFrame(0);
    const positions = Object.values(frame.cars).map(({ transform }) => transform.position);

    expect(Object.keys(frame.cars)).toHaveLength(6);
    expect(new Set(positions.map(({ x, z }) => `${x.toFixed(2)}:${z.toFixed(2)}`)).size).toBe(6);
    expect(session.commandsForTick(0, NEUTRAL_COMMAND, frame).size).toBe(6);
  });

  it('spawns six separate cars for the five-minute 3v3 bot lab', async () => {
    world = await RapierPhysicsWorld.create();
    const session = new BotTrainingSession();
    const simulation = new GameSimulation(
      world,
      new EventBus<GameEventMap>(),
      session.players,
      session.localPlayerId,
    );

    const frame = simulation.authoritativeFrame(0);
    const positions = Object.values(frame.cars).map(({ transform }) => transform.position);

    expect(Object.keys(frame.cars)).toHaveLength(6);
    expect(new Set(positions.map(({ x, z }) => `${x.toFixed(2)}:${z.toFixed(2)}`)).size).toBe(6);
    expect(frame.snapshot.match.timeRemaining).toBe(300);
  });

  it.each([
    {
      name: 'rolling ground ball',
      car: { x: -5, y: 0.72, z: -16 },
      ball: { x: 3, y: BALL_TUNING.radius + 0.08, z: -1 },
      ballVelocity: { x: 2.5, y: 0, z: 1 },
      seconds: 7,
      minimumContactHeight: 0,
    },
    {
      name: 'reachable airborne ball',
      car: { x: 0, y: 0.72, z: -11 },
      ball: { x: 1, y: 3.4, z: -3 },
      ballVelocity: { x: -0.5, y: 2, z: 0.5 },
      seconds: 7,
      minimumContactHeight: BALL_TUNING.radius + 0.75,
      requireAirborneBot: true,
    },
    {
      name: 'side-wall rebound',
      car: { x: 35, y: 0.72, z: -13 },
      ball: { x: ARENA_TUNING.halfWidth - 4, y: BALL_TUNING.radius + 0.2, z: -1 },
      ballVelocity: { x: 16, y: 0, z: 1 },
      seconds: 8,
      minimumContactHeight: 0,
      evaluateFinalVelocity: true,
    },
    {
      name: 'fast lateral crossing ball',
      car: { x: 0, y: 0.72, z: -18 },
      ball: { x: -12, y: BALL_TUNING.radius + 0.08, z: -3 },
      ballVelocity: { x: 11, y: 0, z: 0.5 },
      seconds: 8,
      minimumContactHeight: 0,
    },
    {
      name: 'ball moving away toward goal',
      car: { x: -2, y: 0.72, z: -18 },
      ball: { x: 1, y: BALL_TUNING.radius + 0.08, z: -5 },
      ballVelocity: { x: 0.5, y: 0, z: 8 },
      seconds: 8,
      minimumContactHeight: 0,
    },
    {
      name: 'stationary ball from a side-on approach',
      car: { x: 14, y: 0.72, z: -1 },
      ball: { x: 0, y: BALL_TUNING.radius + 0.08, z: 0 },
      ballVelocity: { x: 0, y: 0, z: 0 },
      seconds: 9,
      preparationSeconds: 7,
      minimumContactHeight: 0,
      minimumGoalAlignment: 0.15,
    },
    {
      name: 'stationary ball after starting goal-side',
      car: { x: 4, y: 0.72, z: 9 },
      ball: { x: 0, y: BALL_TUNING.radius + 0.08, z: 0 },
      ballVelocity: { x: 0, y: 0, z: 0 },
      seconds: 10,
      preparationSeconds: 7,
      minimumContactHeight: 0,
    },
    {
      name: 'very high moving aerial ball',
      car: { x: -1, y: 0.72, z: -12 },
      ball: { x: 1, y: 9, z: -3 },
      ballVelocity: { x: 1.5, y: 10, z: 2 },
      seconds: 9,
      minimumContactHeight: 6.5,
      requireAirborneBot: true,
    },
    {
      name: 'very high lateral aerial ball',
      car: { x: -2, y: 0.72, z: -12 },
      ball: { x: -4, y: 9, z: -3 },
      ballVelocity: { x: 5, y: 9, z: 2 },
      seconds: 9,
      minimumContactHeight: 6.5,
      requireAirborneBot: true,
    },
    {
      name: 'descending medium-height aerial ball',
      car: { x: 0, y: 0.72, z: -13 },
      ball: { x: 1, y: 7, z: -3 },
      ballVelocity: { x: 2.5, y: -2.5, z: 2 },
      seconds: 8,
      minimumContactHeight: 3.5,
      requireAirborneBot: true,
    },
  ])('makes real car-ball contact with a $name', async ({
    name,
    car,
    ball,
    ballVelocity,
    seconds,
    preparationSeconds = 4,
    minimumContactHeight,
    minimumGoalAlignment = 0.35,
    requireAirborneBot = false,
    evaluateFinalVelocity = false,
  }) => {
    world = await RapierPhysicsWorld.create();
    let session = new LocalSession(1);
    const simulation = new GameSimulation(
      world,
      new EventBus<GameEventMap>(),
      session.players,
      session.localPlayerId,
    );
    const step = 1 / RUNTIME_CONFIG.physicsHz;
    let tick = 0;
    for (; tick < RUNTIME_CONFIG.physicsHz * preparationSeconds; tick += 1) {
      const frame = simulation.authoritativeFrame(tick);
      simulation.updatePlayers(session.commandsForTick(tick, NEUTRAL_COMMAND, frame), step);
    }

    const idleCars = [['local', { x: -35, y: 0.72, z: 48 }]] as const;
    idleCars.forEach(([playerId, position]) => simulation.stageCar(
      playerId,
      { position, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ));
    simulation.stageCar(
      'bot-coral-0',
      { position: car, rotation: { x: 0, y: 1, z: 0, w: 0 } },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    );
    simulation.stageBall(ball, ballVelocity);
    // This setup specifically verifies routing from the wrong side of the ball. Use
    // fresh bot state so a commitment made during the preparation kickoff cannot
    // bypass that route after the teleport.
    if (name === 'stationary ball after starting goal-side') session = new LocalSession(1);

    let contacted = false;
    let contactHeight = 0;
    let contactSpeed = 0;
    let contactGrounded = true;
    let contactCar: AuthoritativeFrame['cars'][string] | undefined;
    let goalAlignment = -1;
    let goalProgressSpeed = Number.NEGATIVE_INFINITY;
    let velocityBeforeContact = { x: 0, y: 0, z: 0 };
    let closestDistance = Number.POSITIVE_INFINITY;
    let jumpActions = 0;
    const tacticalIntents = new Map<string, number>();
    let finalTacticalState: ReturnType<LocalSession['tacticalStates']> extends ReadonlyMap<string, infer T>
      ? T | undefined
      : never;
    let finalCommand: PlayerCommand = NEUTRAL_COMMAND;
    for (let elapsed = 0; elapsed < RUNTIME_CONFIG.physicsHz * seconds; elapsed += 1, tick += 1) {
      const frame = simulation.authoritativeFrame(tick);
      const commands = session.commandsForTick(tick, NEUTRAL_COMMAND, frame);
      finalCommand = commands.get('bot-coral-0') ?? NEUTRAL_COMMAND;
      if (finalCommand.jumpPressed) jumpActions += 1;
      finalTacticalState = session.tacticalStates().get('bot-coral-0');
      if (finalTacticalState) {
        tacticalIntents.set(
          finalTacticalState.intent,
          (tacticalIntents.get(finalTacticalState.intent) ?? 0) + 1,
        );
      }
      simulation.updatePlayers(commands, step);
      const next = simulation.authoritativeFrame(tick + 1);
      const bot = next.cars['bot-coral-0'];
      if (bot) {
        closestDistance = Math.min(closestDistance, Math.hypot(
          bot.transform.position.x - next.snapshot.ball.transform.position.x,
          bot.transform.position.y - next.snapshot.ball.transform.position.y,
          bot.transform.position.z - next.snapshot.ball.transform.position.z,
        ));
      }
      if (simulation.ballContactPlayerIds().includes('bot-coral-0')) {
        contacted = true;
        velocityBeforeContact = frame.snapshot.ball.linearVelocity;
        contactHeight = next.snapshot.ball.transform.position.y;
        contactGrounded = next.cars['bot-coral-0']?.grounded ?? true;
        contactCar = next.cars['bot-coral-0'];
        const immediateContactSpeed = Math.hypot(
          next.snapshot.ball.linearVelocity.x,
          next.snapshot.ball.linearVelocity.y,
          next.snapshot.ball.linearVelocity.z,
        );
        if (immediateContactSpeed > 0.5) {
          tick += 1;
          break;
        }
      }
    }

    if (contacted) {
      for (let followThroughTick = 0; followThroughTick < 8; followThroughTick += 1, tick += 1) {
        const frame = simulation.authoritativeFrame(tick);
        simulation.updatePlayers(session.commandsForTick(tick, NEUTRAL_COMMAND, frame), step);
      }
      const outcome = simulation.authoritativeFrame(tick);
      const velocity = outcome.snapshot.ball.linearVelocity;
      contactSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
      const opponentGoal = GOALS.find(({ teamScored }) => teamScored === 'coral');
      if (opponentGoal) {
        const ballPosition = outcome.snapshot.ball.transform.position;
        const goalX = opponentGoal.center.x - ballPosition.x;
        const goalZ = opponentGoal.center.z - ballPosition.z;
        const impactVelocity = evaluateFinalVelocity ? velocity : {
          x: velocity.x - velocityBeforeContact.x,
          y: velocity.y - velocityBeforeContact.y,
          z: velocity.z - velocityBeforeContact.z,
        };
        goalAlignment = (impactVelocity.x * goalX + impactVelocity.z * goalZ) / Math.max(
          0.0001,
          Math.hypot(impactVelocity.x, impactVelocity.z) * Math.hypot(goalX, goalZ),
        );
        goalProgressSpeed = impactVelocity.z;
      }
    }

    const finalBot = simulation.authoritativeFrame(tick).cars['bot-coral-0'];
    const finalBotPosition = finalBot?.transform.position;
    expect(contacted, JSON.stringify({
      closestDistance,
      finalBotPosition,
      ball,
      ballVelocity,
      tacticalIntents: Object.fromEntries(tacticalIntents),
      finalTacticalState,
      finalCommand,
      finalBot,
    })).toBe(true);
    expect(contactHeight, JSON.stringify({ closestDistance, contactHeight, jumpActions, contactCar })).toBeGreaterThanOrEqual(
      minimumContactHeight,
    );
    expect(contactSpeed, JSON.stringify({ closestDistance, contactSpeed, contactCar })).toBeGreaterThan(0.5);
    const shotContext = JSON.stringify({ goalAlignment, goalProgressSpeed, contactCar });
    expect(goalAlignment, shotContext).toBeGreaterThan(minimumGoalAlignment);
    expect(goalProgressSpeed, shotContext).toBeGreaterThan(0.5);
    if (requireAirborneBot) expect(contactGrounded).toBe(false);
  }, 15_000);
});
