import * as THREE from 'three';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { ARENA_SURFACES } from '../../gameplay/arena/ArenaDefinition';

export class GlassDomeView {
  readonly group = new THREE.Group();

  constructor() {
    this.group.name = 'glass-dome';
    this.addGlassEnvelope();
    this.addStructure();
  }

  private addGlassEnvelope(): void {
    const surfaces = ARENA_SURFACES.filter(({ kind }) => kind === 'wall' || kind === 'curve' || kind === 'ceiling');
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xa9e6ec,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.72,
      thickness: 0.18,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 1.35,
    });
    const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, surfaces.length);
    glass.name = 'glass-envelope';
    glass.renderOrder = 5;
    const transform = new THREE.Object3D();
    surfaces.forEach((surface, index) => {
      transform.position.set(surface.position.x, surface.position.y, surface.position.z);
      transform.quaternion.set(surface.rotation.x, surface.rotation.y, surface.rotation.z, surface.rotation.w);
      transform.scale.set(surface.halfExtents.x * 2, surface.halfExtents.y * 2, surface.halfExtents.z * 2);
      transform.updateMatrix();
      glass.setMatrixAt(index, transform.matrix);
    });
    glass.instanceMatrix.needsUpdate = true;
    this.group.add(glass);
  }

  private addStructure(): void {
    const material = new THREE.MeshStandardMaterial({
      color: 0x8fb8b8,
      metalness: 0.82,
      roughness: 0.24,
    });
    const sidePostGeometry = new THREE.BoxGeometry(0.18, ARENA_TUNING.height, 0.28);
    const endPostGeometry = new THREE.BoxGeometry(0.28, ARENA_TUNING.height, 0.18);
    const roofBeamGeometry = new THREE.BoxGeometry(ARENA_TUNING.halfWidth * 2 - 1, 0.16, 0.22);
    const sideLimit = ARENA_TUNING.halfLength - ARENA_TUNING.cornerRadius;
    const sidePosts: THREE.Vector3[] = [];
    const roofBeams: THREE.Vector3[] = [];
    const endPosts: THREE.Vector3[] = [];
    for (let z = -sideLimit; z <= sideLimit; z += 8) {
      for (const x of [-ARENA_TUNING.halfWidth + 0.4, ARENA_TUNING.halfWidth - 0.4]) {
        sidePosts.push(new THREE.Vector3(x, ARENA_TUNING.height / 2, z));
      }
      roofBeams.push(new THREE.Vector3(0, ARENA_TUNING.height - 0.16, z));
    }
    const endLimit = ARENA_TUNING.halfWidth - 10;
    for (const zSign of [-1, 1] as const) {
      for (let x = -endLimit; x <= endLimit; x += 8) {
        endPosts.push(new THREE.Vector3(x, ARENA_TUNING.height / 2, zSign * (ARENA_TUNING.halfLength - 0.4)));
      }
    }
    this.addInstances('dome-side-posts', sidePostGeometry, material, sidePosts);
    this.addInstances('dome-roof-beams', roofBeamGeometry, material, roofBeams);
    this.addInstances('dome-end-posts', endPostGeometry, material, endPosts);
  }

  private addInstances(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    positions: readonly THREE.Vector3[],
  ): void {
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    mesh.name = name;
    const transform = new THREE.Object3D();
    positions.forEach((position, index) => {
      transform.position.copy(position);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }
}
