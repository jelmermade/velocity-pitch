import { describe, expect, it, vi } from 'vitest';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import { DEFAULT_MATCH_SETTINGS } from '../../src/gameplay/match/MatchSettings';
import type { StartedLobby } from '../../src/networking/WebSocketLobbyClient';
import { NetworkSession } from '../../src/networking/NetworkSession';
import type { AuthoritativeFrame } from '../../src/networking/LobbyProtocol';

describe('network session input sending', () => {
  it('sends state changes immediately without sending duplicate input every physics tick', () => {
    const sendGuestInput = vi.fn();
    const session = new NetworkSession({
      lobbyId: 'ABC123',
      playerId: 'guest',
      hostId: 'host',
      players: [
        { id: 'host', name: 'Host', team: 'azure', host: true },
        { id: 'guest', name: 'Guest', team: 'coral', host: false },
      ],
      settings: DEFAULT_MATCH_SETTINGS,
      client: { sendGuestInput } as unknown as StartedLobby['client'],
    });

    session.commandsForTick(0, NEUTRAL_COMMAND);
    session.commandsForTick(1, NEUTRAL_COMMAND);
    session.commandsForTick(2, { ...NEUTRAL_COMMAND, throttle: 1 });
    session.commandsForTick(3, { ...NEUTRAL_COMMAND, throttle: 1 });
    session.commandsForTick(4, { ...NEUTRAL_COMMAND, throttle: 1, jumpPressed: true, jumpHeld: true });

    expect(sendGuestInput).toHaveBeenCalledTimes(3);
    expect(sendGuestInput).toHaveBeenLastCalledWith({
      ...NEUTRAL_COMMAND,
      throttle: 1,
      jumpPressed: true,
      jumpHeld: true,
    });
  });

  it('sends an unchanged command periodically as a heartbeat', () => {
    const sendGuestInput = vi.fn();
    const session = new NetworkSession({
      lobbyId: 'ABC123',
      playerId: 'guest',
      hostId: 'host',
      players: [{ id: 'guest', name: 'Guest', team: 'coral', host: false }],
      settings: DEFAULT_MATCH_SETTINGS,
      client: { sendGuestInput } as unknown as StartedLobby['client'],
    });

    session.commandsForTick(0, NEUTRAL_COMMAND);
    session.commandsForTick(14, NEUTRAL_COMMAND);
    session.commandsForTick(15, NEUTRAL_COMMAND);

    expect(sendGuestInput).toHaveBeenCalledTimes(2);
  });

  it('runs bot controllers on the authoritative multiplayer host', () => {
    const commandsForHost = vi.fn(() => new Map([['host', NEUTRAL_COMMAND]]));
    const players = [
      { id: 'host', name: 'Host', team: 'azure', host: true },
      { id: 'bot-coral-0', name: 'Ember [BOT]', team: 'coral', host: false, bot: true },
    ] as const;
    const session = new NetworkSession({
      lobbyId: 'ABC123',
      playerId: 'host',
      hostId: 'host',
      players,
      settings: { ...DEFAULT_MATCH_SETTINGS, teamSize: 1 },
      client: { commandsForHost } as unknown as StartedLobby['client'],
    });
    const frame = botFrame();

    const commands = session.commandsForTick(0, NEUTRAL_COMMAND, frame);

    expect(commands.get('host')).toBe(NEUTRAL_COMMAND);
    expect(commands.get('bot-coral-0')?.throttle).toBe(1);
  });
});

const botFrame = (): AuthoritativeFrame => {
  const host = carState(23, false);
  const bot = carState(-23, true);
  return {
    sequence: 0,
    cars: { host, 'bot-coral-0': bot },
    snapshot: {
      tick: 0,
      car: host,
      ball: {
        transform: { position: { x: 0, y: 1.35, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        linearVelocity: { x: 0, y: 0, z: 0 },
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
    },
  };
};

const carState = (z: number, coral: boolean): AuthoritativeFrame['snapshot']['car'] => ({
  transform: {
    position: { x: 0, y: 0.72, z },
    rotation: coral ? { x: 0, y: 1, z: 0, w: 0 } : { x: 0, y: 0, z: 0, w: 1 },
  },
  linearVelocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  wheels: [],
  grounded: true,
  boost: 100,
  boosting: false,
});
