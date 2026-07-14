import { describe, expect, it } from 'vitest';
import { fillBotSlots } from '../../src/gameplay/bots/BotRoster';
import type { LobbyPlayer } from '../../src/networking/LobbyProtocol';

const host: LobbyPlayer = { id: 'host', name: 'Host', team: 'azure', host: true };

describe('bot-filled rosters', () => {
  it.each([1, 2, 3] as const)('fills both sides of a %sv%s match', (teamSize) => {
    const roster = fillBotSlots([host], teamSize);

    expect(roster).toHaveLength(teamSize * 2);
    expect(roster.filter(({ team }) => team === 'azure')).toHaveLength(teamSize);
    expect(roster.filter(({ team }) => team === 'coral')).toHaveLength(teamSize);
  });

  it('removes the bot occupying a slot when a real player joins that team', () => {
    const botsOnly = fillBotSlots([host], 2);
    const withGuest = fillBotSlots([
      host,
      { id: 'guest', name: 'Guest', team: 'coral', host: false },
    ], 2);

    expect(botsOnly.map(({ id }) => id)).toContain('bot-coral-0');
    expect(withGuest.map(({ id }) => id)).not.toContain('bot-coral-0');
    expect(withGuest.map(({ id }) => id)).toContain('bot-coral-1');
    expect(withGuest).toHaveLength(4);
  });
});
