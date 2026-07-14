import { describe, expect, it } from 'vitest';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import { LocalSession } from '../../src/networking/LocalSession';

describe('local session bots', () => {
  it.each([1, 2, 3] as const)('creates a balanced %sv%s roster and commands every car', (teamSize) => {
    const session = new LocalSession(teamSize);
    const commands = session.commandsForTick(0, NEUTRAL_COMMAND);

    expect(session.players.filter(({ team }) => team === 'azure')).toHaveLength(teamSize);
    expect(session.players.filter(({ team }) => team === 'coral')).toHaveLength(teamSize);
    expect(session.players.filter(({ bot }) => bot)).toHaveLength(teamSize * 2 - 1);
    expect([...commands.keys()]).toEqual(session.players.map(({ id }) => id));
    expect(commands.get(session.localPlayerId)).toBe(NEUTRAL_COMMAND);
  });
});
