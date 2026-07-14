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
    const surfaces = ARENA_SURFACES.filter(({ kind }) => kind === 'wall' || kind === 'curve' || kind === 'ceiling');
    const material = new THREE.MeshStandardMaterial({
      color: 0xa9e6ec,
      roughness: 0.18,
      metalness: 0.08,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, surfaces.length);
    glass.name = 'glass-envelope';
    glass.renderOrder = 5;
    const transform = new THREE.Object3D();
    surfaces.forEach((surface, index) => {
      transform.position.set(surface.position.x, surface.position.y, surface.position.z);
      transform.quaternion.set(surface.rotation.x, surface.rotation.y, surface.rotation.z, surface.rotation.w);
      const overlap = surface.kind === 'curve' || surface.kind === 'wall' ? GLASS_SEAM_OVERLAP : 0;
      transform.scale.set(
        surface.halfExtents.x * 2 + overlap,
        surface.halfExtents.y * 2 + overlap,
        surface.halfExtents.z * 2 + overlap,
      );
      transform.updateMatrix();
      glass.setMatrixAt(index, transform.matrix);
    });
    glass.instanceMatrix.needsUpdate = true;
    this.group.add(glass);
  }

}
