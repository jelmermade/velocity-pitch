import { describe, expect, it } from 'vitest';
import { BotController } from '../../src/gameplay/bots/BotController';
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
      { x: 0, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 10)).toMatchObject({ jumpPressed: true, jumpHeld: true });
    expect(bot.command(frame, 11)).toMatchObject({ jumpPressed: false, jumpHeld: true });
    expect(bot.command(frame, 20)).toMatchObject({ jumpPressed: false, jumpHeld: false });
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

  it('pulses recovery controls after landing upside down', () => {
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
    expect(bot.command(frame, 50)).toMatchObject({ jumpPressed: true, jumpHeld: true });
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
});

const createFrame = (
  bot: CarState,
  ballPosition = { x: 0, y: 1.35, z: 0 },
): AuthoritativeFrame => ({
  sequence: 0,
  cars: { bot },
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
