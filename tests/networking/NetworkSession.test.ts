import { describe, expect, it, vi } from 'vitest';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import { DEFAULT_MATCH_SETTINGS } from '../../src/gameplay/match/MatchSettings';
import type { StartedLobby } from '../../src/networking/WebSocketLobbyClient';
import { NetworkSession } from '../../src/networking/NetworkSession';

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
});
