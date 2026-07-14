import { describe, expect, it } from 'vitest';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import { clearCommandEdges, mergeCommandEdges } from '../../src/networking/PlayerCommandBuffer';

describe('guest command buffering', () => {
  it('keeps a jump edge latched when a newer held command arrives before host simulation', () => {
    const pressed = { ...NEUTRAL_COMMAND, jumpPressed: true, jumpHeld: true };
    const held = { ...NEUTRAL_COMMAND, jumpHeld: true, throttle: 1 };

    const buffered = mergeCommandEdges(pressed, held);

    expect(buffered.jumpPressed).toBe(true);
    expect(buffered.jumpHeld).toBe(true);
    expect(buffered.throttle).toBe(1);
  });

  it('clears consumed edges without clearing held controls', () => {
    const consumed = clearCommandEdges({
      ...NEUTRAL_COMMAND,
      jumpPressed: true,
      jumpHeld: true,
      toggleBallCamera: true,
    });

    expect(consumed.jumpPressed).toBe(false);
    expect(consumed.toggleBallCamera).toBe(false);
    expect(consumed.jumpHeld).toBe(true);
  });
});
