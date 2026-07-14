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

const createCar = (position: CarState['transform']['position'], rotation: CarState['transform']['rotation']): CarState => ({
  transform: { position, rotation },
  linearVelocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  wheels: [],
  grounded: true,
  boost: 100,
  boosting: false,
});
