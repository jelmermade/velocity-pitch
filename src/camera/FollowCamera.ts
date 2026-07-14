import * as THREE from 'three';
import type { CarState } from '../gameplay/car/CarState';

export interface CameraPose {
  readonly position: THREE.Vector3;
  readonly lookAt: THREE.Vector3;
  readonly collisionAnchor: THREE.Vector3;
}

export class FollowCamera {
  pose(car: CarState, distance: number, height: number, targetHeight: number): CameraPose {
    const carPosition = new THREE.Vector3(car.transform.position.x, car.transform.position.y, car.transform.position.z);
    const rotation = new THREE.Quaternion(car.transform.rotation.x, car.transform.rotation.y, car.transform.rotation.z, car.transform.rotation.w);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation);
    const collisionAnchor = carPosition.clone().add(new THREE.Vector3(0, targetHeight, 0));
    const lookAt = collisionAnchor.clone().addScaledVector(forward, 2.2);
    const position = carPosition.clone().addScaledVector(forward, -distance).add(new THREE.Vector3(0, height, 0));
    return { position, lookAt, collisionAnchor };
  }
}
