import * as THREE from 'three';
import type { BallState } from '../gameplay/ball/BallState';
import type { CarState } from '../gameplay/car/CarState';
import type { CameraPose } from './FollowCamera';

export class BallCamera {
  pose(car: CarState, ball: BallState, distance: number, height: number): CameraPose {
    const carPosition = new THREE.Vector3(car.transform.position.x, car.transform.position.y, car.transform.position.z);
    const ballPosition = new THREE.Vector3(ball.transform.position.x, ball.transform.position.y, ball.transform.position.z);
    const collisionAnchor = carPosition.clone().add(new THREE.Vector3(0, 1.15, 0));
    const towardBall = ballPosition.clone().sub(collisionAnchor).setY(0);
    if (towardBall.lengthSq() < 0.01) towardBall.set(0, 0, -1);
    towardBall.normalize();
    const position = carPosition.clone().addScaledVector(towardBall, -distance).add(new THREE.Vector3(0, height, 0));
    return { position, lookAt: ballPosition, collisionAnchor };
  }
}
