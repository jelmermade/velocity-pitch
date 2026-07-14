import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '../../src/core/math/Quaternion';
import { GoalReplayBuffer } from '../../src/gameplay/replay/GoalReplayBuffer';
import type { SimulationSnapshot } from '../../src/gameplay/simulation/SimulationSnapshot';

describe('GoalReplayBuffer', () => {
  it('samples from recorded play through the frozen goal frame', () => {
    const replay = new GoalReplayBuffer();
    replay.record(snapshot(0, 0));
    replay.record(snapshot(1, 5));
    replay.freeze(snapshot(2, 10));

    expect(replay.sample(0)?.ball.transform.position.z).toBe(0);
    expect(replay.sample(0.5)?.ball.transform.position.z).toBe(5);
    expect(replay.sample(1)?.ball.transform.position.z).toBe(10);
  });
});

const snapshot = (tick: number, ballZ: number): SimulationSnapshot => ({
  tick,
  car: {
    transform: { position: { x: 0, y: 0.62, z: 23 }, rotation: IDENTITY_QUAT },
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    wheels: [],
    grounded: true,
    boost: 100,
    boosting: false,
  },
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
