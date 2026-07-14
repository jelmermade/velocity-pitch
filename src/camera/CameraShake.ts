import * as THREE from 'three';

export class CameraShake {
  private strength = 0;

  add(intensity: number): void {
    this.strength = Math.min(0.6, this.strength + intensity * 0.018);
  }

  sample(deltaSeconds: number): THREE.Vector3 {
    this.strength *= Math.exp(-9 * deltaSeconds);
    if (this.strength < 0.001) return new THREE.Vector3();
    return new THREE.Vector3(
      (Math.random() - 0.5) * this.strength,
      (Math.random() - 0.5) * this.strength,
      (Math.random() - 0.5) * this.strength,
    );
  }
}
