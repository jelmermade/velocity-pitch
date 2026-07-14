import * as THREE from 'three';
import { VICTORY_CENTER } from '../gameplay/match/VictoryLineup';
import type { CameraPose } from './FollowCamera';

export class VictoryCamera {
  pose(): CameraPose {
    return {
      position: new THREE.Vector3(0, 8.5, 14),
      lookAt: new THREE.Vector3(VICTORY_CENTER.x, VICTORY_CENTER.y, VICTORY_CENTER.z),
      collisionAnchor: new THREE.Vector3(
        VICTORY_CENTER.x,
        VICTORY_CENTER.y + 0.48,
        VICTORY_CENTER.z,
      ),
    };
  }
}
