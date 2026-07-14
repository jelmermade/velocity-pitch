import type { PlayerCommand } from '../input/PlayerCommand';
import { NEUTRAL_COMMAND } from '../input/PlayerCommand';
import { BotController } from '../gameplay/bots/BotController';
import { BUILT_IN_BOT_KNOWLEDGE, type BotKnowledge } from '../gameplay/bots/BotKnowledge';
import { botRole, fillBotSlots } from '../gameplay/bots/BotRoster';
import type { TeamSize } from '../gameplay/match/MatchSettings';
import type { GameSession } from './GameSession';
import type { AuthoritativeFrame, LobbyPlayer } from './LobbyProtocol';

export class LocalSession implements GameSession {
  readonly localPlayerId = 'local';
  readonly authoritative = true;
  readonly players: readonly LobbyPlayer[];
  private readonly bots: ReadonlyMap<string, BotController>;

  constructor(teamSize: TeamSize = 2, knowledge: BotKnowledge = BUILT_IN_BOT_KNOWLEDGE) {
    this.players = fillBotSlots([
      { id: this.localPlayerId, name: 'Driver', team: 'azure', host: true },
    ], teamSize);
    this.bots = new Map(this.players
      .filter((player) => player.bot)
      .map((player) => [
        player.id,
        new BotController(
          player.id,
          player.team,
          botRole(player),
          false,
          knowledge,
          this.players.filter(({ team }) => team === player.team).map(({ id }) => id),
        ),
      ]));
  }

  commandsForTick(
    tick: number,
    localCommand: PlayerCommand,
    observedFrame?: AuthoritativeFrame,
  ): ReadonlyMap<string, PlayerCommand> {
    const commands = new Map<string, PlayerCommand>([[this.localPlayerId, localCommand]]);
    this.bots.forEach((bot, playerId) => {
      commands.set(playerId, observedFrame ? bot.command(observedFrame, tick) : NEUTRAL_COMMAND);
    });
    return commands;
  }

  publish(frame: AuthoritativeFrame): void { void frame; }
  latestFrame(): AuthoritativeFrame | null { return null; }
  dispose(): void {}
}
