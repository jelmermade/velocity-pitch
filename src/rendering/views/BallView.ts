import * as THREE from 'three';
import { BALL_TUNING } from '../../core/config/BallTuning';
import type { BallState } from '../../gameplay/ball/BallState';

export class BallView {
  readonly group = new THREE.Group();

  constructor() {
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(BALL_TUNING.radius, 4),
      new THREE.MeshStandardMaterial({ color: 0xe7eee5, roughness: 0.34, metalness: 0.18 }),
    );
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.group.add(shell);

    const lattice = new THREE.Mesh(
      new THREE.IcosahedronGeometry(BALL_TUNING.radius * 1.012, 2),
      new THREE.MeshStandardMaterial({ color: 0x18343d, emissive: 0x0f7d83, emissiveIntensity: 0.8, wireframe: true }),
    );
    this.group.add(lattice);
  }

  update(state: BallState): void {
    const { position, rotation } = state.transform;
    this.group.position.set(position.x, position.y, position.z);
    this.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    });
  }
}
