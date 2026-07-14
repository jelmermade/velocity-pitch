import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArenaView } from '../../src/rendering/views/ArenaView';

describe('arena presentation', () => {
  it('renders a grass pitch, glass enclosure, and exterior city', () => {
    const arena = new ArenaView();

    expect(arena.group.getObjectByName('grass-field')).toBeDefined();
    expect(arena.group.getObjectByName('turf')).toBeInstanceOf(THREE.Mesh);
    expect(arena.group.getObjectByName('center-circle')).toBeInstanceOf(THREE.Mesh);
    expect(arena.group.getObjectByName('city-backdrop')).toBeDefined();
    expect(arena.group.getObjectByName('city-windows')).toBeInstanceOf(THREE.InstancedMesh);

    const glass = arena.group.getObjectByName('glass-envelope');
    expect(glass).toBeInstanceOf(THREE.InstancedMesh);
    const material = (glass as THREE.InstancedMesh).material;
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((material as THREE.MeshPhysicalMaterial).transmission).toBeGreaterThan(0.5);

    arena.dispose();
  });
});
