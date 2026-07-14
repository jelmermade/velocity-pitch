import { describe, expect, it } from 'vitest';
import { BOOST_PICKUP_DEFINITIONS } from '../../src/gameplay/boost/BoostPickup';
import { BoostPickupSystem } from '../../src/gameplay/boost/BoostPickupSystem';

const pickupPosition = (id: string) => {
  const pickup = BOOST_PICKUP_DEFINITIONS.find((definition) => definition.id === id);
  if (!pickup) throw new Error(`Missing boost pickup: ${id}`);
  return { ...pickup.position, y: 1 };
};

describe('BoostPickupSystem', () => {
  it('collects a small pad and respawns it after four seconds', () => {
    const system = new BoostPickupSystem();
    const position = pickupPosition('small-center-north');

    const pickup = system.update(position, 40, 1 / 120);
    expect(pickup?.kind).toBe('small');
    expect(pickup?.amount).toBe(24);
    expect(system.state().find(({ id }) => id === pickup?.id)?.active).toBe(false);

    system.update({ x: 50, y: 1, z: 50 }, 40, 4.01);
    expect(system.state().find(({ id }) => id === pickup?.id)?.active).toBe(true);
  });

  it('provides full-refill pads without consuming them at full boost', () => {
    const system = new BoostPickupSystem();
    const position = pickupPosition('large-west-center');

    expect(system.update(position, 100, 1 / 120)).toBeNull();
    const pickup = system.update(position, 15, 1 / 120);
    expect(pickup?.kind).toBe('large');
    expect(pickup?.amount).toBe(100);
    expect(pickup?.respawnSeconds).toBe(10);
  });

  it('reactivates every pad for a kickoff reset', () => {
    const system = new BoostPickupSystem();
    system.update(pickupPosition('small-center-north'), 20, 1 / 120);
    system.update(pickupPosition('large-west-center'), 20, 1 / 120);
    system.reset();
    expect(system.state().every(({ active }) => active)).toBe(true);
  });
});
