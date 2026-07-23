import type { PlayerCommand } from '../input/PlayerCommand';
import type { AuthoritativeFrame, LobbyPlayer } from './LobbyProtocol';
import type { BotTrainingState } from '../gameplay/bots/BotTrainingState';
import type { BotTacticalPlan } from '../gameplay/bots/BotTeamCoordinator';

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
  tacticalStates?(): ReadonlyMap<string, BotTacticalPlan>;
  flushKnowledge?(): Promise<void>;
  dispose(): void;
}
