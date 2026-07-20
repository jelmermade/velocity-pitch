import * as THREE from 'three';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import type { Vec3 } from '../../core/math/Vector3';
import {
  ARENA_BOUNDARY_SEGMENTS,
  ARENA_SURFACES,
  ARENA_WALL_HALF_THICKNESS,
} from '../../gameplay/arena/ArenaDefinition';

export const GLASS_SEAM_OVERLAP = 0.18;

interface DomeBeam {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly radius: number;
}

interface SupportAnchor {
  readonly position: Vec3;
  readonly outward: Vec3;
}

interface RampPanelInterval {
  readonly start: number;
  readonly end: number;
  readonly materialIndex: 0 | 1;
  readonly panelIndex: number;
}

const FRAME_BEAM_RADIUS = 0.18;
const FRAME_RIB_RADIUS = 0.13;
export const DOME_FRAME_OUTSET = ARENA_WALL_HALF_THICKNESS * 2 + FRAME_BEAM_RADIUS + 0.12;
const RAMP_PANEL_WIDTH = 8 * ARENA_TUNING.scale;
const RAMP_PANEL_REVEAL = 0.08 * ARENA_TUNING.scale;
const RAMP_BACKING_INSET = 0.018;
const RAMP_LIGHT_STRIP_OFFSET = 0.025;
const RAMP_PANEL_COLORS = Object.freeze([0x172023, 0x1b2528, 0x202a2c, 0x192326]);
const AZURE_RAMP_ACCENT = new THREE.Color(0x7299a3);
const CORAL_RAMP_ACCENT = new THREE.Color(0xb08a70);

export class GlassDomeView {
  readonly group = new THREE.Group();

  constructor() {
    this.group.name = 'glass-dome';
    this.addGlassEnvelope();
    this.addCurveEdgeOutlines();
    this.addRampLightStrips('floor', 'ramp-team-light-strips');
    this.addRampLightStrips('ceiling', 'upper-team-light-strips');
    this.addDomeStructure();
  }

  private addGlassEnvelope(): void {
    const boxSurfaces = ARENA_SURFACES.filter(({ glass, kind }) => glass && kind !== 'curve');
    const lowerCurveSurfaces = ARENA_SURFACES.filter(({ glass, kind, curveLocation, boundaryKind }) => (
      glass && kind === 'curve' && curveLocation === 'floor' && boundaryKind === 'wall'
    ));
    const goalCurveSurfaces = ARENA_SURFACES.filter(({ glass, kind, curveLocation, boundaryKind }) => (
      glass && kind === 'curve' && curveLocation === 'floor' && boundaryKind === 'goal'
    ));
    const upperCurveSurfaces = ARENA_SURFACES.filter(({ glass, kind, curveLocation }) => (
      glass && kind === 'curve' && curveLocation === 'ceiling'
    ));
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0xa9e6ec,
      roughness: 0.18,
      metalness: 0.08,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const rampMaterials = [
      this.createRampMaterial(0x416b75),
      this.createRampMaterial(0x79543d),
    ];
    const upperRampMaterials = [
      this.createRampMaterial(0x416b75),
      this.createRampMaterial(0x79543d),
    ];
    const goalTransitionMaterial = new THREE.MeshStandardMaterial({
      color: 0x182529,
      roughness: 0.32,
      metalness: 0.52,
      side: THREE.DoubleSide,
    });
    const rampBackingMaterial = new THREE.MeshStandardMaterial({
      color: 0x090f11,
      roughness: 0.48,
      metalness: 0.42,
      side: THREE.FrontSide,
    });
    const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), glassMaterial, boxSurfaces.length);
    glass.name = 'glass-envelope';
    glass.renderOrder = 5;
    const transform = new THREE.Object3D();
    boxSurfaces.forEach((surface, index) => {
      transform.position.set(surface.position.x, surface.position.y, surface.position.z);
      transform.quaternion.set(surface.rotation.x, surface.rotation.y, surface.rotation.z, surface.rotation.w);
      const tangentOverlap = surface.kind === 'wall' || surface.kind === 'goal'
        ? GLASS_SEAM_OVERLAP
        : 0;
      transform.scale.set(
        surface.halfExtents.x * 2 + tangentOverlap,
        surface.halfExtents.y * 2,
        surface.halfExtents.z * 2,
      );
      transform.updateMatrix();
      glass.setMatrixAt(index, transform.matrix);
    });
    glass.instanceMatrix.needsUpdate = true;
    this.group.add(
      glass,
      this.createCurveEnvelope(
        lowerCurveSurfaces,
        rampBackingMaterial,
        'ramp-seam-backing',
        false,
        false,
        RAMP_BACKING_INSET,
      ),
      this.createCurveEnvelope(
        upperCurveSurfaces,
        rampBackingMaterial.clone(),
        'upper-ramp-seam-backing',
        false,
        false,
        RAMP_BACKING_INSET,
      ),
      this.createCurveEnvelope(lowerCurveSurfaces, rampMaterials, 'ramp-barricades', true, true),
      this.createCurveEnvelope(goalCurveSurfaces, goalTransitionMaterial, 'goal-floor-transitions', false),
      this.createCurveEnvelope(upperCurveSurfaces, upperRampMaterials, 'upper-ramp-barricades', true, true),
    );
  }

  private createRampMaterial(emissive: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive,
      emissiveIntensity: 0.16,
      roughness: 0.3,
      metalness: 0.48,
      vertexColors: true,
      side: THREE.FrontSide,
    });
  }

  private createCurveEnvelope(
    surfaces: readonly (typeof ARENA_SURFACES)[number][],
    material: THREE.Material | THREE.Material[],
    name: string,
    panelled: boolean,
    groupByTeamHalf = false,
    faceInset = 0,
  ): THREE.Mesh {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const geometryGroupAssignments: { readonly indexOffset: number; readonly materialIndex: number }[] = [];
    const corner = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    const panelColor = new THREE.Color();
    surfaces.forEach((surface, surfaceIndex) => {
      quaternion.set(surface.rotation.x, surface.rotation.y, surface.rotation.z, surface.rotation.w);
      const halfNormal = surface.halfExtents.y;
      const halfCurve = surface.halfExtents.z;
      const startNormal = surface.curveStartNormal;
      const endNormal = surface.curveEndNormal;
      if (!startNormal || !endNormal) throw new Error('Curve surface is missing smooth profile normals');
      const panelIntervals = this.createRampPanelIntervals(surface, panelled);
      const boundaryIndex = surface.curveBoundaryIndex ?? surfaceIndex;
      panelIntervals.forEach(({ start: startX, end: endX, materialIndex, panelIndex }) => {
        const indexOffset = indices.length;
        const localCorners = [
          [startX, -halfNormal + faceInset, -halfCurve],
          [endX, -halfNormal + faceInset, -halfCurve],
          [endX, -halfNormal + faceInset, halfCurve],
          [startX, -halfNormal + faceInset, halfCurve],
        ] as const;
        localCorners.forEach(([x, y, z]) => {
          corner.set(x, y, z).applyQuaternion(quaternion);
          positions.push(
            corner.x + surface.position.x,
            corner.y + surface.position.y,
            corner.z + surface.position.z,
          );
        });
        const startProfileAtStart = this.smoothFilletNormal(surface, startNormal, -1);
        const startProfileAtEnd = this.smoothFilletNormal(surface, startNormal, 1);
        const endProfileAtEnd = this.smoothFilletNormal(surface, endNormal, 1);
        const endProfileAtStart = this.smoothFilletNormal(surface, endNormal, -1);
        [startProfileAtStart, startProfileAtEnd, endProfileAtEnd, endProfileAtStart].forEach((normal) => {
          normals.push(normal.x, normal.y, normal.z);
        });
        if (panelled) {
          const panelColorIndex = surface.boundarySectionType === 'filletArc'
            ? 0
            : boundaryIndex + panelIndex;
          panelColor.setHex(RAMP_PANEL_COLORS[panelColorIndex % RAMP_PANEL_COLORS.length] ?? 0x087f86);
          for (let vertexIndex = 0; vertexIndex < 4; vertexIndex += 1) {
            colors.push(panelColor.r, panelColor.g, panelColor.b);
          }
        }
        const vertex = positions.length / 3 - 4;
        indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
        if (groupByTeamHalf) {
          geometryGroupAssignments.push({
            indexOffset,
            materialIndex,
          });
        }
      });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    if (panelled) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometryGroupAssignments.forEach(({ indexOffset, materialIndex }) => {
      geometry.addGroup(indexOffset, 6, materialIndex);
    });
    const curves = new THREE.Mesh(geometry, material);
    curves.name = name;
    curves.renderOrder = 5;
    return curves;
  }

  private smoothFilletNormal(
    surface: (typeof ARENA_SURFACES)[number],
    profileNormal: Vec3,
    tangentEnd: -1 | 1,
  ): Vec3 {
    if (surface.boundarySectionType !== 'filletArc' || surface.curveBoundaryIndex === undefined) {
      return profileNormal;
    }
    const boundaryIndex = surface.curveBoundaryIndex;
    const boundary = ARENA_BOUNDARY_SEGMENTS[boundaryIndex];
    if (!boundary) return profileNormal;
    const quaternion = new THREE.Quaternion(
      surface.rotation.x,
      surface.rotation.y,
      surface.rotation.z,
      surface.rotation.w,
    );
    const localTangent = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    const boundaryDirection = Math.sign(
      localTangent.x * boundary.tangent.x + localTangent.z * boundary.tangent.z,
    );
    const neighbor = ARENA_BOUNDARY_SEGMENTS[
      (
        boundaryIndex
        + tangentEnd * boundaryDirection
        + ARENA_BOUNDARY_SEGMENTS.length
      ) % ARENA_BOUNDARY_SEGMENTS.length
    ];
    if (!neighbor) return profileNormal;
    const horizontalLength = Math.hypot(profileNormal.x, profileNormal.z);
    if (horizontalLength < 1e-6) return profileNormal;
    const outward = new THREE.Vector2(
      boundary.outward.x + neighbor.outward.x,
      boundary.outward.z + neighbor.outward.z,
    ).normalize();
    const horizontalSign = Math.sign(
      profileNormal.x * boundary.outward.x + profileNormal.z * boundary.outward.z,
    );
    return {
      x: outward.x * horizontalLength * horizontalSign,
      y: profileNormal.y,
      z: outward.y * horizontalLength * horizontalSign,
    };
  }

  private createRampPanelIntervals(
    surface: (typeof ARENA_SURFACES)[number],
    panelled = true,
  ): readonly RampPanelInterval[] {
    const halfTangent = surface.halfExtents.x;
    const seamlessFillet = surface.boundarySectionType === 'filletArc';
    const panelCount = panelled && !seamlessFillet
      ? Math.max(1, Math.ceil(halfTangent * 2 / RAMP_PANEL_WIDTH))
      : 1;
    const breaks = Array.from(
      { length: panelCount + 1 },
      (_, index) => -halfTangent + index / panelCount * halfTangent * 2,
    );
    const quaternion = new THREE.Quaternion(
      surface.rotation.x,
      surface.rotation.y,
      surface.rotation.z,
      surface.rotation.w,
    );
    const faceCenter = new THREE.Vector3(0, -surface.halfExtents.y, 0).applyQuaternion(quaternion);
    faceCenter.add(new THREE.Vector3(surface.position.x, surface.position.y, surface.position.z));
    const tangent = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    if (panelled && !seamlessFillet && Math.abs(tangent.z) > 1e-6) {
      const midfield = -faceCenter.z / tangent.z;
      if (midfield > -halfTangent + 1e-6 && midfield < halfTangent - 1e-6) breaks.push(midfield);
    }
    breaks.sort((left, right) => left - right);
    const uniqueBreaks = breaks.filter((value, index) => (
      index === 0 || Math.abs(value - (breaks[index - 1] ?? value)) > 1e-6
    ));

    return uniqueBreaks.slice(0, -1).map((start, panelIndex) => {
      const end = uniqueBreaks[panelIndex + 1] ?? start;
      const reveal = panelled && !seamlessFillet
        ? Math.min(RAMP_PANEL_REVEAL, (end - start) * 0.2)
        : 0;
      const panelStart = start + reveal / 2;
      const panelEnd = end - reveal / 2;
      const midpointWorldZ = faceCenter.z + tangent.z * ((panelStart + panelEnd) / 2);
      return {
        start: panelStart,
        end: panelEnd,
        materialIndex: midpointWorldZ >= 0 ? 0 : 1,
        panelIndex,
      };
    });
  }

  private addCurveEdgeOutlines(): void {
    const surfaces = ARENA_SURFACES.filter(({ glass, kind }) => glass && kind === 'curve');
    const positions: number[] = [];
    const point = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const appendTangentEdge = (
      surface: (typeof ARENA_SURFACES)[number],
      curveSide: -1 | 1,
    ): void => {
      quaternion.set(surface.rotation.x, surface.rotation.y, surface.rotation.z, surface.rotation.w);
      for (const tangentSide of [-1, 1] as const) {
        point.set(
          tangentSide * surface.halfExtents.x,
          -surface.halfExtents.y,
          curveSide * surface.halfExtents.z,
        ).applyQuaternion(quaternion);
        positions.push(
          point.x + surface.position.x,
          point.y + surface.position.y,
          point.z + surface.position.z,
        );
      }
    };

    surfaces.forEach((surface) => {
      const profileIndex = surface.curveProfileIndex;
      const profileSegments = surface.curveProfileSegments;
      if (profileIndex === 0) appendTangentEdge(surface, -1);
      if (profileIndex === (profileSegments ?? 0) - 1) appendTangentEdge(surface, 1);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0x789397,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    const outlines = new THREE.LineSegments(geometry, material);
    outlines.name = 'curve-edge-outlines';
    outlines.renderOrder = 7;
    this.group.add(outlines);
  }

  private addRampLightStrips(
    curveLocation: 'floor' | 'ceiling',
    name: string,
  ): void {
    const surfaces = ARENA_SURFACES.filter(({ glass, kind, curveLocation: location, boundaryKind }) => (
      glass && kind === 'curve' && location === curveLocation && boundaryKind === 'wall'
    ));
    const positions: number[] = [];
    const colors: number[] = [];
    const point = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const appendPoint = (
      surface: (typeof ARENA_SURFACES)[number],
      x: number,
      curveSide: -1 | 1,
      materialIndex: 0 | 1,
    ): void => {
      quaternion.set(surface.rotation.x, surface.rotation.y, surface.rotation.z, surface.rotation.w);
      point.set(
        x,
        -surface.halfExtents.y,
        curveSide * surface.halfExtents.z,
      ).applyQuaternion(quaternion);
      point.x += surface.position.x;
      point.y += surface.position.y;
      point.z += surface.position.z;
      const normal = curveSide === -1 ? surface.curveStartNormal : surface.curveEndNormal;
      if (!normal) throw new Error('Curve surface is missing smooth profile normals');
      point.x += normal.x * RAMP_LIGHT_STRIP_OFFSET;
      point.y += normal.y * RAMP_LIGHT_STRIP_OFFSET;
      point.z += normal.z * RAMP_LIGHT_STRIP_OFFSET;
      positions.push(point.x, point.y, point.z);
      const color = materialIndex === 0 ? AZURE_RAMP_ACCENT : CORAL_RAMP_ACCENT;
      colors.push(color.r, color.g, color.b);
    };

    surfaces.forEach((surface) => {
      const intervals = this.createRampPanelIntervals(surface);
      const profileIndex = surface.curveProfileIndex ?? 0;
      const lastProfileIndex = (surface.curveProfileSegments ?? 1) - 1;
      intervals.forEach((interval) => {
        if (profileIndex === 0) {
          appendPoint(surface, interval.start, -1, interval.materialIndex);
          appendPoint(surface, interval.end, -1, interval.materialIndex);
        }
        if (profileIndex === lastProfileIndex) {
          appendPoint(surface, interval.start, 1, interval.materialIndex);
          appendPoint(surface, interval.end, 1, interval.materialIndex);
        }
        if (surface.boundarySectionType !== 'filletArc') {
          appendPoint(surface, interval.start, -1, interval.materialIndex);
          appendPoint(surface, interval.start, 1, interval.materialIndex);
          appendPoint(surface, interval.end, -1, interval.materialIndex);
          appendPoint(surface, interval.end, 1, interval.materialIndex);
        }
      });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      toneMapped: false,
    });
    const accents = new THREE.LineSegments(geometry, material);
    accents.name = name;
    accents.renderOrder = 8;
    this.group.add(accents);
  }

  private addDomeStructure(): void {
    const beams = this.createDomeBeams();
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 10);
    const material = new THREE.MeshStandardMaterial({
      color: 0x17383d,
      emissive: 0x07191c,
      emissiveIntensity: 0.8,
      roughness: 0.28,
      metalness: 0.82,
    });
    const structure = new THREE.InstancedMesh(geometry, material, beams.length);
    structure.name = 'dome-support-beams';
    structure.castShadow = true;
    structure.receiveShadow = true;
    const transform = new THREE.Object3D();
    const direction = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    beams.forEach((beam, index) => {
      direction.set(
        beam.end.x - beam.start.x,
        beam.end.y - beam.start.y,
        beam.end.z - beam.start.z,
      );
      const length = direction.length();
      transform.position.set(
        (beam.start.x + beam.end.x) / 2,
        (beam.start.y + beam.end.y) / 2,
        (beam.start.z + beam.end.z) / 2,
      );
      transform.quaternion.setFromUnitVectors(up, direction.normalize());
      transform.scale.set(beam.radius, length, beam.radius);
      transform.updateMatrix();
      structure.setMatrixAt(index, transform.matrix);
    });
    structure.instanceMatrix.needsUpdate = true;
    this.group.add(structure);
  }

  private createDomeBeams(): DomeBeam[] {
    const beams: DomeBeam[] = [];
    const wallBoundaries = ARENA_BOUNDARY_SEGMENTS.filter(({ kind }) => kind === 'wall');
    const lowerY = ARENA_TUNING.floorWallCurveRadius;
    const upperY = ARENA_TUNING.height + FRAME_BEAM_RADIUS * 0.25;

    wallBoundaries.forEach(({ start, end, outward }) => {
      const exteriorStart = this.exteriorPoint(start, outward);
      const exteriorEnd = this.exteriorPoint(end, outward);
      beams.push(
        { start: { ...exteriorStart, y: lowerY }, end: { ...exteriorEnd, y: lowerY }, radius: FRAME_BEAM_RADIUS },
        { start: { ...exteriorStart, y: upperY }, end: { ...exteriorEnd, y: upperY }, radius: FRAME_BEAM_RADIUS },
      );
    });

    const anchors = this.createSupportAnchors(wallBoundaries);
    anchors.forEach(({ position, outward }) => {
      const exteriorPosition = this.exteriorPoint(position, outward);
      beams.push({
        start: { ...exteriorPosition, y: 0 },
        end: { ...exteriorPosition, y: upperY },
        radius: FRAME_RIB_RADIUS,
      });
    });

    const mouthZ = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;
    for (const zSign of [-1, 1] as const) {
      const exteriorMouthZ = zSign * (mouthZ + DOME_FRAME_OUTSET);
      beams.push({
        start: { x: -ARENA_TUNING.goalHalfWidth, y: upperY, z: exteriorMouthZ },
        end: { x: ARENA_TUNING.goalHalfWidth, y: upperY, z: exteriorMouthZ },
        radius: FRAME_BEAM_RADIUS,
      });
      for (const xSign of [-1, 1] as const) {
        beams.push({
          start: { x: xSign * ARENA_TUNING.goalHalfWidth, y: ARENA_TUNING.goalHeight, z: exteriorMouthZ },
          end: { x: xSign * ARENA_TUNING.goalHalfWidth, y: upperY, z: exteriorMouthZ },
          radius: FRAME_RIB_RADIUS,
        });
      }
    }

    const roofInset = (
      ARENA_TUNING.cornerChamferLength
      + 2 * ARENA_TUNING.cornerFilletRadius * Math.tan(Math.PI / 8)
    ) / Math.SQRT2;
    for (const ratio of [-1, -0.5, 0, 0.5, 1]) {
      const z = ratio * (ARENA_TUNING.halfLength - roofInset);
      beams.push({
        start: { x: -ARENA_TUNING.halfWidth - DOME_FRAME_OUTSET, y: upperY, z },
        end: { x: ARENA_TUNING.halfWidth + DOME_FRAME_OUTSET, y: upperY, z },
        radius: FRAME_RIB_RADIUS,
      });
    }
    beams.push({
      start: { x: 0, y: upperY + FRAME_RIB_RADIUS, z: -mouthZ },
      end: { x: 0, y: upperY + FRAME_RIB_RADIUS, z: mouthZ },
      radius: FRAME_RIB_RADIUS,
    });
    return beams;
  }

  private createSupportAnchors(
    wallBoundaries: readonly (typeof ARENA_BOUNDARY_SEGMENTS)[number][],
  ): readonly SupportAnchor[] {
    const anchors = new Map<string, SupportAnchor>();
    const addAnchor = (position: Vec3, outward: Vec3): void => {
      const key = `${position.x.toFixed(3)}:${position.z.toFixed(3)}`;
      if (!anchors.has(key)) anchors.set(key, { position, outward });
    };
    wallBoundaries.filter(({ curve }) => !curve).forEach(({ start, end, outward }) => {
      addAnchor(start, outward);
      addAnchor(end, outward);
    });
    return [...anchors.values()];
  }

  private exteriorPoint(position: Vec3, outward: Vec3): Vec3 {
    return {
      x: position.x + outward.x * DOME_FRAME_OUTSET,
      y: position.y,
      z: position.z + outward.z * DOME_FRAME_OUTSET,
    };
  }
}
