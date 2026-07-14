import type { Vec3 } from './Vector3';
import { vec3 } from './Vector3';

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const IDENTITY_QUAT: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export const rotateVector = (rotation: Quat, vector: Vec3): Vec3 => {
  const tx = 2 * (rotation.y * vector.z - rotation.z * vector.y);
  const ty = 2 * (rotation.z * vector.x - rotation.x * vector.z);
  const tz = 2 * (rotation.x * vector.y - rotation.y * vector.x);
  return vec3(
    vector.x + rotation.w * tx + rotation.y * tz - rotation.z * ty,
    vector.y + rotation.w * ty + rotation.z * tx - rotation.x * tz,
    vector.z + rotation.w * tz + rotation.x * ty - rotation.y * tx,
  );
};

export const slerpQuat = (from: Quat, to: Quat, alpha: number): Quat => {
  let cosine = from.x * to.x + from.y * to.y + from.z * to.z + from.w * to.w;
  const target = cosine < 0 ? { x: -to.x, y: -to.y, z: -to.z, w: -to.w } : to;
  cosine = Math.abs(cosine);
  if (cosine > 0.9995) {
    const result = {
      x: from.x + (target.x - from.x) * alpha,
      y: from.y + (target.y - from.y) * alpha,
      z: from.z + (target.z - from.z) * alpha,
      w: from.w + (target.w - from.w) * alpha,
    };
    const inverseLength = 1 / Math.hypot(result.x, result.y, result.z, result.w);
    return { x: result.x * inverseLength, y: result.y * inverseLength, z: result.z * inverseLength, w: result.w * inverseLength };
  }
  const angle = Math.acos(cosine);
  const inverseSin = 1 / Math.sin(angle);
  const a = Math.sin((1 - alpha) * angle) * inverseSin;
  const b = Math.sin(alpha * angle) * inverseSin;
  return { x: from.x * a + target.x * b, y: from.y * a + target.y * b, z: from.z * a + target.z * b, w: from.w * a + target.w * b };
};
