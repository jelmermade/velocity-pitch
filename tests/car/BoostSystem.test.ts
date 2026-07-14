import { describe, expect, it } from 'vitest';
import { BoostSystem } from '../../src/gameplay/car/BoostSystem';

describe('BoostSystem', () => {
  it('does not recharge after boost runs out while the button remains held', () => {
    const boost = new BoostSystem();
    boost.update(true, 30, 5, 4);

    expect(boost.value()).toBe(0);
    expect(boost.update(true, 30, 5, 1)).toBe(false);
    expect(boost.value()).toBe(0);

    boost.update(false, 30, 5, 1);
    expect(boost.value()).toBe(5);
  });

  it('does not recharge while boost is held but temporarily disallowed', () => {
    const boost = new BoostSystem();
    boost.update(true, 30, 5, 1);
    const before = boost.value();

    expect(boost.update(true, 30, 5, 1, false)).toBe(false);
    expect(boost.value()).toBe(before);
  });
});
