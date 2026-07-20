import type { Quat } from '../core/math/Quaternion';
import type { Vec3 } from '../core/math/Vector3';

export interface BodyOptions {
  readonly position: Vec3;
  readonly rotation?: Quat;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  readonly ccd?: boolean;
}

export type ColliderShape =
  | { readonly type: 'box'; readonly halfExtents: Vec3 }
  | { readonly type: 'roundBox'; readonly halfExtents: Vec3; readonly borderRadius: number }
  | { readonly type: 'roundConvexHull'; readonly points: readonly Vec3[]; readonly borderRadius: number }
  | { readonly type: 'ball'; readonly radius: number };

export type CoefficientCombineRule = 'average' | 'min' | 'multiply' | 'max';

export interface ColliderOptions {
  readonly shape: ColliderShape;
  readonly localPosition?: Vec3;
  readonly mass?: number;
  readonly friction?: number;
  readonly frictionCombineRule?: CoefficientCombineRule;
  readonly restitution?: number;
  readonly restitutionCombineRule?: CoefficientCombineRule;
  readonly sensor?: boolean;
}

export interface RayHit {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly distance: number;
  readonly bodyHandle: number | null;
}
