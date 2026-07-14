import type RAPIER from '@dimforge/rapier3d-compat';
import type { Quat } from '../../core/math/Quaternion';
import type { Vec3 } from '../../core/math/Vector3';

export const fromRapierVector = (value: RAPIER.Vector): Vec3 => ({ x: value.x, y: value.y, z: value.z });
export const fromRapierRotation = (value: RAPIER.Rotation): Quat => ({ x: value.x, y: value.y, z: value.z, w: value.w });
