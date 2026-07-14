import type { PlayerCommand } from '../input/PlayerCommand';
import type { GameSession } from './GameSession';
import type { AuthoritativeFrame, LobbyPlayer } from './LobbyProtocol';

export class FreePlaySession implements GameSession {
  readonly localPlayerId = 'local';
  readonly authoritative = true;
  readonly players: readonly LobbyPlayer[] = Object.freeze([
    { id: this.localPlayerId, name: 'Driver', team: 'azure', host: true },
  ]);

  commandsForTick(_tick: number, localCommand: PlayerCommand): ReadonlyMap<string, PlayerCommand> {
    return new Map([[this.localPlayerId, localCommand]]);
  }

  publish(frame: AuthoritativeFrame): void { void frame; }
  latestFrame(): AuthoritativeFrame | null { return null; }
  dispose(): void {}
}
