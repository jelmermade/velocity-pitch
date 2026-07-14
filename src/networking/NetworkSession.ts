import type { PlayerCommand } from '../input/PlayerCommand';
import type { GameSession } from './GameSession';
import type { AuthoritativeFrame, LobbyPlayer } from './LobbyProtocol';
import type { StartedLobby } from './WebSocketLobbyClient';

export class NetworkSession implements GameSession {
  readonly localPlayerId: string;
  readonly players: readonly LobbyPlayer[];
  readonly authoritative: boolean;

  constructor(private readonly lobby: StartedLobby) {
    this.localPlayerId = lobby.playerId;
    this.players = lobby.players;
    this.authoritative = lobby.playerId === lobby.hostId;
  }

  commandsForTick(_tick: number, localCommand: PlayerCommand): ReadonlyMap<string, PlayerCommand> {
    if (this.authoritative) return this.lobby.client.commandsForHost(localCommand);
    this.lobby.client.sendGuestInput(localCommand);
    return new Map();
  }

  publish(frame: AuthoritativeFrame): void {
    if (this.authoritative) this.lobby.client.publishFrame(frame);
  }

  latestFrame(): AuthoritativeFrame | null {
    return this.lobby.client.latestFrame();
  }

  dispose(): void {
    this.lobby.client.close();
  }
}
