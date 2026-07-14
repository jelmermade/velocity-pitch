import * as THREE from 'three';
import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';
import type { CameraPose } from './FollowCamera';

export class ReplayCamera {
  pose(snapshot: SimulationSnapshot): CameraPose {
    const ball = new THREE.Vector3(
      snapshot.ball.transform.position.x,
      snapshot.ball.transform.position.y,
      snapshot.ball.transform.position.z,
    );
    const travel = new THREE.Vector3(
      snapshot.ball.linearVelocity.x,
      0,
      snapshot.ball.linearVelocity.z,
    );
    if (travel.lengthSq() < 0.2) travel.set(0, 0, snapshot.match.lastGoalTeam === 'azure' ? 1 : -1);
    travel.normalize();
    const side = new THREE.Vector3(-travel.z, 0, travel.x);
    const orbit = Math.sin(snapshot.match.replayProgress * Math.PI) * 4.5;
    const collisionAnchor = ball.clone().add(new THREE.Vector3(0, 1.2, 0));
    const position = ball.clone()
      .addScaledVector(travel, -8.5)
      .addScaledVector(side, 5.5 + orbit)
      .add(new THREE.Vector3(0, 4.8, 0));
    const lookAt = ball.clone().addScaledVector(travel, 1.4);
    return { position, lookAt, collisionAnchor };
  }
}
