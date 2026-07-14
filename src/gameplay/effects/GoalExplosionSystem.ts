import { MATCH_TUNING } from '../../core/config/MatchTuning';
import { add, distance, normalize, scale, sub, type Vec3 } from '../../core/math/Vector3';

export interface ExplosionTarget {
  state(): { readonly transform: { readonly position: Vec3 } };
  applyImpulse(impulse: Vec3): void;
}

export class GoalExplosionSystem {
  trigger(origin: Vec3, targets: readonly ExplosionTarget[]): void {
    targets.forEach((target) => {
      const position = target.state().transform.position;
      const targetDistance = distance(position, origin);
      if (targetDistance >= MATCH_TUNING.goalExplosionRadius) return;

      const falloff = 1 - targetDistance / MATCH_TUNING.goalExplosionRadius;
      const away = normalize(add(sub(position, origin), { x: 0, y: 1.5, z: 0 }));
      target.applyImpulse(scale(away, MATCH_TUNING.goalExplosionImpulse * falloff));
    });
  }
}
