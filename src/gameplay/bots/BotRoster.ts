import type { LobbyPlayer, TeamId } from '../../networking/LobbyProtocol';
import type { TeamSize } from '../match/MatchSettings';
import type { BotRole } from './BotController';

const BOT_NAMES: Readonly<Record<TeamId, readonly string[]>> = Object.freeze({
  azure: Object.freeze(['Ace', 'Atlas', 'Nova']),
  coral: Object.freeze(['Ember', 'Vex', 'Blaze']),
});

export const fillBotSlots = (
  humans: readonly LobbyPlayer[],
  teamSize: TeamSize,
): readonly LobbyPlayer[] => {
  const players = [...humans];
  for (const team of ['azure', 'coral'] as const) {
    const humanCount = humans.filter((player) => player.team === team && !player.bot).length;
    for (let slot = humanCount; slot < teamSize; slot += 1) {
      players.push({
        id: `bot-${team}-${slot}`,
        name: `${BOT_NAMES[team][slot] ?? 'Bot'} [BOT]`,
        team,
        host: false,
        bot: true,
      });
    }
  }
  return players;
};

export const botRole = (player: LobbyPlayer): BotRole => {
  const slot = Number(player.id.match(/-(\d+)$/)?.[1] ?? 0);
  return slot % 2 === 1 ? 'defender' : 'striker';
};
