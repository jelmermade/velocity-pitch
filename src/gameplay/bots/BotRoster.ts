import type { LobbyPlayer, TeamId } from '../../networking/LobbyProtocol';
import type { TeamSize } from '../match/MatchSettings';
import type { BotRole } from './BotKnowledge';

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

export const createBotTrainingRoster = (random: () => number = Math.random): readonly LobbyPlayer[] => {
  const players = fillBotSlots([], 3);
  const assignedTeams = new Map<string, TeamId>();

  for (const role of ['striker', 'defender'] as const) {
    const shuffled = shuffle(players.filter((player) => botRole(player) === role), random);
    const azureCount = shuffled.length / 2;
    shuffled.forEach((player, index) => {
      assignedTeams.set(player.id, index < azureCount ? 'azure' : 'coral');
    });
  }

  return players.map((player) => ({
    ...player,
    team: assignedTeams.get(player.id) ?? player.team,
  }));
};

export const botRole = (player: LobbyPlayer): BotRole => {
  const slot = Number(player.id.match(/-(\d+)$/)?.[1] ?? 0);
  return slot % 2 === 1 ? 'defender' : 'striker';
};

const shuffle = <T>(values: readonly T[], random: () => number): T[] => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const sample = random();
    const normalized = Number.isFinite(sample) ? Math.min(0.999999, Math.max(0, sample)) : 0.5;
    const swapIndex = Math.floor(normalized * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex] as T, result[index] as T];
  }
  return result;
};
