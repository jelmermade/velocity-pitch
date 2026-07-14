import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '../../src/core/math/Quaternion';
import { GoalReplayBuffer } from '../../src/gameplay/replay/GoalReplayBuffer';
import type { SimulationSnapshot } from '../../src/gameplay/simulation/SimulationSnapshot';

describe('GoalReplayBuffer', () => {
  it('samples from recorded play through the frozen goal frame', () => {
    const replay = new GoalReplayBuffer();
    replay.record(snapshot(0, 0), cars(0));
    replay.record(snapshot(1, 5), cars(5));
    replay.freeze(snapshot(2, 10), cars(10));

    expect(replay.sample(0)?.snapshot.ball.transform.position.z).toBe(0);
    expect(replay.sample(0.5)?.snapshot.ball.transform.position.z).toBe(5);
    expect(replay.sample(1)?.snapshot.ball.transform.position.z).toBe(10);
  });

  it('records and interpolates every car in the replay', () => {
    const replay = new GoalReplayBuffer();
    replay.record(snapshot(0, 0), cars(0));
    replay.freeze(snapshot(1, 10), cars(10));

    const sampled = replay.sample(0.5);

    expect(Object.keys(sampled?.cars ?? {})).toEqual(['local', 'bot']);
    expect(sampled?.cars.local?.transform.position.z).toBeCloseTo(5);
    expect(sampled?.cars.bot?.transform.position.z).toBeCloseTo(-5);
  });
});

const cars = (z: number) => ({
  local: carState(z),
  bot: carState(-z),
});

const carState = (z: number): SimulationSnapshot['car'] => ({
  transform: { position: { x: 0, y: 0.62, z }, rotation: IDENTITY_QUAT },
  linearVelocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  wheels: [],
  grounded: true,
  boost: 100,
  boosting: false,
});

const snapshot = (tick: number, ballZ: number): SimulationSnapshot => ({
  tick,
  car: carState(23),
  ball: {
    transform: { position: { x: 0, y: 1.5, z: ballZ }, rotation: IDENTITY_QUAT },
    linearVelocity: { x: 0, y: 0, z: 5 },
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
});
