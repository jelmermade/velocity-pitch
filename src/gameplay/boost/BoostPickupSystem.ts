import { distance, type Vec3 } from '../../core/math/Vector3';
import { BOOST_PICKUP_DEFINITIONS, type BoostPickupDefinition, type BoostPickupState } from './BoostPickup';

interface RuntimePickup {
  readonly definition: BoostPickupDefinition;
  respawnRemaining: number;
}

export class BoostPickupSystem {
  private readonly pickups: RuntimePickup[] = BOOST_PICKUP_DEFINITIONS.map((definition) => ({
    definition,
    respawnRemaining: 0,
  }));

  update(carPosition: Vec3, currentBoost: number, deltaSeconds: number): BoostPickupDefinition | null {
    this.advance(deltaSeconds);
    return this.collect(carPosition, currentBoost);
  }

  advance(deltaSeconds: number): void {
    this.pickups.forEach((pickup) => {
      pickup.respawnRemaining = Math.max(0, pickup.respawnRemaining - deltaSeconds);
    });
  }

  collect(carPosition: Vec3, currentBoost: number): BoostPickupDefinition | null {
    let collected: BoostPickupDefinition | null = null;
    this.pickups.forEach((pickup) => {
      if (pickup.respawnRemaining > 0) return;
      if (collected || currentBoost >= 99.5) return;
      if (distance(carPosition, pickup.definition.position) > pickup.definition.collectionRadius) return;
      pickup.respawnRemaining = pickup.definition.respawnSeconds;
      collected = pickup.definition;
    });
    return collected;
  }

  state(): readonly BoostPickupState[] {
    return this.pickups.map(({ definition, respawnRemaining }) => ({
      id: definition.id,
      kind: definition.kind,
      position: definition.position,
      active: respawnRemaining === 0,
      respawnRemaining,
    }));
  }

  reset(): void {
    this.pickups.forEach((pickup) => { pickup.respawnRemaining = 0; });
  }
}
