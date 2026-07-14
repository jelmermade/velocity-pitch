import type { PlayerCommand } from '../input/PlayerCommand';
import type { AuthoritativeFrame, LobbyPlayer } from './LobbyProtocol';
import type { BotTrainingState } from '../gameplay/bots/BotTrainingState';

export interface GameSession {
  readonly localPlayerId: string;
  readonly players: readonly LobbyPlayer[];
  readonly authoritative: boolean;
  commandsForTick(
    tick: number,
    localCommand: PlayerCommand,
    observedFrame?: AuthoritativeFrame,
  ): ReadonlyMap<string, PlayerCommand>;
  publish(frame: AuthoritativeFrame): void;
  latestFrame(): AuthoritativeFrame | null;
  trainingState?(): BotTrainingState;
  flushKnowledge?(): Promise<void>;
  dispose(): void;
}
