import * as THREE from 'three';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { ARENA_SURFACES } from '../../gameplay/arena/ArenaDefinition';
import { CityBackdropView } from './CityBackdropView';
import { GlassDomeView } from './GlassDomeView';
import { GrassFieldView } from './GrassFieldView';

export class ArenaView {
  readonly group = new THREE.Group();

  constructor() {
    this.group.name = 'arena';
    this.group.add(
      new CityBackdropView().group,
      new GrassFieldView().group,
      new GlassDomeView().group,
    );
    this.addGoalShells();
    this.addGoalLights();
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      const meshMaterial = object.material as THREE.Material | THREE.Material[];
      geometries.add(geometry);
      const objectMaterials = Array.isArray(meshMaterial) ? meshMaterial : [meshMaterial];
      objectMaterials.forEach((material) => {
        materials.add(material);
        if (material instanceof THREE.MeshStandardMaterial && material.map) textures.add(material.map);
      });
    });
    textures.forEach((texture) => texture.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }

  private addGoalShells(): void {
    const surfaces = ARENA_SURFACES.filter(({ kind }) => kind === 'goal');
    const material = new THREE.MeshStandardMaterial({
      color: 0x14272b,
      roughness: 0.3,
      metalness: 0.65,
    });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, surfaces.length);
    mesh.name = 'goal-shells';
    const transform = new THREE.Object3D();
    surfaces.forEach((surface, index) => {
      transform.position.set(surface.position.x, surface.position.y, surface.position.z);
      transform.quaternion.set(surface.rotation.x, surface.rotation.y, surface.rotation.z, surface.rotation.w);
      transform.scale.set(surface.halfExtents.x * 2, surface.halfExtents.y * 2, surface.halfExtents.z * 2);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private addGoalLights(): void {
    const geometry = new THREE.BoxGeometry(0.22, 0.22, ARENA_TUNING.goalDepth);
    for (const zSign of [-1, 1] as const) {
      const color = zSign > 0 ? 0x2cd9ff : 0xff5b51;
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3.5 });
      for (const xSign of [-1, 1] as const) {
        const rail = new THREE.Mesh(geometry, material);
        rail.position.set(
          xSign * ARENA_TUNING.goalHalfWidth,
          0.18,
          zSign * (ARENA_TUNING.halfLength + ARENA_TUNING.goalDepth / 2),
        );
        this.group.add(rail);
      }
    }
  }
}
