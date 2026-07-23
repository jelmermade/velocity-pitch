import { describe, expect, it, vi } from 'vitest';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';

describe('RapierPhysicsWorld', () => {
  it('retries Rapier borrowed-value teardown failures once and remains idempotent', async () => {
    const world = await RapierPhysicsWorld.create();
    const rawWorld = Reflect.get(world, 'world') as { free(): void };
    const integrationParameters = Reflect.get(rawWorld, 'integrationParameters') as {
      raw: { free(): void };
    };
    const originalFree = integrationParameters.raw.free.bind(integrationParameters.raw);
    vi.spyOn(integrationParameters.raw, 'free').mockImplementationOnce(() => {
      originalFree();
      throw new Error('attempted to take ownership of Rust value while it was borrowed');
    });
    const free = vi.spyOn(rawWorld, 'free');

    world.dispose();
    world.dispose();

    expect(free).toHaveBeenCalledTimes(2);
  });

  it('does not hide unrelated Rapier teardown failures', async () => {
    const world = await RapierPhysicsWorld.create();
    const rawWorld = Reflect.get(world, 'world') as { free(): void };
    vi.spyOn(rawWorld, 'free').mockImplementationOnce(() => {
      throw new Error('unrelated teardown failure');
    });

    expect(() => world.dispose()).toThrow('unrelated teardown failure');
    world.dispose();
  });
});
