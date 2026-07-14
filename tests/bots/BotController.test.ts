import { describe, expect, it } from 'vitest';
import { BotController } from '../../src/gameplay/bots/BotController';
import { normalizeBotKnowledge } from '../../src/gameplay/bots/BotKnowledge';
import type { CarState } from '../../src/gameplay/car/CarState';
import type { AuthoritativeFrame } from '../../src/networking/LobbyProtocol';

describe('bot controller', () => {
  it('drives and boosts toward the ball when facing the play', () => {
    const bot = new BotController('bot', 'coral', 'striker');
    const frame = createFrame(createCar({ x: 0, y: 0.72, z: -23 }, { x: 0, y: 1, z: 0, w: 0 }));

    const command = bot.command(frame, 0);

    expect(command.throttle).toBe(1);
    expect(command.steer).toBeCloseTo(0);
    expect(command.boost).toBe(true);
  });

  it('turns toward an off-center ball instead of driving straight', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: 20 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 12, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0).steer).toBeGreaterThan(0.5);
  });

  it('jumps once near the ball and holds jump for several ticks', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: 3 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 2.1, z: 0 },
    );

    expect(bot.command(frame, 10)).toMatchObject({ jumpPressed: true, jumpHeld: true });
    expect(bot.command(frame, 11)).toMatchObject({ jumpPressed: false, jumpHeld: true });
    expect(bot.command(frame, 20)).toMatchObject({ jumpPressed: false, jumpHeld: false });
  });

  it('supports from behind instead of jumping into a teammate challenge', () => {
    const bot = new BotController(
      'bot-azure-2',
      'azure',
      'striker',
      false,
      undefined,
      ['bot-azure-0', 'bot-azure-2'],
    );
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: 3 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 2.1, z: 0 },
      {
        'bot-azure-0': createCar({ x: 0, y: 0.72, z: 1 }, { x: 0, y: 0, z: 0, w: 1 }),
      },
      'bot-azure-2',
    );

    expect(bot.command(frame, 10).jumpPressed).toBe(false);
  });

  it('keeps a lined-up striker committed when a teammate becomes slightly closer', () => {
    const bot = new BotController(
      'bot-azure-0',
      'azure',
      'striker',
      false,
      undefined,
      ['bot-azure-0', 'bot-azure-2'],
    );
    const first = createFrame(
      createCar({ x: 0, y: 0.72, z: 5 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 1.35, z: 0 },
      {
        'bot-azure-2': createCar({ x: 5, y: 0.72, z: 5 }, { x: 0, y: 0, z: 0, w: 1 }),
      },
      'bot-azure-0',
    );
    const teammateCloser = createFrame(
      createCar({ x: 0, y: 0.72, z: 4 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 1.35, z: 0 },
      {
        'bot-azure-2': createCar({ x: 0.5, y: 0.72, z: 2 }, { x: 0, y: 0, z: 0, w: 1 }),
      },
      'bot-azure-0',
    );

    bot.command(first, 20);
    expect(bot.command(teammateCloser, 21).throttle).toBe(1);
  });

  it('slows down and powerslides to correct a close offset shot', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 2, y: 0.72, z: 3 },
        { x: 0, y: 0, z: 0, w: 1 },
        { linearVelocity: { x: 0, y: 0, z: -15 } },
      ),
      { x: 0, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0)).toMatchObject({ throttle: 0.35, powerslide: true });
  });

  it('changes its kickoff contact lane after the next countdown', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const playing = createFrame(
      createCar({ x: 0, y: 0.72, z: 28 }, { x: 0, y: 0, z: 0, w: 1 }),
    );

    bot.command(withMatchPhase(playing, 'countdown'), 0);
    const firstKickoff = bot.command(playing, 1);
    bot.command(withMatchPhase(playing, 'countdown'), 100);
    const secondKickoff = bot.command(playing, 101);

    expect(firstKickoff.steer).not.toBe(secondKickoff.steer);
  });

  it('launches, rotates, and boosts toward an aerial ball', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const launchFrame = createFrame(
      createCar({ x: 0, y: 0.72, z: 6 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 6, z: 0 },
    );
    const flightFrame = createFrame(
      createCar(
        { x: 0, y: 1.8, z: 5 },
        { x: Math.sin(Math.PI / 8), y: 0, z: 0, w: Math.cos(Math.PI / 8) },
        { grounded: false },
      ),
      { x: 0, y: 6, z: 0 },
    );

    expect(bot.command(launchFrame, 0)).toMatchObject({ jumpPressed: true, jumpHeld: true, boost: false });
    expect(bot.command(flightFrame, 1)).toMatchObject({ jumpPressed: false, boost: true });
    expect(bot.command(flightFrame, 10)).toMatchObject({ jumpPressed: true, boost: false });
  });

  it.each([
    ['azure', { x: 0, y: 0, z: 0, w: 1 }, 18, 20],
    ['coral', { x: 0, y: 1, z: 0, w: 0 }, -18, -20],
  ] as const)('stages behind the ball to shoot at the opposing goal for %s', (team, rotation, carZ, ballZ) => {
    const bot = new BotController('bot', team, 'striker');
    const frame = createFrame(
      createCar({ x: 6, y: 0.72, z: carZ }, rotation),
      { x: 0, y: 1.35, z: ballZ },
    );

    expect(bot.command(frame, 0).throttle).toBe(-0.7);
  });

  it.each([
    ['azure', { x: 0, y: 0, z: 0, w: 1 }, 58, 55],
    ['coral', { x: 0, y: 1, z: 0, w: 0 }, -58, -55],
  ] as const)('shoots away from the nearby own goal for %s', (team, rotation, carZ, ballZ) => {
    const bot = new BotController('bot', team, 'striker');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: carZ }, rotation),
      { x: 0, y: 1.35, z: ballZ },
    );

    expect(bot.command(frame, 0)).toMatchObject({ throttle: 1, steer: 0 });
  });

  it.each([
    ['azure', { x: 0, y: 1, z: 0, w: 0 }, -2],
    ['coral', { x: 0, y: 0, z: 0, w: 1 }, 2],
  ] as const)('routes the %s bot around the ball when the direct hit would be an own goal', (team, rotation, carZ) => {
    const bot = new BotController('bot', team, 'striker');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: carZ }, rotation),
      { x: 0, y: 1.35, z: 0 },
    );

    expect(Math.abs(bot.command(frame, 0).steer)).toBeGreaterThan(0.5);
  });

  it.each([
    ['azure', { x: 0, y: 0, z: 0, w: 1 }, -20],
    ['coral', { x: 0, y: 1, z: 0, w: 0 }, 20],
  ] as const)('keeps the %s defender goal-side when play is upfield', (team, rotation, ballZ) => {
    const bot = new BotController('bot', team, 'defender');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: 0 }, rotation),
      { x: 4, y: 1.35, z: ballZ },
    );

    expect(bot.command(frame, 0).throttle).toBe(-0.7);
  });

  it.each([
    ['azure', { x: 0, y: 0, z: 0, w: 1 }, 29],
    ['coral', { x: 0, y: 1, z: 0, w: 0 }, -29],
  ] as const)('separates the %s striker and defender at kickoff', (team, rotation, carZ) => {
    const car = createCar({ x: 0, y: 0.72, z: carZ }, rotation);
    const frame = createFrame(car, { x: 0, y: 1.35, z: 0 });
    const striker = new BotController('bot', team, 'striker').command(frame, 0);
    const defender = new BotController('bot', team, 'defender').command(frame, 0);

    expect(striker.throttle).toBe(1);
    expect(defender).toMatchObject({ throttle: -0.7, boost: false });
  });

  it.each([
    ['azure', { x: 0, y: 0, z: 0, w: 1 }, 30, 20],
    ['coral', { x: 0, y: 1, z: 0, w: 0 }, -30, -20],
  ] as const)('releases the %s defender when the ball threatens its half', (team, rotation, carZ, ballZ) => {
    const bot = new BotController('bot', team, 'defender');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: carZ }, rotation),
      { x: 0, y: 1.35, z: ballZ },
    );

    expect(bot.command(frame, 0).throttle).toBe(1);
  });

  it('double-jumps to recover after landing upside down', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(createCar(
      { x: 0, y: 0.55, z: 10 },
      { x: 1, y: 0, z: 0, w: 0 },
      { grounded: false },
    ));

    expect(bot.command(frame, 0)).toMatchObject({
      throttle: 1,
      jumpPressed: true,
      jumpHeld: true,
      boost: false,
    });
    expect(bot.command(frame, 1)).toMatchObject({ jumpPressed: false, jumpHeld: false });
    expect(bot.command(frame, 45)).toMatchObject({ jumpPressed: false, jumpHeld: false });
    expect(bot.command(frame, 46)).toMatchObject({ jumpPressed: true, jumpHeld: true });
    expect(bot.command(frame, 47)).toMatchObject({ jumpPressed: false, jumpHeld: false });
  });

  it.each([
    ['left', Math.SQRT1_2],
    ['right', -Math.SQRT1_2],
  ] as const)('jumps to recover when resting on its %s side', (_side, z) => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(createCar(
      { x: 0, y: 1.05, z: 10 },
      { x: 0, y: 0, z, w: Math.SQRT1_2 },
      { grounded: false },
    ));

    expect(bot.command(frame, 0)).toMatchObject({
      throttle: 0,
      jumpPressed: true,
      jumpHeld: true,
    });
    expect(bot.command(frame, 1).jumpPressed).toBe(false);
    expect(bot.command(frame, 50).jumpPressed).toBe(true);
  });

  it('jumps after being unable to move toward a distant target', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: 20 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 1.35, z: -20 },
    );

    expect(bot.command(frame, 0).jumpPressed).toBe(false);
    expect(bot.command(frame, 44).jumpPressed).toBe(false);
    expect(bot.command(frame, 45)).toMatchObject({ jumpPressed: true, jumpHeld: true });
    expect(bot.command(frame, 46)).toMatchObject({ jumpPressed: false, jumpHeld: true });
  });

  it('tracks net performance so negative feedback affects the visible score', () => {
    const bot = new BotController('learning-bot', 'azure', 'striker', true);

    bot.reward(12, 100);
    bot.reward(-5, 200);
    bot.reward(3, 300);

    expect(bot.learningState().points).toBe(10);
    expect(['balanced', 'press', 'rotate']).toContain(bot.learningState().policy);
  });

  it('uses the strongest persisted policy in normal matches', () => {
    const knowledge = normalizeBotKnowledge({
      generation: 3,
      roles: {
        striker: {
          balanced: { value: 0.01, samples: 10 },
          press: { value: 0.08, samples: 12 },
          rotate: { value: -0.02, samples: 8 },
        },
      },
    });
    const bot = new BotController('bot', 'azure', 'striker', false, knowledge);

    expect(bot.learningState().policy).toBe('press');
  });

});

const createFrame = (
  bot: CarState,
  ballPosition = { x: 0, y: 1.35, z: 0 },
  otherCars: Readonly<Record<string, CarState>> = {},
  botId = 'bot',
): AuthoritativeFrame => ({
  sequence: 0,
  cars: { [botId]: bot, ...otherCars },
  snapshot: {
    tick: 0,
    car: bot,
    ball: {
      transform: { position: ballPosition, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      linearVelocity: { x: 0, y: 0, z: 0 },
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
});

const createCar = (
  position: CarState['transform']['position'],
  rotation: CarState['transform']['rotation'],
  overrides: Partial<CarState> = {},
): CarState => ({
  transform: { position, rotation },
  linearVelocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  wheels: [],
  grounded: true,
  boost: 100,
  boosting: false,
  ...overrides,
});

const withMatchPhase = (
  frame: AuthoritativeFrame,
  phase: AuthoritativeFrame['snapshot']['match']['phase'],
): AuthoritativeFrame => ({
  ...frame,
  snapshot: {
    ...frame.snapshot,
    match: { ...frame.snapshot.match, phase },
  },
});
