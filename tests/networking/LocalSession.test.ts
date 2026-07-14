import { describe, expect, it } from 'vitest';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import { LocalSession } from '../../src/networking/LocalSession';

describe('local session bots', () => {
  it('creates a balanced 2v2 roster and commands every car', () => {
    const session = new LocalSession();
    const commands = session.commandsForTick(0, NEUTRAL_COMMAND);

    expect(session.players.map(({ team }) => team)).toEqual(['azure', 'coral', 'azure', 'coral']);
    expect(session.players.filter(({ name }) => name.includes('[BOT]'))).toHaveLength(3);
    expect([...commands.keys()]).toEqual(session.players.map(({ id }) => id));
    expect(commands.get(session.localPlayerId)).toBe(NEUTRAL_COMMAND);
  });
});
