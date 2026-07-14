import * as THREE from 'three';
import { ARENA_SURFACES } from '../../gameplay/arena/ArenaDefinition';

export const GLASS_SEAM_OVERLAP = 0.18;

export class GlassDomeView {
  readonly group = new THREE.Group();

  constructor() {
    this.group.name = 'glass-dome';
    this.addGlassEnvelope();
  }

  private addGlassEnvelope(): void {
    const boxSurfaces = ARENA_SURFACES.filter(({ glass, kind }) => glass && kind !== 'curve');
    const curveSurfaces = ARENA_SURFACES.filter(({ glass, kind }) => glass && kind === 'curve');
    const material = new THREE.MeshStandardMaterial({
      color: 0xa9e6ec,
      roughness: 0.18,
      metalness: 0.08,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, boxSurfaces.length);
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
    this.group.add(glass, this.createCurveEnvelope(curveSurfaces, material));
  }

  private createCurveEnvelope(
    surfaces: readonly (typeof ARENA_SURFACES)[number][],
    material: THREE.Material,
  ): THREE.Mesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const corner = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    surfaces.forEach((surface, surfaceIndex) => {
      quaternion.set(surface.rotation.x, surface.rotation.y, surface.rotation.z, surface.rotation.w);
      const halfTangent = surface.halfExtents.x;
      const halfNormal = surface.halfExtents.y;
      const halfCurve = surface.halfExtents.z;
      const localCorners = [
        [-halfTangent, -halfNormal, -halfCurve],
        [halfTangent, -halfNormal, -halfCurve],
        [halfTangent, -halfNormal, halfCurve],
        [-halfTangent, -halfNormal, halfCurve],
      ] as const;
      localCorners.forEach(([x, y, z]) => {
        corner.set(x, y, z).applyQuaternion(quaternion);
        positions.push(
          corner.x + surface.position.x,
          corner.y + surface.position.y,
          corner.z + surface.position.z,
        );
      });
      const vertex = surfaceIndex * 4;
      indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const curves = new THREE.Mesh(geometry, material);
    curves.name = 'glass-curves';
    curves.renderOrder = 5;
    return curves;
  }
}
