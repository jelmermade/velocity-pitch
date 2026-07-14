import * as THREE from 'three';
import type { CameraPose } from './FollowCamera';

export class VictoryCamera {
  pose(): CameraPose {
    return {
      position: new THREE.Vector3(0, 8.5, 14),
      lookAt: new THREE.Vector3(0, 1.35, 0),
      collisionAnchor: new THREE.Vector3(0, 2, 0),
    };
  }
}
