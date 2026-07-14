import { describe, expect, it } from 'vitest';
import { formatCarPosition, playerRosterMarkup, trainingCompletionMarkup } from '../../src/ui/UIManager';
import { VEHICLE_CONFIG } from '../../src/core/config/GameplayScale';
import { botLabTuningMarkup, gameplayConfigJson } from '../../src/ui/BotLabTuningPanel';

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

describe('Bot Lab completion controls', () => {
  it('offers another five-minute cycle or a return to the menu', () => {
    const markup = trainingCompletionMarkup();

    expect(markup).toContain('data-training-restart');
    expect(markup).toContain('RUN ANOTHER 5 MINUTES');
    expect(markup).toContain('data-training-menu');
    expect(markup).toContain('BACK TO MENU');
  });
});

describe('Bot Lab live tuning', () => {
  it('renders temporary controls and exports a complete gameplay config', () => {
    const vehicle = { ...VEHICLE_CONFIG, driveTopSpeed: 34, boostTopSpeed: 48 };
    const markup = botLabTuningMarkup(vehicle);
    const exported = JSON.parse(gameplayConfigJson(vehicle, { arenaScale: 2.2, ballSize: 1.6 })) as {
      arenaScale: number;
      ballSize: number;
      vehicle: typeof vehicle;
    };

    expect(markup).toContain('data-bot-lab-tuning-input');
    expect(markup).toContain('COPY JSON');
    expect(markup).toContain('name="arenaScale"');
    expect(markup).toContain('name="ballSize"');
    expect(markup).toContain('REBUILD BOT LAB');
    expect(exported.arenaScale).toBe(2.2);
    expect(exported.ballSize).toBe(1.6);
    expect(exported.vehicle.driveTopSpeed).toBe(34);
    expect(exported.vehicle.boostTopSpeed).toBe(48);
  });
});
