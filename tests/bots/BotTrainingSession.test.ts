import { describe, expect, it } from 'vitest';
import type { CarState } from '../../src/gameplay/car/CarState';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import { BotTrainingSession } from '../../src/networking/BotTrainingSession';
import {
  BUILT_IN_BOT_KNOWLEDGE,
  BOT_POLICY_ORDER,
  type BotKnowledgeObservations,
} from '../../src/gameplay/bots/BotKnowledge';
import type { AuthoritativeFrame } from '../../src/networking/LobbyProtocol';

const TEST_RANDOM = (): number => 0.999999;

describe('bot training session', () => {
  it('commands all six bots, preserves pause input, and rewards a useful touch', () => {
    const session = new BotTrainingSession(BUILT_IN_BOT_KNOWLEDGE, undefined, TEST_RANDOM);
    const before = frameFor(session, 0, 0, 0);
    const after = frameFor(session, 1, -1, -5);

    session.commandsForTick(0, NEUTRAL_COMMAND, before);
    const commands = session.commandsForTick(1, { ...NEUTRAL_COMMAND, togglePause: true }, after);
    const azureLeader = session.trainingState().entries.find(({ playerId }) => playerId === 'bot-azure-0');

    expect(session.players).toHaveLength(6);
    expect(commands.size).toBe(6);
    expect(commands.get(session.localPlayerId)?.togglePause).toBe(true);
    expect(azureLeader?.points).toBeGreaterThan(0);
  });

  it('merges learned policy windows and persists them when flushed', async () => {
    const persisted: BotKnowledgeObservations[] = [];
    const session = new BotTrainingSession(
      BUILT_IN_BOT_KNOWLEDGE,
      (observations) => { persisted.push(observations); },
      TEST_RANDOM,
    );
    const before = frameFor(session, 0, 0, 0);
    const after = frameFor(session, 300, -1, -5);

    session.commandsForTick(0, NEUTRAL_COMMAND, before);
    session.commandsForTick(300, NEUTRAL_COMMAND, after);
    const learned = session.learnedKnowledge('2026-07-14T00:00:00.000Z');
    await session.flushKnowledge();

    const samples = Object.values(learned.roles).reduce((total, role) => (
      total + BOT_POLICY_ORDER.reduce((roleTotal, policy) => roleTotal + role[policy].samples, 0)
    ), 0);
    expect(learned.generation).toBe(BUILT_IN_BOT_KNOWLEDGE.generation + 1);
    expect(samples).toBeGreaterThan(0);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.striker).toBeDefined();
    expect(persisted[0]?.defender).toBeDefined();
  });

  it('waits for shared knowledge persistence before completing a learning cycle', async () => {
    let finishPersistence: (() => void) | undefined;
    let persisted = false;
    const persistence = new Promise<void>((resolve) => { finishPersistence = resolve; });
    const session = new BotTrainingSession(BUILT_IN_BOT_KNOWLEDGE, async () => {
      await persistence;
      persisted = true;
    }, TEST_RANDOM);

    session.commandsForTick(0, NEUTRAL_COMMAND, frameFor(session, 0, 0, 0));
    session.commandsForTick(300, NEUTRAL_COMMAND, frameFor(session, 300, -1, -5));
    const flushing = session.flushKnowledge();
    await Promise.resolve();

    expect(persisted).toBe(false);
    finishPersistence?.();
    await flushing;
    expect(persisted).toBe(true);
  });

  it('rewards a maximum-speed opponent demolition and penalizes the victim', () => {
    const session = new BotTrainingSession(BUILT_IN_BOT_KNOWLEDGE, undefined, TEST_RANDOM);
    const before = frameFor(session, 0, 0, 0);
    const baseAfter = frameFor(session, 1, 0, 0);
    const after: AuthoritativeFrame = {
      ...baseAfter,
      snapshot: {
        ...baseAfter.snapshot,
        demolition: {
          sequence: 1,
          attackerId: 'bot-azure-0',
          victimId: 'bot-coral-0',
          attackerTeam: 'azure',
          victimTeam: 'coral',
          position: { x: 0, y: 0.72, z: 0 },
        },
      },
    };

    session.commandsForTick(0, NEUTRAL_COMMAND, before);
    session.commandsForTick(1, NEUTRAL_COMMAND, after);
    const attacker = session.trainingState().entries.find(({ playerId }) => playerId === 'bot-azure-0');
    const victim = session.trainingState().entries.find(({ playerId }) => playerId === 'bot-coral-0');

    expect(attacker?.points).toBeGreaterThan(7);
    expect(victim?.points).toBeLessThan(0);
  });

  it('penalizes an aerial attempt that lands without touching the ball', () => {
    const session = new BotTrainingSession(BUILT_IN_BOT_KNOWLEDGE, undefined, TEST_RANDOM);
    const launch = withBallHeight(frameFor(session, 0, 0, 0), 6);
    const landed = withBallHeight(frameFor(session, 0, 0, 0), 6);

    const command = session.commandsForTick(0, NEUTRAL_COMMAND, launch).get('bot-azure-0');
    session.commandsForTick(20, NEUTRAL_COMMAND, landed);
    const bot = session.trainingState().entries.find(({ playerId }) => playerId === 'bot-azure-0');

    expect(command?.jumpPressed).toBe(true);
    expect(bot?.points).toBeLessThan(-3);
  });
});

const frameFor = (
  session: BotTrainingSession,
  sequence: number,
  ballZ: number,
  ballVelocityZ: number,
): AuthoritativeFrame => {
  const cars = Object.fromEntries(session.players.map((player, index) => [
    player.id,
    carState({
      x: index === 0 ? 0 : 12 + index,
      y: 0.72,
      z: index === 0 ? 1 - sequence : player.team === 'azure' ? 20 : -20,
    }),
  ]));
  const localCar = cars[session.localPlayerId] as CarState;
  return {
    sequence,
    cars,
    snapshot: {
      tick: sequence,
      car: localCar,
      ball: {
        transform: { position: { x: 0, y: 1.35, z: ballZ }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        linearVelocity: { x: 0, y: 0, z: ballVelocityZ },
        angularVelocity: { x: 0, y: 0, z: 0 },
      },
      boostPickups: [],
      match: {
        phase: 'playing',
        paused: false,
        timeRemaining: 300,
        countdown: 0,
        azureScore: 0,
        coralScore: 0,
        overtime: false,
        replayProgress: 0,
        lastGoalTeam: null,
      },
    },
  };
};

const carState = (position: CarState['transform']['position']): CarState => ({
  transform: { position, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  linearVelocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  wheels: [],
  grounded: true,
  boost: 100,
  boosting: false,
});

const withBallHeight = (frame: AuthoritativeFrame, y: number): AuthoritativeFrame => ({
  ...frame,
  snapshot: {
    ...frame.snapshot,
    ball: {
      ...frame.snapshot.ball,
      transform: {
        ...frame.snapshot.ball.transform,
        position: { ...frame.snapshot.ball.transform.position, y },
      },
    },
  },
});
