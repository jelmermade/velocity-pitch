import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { Car } from './Car';

export const createCar = (world: PhysicsWorld): Car => new Car(world);
