import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
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
    const glassSurfaces = ARENA_SURFACES.filter(({ glass: rendersGlass, kind }) => (
      rendersGlass && kind !== 'curve'
    ));
    const wallIndex = glassSurfaces.findIndex(({ kind }) => kind === 'wall');
    const wall = glassSurfaces[wallIndex];
    const matrix = new THREE.Matrix4();
    (glass as THREE.InstancedMesh).getMatrixAt(wallIndex, matrix);
    const renderedScale = new THREE.Vector3();
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), renderedScale);
    expect(wall).toBeDefined();
    expect(renderedScale.x).toBeCloseTo((wall?.halfExtents.x ?? 0) * 2 + GLASS_SEAM_OVERLAP);
    expect(renderedScale.y).toBeCloseTo((wall?.halfExtents.y ?? 0) * 2);
    expect(renderedScale.z).toBeCloseTo((wall?.halfExtents.z ?? 0) * 2);
    expect(glassSurfaces.some(({ kind, position }) => (
      kind === 'goal' && Math.abs(position.z) > ARENA_TUNING.halfLength
    ))).toBe(true);

    const curveSurfaces = ARENA_SURFACES.filter(({ glass: rendersGlass, kind }) => (
      rendersGlass && kind === 'curve'
    ));
    const glassCurves = arena.group.getObjectByName('glass-curves');
    expect(glassCurves).toBeInstanceOf(THREE.Mesh);
    const curveGeometry = (glassCurves as THREE.Mesh).geometry;
    expect(curveGeometry.getAttribute('position').count).toBe(curveSurfaces.length * 4);
    expect(curveGeometry.index?.count).toBe(curveSurfaces.length * 6);

    expect(arena.group.getObjectByName('goal-azure-crossbar')).toBeInstanceOf(THREE.Mesh);
    expect(arena.group.getObjectByName('goal-coral-crossbar')).toBeInstanceOf(THREE.Mesh);
    expect(arena.group.getObjectByName('goal-azure-net')).toBeInstanceOf(THREE.LineSegments);
    expect(arena.group.getObjectByName('goal-coral-net')).toBeInstanceOf(THREE.LineSegments);

    arena.dispose();
  });
});
