import { RUNTIME_CONFIG } from '../app/RuntimeConfig';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../input/PlayerCommand';
import type {
  AuthoritativeFrame,
  ClientLobbyMessage,
  LobbyPlayer,
  ServerLobbyMessage,
} from './LobbyProtocol';
import { NETWORK_CONFIG } from './NetworkConfig';
import { clearCommandEdges, mergeCommandEdges } from './PlayerCommandBuffer';

export interface StartedLobby {
  readonly lobbyId: string;
  readonly playerId: string;
  readonly hostId: string;
  readonly players: readonly LobbyPlayer[];
  readonly client: WebSocketLobbyClient;
}

export class WebSocketLobbyClient {
  private lobbyId = '';
  private playerId = '';
  private players: readonly LobbyPlayer[] = [];
  private hostId = '';
  private inputSequence = 0;
  private latestAuthoritativeFrame: AuthoritativeFrame | null = null;
  private readonly remoteCommands = new Map<string, PlayerCommand>();
  private readonly remoteSequences = new Map<string, number>();
  private readonly rosterHandlers = new Set<(players: readonly LobbyPlayer[]) => void>();
  private readonly errorHandlers = new Set<(message: string) => void>();
  private joinResolve: (() => void) | null = null;
  private joinReject: ((reason: Error) => void) | null = null;
  private startResolve: ((value: StartedLobby) => void) | null = null;

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', this.onMessage);
  }

  static connect(url = NETWORK_CONFIG.webSocketUrl): Promise<WebSocketLobbyClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new WebSocketLobbyClient(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error(`Unable to connect to multiplayer server at ${url}`)), { once: true });
    });
  }

  createLobby(playerName: string): Promise<void> {
    return this.joinRequest({ type: 'createLobby', playerName });
  }

  joinLobby(lobbyId: string, playerName: string): Promise<void> {
    return this.joinRequest({ type: 'joinLobby', lobbyId, playerName });
  }

  waitForStart(): Promise<StartedLobby> {
    return new Promise((resolve) => { this.startResolve = resolve; });
  }

  startMatch(): void {
    this.send({ type: 'startMatch' });
  }

  onRoster(handler: (players: readonly LobbyPlayer[]) => void): () => void {
    this.rosterHandlers.add(handler);
    handler(this.players);
    return () => this.rosterHandlers.delete(handler);
  }

  onError(handler: (message: string) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  isHost(): boolean {
    return this.players.some(({ id, host }) => id === this.playerId && host);
  }

  currentLobbyId(): string { return this.lobbyId; }

  commandsForHost(localCommand: PlayerCommand): ReadonlyMap<string, PlayerCommand> {
    const commands = new Map(this.remoteCommands);
    commands.set(this.playerId, localCommand);
    this.remoteCommands.forEach((command, playerId) => {
      this.remoteCommands.set(playerId, clearCommandEdges(command));
    });
    return commands;
  }

  sendGuestInput(command: PlayerCommand): void {
    this.inputSequence += 1;
    this.send({ type: 'input', sequence: this.inputSequence, command });
  }

  publishFrame(frame: AuthoritativeFrame): void {
    const interval = Math.max(1, Math.round(RUNTIME_CONFIG.physicsHz / NETWORK_CONFIG.snapshotRate));
    if (frame.sequence % interval === 0) this.send({ type: 'authoritativeFrame', frame });
  }

  latestFrame(): AuthoritativeFrame | null {
    return this.latestAuthoritativeFrame;
  }

  close(): void {
    this.socket.removeEventListener('message', this.onMessage);
    this.socket.close();
  }

  private joinRequest(message: ClientLobbyMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      this.joinResolve = resolve;
      this.joinReject = reject;
      this.send(message);
    });
  }

  private readonly onMessage = (event: MessageEvent<string>): void => {
    const message = parseServerMessage(event.data);
    if (!message) return;
    if (message.type === 'error') {
      const reject = this.joinReject;
      this.joinReject = null;
      this.joinResolve = null;
      if (reject) reject(new Error(message.message));
      this.errorHandlers.forEach((handler) => handler(message.message));
      return;
    }
    if (message.type === 'lobbyJoined') {
      this.lobbyId = message.lobbyId;
      this.playerId = message.playerId;
      this.updateRoster(message.players);
      this.joinResolve?.();
      this.joinResolve = null;
      this.joinReject = null;
      return;
    }
    if (message.type === 'roster') {
      this.updateRoster(message.players);
      return;
    }
    if (message.type === 'matchStarted') {
      this.hostId = message.hostId;
      this.updateRoster(message.players);
      this.startResolve?.({
        lobbyId: this.lobbyId,
        playerId: this.playerId,
        hostId: this.hostId,
        players: this.players,
        client: this,
      });
      this.startResolve = null;
      return;
    }
    if (message.type === 'remoteInput') {
      const previousSequence = this.remoteSequences.get(message.playerId) ?? -1;
      if (message.sequence <= previousSequence) return;
      this.remoteSequences.set(message.playerId, message.sequence);
      const previous = this.remoteCommands.get(message.playerId) ?? NEUTRAL_COMMAND;
      this.remoteCommands.set(message.playerId, mergeCommandEdges(previous, message.command));
      return;
    }
    this.latestAuthoritativeFrame = message.frame;
  };

  private updateRoster(players: readonly LobbyPlayer[]): void {
    this.players = players;
    this.players.forEach(({ id }) => {
      if (id !== this.playerId && !this.remoteCommands.has(id)) this.remoteCommands.set(id, NEUTRAL_COMMAND);
    });
    this.rosterHandlers.forEach((handler) => handler(players));
  }

  private send(message: ClientLobbyMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}

const parseServerMessage = (payload: string): ServerLobbyMessage | null => {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed) || typeof parsed.type !== 'string') return null;
    return parsed as ServerLobbyMessage;
  } catch {
    return null;
  }
};
