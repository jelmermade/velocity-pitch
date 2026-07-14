import type { Vec3 } from '../math/Vector3';

export interface GameEventMap {
  readonly kickoff: { readonly count: number };
  readonly goal: {
    readonly team: 'azure' | 'coral';
    readonly azure: number;
    readonly coral: number;
    readonly position: Vec3;
  };
  readonly carImpact: { readonly intensity: number; readonly position: Vec3 };
  readonly ballImpact: { readonly intensity: number; readonly position: Vec3 };
  readonly boostPickup: { readonly amount: number; readonly position: Vec3 };
  readonly matchEnded: { readonly winner: 'azure' | 'coral' | 'draw' };
  readonly paused: { readonly paused: boolean };
}
