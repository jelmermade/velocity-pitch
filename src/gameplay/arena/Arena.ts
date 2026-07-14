import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { ARENA_SURFACES } from './ArenaDefinition';

export const createArena = (world: PhysicsWorld): void => {
  ARENA_SURFACES.forEach((surface) => {
    world.createFixedCollider(
      { position: surface.position, rotation: surface.rotation },
      {
        shape: { type: 'box', halfExtents: surface.halfExtents },
        friction: surface.kind === 'floor' ? 0.82 : surface.kind === 'curve' ? 0.6 : 0.45,
        restitution: surface.kind === 'curve' ? 0 : surface.kind === 'floor' ? 0.35 : 0.62,
      },
    );
  });
};
