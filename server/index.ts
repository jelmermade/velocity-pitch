import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { ClientLobbyMessage, LobbyPlayer, ServerLobbyMessage } from '../src/networking/LobbyProtocol';

const port = Number(process.env.MULTIPLAYER_PORT ?? 8787);
const host = process.env.MULTIPLAYER_HOST ?? '0.0.0.0';
const maximumPlayers = Number(process.env.MULTIPLAYER_MAX_PLAYERS ?? 4);

interface ClientConnection {
  readonly socket: WebSocket;
  readonly playerId: string;
  lobbyId: string | null;
}

interface Lobby {
  readonly id: string;
  readonly hostId: string;
  readonly clients: Map<string, ClientConnection>;
  readonly players: Map<string, LobbyPlayer>;
  started: boolean;
}

const server = new WebSocketServer({ host, port });
const lobbies = new Map<string, Lobby>();
const connections = new Map<WebSocket, ClientConnection>();

server.on('connection', (socket) => {
  const connection: ClientConnection = { socket, playerId: randomUUID(), lobbyId: null };
  connections.set(socket, connection);
  socket.on('message', (payload) => handleMessage(connection, parseMessage(decodePayload(payload))));
  socket.on('close', () => disconnect(connection));
  socket.on('error', () => disconnect(connection));
});

server.on('listening', () => {
  console.log(`Velocity Pitch multiplayer listening on ws://${host}:${port}`);
});

const handleMessage = (connection: ClientConnection, message: ClientLobbyMessage | null): void => {
  if (!message) {
    send(connection.socket, { type: 'error', message: 'Invalid network message' });
    return;
  }
  if (message.type === 'createLobby') {
    createLobby(connection, message.playerName);
    return;
  }
  if (message.type === 'joinLobby') {
    joinLobby(connection, message.lobbyId, message.playerName);
    return;
  }
  const lobby = connection.lobbyId ? lobbies.get(connection.lobbyId) : undefined;
  if (!lobby) {
    send(connection.socket, { type: 'error', message: 'Join a lobby before sending game messages' });
    return;
  }
  if (message.type === 'startMatch') {
    if (connection.playerId !== lobby.hostId) return;
    lobby.started = true;
    broadcast(lobby, { type: 'matchStarted', players: [...lobby.players.values()], hostId: lobby.hostId });
    return;
  }
  if (message.type === 'input') {
    const hostConnection = lobby.clients.get(lobby.hostId);
    if (hostConnection && connection.playerId !== lobby.hostId) {
      send(hostConnection.socket, {
        type: 'remoteInput',
        playerId: connection.playerId,
        sequence: message.sequence,
        command: message.command,
      });
    }
    return;
  }
  if (connection.playerId === lobby.hostId) {
    lobby.clients.forEach((client, playerId) => {
      if (playerId !== lobby.hostId) send(client.socket, message);
    });
  }
};

const createLobby = (connection: ClientConnection, playerName: string): void => {
  if (connection.lobbyId) return;
  let lobbyId = createLobbyId();
  while (lobbies.has(lobbyId)) lobbyId = createLobbyId();
  const player = createPlayer(connection.playerId, playerName, 'azure', true);
  const lobby: Lobby = {
    id: lobbyId,
    hostId: connection.playerId,
    clients: new Map([[connection.playerId, connection]]),
    players: new Map([[connection.playerId, player]]),
    started: false,
  };
  connection.lobbyId = lobbyId;
  lobbies.set(lobbyId, lobby);
  send(connection.socket, { type: 'lobbyJoined', lobbyId, playerId: connection.playerId, players: [player] });
};

const joinLobby = (connection: ClientConnection, requestedLobbyId: string, playerName: string): void => {
  if (connection.lobbyId) return;
  const lobbyId = requestedLobbyId.trim().toUpperCase();
  const lobby = lobbies.get(lobbyId);
  if (!lobby) {
    send(connection.socket, { type: 'error', message: 'Lobby not found' });
    return;
  }
  if (lobby.started) {
    send(connection.socket, { type: 'error', message: 'This match has already started' });
    return;
  }
  if (lobby.players.size >= maximumPlayers) {
    send(connection.socket, { type: 'error', message: 'This lobby is full' });
    return;
  }
  const team = lobby.players.size % 2 === 0 ? 'azure' : 'coral';
  const player = createPlayer(connection.playerId, playerName, team, false);
  connection.lobbyId = lobbyId;
  lobby.clients.set(connection.playerId, connection);
  lobby.players.set(connection.playerId, player);
  send(connection.socket, {
    type: 'lobbyJoined',
    lobbyId,
    playerId: connection.playerId,
    players: [...lobby.players.values()],
  });
  broadcast(lobby, { type: 'roster', players: [...lobby.players.values()] });
};

const disconnect = (connection: ClientConnection): void => {
  connections.delete(connection.socket);
  if (!connection.lobbyId) return;
  const lobby = lobbies.get(connection.lobbyId);
  if (!lobby) return;
  lobby.clients.delete(connection.playerId);
  lobby.players.delete(connection.playerId);
  connection.lobbyId = null;
  if (connection.playerId === lobby.hostId || lobby.players.size === 0) {
    lobby.clients.forEach((client) => send(client.socket, { type: 'error', message: 'The lobby host disconnected' }));
    lobbies.delete(lobby.id);
    return;
  }
  broadcast(lobby, { type: 'roster', players: [...lobby.players.values()] });
};

const createPlayer = (id: string, rawName: string, team: LobbyPlayer['team'], isHost: boolean): LobbyPlayer => ({
  id,
  name: rawName.trim().slice(0, 20) || 'Driver',
  team,
  host: isHost,
});

const createLobbyId = (): string => randomBytes(3).toString('hex').toUpperCase();

const decodePayload = (payload: RawData): string => {
  if (payload instanceof ArrayBuffer) return Buffer.from(payload).toString('utf8');
  if (Array.isArray(payload)) return Buffer.concat(payload).toString('utf8');
  return payload.toString('utf8');
};

const parseMessage = (payload: string): ClientLobbyMessage | null => {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed) || typeof parsed.type !== 'string') return null;
    return parsed as ClientLobbyMessage;
  } catch {
    return null;
  }
};

const send = (socket: WebSocket, message: ServerLobbyMessage | ClientLobbyMessage): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

const broadcast = (lobby: Lobby, message: ServerLobbyMessage): void => {
  lobby.clients.forEach(({ socket }) => send(socket, message));
};
