import { describe, expect, it } from 'vitest';
import { formatCarPosition } from '../../src/ui/UIManager';

describe('debug car position', () => {
  it('formats all world axes next to the FPS counter', () => {
    expect(formatCarPosition({ x: 0, y: 0.72, z: -1.234 })).toBe('X 0.00 Y 0.72 Z -1.23');
  });

  it('does not display negative zero near midfield', () => {
    expect(formatCarPosition({ x: -0.001, y: 0.718, z: 0.002 })).toBe('X 0.00 Y 0.72 Z 0.00');
  });
});
