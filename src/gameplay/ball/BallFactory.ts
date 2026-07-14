import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { Ball } from './Ball';

export const createBall = (world: PhysicsWorld): Ball => new Ball(world);
