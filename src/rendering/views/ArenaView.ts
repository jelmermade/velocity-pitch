import * as THREE from 'three';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { ARENA_SURFACES, GOALS } from '../../gameplay/arena/ArenaDefinition';
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
      transform.scale.set(
        surface.halfExtents.x * 2,
        surface.halfExtents.y * 2,
        surface.halfExtents.z * 2,
      );
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private addGoalPresentation(): void {
    for (const goal of GOALS) {
      const zSign = goal.center.z > 0 ? 1 : -1;
      const team = goal.defendingTeam;
      const color = team === 'azure' ? 0x7299a3 : 0xb08a70;
      const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x1b292d,
        emissive: 0x0c1719,
        emissiveIntensity: 0.35,
        metalness: 0.72,
        roughness: 0.26,
      });
      const accentMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.42,
        metalness: 0.58,
        roughness: 0.24,
      });
      const glowMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const goalLine = ARENA_TUNING.halfLength + ARENA_TUNING.goalTransitionDepth;
      const mouthZ = zSign * (goalLine + 0.12);
      const centerZ = zSign * (goalLine + ARENA_TUNING.goalDepth / 2);
      const frameThickness = 0.44;
      const accentThickness = 0.075;

      const postGeometry = new THREE.BoxGeometry(frameThickness, ARENA_TUNING.goalHeight, frameThickness);
      for (const xSign of [-1, 1] as const) {
        const post = new THREE.Mesh(postGeometry, frameMaterial);
        post.position.set(xSign * ARENA_TUNING.goalHalfWidth, ARENA_TUNING.goalHeight / 2, mouthZ);
        post.name = `goal-${team}-post`;
        const postAccent = new THREE.Mesh(
          new THREE.BoxGeometry(accentThickness, ARENA_TUNING.goalHeight - frameThickness, frameThickness * 1.04),
          accentMaterial,
        );
        postAccent.position.set(
          xSign * (ARENA_TUNING.goalHalfWidth - frameThickness * 0.54),
          (ARENA_TUNING.goalHeight - frameThickness) / 2,
          mouthZ - zSign * 0.015,
        );
        this.group.add(post, postAccent);

        const railGeometry = new THREE.BoxGeometry(
          frameThickness * 0.62,
          frameThickness * 0.62,
          ARENA_TUNING.goalDepth,
        );
        const depthRail = new THREE.Mesh(
          railGeometry,
          frameMaterial,
        );
        depthRail.position.set(xSign * ARENA_TUNING.goalHalfWidth, 0.2, centerZ);
        const upperDepthRail = new THREE.Mesh(railGeometry, frameMaterial);
        upperDepthRail.position.set(
          xSign * ARENA_TUNING.goalHalfWidth,
          ARENA_TUNING.goalHeight - frameThickness * 0.31,
          centerZ,
        );
        this.group.add(depthRail, upperDepthRail);
      }

      const crossbar = new THREE.Mesh(
        new THREE.BoxGeometry(ARENA_TUNING.goalHalfWidth * 2 + frameThickness, frameThickness, frameThickness),
        frameMaterial,
      );
      crossbar.position.set(0, ARENA_TUNING.goalHeight, mouthZ);
      crossbar.name = `goal-${team}-crossbar`;
      const crossbarAccent = new THREE.Mesh(
        new THREE.BoxGeometry(
          ARENA_TUNING.goalHalfWidth * 2 - frameThickness,
          accentThickness,
          frameThickness * 1.04,
        ),
        accentMaterial,
      );
      crossbarAccent.position.set(
        0,
        ARENA_TUNING.goalHeight - frameThickness * 0.54,
        mouthZ - zSign * 0.015,
      );
      this.group.add(crossbar, crossbarAccent);

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
    const z = zSign * (
      ARENA_TUNING.halfLength
      + ARENA_TUNING.goalTransitionDepth
      + ARENA_TUNING.goalDepth
      - 0.42
    );
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
