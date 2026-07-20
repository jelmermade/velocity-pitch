import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_TUNING } from '../../src/core/config/ArenaTuning';
import { ArenaView } from '../../src/rendering/views/ArenaView';
import {
  ARENA_BOUNDARY_SEGMENTS,
  ARENA_SURFACES,
  ARENA_WALL_HALF_THICKNESS,
} from '../../src/gameplay/arena/ArenaDefinition';
import { DOME_FRAME_OUTSET, GLASS_SEAM_OVERLAP } from '../../src/rendering/views/GlassDomeView';

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
    expect(glassSurfaces.some(({ kind }) => kind === 'goal')).toBe(false);
    expect(ARENA_SURFACES.filter(({ kind }) => kind === 'goal').every(({ glass: rendersGlass }) => (
      !rendersGlass
    ))).toBe(true);

    const lowerCurveSurfaces = ARENA_SURFACES.filter(({ glass: rendersGlass, kind, curveLocation, boundaryKind }) => (
      rendersGlass && kind === 'curve' && curveLocation === 'floor' && boundaryKind === 'wall'
    ));
    const goalCurveSurfaces = ARENA_SURFACES.filter(({ glass: rendersGlass, kind, curveLocation, boundaryKind }) => (
      rendersGlass && kind === 'curve' && curveLocation === 'floor' && boundaryKind === 'goal'
    ));
    const upperCurveSurfaces = ARENA_SURFACES.filter(({ glass: rendersGlass, kind, curveLocation }) => (
      rendersGlass && kind === 'curve' && curveLocation === 'ceiling'
    ));
    const rampBarricades = arena.group.getObjectByName('ramp-barricades');
    expect(rampBarricades).toBeInstanceOf(THREE.Mesh);
    const rampMaterials = (rampBarricades as THREE.Mesh).material as THREE.MeshStandardMaterial[];
    expect(rampMaterials).toHaveLength(2);
    expect(rampMaterials.every((rampMaterial) => (
      rampMaterial !== material
      && !rampMaterial.transparent
      && rampMaterial.vertexColors
      && rampMaterial.emissiveIntensity < 0.25
    ))).toBe(true);
    expect(rampMaterials[0]?.emissive.getHex()).not.toBe(rampMaterials[1]?.emissive.getHex());
    const curveGeometry = (rampBarricades as THREE.Mesh).geometry;
    expect(curveGeometry.getAttribute('position').count).toBeGreaterThanOrEqual(lowerCurveSurfaces.length * 4);
    expect(curveGeometry.getAttribute('normal').count).toBe(curveGeometry.getAttribute('position').count);
    expect(curveGeometry.getAttribute('color').count).toBe(curveGeometry.getAttribute('position').count);
    expect(curveGeometry.index?.count).toBeGreaterThanOrEqual(lowerCurveSurfaces.length * 6);
    expect(new Set(curveGeometry.groups.map(({ materialIndex }) => materialIndex))).toEqual(new Set([0, 1]));
    const rampBacking = arena.group.getObjectByName('ramp-seam-backing');
    expect(rampBacking).toBeInstanceOf(THREE.Mesh);
    const rampBackingMesh = rampBacking as THREE.Mesh;
    const rampBackingMaterial = rampBackingMesh.material as THREE.MeshStandardMaterial;
    expect(rampBackingMaterial.transparent).toBe(false);
    expect(rampBackingMaterial.color.getHex()).toBe(0x090f11);
    expect(rampBackingMesh.geometry.getAttribute('color')).toBeUndefined();
    expect(rampBackingMesh.geometry.getAttribute('position').count).toBe(lowerCurveSurfaces.length * 4);
    expect(rampBackingMesh.geometry.index?.count).toBe(lowerCurveSurfaces.length * 6);
    const rampPositions = curveGeometry.getAttribute('position');
    const rampIndices = curveGeometry.index;
    expect(rampIndices).not.toBeNull();
    curveGeometry.groups.forEach((group) => {
      let averageZ = 0;
      let minimumZ = Number.POSITIVE_INFINITY;
      let maximumZ = Number.NEGATIVE_INFINITY;
      for (let offset = 0; offset < group.count; offset += 1) {
        const z = rampPositions.getZ(rampIndices?.getX(group.start + offset) ?? 0);
        averageZ += z;
        minimumZ = Math.min(minimumZ, z);
        maximumZ = Math.max(maximumZ, z);
      }
      averageZ /= group.count;
      expect(minimumZ < -0.000_1 && maximumZ > 0.000_1).toBe(false);
      expect(group.materialIndex).toBe(averageZ >= -0.000_1 ? 0 : 1);
    });

    const goalTransitions = arena.group.getObjectByName('goal-floor-transitions');
    expect(goalTransitions).toBeInstanceOf(THREE.Mesh);
    const goalTransitionMesh = goalTransitions as THREE.Mesh;
    expect(goalTransitionMesh.geometry.getAttribute('color')).toBeUndefined();
    expect(goalTransitionMesh.geometry.getAttribute('position').count).toBe(goalCurveSurfaces.length * 4);

    const rampLightStrips = arena.group.getObjectByName('ramp-team-light-strips');
    const upperLightStrips = arena.group.getObjectByName('upper-team-light-strips');
    expect(rampLightStrips).toBeInstanceOf(THREE.LineSegments);
    expect(upperLightStrips).toBeInstanceOf(THREE.LineSegments);
    [rampLightStrips, upperLightStrips].forEach((lightStrips) => {
      const stripGeometry = (lightStrips as THREE.LineSegments).geometry;
      const stripPositions = stripGeometry.getAttribute('position');
      const stripColors = stripGeometry.getAttribute('color');
      expect(stripPositions.count).toBeGreaterThan(4);
      expect(stripColors.count).toBe(stripPositions.count);
      const firstColor = new THREE.Color(
        stripColors.getX(0),
        stripColors.getY(0),
        stripColors.getZ(0),
      );
      expect(Array.from({ length: stripColors.count }, (_, index) => (
        Math.abs(firstColor.r - stripColors.getX(index))
        + Math.abs(firstColor.g - stripColors.getY(index))
        + Math.abs(firstColor.b - stripColors.getZ(index))
      )).some((distanceFromFirst) => distanceFromFirst > 0.05)).toBe(true);
    });
    const lowerStripGeometry = (rampLightStrips as THREE.LineSegments).geometry;
    lowerStripGeometry.computeBoundingBox();
    expect(lowerStripGeometry.boundingBox?.min.y).toBeCloseTo(0, 1);
    expect(lowerStripGeometry.boundingBox?.max.y).toBeLessThan(ARENA_TUNING.floorWallCurveRadius + 0.1);
    const upperStripGeometry = (upperLightStrips as THREE.LineSegments).geometry;
    upperStripGeometry.computeBoundingBox();
    expect(upperStripGeometry.boundingBox?.min.y).toBeGreaterThan(
      ARENA_TUNING.height - ARENA_TUNING.floorWallCurveRadius - 0.1,
    );
    expect(upperStripGeometry.boundingBox?.max.y).toBeCloseTo(ARENA_TUNING.height, 1);

    const upperRamp = arena.group.getObjectByName('upper-ramp-barricades');
    expect(upperRamp).toBeInstanceOf(THREE.Mesh);
    const upperRampMesh = upperRamp as THREE.Mesh;
    const upperRampMaterials = upperRampMesh.material as THREE.MeshStandardMaterial[];
    expect(upperRampMaterials).toHaveLength(2);
    expect(upperRampMaterials.every((upperRampMaterial) => (
      !upperRampMaterial.transparent && upperRampMaterial.vertexColors
    ))).toBe(true);
    expect(upperRampMesh.geometry.getAttribute('color').count).toBe(
      upperRampMesh.geometry.getAttribute('position').count,
    );
    expect(upperRampMesh.geometry.getAttribute('position').count).toBeGreaterThanOrEqual(
      upperCurveSurfaces.length * 4,
    );
    expect(upperRampMesh.geometry.index?.count).toBeGreaterThanOrEqual(upperCurveSurfaces.length * 6);
    const upperRampBacking = arena.group.getObjectByName('upper-ramp-seam-backing');
    expect(upperRampBacking).toBeInstanceOf(THREE.Mesh);
    const upperRampBackingMesh = upperRampBacking as THREE.Mesh;
    expect((upperRampBackingMesh.material as THREE.MeshStandardMaterial).transparent).toBe(false);
    expect(upperRampBackingMesh.geometry.getAttribute('position').count).toBe(upperCurveSurfaces.length * 4);

    const rampNormals = rampBackingMesh.geometry.getAttribute('normal');
    const filletSurfaces = lowerCurveSurfaces.filter(({ boundarySectionType }) => boundarySectionType === 'filletArc');
    let smoothFilletJoins = 0;
    filletSurfaces.forEach((surface) => {
      const surfaceIndex = lowerCurveSurfaces.indexOf(surface);
      const nextSurfaceIndex = lowerCurveSurfaces.findIndex((candidate) => (
        candidate.boundarySectionType === 'filletArc'
        && candidate.curveBoundaryIndex === (surface.curveBoundaryIndex ?? -2) + 1
        && candidate.curveProfileIndex === surface.curveProfileIndex
      ));
      if (nextSurfaceIndex < 0) return;
      const boundary = ARENA_BOUNDARY_SEGMENTS[surface.curveBoundaryIndex ?? -1];
      const nextSurface = lowerCurveSurfaces[nextSurfaceIndex];
      const nextBoundary = ARENA_BOUNDARY_SEGMENTS[nextSurface?.curveBoundaryIndex ?? -1];
      if (!boundary || !nextSurface || !nextBoundary) return;
      const localTangent = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(
        surface.rotation.x,
        surface.rotation.y,
        surface.rotation.z,
        surface.rotation.w,
      ));
      const nextLocalTangent = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(
        nextSurface.rotation.x,
        nextSurface.rotation.y,
        nextSurface.rotation.z,
        nextSurface.rotation.w,
      ));
      const currentEndVertex = localTangent.dot(new THREE.Vector3(
        boundary.tangent.x,
        0,
        boundary.tangent.z,
      )) > 0 ? 1 : 0;
      const nextStartVertex = nextLocalTangent.dot(new THREE.Vector3(
        nextBoundary.tangent.x,
        0,
        nextBoundary.tangent.z,
      )) > 0 ? 0 : 1;
      const currentEnd = new THREE.Vector3().fromBufferAttribute(
        rampNormals,
        surfaceIndex * 4 + currentEndVertex,
      );
      const nextStart = new THREE.Vector3().fromBufferAttribute(
        rampNormals,
        nextSurfaceIndex * 4 + nextStartVertex,
      );
      expect(currentEnd.distanceTo(nextStart)).toBeLessThan(1e-6);
      smoothFilletJoins += 1;
    });
    expect(smoothFilletJoins).toBeGreaterThan(0);

    const curveOutlines = arena.group.getObjectByName('curve-edge-outlines');
    expect(curveOutlines).toBeInstanceOf(THREE.LineSegments);
    const outlineGeometry = (curveOutlines as THREE.LineSegments).geometry;
    outlineGeometry.computeBoundingBox();
    expect(outlineGeometry.boundingBox?.min.y).toBeCloseTo(0, 1);
    expect(outlineGeometry.boundingBox?.max.y).toBeCloseTo(ARENA_TUNING.height, 1);

    const domeSupports = arena.group.getObjectByName('dome-support-beams');
    expect(domeSupports).toBeInstanceOf(THREE.InstancedMesh);
    const wallBoundaryCount = ARENA_BOUNDARY_SEGMENTS.filter(({ kind }) => kind === 'wall').length;
    expect((domeSupports as THREE.InstancedMesh).count).toBeGreaterThan(wallBoundaryCount * 2);
    expect(DOME_FRAME_OUTSET - 0.18).toBeGreaterThan(ARENA_WALL_HALF_THICKNESS * 2);

    expect(arena.group.getObjectByName('goal-azure-crossbar')).toBeInstanceOf(THREE.Mesh);
    expect(arena.group.getObjectByName('goal-coral-crossbar')).toBeInstanceOf(THREE.Mesh);
    const azureCrossbarMaterial = (
      arena.group.getObjectByName('goal-azure-crossbar') as THREE.Mesh
    ).material as THREE.MeshStandardMaterial;
    expect(azureCrossbarMaterial.color.getHex()).toBe(0x1b292d);
    expect(azureCrossbarMaterial.emissiveIntensity).toBeLessThan(0.5);
    expect(arena.group.getObjectByName('goal-shells')).toBeInstanceOf(THREE.InstancedMesh);
    expect(arena.group.getObjectByName('goal-azure-net')).toBeInstanceOf(THREE.LineSegments);
    expect(arena.group.getObjectByName('goal-coral-net')).toBeInstanceOf(THREE.LineSegments);

    arena.dispose();
  });
});
