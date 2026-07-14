import type { PlayerCommand } from '../input/PlayerCommand';
import { RUNTIME_CONFIG } from '../app/RuntimeConfig';
import type { GameSession } from './GameSession';
import type { AuthoritativeFrame, LobbyPlayer } from './LobbyProtocol';
import type { StartedLobby } from './WebSocketLobbyClient';

const INPUT_HEARTBEAT_TICKS = Math.max(1, Math.round(RUNTIME_CONFIG.physicsHz / 4));

export class NetworkSession implements GameSession {
  readonly localPlayerId: string;
  readonly players: readonly LobbyPlayer[];
  readonly authoritative: boolean;
  private lastGuestCommand: PlayerCommand | null = null;
  private lastGuestInputTick = Number.NEGATIVE_INFINITY;

  constructor(private readonly lobby: StartedLobby) {
    this.localPlayerId = lobby.playerId;
    this.players = lobby.players;
    this.authoritative = lobby.playerId === lobby.hostId;
  }

  commandsForTick(tick: number, localCommand: PlayerCommand): ReadonlyMap<string, PlayerCommand> {
    if (this.authoritative) return this.lobby.client.commandsForHost(localCommand);
    if (
      !this.lastGuestCommand
      || !commandsEqual(localCommand, this.lastGuestCommand)
      || tick - this.lastGuestInputTick >= INPUT_HEARTBEAT_TICKS
    ) {
      this.lobby.client.sendGuestInput(localCommand);
      this.lastGuestCommand = localCommand;
      this.lastGuestInputTick = tick;
    }
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

const commandsEqual = (left: PlayerCommand, right: PlayerCommand): boolean => (
  left.throttle === right.throttle
  && left.steer === right.steer
  && left.airRoll === right.airRoll
  && left.jumpPressed === right.jumpPressed
  && left.jumpHeld === right.jumpHeld
  && left.boost === right.boost
  && left.powerslide === right.powerslide
  && left.toggleBallCamera === right.toggleBallCamera
  && left.toggleFpsCounter === right.toggleFpsCounter
  && left.toggleFreeCamera === right.toggleFreeCamera
  && left.togglePause === right.togglePause
);
