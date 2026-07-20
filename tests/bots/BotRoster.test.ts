import { describe, expect, it } from 'vitest';
import { botRole, createBotTrainingRoster, fillBotSlots } from '../../src/gameplay/bots/BotRoster';
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

  it('creates six unique bots for the temporary 3v3 training match', () => {
    const roster = createBotTrainingRoster();

    expect(roster).toHaveLength(6);
    expect(roster.filter(({ team }) => team === 'azure')).toHaveLength(3);
    expect(roster.filter(({ team }) => team === 'coral')).toHaveLength(3);
    expect(new Set(roster.map(({ id }) => id)).size).toBe(6);
  });

  it('randomizes bot teams while preserving two strikers and one defender per side', () => {
    const originalOrder = createBotTrainingRoster(() => 0.999999);
    const shuffled = createBotTrainingRoster(() => 0);

    for (const roster of [originalOrder, shuffled]) {
      for (const team of ['azure', 'coral'] as const) {
        const teamPlayers = roster.filter((player) => player.team === team);
        expect(teamPlayers.filter((player) => botRole(player) === 'striker')).toHaveLength(2);
        expect(teamPlayers.filter((player) => botRole(player) === 'defender')).toHaveLength(1);
      }
    }
    expect(shuffled.map(({ id, team }) => `${id}:${team}`))
      .not.toEqual(originalOrder.map(({ id, team }) => `${id}:${team}`));
  });
});
