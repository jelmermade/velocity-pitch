export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const UP: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (value: Vec3, scalar: number): Vec3 => vec3(value.x * scalar, value.y * scalar, value.z * scalar);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const lengthSquared = (value: Vec3): number => dot(value, value);
export const length = (value: Vec3): number => Math.sqrt(lengthSquared(value));
export const normalize = (value: Vec3): Vec3 => {
  const magnitude = length(value);
  return magnitude > 1e-8 ? scale(value, 1 / magnitude) : ZERO;
};
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const lerpVec3 = (a: Vec3, b: Vec3, alpha: number): Vec3 =>
  vec3(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
export const clampMagnitude = (value: Vec3, maximum: number): Vec3 => {
  const magnitude = length(value);
  return magnitude > maximum ? scale(value, maximum / magnitude) : value;
};
