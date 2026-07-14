import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type {
  ClientLobbyMessage,
  LobbyPlayer,
  LobbySummary,
  MatchControlAction,
  ServerLobbyMessage,
  TeamId,
} from '../src/networking/LobbyProtocol';
import { sanitizeMatchSettings, type MatchSettings } from '../src/gameplay/match/MatchSettings';

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
  readonly name: string;
  readonly hostId: string;
  readonly clients: Map<string, ClientConnection>;
  readonly players: Map<string, LobbyPlayer>;
  readonly passwordHash: Buffer | null;
  settings: MatchSettings;
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
  if (message.type === 'listLobbies') {
    send(connection.socket, { type: 'lobbyList', lobbies: publicLobbyList() });
    return;
  }
  if (message.type === 'createLobby') {
    createLobby(connection, message.playerName, message.lobbyName, message.settings, message.password);
    return;
  }
  if (message.type === 'joinLobby') {
    joinLobby(connection, message.lobbyId, message.playerName, message.password);
    return;
  }
  const lobby = connection.lobbyId ? lobbies.get(connection.lobbyId) : undefined;
  if (!lobby) {
    send(connection.socket, { type: 'error', message: 'Join a lobby before sending game messages' });
    return;
  }
  if (message.type === 'startMatch') {
    if (connection.playerId !== lobby.hostId || lobby.started) return;
    lobby.started = true;
    broadcast(lobby, {
      type: 'matchStarted',
      players: [...lobby.players.values()],
      hostId: lobby.hostId,
      settings: lobby.settings,
    });
    return;
  }
  if (message.type === 'setPlayerTeam') {
    if (connection.playerId !== lobby.hostId || lobby.started) return;
    const player = lobby.players.get(message.playerId);
    const requestedTeam: unknown = message.team;
    if (!player || !isTeamId(requestedTeam)) return;
    lobby.players.set(player.id, { ...player, team: requestedTeam });
    broadcast(lobby, { type: 'roster', players: [...lobby.players.values()] });
    return;
  }
  if (message.type === 'kickPlayer') {
    if (connection.playerId !== lobby.hostId || lobby.started || message.playerId === lobby.hostId) return;
    const kicked = lobby.clients.get(message.playerId);
    if (!kicked) return;
    lobby.clients.delete(message.playerId);
    lobby.players.delete(message.playerId);
    kicked.lobbyId = null;
    send(kicked.socket, { type: 'removedFromLobby', reason: 'You were kicked by the host' });
    broadcast(lobby, { type: 'roster', players: [...lobby.players.values()] });
    return;
  }
  if (message.type === 'matchControl') {
    if (connection.playerId !== lobby.hostId || !lobby.started) return;
    const requestedAction: unknown = message.action;
    if (!isMatchControlAction(requestedAction)) return;
    broadcast(lobby, { type: 'matchControl', action: requestedAction });
    return;
  }
  if (message.type === 'finishMatch') {
    if (connection.playerId !== lobby.hostId || !lobby.started) return;
    lobby.started = false;
    broadcast(lobby, {
      type: 'returnedToLobby',
      players: [...lobby.players.values()],
      settings: lobby.settings,
    });
    return;
  }
  if (message.type === 'updateMatchSettings') {
    if (connection.playerId !== lobby.hostId || lobby.started) return;
    lobby.settings = sanitizeMatchSettings(message.settings);
    broadcast(lobby, { type: 'matchSettings', settings: lobby.settings });
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

const createLobby = (
  connection: ClientConnection,
  playerName: string,
  lobbyName: string,
  settings: MatchSettings,
  password: string,
): void => {
  if (connection.lobbyId) return;
  let lobbyId = createLobbyId();
  while (lobbies.has(lobbyId)) lobbyId = createLobbyId();
  const player = createPlayer(connection.playerId, playerName, 'azure', true);
  const lobby: Lobby = {
    id: lobbyId,
    name: sanitizeLobbyName(lobbyName, player.name),
    hostId: connection.playerId,
    clients: new Map([[connection.playerId, connection]]),
    players: new Map([[connection.playerId, player]]),
    passwordHash: hashPassword(password),
    settings: sanitizeMatchSettings(settings),
    started: false,
  };
  connection.lobbyId = lobbyId;
  lobbies.set(lobbyId, lobby);
  send(connection.socket, {
    type: 'lobbyJoined',
    lobbyId,
    lobbyName: lobby.name,
    playerId: connection.playerId,
    players: [player],
    settings: lobby.settings,
  });
};

const joinLobby = (
  connection: ClientConnection,
  requestedLobbyId: string,
  playerName: string,
  password: string,
): void => {
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
  if (!passwordMatches(lobby.passwordHash, password)) {
    send(connection.socket, { type: 'error', message: 'Incorrect lobby password' });
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
    lobbyName: lobby.name,
    playerId: connection.playerId,
    players: [...lobby.players.values()],
    settings: lobby.settings,
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
    lobby.clients.forEach((client) => {
      client.lobbyId = null;
      send(client.socket, { type: 'removedFromLobby', reason: 'The lobby host disconnected' });
    });
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

const publicLobbyList = (): readonly LobbySummary[] => [...lobbies.values()]
  .filter((lobby) => !lobby.started && lobby.players.size < maximumPlayers)
  .map((lobby) => ({
    id: lobby.id,
    name: lobby.name,
    hostName: lobby.players.get(lobby.hostId)?.name ?? 'Driver',
    playerCount: lobby.players.size,
    maximumPlayers,
    passwordProtected: lobby.passwordHash !== null,
  }));

const normalizePassword = (password: unknown): string => (
  typeof password === 'string' ? password.trim().slice(0, 64) : ''
);

const sanitizeLobbyName = (value: unknown, hostName: string): string => {
  if (typeof value !== 'string') return `${hostName}'s Lobby`;
  return value.trim().slice(0, 30) || `${hostName}'s Lobby`;
};

const hashPassword = (password: unknown): Buffer | null => {
  const normalized = normalizePassword(password);
  return normalized ? createHash('sha256').update(normalized).digest() : null;
};

const passwordMatches = (expected: Buffer | null, password: unknown): boolean => {
  if (!expected) return true;
  const candidate = hashPassword(password);
  return candidate !== null && timingSafeEqual(expected, candidate);
};

const isTeamId = (value: unknown): value is TeamId => value === 'azure' || value === 'coral';

const isMatchControlAction = (value: unknown): value is MatchControlAction => value === 'reset' || value === 'stop';

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
