import { describe, expect, it } from 'vitest';
import { NEUTRAL_COMMAND } from '../../src/input/PlayerCommand';
import { FreePlaySession } from '../../src/networking/FreePlaySession';

describe('free-play session', () => {
  it('creates only the local human player and never fills bot slots', () => {
    const session = new FreePlaySession();
    const commands = session.commandsForTick(0, NEUTRAL_COMMAND);

    expect(session.players).toEqual([
      { id: session.localPlayerId, name: 'Driver', team: 'azure', host: true },
    ]);
    expect(session.players.some(({ bot }) => bot)).toBe(false);
    expect([...commands]).toEqual([[session.localPlayerId, NEUTRAL_COMMAND]]);
  });
});
