import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MATCH_SETTINGS } from '../../src/gameplay/match/MatchSettings';
import type { WebSocketLobbyClient } from '../../src/networking/WebSocketLobbyClient';

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  readonly sent: string[] = [];
  readyState = FakeWebSocket.OPEN;

  constructor(readonly url: string) {
    super();
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }

  send(payload: string): void { this.sent.push(payload); }
  close(): void { this.readyState = 3; }

  receive(payload: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }
}

describe('WebSocketLobbyClient lobby discovery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests lobby summaries and resolves the server response', async () => {
    const Client = await loadClient();
    const client = await Client.connect('ws://test');
    const socket = latestSocket(client);
    const pending = client.listLobbies();
    const lobbies = [{
      id: 'ABC123',
      name: 'Friday Finals',
      hostName: 'Host',
      playerCount: 1,
      maximumPlayers: 4,
      teamSize: 2,
      passwordProtected: true,
    }];

    expect(JSON.parse(socket.sent[0] ?? '')).toEqual({ type: 'listLobbies' });
    socket.receive({ type: 'lobbyList', lobbies });

    await expect(pending).resolves.toEqual(lobbies);
  });

  it('sends passwords when creating and joining protected lobbies', async () => {
    const Client = await loadClient();
    const creator = await Client.connect('ws://test');
    const creatorSocket = latestSocket(creator);
    void creator.createLobby('Host', DEFAULT_MATCH_SETTINGS, 'secret', 'Friday Finals');

    expect(JSON.parse(creatorSocket.sent[0] ?? '')).toMatchObject({
      type: 'createLobby',
      lobbyName: 'Friday Finals',
      password: 'secret',
      settings: DEFAULT_MATCH_SETTINGS,
    });

    const guest = await Client.connect('ws://test');
    const guestSocket = latestSocket(guest);
    void guest.joinLobby('ABC123', 'Guest', 'secret');

    expect(JSON.parse(guestSocket.sent[0] ?? '')).toEqual({
      type: 'joinLobby',
      lobbyId: 'ABC123',
      playerName: 'Guest',
      password: 'secret',
    });
  });

  it('sends host moderation commands and receives match controls', async () => {
    const Client = await loadClient();
    const client = await Client.connect('ws://test');
    const socket = latestSocket(client);
    const joined = client.createLobby('Host', DEFAULT_MATCH_SETTINGS);
    socket.receive({
      type: 'lobbyJoined',
      lobbyId: 'ABC123',
      lobbyName: "Host's Lobby",
      playerId: 'host',
      players: [{ id: 'host', name: 'Host', team: 'azure', host: true }],
      settings: DEFAULT_MATCH_SETTINGS,
    });
    await joined;
    const controls: string[] = [];
    let returnedToLobby = 0;
    client.onMatchControl((action) => controls.push(action));
    client.onReturnedToLobby(() => { returnedToLobby += 1; });

    client.setPlayerTeam('guest', 'azure');
    client.kickPlayer('guest');
    client.controlMatch('reset');
    client.finishMatch();
    socket.receive({ type: 'matchControl', action: 'reset' });
    socket.receive({
      type: 'returnedToLobby',
      players: [{ id: 'host', name: 'Host', team: 'azure', host: true }],
      settings: DEFAULT_MATCH_SETTINGS,
    });

    expect(socket.sent.slice(1).map((payload) => JSON.parse(payload) as unknown)).toEqual([
      { type: 'setPlayerTeam', playerId: 'guest', team: 'azure' },
      { type: 'kickPlayer', playerId: 'guest' },
      { type: 'matchControl', action: 'reset' },
      { type: 'finishMatch' },
    ]);
    expect(controls).toEqual(['reset']);
    expect(returnedToLobby).toBe(1);
  });

  it('sends chat and keeps a bounded received-message history', async () => {
    const Client = await loadClient();
    const client = await Client.connect('ws://test');
    const socket = latestSocket(client);
    const received: string[] = [];
    client.onChat((message) => received.push(message.text));

    client.sendChat('  hello drivers  ');
    socket.receive({
      type: 'chat',
      message: {
        playerId: 'host',
        playerName: 'Host',
        team: 'azure',
        text: 'hello drivers',
        sentAt: 1,
      },
    });

    expect(JSON.parse(socket.sent[0] ?? '')).toEqual({ type: 'chat', text: 'hello drivers' });
    expect(received).toEqual(['hello drivers']);
    expect(client.currentChatMessages().map(({ text }) => text)).toEqual(['hello drivers']);
  });
});

const loadClient = async (): Promise<typeof WebSocketLobbyClient> => {
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'test' } });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return (await import('../../src/networking/WebSocketLobbyClient')).WebSocketLobbyClient;
};

const latestSocket = (client: WebSocketLobbyClient): FakeWebSocket => (
  (client as unknown as { socket: FakeWebSocket }).socket
);
