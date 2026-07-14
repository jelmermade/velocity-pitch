import { describe, expect, it } from 'vitest';
import { add, cross, dot, normalize } from '../../src/core/math/Vector3';

describe('Vector3', () => {
  it('performs common vector operations without engine dependencies', () => {
    expect(add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toEqual({ x: 5, y: 7, z: 9 });
    expect(dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
    expect(cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
    expect(normalize({ x: 0, y: 0, z: 4 })).toEqual({ x: 0, y: 0, z: 1 });
  });
});
