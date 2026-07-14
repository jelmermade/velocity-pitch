import { describe, expect, it } from 'vitest';
import type { BallState } from '../../src/gameplay/ball/BallState';
import { BallView } from '../../src/rendering/views/BallView';

const BALL_STATE: BallState = {
  transform: {
    position: { x: 2, y: 3, z: 4 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
  linearVelocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
};

describe('BallView visibility', () => {
  it('hides the complete ball group during the winner presentation', () => {
    const view = new BallView();

    view.update(BALL_STATE, false);
    expect(view.group.visible).toBe(false);

    view.update(BALL_STATE);
    expect(view.group.visible).toBe(true);
    view.dispose();
  });
});
