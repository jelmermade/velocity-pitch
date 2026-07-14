import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/events/EventBus';
import type { GameEventMap } from '../../src/core/events/GameEvents';
import { selectCarStateForRender } from '../../src/rendering/GameRenderer';
import { GoalExplosionView } from '../../src/rendering/views/GoalExplosionView';
import type { SimulationSnapshot } from '../../src/gameplay/simulation/SimulationSnapshot';

describe('demolition explosion rendering', () => {
  it('shows an explosion at the demolished vehicle position', () => {
    const events = new EventBus<GameEventMap>();
    const view = new GoalExplosionView(events);

    events.emit('demolition', {
      attackerId: 'azure-1',
      victimId: 'coral-1',
      attackerTeam: 'azure',
      victimTeam: 'coral',
      position: { x: 4, y: 0.7, z: -8 },
    });

    expect(view.group.visible).toBe(true);
    expect(view.group.position.toArray()).toEqual([4, 0.7, -8]);
    view.dispose();
  });

  it('does not render a local car omitted from an authoritative car map', () => {
    const snapshot = {
      car: { transform: { position: { x: 1, y: 2, z: 3 } } },
    } as SimulationSnapshot;

    expect(selectCarStateForRender('local', 'local', snapshot, {})).toBeUndefined();
    expect(selectCarStateForRender('local', 'local', snapshot)).toBe(snapshot.car);
  });
});
