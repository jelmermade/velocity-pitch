export const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;

export const damp = (current: number, target: number, smoothing: number, deltaSeconds: number): number =>
  lerp(current, target, 1 - Math.exp(-smoothing * deltaSeconds));