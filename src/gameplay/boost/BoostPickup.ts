import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import type { Vec3 } from '../../core/math/Vector3';

export type BoostPickupKind = 'small' | 'large';

export interface BoostPickupDefinition {
  readonly id: string;
  readonly kind: BoostPickupKind;
  readonly position: Vec3;
  readonly amount: number;
  readonly collectionRadius: number;
  readonly respawnSeconds: number;
}

export interface BoostPickupState {
  readonly id: string;
  readonly kind: BoostPickupKind;
  readonly position: Vec3;
  readonly active: boolean;
  readonly respawnRemaining: number;
}

const small = (id: string, x: number, z: number): BoostPickupDefinition => ({
  id,
  kind: 'small',
  position: { x, y: 0.12, z },
  amount: 24,
  collectionRadius: 1.55,
  respawnSeconds: 4,
});

const large = (id: string, x: number, z: number): BoostPickupDefinition => ({
  id,
  kind: 'large',
  position: { x, y: 0.18, z },
  amount: 100,
  collectionRadius: 1.9,
  respawnSeconds: 10,
});

const xAt = (fraction: number): number => ARENA_TUNING.halfWidth * fraction;
const zAt = (fraction: number): number => ARENA_TUNING.halfLength * fraction;

export const BOOST_PICKUP_DEFINITIONS: readonly BoostPickupDefinition[] = Object.freeze([
  small('small-center-north', 0, -zAt(0.235)),
  small('small-center-south', 0, zAt(0.235)),
  small('small-west-north', -xAt(0.382), -zAt(0.196)),
  small('small-east-north', xAt(0.382), -zAt(0.196)),
  small('small-west-south', -xAt(0.382), zAt(0.196)),
  small('small-east-south', xAt(0.382), zAt(0.196)),
  small('small-west-deep-north', -xAt(0.5), -zAt(0.529)),
  small('small-east-deep-north', xAt(0.5), -zAt(0.529)),
  small('small-west-deep-south', -xAt(0.5), zAt(0.529)),
  small('small-east-deep-south', xAt(0.5), zAt(0.529)),
  small('small-outer-west-north', -xAt(0.735), -zAt(0.275)),
  small('small-outer-east-north', xAt(0.735), -zAt(0.275)),
  small('small-outer-west-south', -xAt(0.735), zAt(0.275)),
  small('small-outer-east-south', xAt(0.735), zAt(0.275)),
  large('large-west-center', -xAt(0.82), 0),
  large('large-east-center', xAt(0.82), 0),
  large('large-north-center', 0, -zAt(0.83)),
  large('large-south-center', 0, zAt(0.83)),
  large('large-west-north', -xAt(0.735), -zAt(0.647)),
  large('large-east-north', xAt(0.735), -zAt(0.647)),
  large('large-west-south', -xAt(0.735), zAt(0.647)),
  large('large-east-south', xAt(0.735), zAt(0.647)),
]);
