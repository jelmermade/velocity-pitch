import { describe, expect, it } from 'vitest';
import { formatCarPosition, playerRosterMarkup } from '../../src/ui/UIManager';

describe('debug car position', () => {
  it('formats all world axes next to the FPS counter', () => {
    expect(formatCarPosition({ x: 0, y: 0.72, z: -1.234 })).toBe('X 0.00 Y 0.72 Z -1.23');
  });

  it('does not display negative zero near midfield', () => {
    expect(formatCarPosition({ x: -0.001, y: 0.718, z: 0.002 })).toBe('X 0.00 Y 0.72 Z 0.00');
  });
});

describe('player scoreboard roster', () => {
  it('groups players by team and escapes driver names', () => {
    const markup = playerRosterMarkup([
      { id: 'host', name: 'Host <One>', team: 'azure', host: true },
      { id: 'guest', name: 'Guest', team: 'coral', host: false },
    ], 'azure', 'host');

    expect(markup).toContain('Host &lt;One&gt;');
    expect(markup).toContain('HOST // YOU');
    expect(markup).not.toContain('Guest');
  });
});
