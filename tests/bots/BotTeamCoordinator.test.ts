import { describe, expect, it } from 'vitest';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import type { Vec3 } from '../../src/core/math/Vector3';
import { BotTeamCoordinator } from '../../src/gameplay/bots/BotTeamCoordinator';
import type { CarState } from '../../src/gameplay/car/CarState';
import type { AuthoritativeFrame } from '../../src/networking/LobbyProtocol';

const TEAM_IDS = ['first-candidate', 'fast-teammate', 'last-man'] as const;
const OPPONENT_IDS = ['opponent'] as const;

describe('bot team coordinator', () => {
  it('assigns exactly one first man from arrival confidence instead of raw distance', () => {
    const coordinator = new BotTeamCoordinator('azure', TEAM_IDS, OPPONENT_IDS);
    const frame = createFrame({
      'first-candidate': createCar({ x: 0, y: 0.72, z: 8 }, awayFromAzureAttack, {
        boost: 4,
        linearVelocity: { x: 0, y: 0, z: 10 },
      }),
      'fast-teammate': createCar({ x: -3, y: 0.72, z: 14 }, towardAzureAttack, {
        boost: 70,
        linearVelocity: { x: 0, y: 0, z: -13 },
      }),
      'last-man': createCar({ x: 12, y: 0.72, z: 30 }, towardAzureAttack),
      opponent: createCar({ x: 5, y: 0.72, z: -18 }, awayFromAzureAttack),
    });

    const plans = coordinator.plans(frame, 0);
    const firstMen = [...plans.values()].filter(({ role }) => role === 'first');
    const challenges = [...plans.values()].filter(({ intent }) => intent === 'challenge');

    expect(firstMen.map(({ playerId }) => playerId)).toEqual(['fast-teammate']);
    expect(challenges.map(({ playerId }) => playerId)).toEqual(['fast-teammate']);
    expect(plans.get('first-candidate')?.challengeAllowed).toBe(false);
  });

  it('forms a pressure-support-cover triangle with separated target lanes', () => {
    const coordinator = new BotTeamCoordinator('azure', TEAM_IDS, OPPONENT_IDS);
    const frame = createFrame({
      'first-candidate': createCar({ x: -2, y: 0.72, z: 8 }, towardAzureAttack, {
        linearVelocity: { x: 0, y: 0, z: -8 },
      }),
      'fast-teammate': createCar({ x: 9, y: 0.72, z: 20 }, towardAzureAttack),
      'last-man': createCar({ x: -5, y: 0.72, z: 38 }, towardAzureAttack),
      opponent: createCar({ x: 0, y: 0.72, z: -20 }, awayFromAzureAttack),
    });

    const plans = [...coordinator.plans(frame, 0).values()];
    const first = plans.find(({ role }) => role === 'first');
    const second = plans.find(({ role }) => role === 'second');
    const third = plans.find(({ role }) => role === 'third');

    expect(first?.intent).toBe('challenge');
    expect(second?.intent).toBe('support');
    expect(third?.intent).toBe('cover');
    expect(horizontalDistance(second?.target, third?.target)).toBeGreaterThan(14);
    expect((second?.target.z ?? 0)).toBeGreaterThan(first?.intercept.z ?? 0);
    expect((third?.target.z ?? 0)).toBeGreaterThan(second?.target.z ?? 0);
    expect(Math.sign(second?.target.x ?? 0)).not.toBe(Math.sign(frame.cars['first-candidate']?.transform.position.x ?? 0));
  });

  it('shadows instead of diving when nobody covers behind the first man', () => {
    const coordinator = new BotTeamCoordinator('azure', TEAM_IDS, OPPONENT_IDS);
    const frame = createFrame({
      'first-candidate': createCar({ x: 0, y: 0.72, z: 3 }, towardAzureAttack),
      'fast-teammate': createCar({ x: 8, y: 0.72, z: -14 }, towardAzureAttack),
      'last-man': createCar({ x: -8, y: 0.72, z: -24 }, towardAzureAttack),
      opponent: createCar({ x: 1, y: 0.72, z: -1 }, awayFromAzureAttack, {
        linearVelocity: { x: 0, y: 0, z: 5 },
      }),
    }, { x: 0, y: 1.35, z: 0 }, { x: 0, y: 0, z: 9 });

    const first = [...coordinator.plans(frame, 0).values()].find(({ role }) => role === 'first');

    expect(first?.challengeAllowed).toBe(false);
    expect(first?.intent).toBe('shadow');
    expect((first?.target.z ?? 0)).toBeGreaterThan(0);
  });

  it('sends the challenger to back-post rotation immediately after a touch', () => {
    const coordinator = new BotTeamCoordinator('azure', TEAM_IDS, OPPONENT_IDS);
    const before = createFrame({
      'first-candidate': createCar({ x: 0, y: 0.72, z: 5 }, towardAzureAttack, {
        linearVelocity: { x: 0, y: 0, z: -8 },
      }),
      'fast-teammate': createCar({ x: 8, y: 0.72, z: 18 }, towardAzureAttack),
      'last-man': createCar({ x: -8, y: 0.72, z: 34 }, towardAzureAttack),
      opponent: createCar({ x: 0, y: 0.72, z: -25 }, awayFromAzureAttack),
    });
    expect(coordinator.planFor('first-candidate', before, 0)?.intent).toBe('challenge');

    const after = createFrame({
      ...before.cars,
      'first-candidate': createCar({ x: 0, y: 0.72, z: 1.5 }, towardAzureAttack, {
        linearVelocity: { x: 0, y: 0, z: -10 },
      }),
    }, { x: 0, y: 1.35, z: -1 }, { x: 0, y: 0, z: -9 });
    const plans = coordinator.plans(after, 1);

    expect(plans.get('first-candidate')).toMatchObject({ role: 'third', intent: 'rotate' });
    expect(plans.get('first-candidate')?.target.z).toBeGreaterThan(40);
    expect([...plans.values()].filter(({ intent }) => intent === 'challenge')).toHaveLength(1);
  });

  it('abandons a committed challenge when the ball path moves behind the car', () => {
    const coordinator = new BotTeamCoordinator('azure', TEAM_IDS);
    const initial = createFrame({
      'first-candidate': createCar({ x: 0, y: 0.72, z: 5 }, towardAzureAttack, {
        linearVelocity: { x: 0, y: 0, z: -8 },
      }),
      'fast-teammate': createCar({ x: 12, y: 0.72, z: 30 }, towardAzureAttack),
      'last-man': createCar({ x: -10, y: 0.72, z: 42 }, towardAzureAttack),
    });
    expect(coordinator.planFor('first-candidate', initial, 0)?.intent).toBe('challenge');

    const passedBall = createFrame({
      'first-candidate': createCar({ x: 0, y: 0.72, z: -5 }, towardAzureAttack, {
        linearVelocity: { x: 0, y: 0, z: -8 },
      }),
      'fast-teammate': createCar({ x: 12, y: 0.72, z: 30 }, towardAzureAttack),
      'last-man': createCar({ x: -10, y: 0.72, z: 42 }, towardAzureAttack),
    });

    expect(coordinator.planFor('first-candidate', passedBall, 1)?.intent).not.toBe('challenge');
  });

  it('predicts a side-wall rebound inside the playable field', () => {
    const coordinator = new BotTeamCoordinator('azure', ['first-candidate']);
    const ball = { x: ARENA_TUNING.halfWidth - 2, y: 2, z: -2 };
    const frame = createFrame({
      'first-candidate': createCar({ x: 16, y: 0.72, z: 12 }, towardAzureAttack, {
        linearVelocity: { x: 5, y: 0, z: -8 },
      }),
    }, ball, { x: 20, y: 0, z: -1 });

    const plan = coordinator.planFor('first-candidate', frame, 0);

    expect(Math.abs(plan?.intercept.x ?? Number.POSITIVE_INFINITY)).toBeLessThan(
      ARENA_TUNING.halfWidth - 1,
    );
    expect(plan?.intercept.x).toBeLessThan(ball.x);
    expect(plan?.interceptSeconds).toBeGreaterThan(0);
    expect(Math.abs(plan?.timingErrorSeconds ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(0.08);
  });
});

const towardAzureAttack = { x: 0, y: 0, z: 0, w: 1 } as const;
const awayFromAzureAttack = { x: 0, y: 1, z: 0, w: 0 } as const;

const createFrame = (
  cars: Readonly<Record<string, CarState>>,
  ballPosition: Vec3 = { x: 0, y: 1.35, z: 0 },
  ballVelocity: Vec3 = { x: 0, y: 0, z: 0 },
): AuthoritativeFrame => ({
  sequence: 0,
  cars,
  snapshot: {
    tick: 0,
    car: Object.values(cars)[0] ?? createCar({ x: 0, y: 0.72, z: 0 }, towardAzureAttack),
    ball: {
      transform: { position: ballPosition, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      linearVelocity: ballVelocity,
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
  position: Vec3,
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

const horizontalDistance = (left?: Vec3, right?: Vec3): number => (
  left && right ? Math.hypot(right.x - left.x, right.z - left.z) : 0
);
