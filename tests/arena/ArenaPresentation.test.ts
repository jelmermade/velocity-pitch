import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArenaView } from '../../src/rendering/views/ArenaView';
import { ARENA_SURFACES } from '../../src/gameplay/arena/ArenaDefinition';
import { GLASS_SEAM_OVERLAP } from '../../src/rendering/views/GlassDomeView';

describe('arena presentation', () => {
  it('renders a grass pitch, glass enclosure, and exterior city', () => {
    const arena = new ArenaView();

    expect(arena.group.getObjectByName('grass-field')).toBeDefined();
    const turf = arena.group.getObjectByName('turf');
    expect(turf).toBeInstanceOf(THREE.Mesh);
    const turfMaterial = (turf as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const turfImage = turfMaterial.map?.image as { readonly width: number; readonly height: number } | undefined;
    expect(turfImage?.width).toBe(512);
    expect(turfImage?.height).toBe(768);
    expect(turfMaterial.map?.anisotropy).toBe(4);
    expect(arena.group.getObjectByName('center-circle')).toBeInstanceOf(THREE.Mesh);
    expect(arena.group.getObjectByName('city-backdrop')).toBeDefined();
    expect(arena.group.getObjectByName('city-windows')).toBeInstanceOf(THREE.InstancedMesh);

    const glass = arena.group.getObjectByName('glass-envelope');
    expect(glass).toBeInstanceOf(THREE.InstancedMesh);
    const material = (glass as THREE.InstancedMesh).material;
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((material as THREE.MeshStandardMaterial).transparent).toBe(true);
    expect((material as THREE.MeshStandardMaterial).opacity).toBeLessThan(0.3);
    const glassSurfaces = ARENA_SURFACES.filter(({ kind }) => kind === 'wall' || kind === 'curve' || kind === 'ceiling');
    const curveIndex = glassSurfaces.findIndex(({ kind }) => kind === 'curve');
    const curve = glassSurfaces[curveIndex];
    const matrix = new THREE.Matrix4();
    (glass as THREE.InstancedMesh).getMatrixAt(curveIndex, matrix);
    const renderedScale = new THREE.Vector3();
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), renderedScale);
    expect(curve).toBeDefined();
    expect(renderedScale.x).toBeCloseTo((curve?.halfExtents.x ?? 0) * 2 + GLASS_SEAM_OVERLAP);
    expect(renderedScale.z).toBeCloseTo((curve?.halfExtents.z ?? 0) * 2 + GLASS_SEAM_OVERLAP);

    expect(arena.group.getObjectByName('goal-azure-crossbar')).toBeInstanceOf(THREE.Mesh);
    expect(arena.group.getObjectByName('goal-coral-crossbar')).toBeInstanceOf(THREE.Mesh);
    expect(arena.group.getObjectByName('goal-azure-net')).toBeInstanceOf(THREE.LineSegments);
    expect(arena.group.getObjectByName('goal-coral-net')).toBeInstanceOf(THREE.LineSegments);

    arena.dispose();
  });
});
