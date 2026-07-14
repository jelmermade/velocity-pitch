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
    this.addGoalPresentation();
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return;
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

  private addGoalPresentation(): void {
    for (const zSign of [-1, 1] as const) {
      const color = zSign > 0 ? 0x2cd9ff : 0xff5b51;
      const team = zSign > 0 ? 'azure' : 'coral';
      const frameMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 2.6,
        metalness: 0.65,
        roughness: 0.22,
      });
      const glowMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mouthZ = zSign * (ARENA_TUNING.halfLength + 0.12);
      const centerZ = zSign * (ARENA_TUNING.halfLength + ARENA_TUNING.goalDepth / 2);
      const frameThickness = 0.34;

      const postGeometry = new THREE.BoxGeometry(frameThickness, ARENA_TUNING.goalHeight, frameThickness);
      for (const xSign of [-1, 1] as const) {
        const post = new THREE.Mesh(postGeometry, frameMaterial);
        post.position.set(xSign * ARENA_TUNING.goalHalfWidth, ARENA_TUNING.goalHeight / 2, mouthZ);
        post.name = `goal-${team}-post`;
        this.group.add(post);

        const depthRail = new THREE.Mesh(
          new THREE.BoxGeometry(frameThickness * 0.62, frameThickness * 0.62, ARENA_TUNING.goalDepth),
          frameMaterial,
        );
        depthRail.position.set(xSign * ARENA_TUNING.goalHalfWidth, 0.2, centerZ);
        this.group.add(depthRail);
      }

      const crossbar = new THREE.Mesh(
        new THREE.BoxGeometry(ARENA_TUNING.goalHalfWidth * 2 + frameThickness, frameThickness, frameThickness),
        frameMaterial,
      );
      crossbar.position.set(0, ARENA_TUNING.goalHeight, mouthZ);
      crossbar.name = `goal-${team}-crossbar`;
      this.group.add(crossbar);

      const canopyRails = new THREE.Mesh(
        new THREE.BoxGeometry(ARENA_TUNING.goalHalfWidth * 2, frameThickness * 0.5, ARENA_TUNING.goalDepth),
        glowMaterial,
      );
      canopyRails.position.set(0, ARENA_TUNING.goalHeight + 0.06, centerZ);
      this.group.add(canopyRails);

      const goalFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_TUNING.goalHalfWidth * 2 - 0.4, ARENA_TUNING.goalDepth - 0.3),
        glowMaterial,
      );
      goalFloor.rotation.x = -Math.PI / 2;
      goalFloor.position.set(0, 0.025, centerZ);
      goalFloor.name = `goal-${team}-floor`;
      this.group.add(goalFloor, this.createGoalNet(team, color, zSign));
    }
  }

  private createGoalNet(team: 'azure' | 'coral', color: number, zSign: -1 | 1): THREE.LineSegments {
    const points: number[] = [];
    const z = zSign * (ARENA_TUNING.halfLength + ARENA_TUNING.goalDepth - 0.42);
    const columns = 10;
    const rows = 5;
    for (let column = 0; column <= columns; column += 1) {
      const x = -ARENA_TUNING.goalHalfWidth + column * (ARENA_TUNING.goalHalfWidth * 2 / columns);
      points.push(x, 0.12, z, x, ARENA_TUNING.goalHeight - 0.12, z);
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = 0.12 + row * ((ARENA_TUNING.goalHeight - 0.24) / rows);
      points.push(-ARENA_TUNING.goalHalfWidth, y, z, ARENA_TUNING.goalHalfWidth, y, z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.58 });
    const net = new THREE.LineSegments(geometry, material);
    net.name = `goal-${team}-net`;
    return net;
  }
}
