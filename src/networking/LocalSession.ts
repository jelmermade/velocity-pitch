import type { PlayerCommand } from '../input/PlayerCommand';
import { NEUTRAL_COMMAND } from '../input/PlayerCommand';
import { BotController, type BotRole } from '../gameplay/bots/BotController';
import type { GameSession } from './GameSession';
import type { AuthoritativeFrame, LobbyPlayer } from './LobbyProtocol';

const SINGLE_PLAYER_ROSTER: readonly LobbyPlayer[] = Object.freeze([
  { id: 'local', name: 'Driver', team: 'azure', host: true },
  { id: 'bot-ember', name: 'Ember [BOT]', team: 'coral', host: false },
  { id: 'bot-atlas', name: 'Atlas [BOT]', team: 'azure', host: false },
  { id: 'bot-vex', name: 'Vex [BOT]', team: 'coral', host: false },
]);

const BOT_ROLES: Readonly<Record<string, BotRole>> = Object.freeze({
  'bot-ember': 'striker',
  'bot-atlas': 'striker',
  'bot-vex': 'defender',
});

export class LocalSession implements GameSession {
  readonly localPlayerId = 'local';
  readonly authoritative = true;
  readonly players = SINGLE_PLAYER_ROSTER;
  private readonly bots = new Map(this.players
    .filter(({ id }) => id !== this.localPlayerId)
    .map((player) => [
      player.id,
      new BotController(player.id, player.team, BOT_ROLES[player.id] ?? 'striker'),
    ]));

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
