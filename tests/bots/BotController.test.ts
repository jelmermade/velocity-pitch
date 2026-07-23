import { describe, expect, it } from 'vitest';
import { BotController } from '../../src/gameplay/bots/BotController';
import { BotTeamCoordinator } from '../../src/gameplay/bots/BotTeamCoordinator';
import { normalizeBotKnowledge } from '../../src/gameplay/bots/BotKnowledge';
import type { CarState } from '../../src/gameplay/car/CarState';
import type { AuthoritativeFrame } from '../../src/networking/LobbyProtocol';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { BALL_TUNING } from '../../src/core/config/BallTuning';

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

    expect(bot.command(frame, 0).steer).toBeGreaterThan(0.2);
  });

  it('steers toward the reachable side-wall trajectory instead of the current ball position', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = withBallVelocity(createFrame(
      createCar({ x: ARENA_TUNING.halfWidth - 18, y: 0.72, z: 10 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: ARENA_TUNING.halfWidth - 3, y: 1.35, z: 0 },
    ), { x: 22, y: 0, z: 0 });

    expect(bot.command(frame, 0).steer).toBeLessThan(-0.25);
    expect(bot.tacticalState()?.intercept.x).toBeLessThan(frame.snapshot.ball.transform.position.x);
  });

  it('does not jump into a routine rolling-ball contact', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: 3 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 2.1, z: 0 },
    );

    expect(bot.command(frame, 10)).toMatchObject({ jumpPressed: false, jumpHeld: false });
  });

  it('keeps a goal-side ground strike planted when the ball does not need lift', () => {
    const bot = new BotController('bot', 'coral', 'striker');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: 47 }, { x: 0, y: 1, z: 0, w: 0 }),
      { x: 0, y: BALL_TUNING.radius + 0.08, z: 51 },
    );

    expect(bot.command(frame, 10)).toMatchObject({ jumpPressed: false, jumpHeld: false });
  });

  it('jumps once when an elevated ball requires it and holds jump for several ticks', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: 3 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 3.5, z: 0 },
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

  it('clears first-man ownership while the car is demolished', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: 3 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 1.35, z: 0 },
    );

    bot.command(frame, 0);
    expect(bot.tacticalState()?.role).toBe('first');

    bot.command({ ...frame, cars: {} }, 1);
    expect(bot.tacticalState()).toBeNull();
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

  it('brakes and powerslides through a close offset shot without boosting', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 2, y: 0.72, z: 3 },
        { x: 0, y: 0, z: 0, w: 1 },
        { linearVelocity: { x: 0, y: 0, z: -15 } },
      ),
      { x: 0, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0)).toMatchObject({
      throttle: -1,
      powerslide: true,
      boost: false,
    });
  });

  it('does not boost while steering substantially toward the ball', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 0, y: 0.72, z: 25 },
        { x: 0, y: 0, z: 0, w: 1 },
        { linearVelocity: { x: 0, y: 0, z: -8 } },
      ),
      { x: 12, y: 1.35, z: 0 },
    );

    expect(Math.abs(bot.command(frame, 0).steer)).toBeGreaterThan(0.5);
    expect(bot.command(frame, 0).boost).toBe(false);
  });

  it('does not boost until lateral sliding is under control', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 0, y: 0.72, z: 25 },
        { x: 0, y: 0, z: 0, w: 1 },
        { linearVelocity: { x: 8, y: 0, z: -8 } },
      ),
      { x: 0, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0)).toMatchObject({ steer: 0, boost: false });
  });

  it('keeps boosting a straight pursuit above normal drive top speed', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 0, y: 0.72, z: 25 },
        { x: 0, y: 0, z: 0, w: 1 },
        { linearVelocity: { x: 0, y: 0, z: -26 } },
      ),
      { x: 0, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0)).toMatchObject({ throttle: 1, steer: 0, boost: true });
  });

  it('only brakes a maximum-speed pursuit when it exceeds the hard-contact envelope', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 0, y: 0.72, z: 10 },
        { x: 0, y: 0, z: 0, w: 1 },
        { linearVelocity: { x: 0, y: 0, z: -38 } },
      ),
      { x: 0, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0)).toMatchObject({ throttle: -1, steer: 0, boost: false });
  });

  it('carries high speed through an aligned final strike', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 0, y: 0.72, z: 7 },
        { x: 0, y: 0, z: 0, w: 1 },
        { linearVelocity: { x: 0, y: 0, z: -30 } },
      ),
      { x: 0, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0)).toMatchObject({ throttle: 1, steer: 0, boost: false });
  });

  it('accelerates through a lined-up final approach instead of coasting before contact', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 0, y: 0.72, z: 12 },
        { x: 0, y: 0, z: 0, w: 1 },
        { linearVelocity: { x: 0, y: 0, z: -15 } },
      ),
      { x: 0, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0)).toMatchObject({ throttle: 1, steer: 0, boost: true });
  });

  it('prefers natural steering when its normal turn radius can reach the ball', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 0, y: 0.72, z: 25 },
        { x: 0, y: 0, z: 0, w: 1 },
        { linearVelocity: { x: 0, y: 0, z: -22 } },
      ),
      { x: 12, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0).powerslide).toBe(false);
    expect(bot.command(frame, 30).powerslide).toBe(false);
  });

  it('brakes into a controlled powerslide for a fast reachable setup turn', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 0, y: 0.72, z: 25 },
        { x: 0, y: 0, z: 0, w: 1 },
        { linearVelocity: { x: 0, y: 0, z: -22 } },
      ),
      { x: 10, y: 1.35, z: 15 },
    );

    expect(bot.command(frame, 0)).toMatchObject({ throttle: -1, powerslide: true });
    expect(bot.command(frame, 23).powerslide).toBe(true);
    expect(bot.command(frame, 24).powerslide).toBe(true);
  });

  it('stops after reaching its second-man support position instead of circling it', () => {
    const teamPlayerIds = ['bot-azure-0', 'bot-azure-1', 'bot-azure-2'];
    const coordinator = new BotTeamCoordinator('azure', teamPlayerIds);
    const bot = new BotController(
      'bot-azure-2',
      'azure',
      'striker',
      false,
      undefined,
      teamPlayerIds,
      coordinator,
    );
    const frame = createFrame(
      createCar({ x: 11, y: 0.72, z: 14 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 1.35, z: 0 },
      {
        'bot-azure-0': createCar(
          { x: -4, y: 0.72, z: 2 },
          { x: 0, y: 0, z: 0, w: 1 },
          { linearVelocity: { x: 0, y: 0, z: -8 } },
        ),
        'bot-azure-1': createCar({ x: 0, y: 0.72, z: 40 }, { x: 0, y: 0, z: 0, w: 1 }),
      },
      'bot-azure-2',
    );

    expect(bot.command(frame, 0)).toMatchObject({ throttle: 0, steer: 0, boost: false });
  });

  it('uses patient natural steering during a low-confidence distant U-turn', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 0, y: 0.72, z: 25 },
        { x: 0, y: 1, z: 0, w: 0 },
        { linearVelocity: { x: 0, y: 0, z: 15 } },
      ),
      { x: 12, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0)).toMatchObject({ boost: false, throttle: 0.55, powerslide: false });
    expect(bot.command(frame, 23).powerslide).toBe(false);
    expect(bot.command(frame, 24)).toMatchObject({ throttle: 0.55, powerslide: false });
    expect(bot.command(frame, 30).powerslide).toBe(false);
    expect(bot.command(frame, 31).powerslide).toBe(false);
    expect(bot.command(frame, 143).powerslide).toBe(false);
    expect(bot.command(frame, 144).powerslide).toBe(false);
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
    const launchFrame = withBallVelocity(createFrame(
      createCar({ x: 0, y: 0.72, z: 6 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 6, z: 0 },
    ), { x: 0, y: 5, z: 0 });
    const flightFrame = withBallVelocity(createFrame(
      createCar(
        { x: 0, y: 1.8, z: 7 },
        { x: Math.sin(Math.PI / 8), y: 0, z: 0, w: Math.cos(Math.PI / 8) },
        { grounded: false },
      ),
      { x: 0, y: 6, z: 0 },
    ), { x: 0, y: 5, z: 0 });

    expect(bot.command(launchFrame, 0)).toMatchObject({ jumpPressed: true, jumpHeld: true, boost: false });
    expect(bot.command(launchFrame, 1).boost).toBe(false);
    expect(bot.command(flightFrame, 1)).toMatchObject({ jumpPressed: false, boost: true });
    expect(bot.command(flightFrame, 8)).toMatchObject({ jumpPressed: true, boost: false });
  });

  it('pitches back down toward the ball instead of abandoning an aerial after rising above it', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const launchFrame = withBallVelocity(createFrame(
      createCar({ x: 0, y: 0.72, z: 6 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 6, z: 0 },
    ), { x: 0, y: 2, z: 0 });
    const overshootFrame = withBallVelocity(createFrame(
      createCar(
        { x: 0, y: 7, z: 3 },
        { x: 0, y: 0, z: 0, w: 1 },
        { grounded: false, linearVelocity: { x: 0, y: 1, z: -6 } },
      ),
      { x: 0, y: 6, z: 0 },
    ), { x: 0, y: 2, z: 0 });

    expect(bot.command(launchFrame, 0).jumpPressed).toBe(true);
    const correction = bot.command(overshootFrame, 20);
    expect(correction).toMatchObject({ boost: false });
    expect(correction.throttle).toBeGreaterThan(0.5);
  });

  it('rejects an aerial when the ball is falling too quickly to intercept', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const base = createFrame(
      createCar({ x: 0, y: 0.72, z: 6 }, { x: 0, y: 0, z: 0, w: 1 }),
      { x: 0, y: 8, z: 0 },
    );
    const frame = withBallVelocity(base, { x: 0, y: -2, z: 0 });

    expect(bot.command(frame, 0).jumpPressed).toBe(false);
  });

  it('levels an airborne car instead of applying ground throttle as pitch-down input', () => {
    const bot = new BotController('bot', 'azure', 'striker');
    const frame = createFrame(
      createCar(
        { x: 0, y: 5, z: 20 },
        { x: 0, y: 0, z: 0, w: 1 },
        { grounded: false, linearVelocity: { x: 0, y: -2, z: 0 } },
      ),
      { x: 0, y: 1.35, z: 0 },
    );

    expect(bot.command(frame, 0)).toMatchObject({ throttle: 0, boost: false });
  });

  it('steers in wall-relative directions toward a ball above the car', () => {
    const bot = new BotController('bot', 'coral', 'striker');
    const frame = createFrame(
      createCar(
        { x: ARENA_TUNING.halfWidth - 0.54, y: 1.8, z: 10 },
        { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
        { surfaceNormal: { x: -1, y: 0, z: 0 } },
      ),
      { x: ARENA_TUNING.halfWidth - 1.35, y: 8, z: 0 },
    );

    const command = bot.command(frame, 0);

    expect(command.throttle).toBeGreaterThan(0);
    expect(Math.abs(command.steer)).toBeGreaterThan(0.2);
    expect(command.jumpPressed).toBe(false);
  });

  it.each([
    ['azure', { x: 0, y: 0, z: 0, w: 1 }, 18, 20],
    ['coral', { x: 0, y: 1, z: 0, w: 0 }, -18, -20],
  ] as const)('turns forward to stage behind the ball for %s', (team, rotation, carZ, ballZ) => {
    const bot = new BotController('bot', team, 'striker');
    const frame = createFrame(
      createCar({ x: 6, y: 0.72, z: carZ }, rotation),
      { x: 0, y: 1.35, z: ballZ },
    );

    expect(bot.command(frame, 0)).toMatchObject({ throttle: 1, boost: false });
    expect(Math.abs(bot.command(frame, 0).steer)).toBe(1);
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

  it('abandons a prolonged orbit and commits to a reachable contact lane', () => {
    const bot = new BotController('bot', 'coral', 'striker');
    const frame = createFrame(
      createCar({ x: 15, y: 0.72, z: -3 }, { x: 0, y: 1, z: 0, w: 0 }),
      { x: 0, y: 1.35, z: 0 },
    );

    bot.command(frame, 0);
    expect(Reflect.get(bot, 'strikeLaneCommitted')).toBe(false);
    expect(Reflect.get(bot, 'orbitStartedTick')).toBe(0);
    bot.command(frame, 149);
    expect(Reflect.get(bot, 'strikeLaneCommitted')).toBe(false);
    bot.command(frame, 150);
    expect(Reflect.get(bot, 'strikeLaneCommitted')).toBe(true);
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

    expect(bot.command(frame, 0).throttle).toBe(1);
  });

  it.each([
    ['azure', { x: 0, y: 0, z: 0, w: 1 }, 29],
    ['coral', { x: 0, y: 1, z: 0, w: 0 }, -29],
  ] as const)('separates the %s striker and defender at kickoff', (team, rotation, carZ) => {
    const teamPlayerIds = ['challenger', 'cover'];
    const coordinator = new BotTeamCoordinator(team, teamPlayerIds);
    const frame = createFrame(
      createCar({ x: 0, y: 0.72, z: carZ }, rotation),
      { x: 0, y: 1.35, z: 0 },
      {
        cover: createCar(
          { x: 8, y: 0.72, z: carZ + Math.sign(carZ) * 16 },
          rotation,
        ),
      },
      'challenger',
    );
    const strikerController = new BotController(
      'challenger', team, 'striker', false, undefined, teamPlayerIds, coordinator,
    );
    const defenderController = new BotController(
      'cover', team, 'defender', false, undefined, teamPlayerIds, coordinator,
    );
    const countdown = withMatchPhase(frame, 'countdown');
    strikerController.command(countdown, 0);
    defenderController.command(countdown, 0);
    const striker = strikerController.command(frame, 1);
    const defender = defenderController.command(frame, 1);

    expect(striker.throttle).toBe(1);
    expect(defender).toMatchObject({ throttle: 1, boost: false });
    expect(strikerController.tacticalState()?.role).toBe('first');
    expect(defenderController.tacticalState()?.role).toBe('third');
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
    expect(bot.command(frame, 74).jumpPressed).toBe(false);
    expect(bot.command(frame, 75)).toMatchObject({ jumpPressed: true, jumpHeld: true });
    expect(bot.command(frame, 76)).toMatchObject({ jumpPressed: false, jumpHeld: true });
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
      techniques: {
        ground: {
          balanced: { value: 0.1, samples: 5 },
          safe: { value: 0.3, samples: 5 },
        },
        aerial: {
          balanced: { value: 0.2, samples: 5 },
          aggressive: { value: 0.4, samples: 5 },
        },
      },
    });
    const bot = new BotController('bot', 'azure', 'striker', false, knowledge);

    expect(bot.learningState().policy).toBe('press');
    expect(bot.learningState().techniques).toEqual({ ground: 'safe', aerial: 'aggressive' });
  });

  it('keeps training technique assignments stable for paired generations', () => {
    const knowledge206 = normalizeBotKnowledge({ generation: 206 });
    const knowledge207 = normalizeBotKnowledge({ generation: 207 });
    const knowledge208 = normalizeBotKnowledge({ generation: 208 });
    const techniques = (knowledge: ReturnType<typeof normalizeBotKnowledge>) => (
      new BotController('bot-azure-0', 'azure', 'striker', true, knowledge).learningState().techniques
    );

    expect(techniques(knowledge207)).toEqual(techniques(knowledge206));
    expect(techniques(knowledge208)).not.toEqual(techniques(knowledge207));
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

const withBallVelocity = (
  frame: AuthoritativeFrame,
  linearVelocity: AuthoritativeFrame['snapshot']['ball']['linearVelocity'],
): AuthoritativeFrame => ({
  ...frame,
  snapshot: {
    ...frame.snapshot,
    ball: { ...frame.snapshot.ball, linearVelocity },
  },
});
