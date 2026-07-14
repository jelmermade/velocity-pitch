import { describe, expect, it } from 'vitest';
import { AdaptivePixelRatio } from '../../src/rendering/AdaptivePixelRatio';

describe('adaptive pixel ratio', () => {
  it('quickly lowers render resolution when frame rate is far below target', () => {
    const quality = new AdaptivePixelRatio(1, 0.6, 1, 60);
    let adjustment: number | null = null;
    for (let frame = 0; frame < 21; frame += 1) adjustment = quality.update(1 / 20) ?? adjustment;

    expect(adjustment).toBe(0.6);
  });

  it('gradually restores resolution when the target frame rate is sustained', () => {
    const quality = new AdaptivePixelRatio(0.6, 0.6, 1, 60);
    let adjustment: number | null = null;
    for (let frame = 0; frame < 61; frame += 1) adjustment = quality.update(1 / 60) ?? adjustment;

    expect(adjustment).toBe(0.65);
  });

  it('does not change quality while frame rate is close to target', () => {
    const quality = new AdaptivePixelRatio(0.8, 0.6, 1, 60);
    let adjustment: number | null = null;
    for (let frame = 0; frame < 58; frame += 1) adjustment = quality.update(1 / 58) ?? adjustment;

    expect(adjustment).toBeNull();
  });
});
