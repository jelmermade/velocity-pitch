import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BallCamera } from '../../src/camera/BallCamera';
import { IDENTITY_QUAT } from '../../src/core/math/Quaternion';
import type { BallState } from '../../src/gameplay/ball/BallState';
import type { CarState } from '../../src/gameplay/car/CarState';

describe('BallCamera', () => {
  it('orbits the car while facing the ball and keeps collision checks car-centered', () => {
    const car = carState({ x: 0, y: 1, z: 12 });
    const ball = ballState({ x: 8, y: 1.35, z: -4 });
    const pose = new BallCamera().pose(car, ball, 8.8, 3.2);
    const carPosition = new THREE.Vector3(0, 1, 12);
    const ballPosition = new THREE.Vector3(8, 1.35, -4);

    expect(pose.position.distanceTo(carPosition)).toBeGreaterThan(8);
    expect(pose.position.distanceTo(ballPosition)).toBeGreaterThan(8);
    expect(pose.lookAt.distanceTo(ballPosition)).toBeLessThan(0.001);
    expect(pose.collisionAnchor.x).toBeCloseTo(carPosition.x);
    expect(pose.collisionAnchor.z).toBeCloseTo(carPosition.z);

    const cameraToCar = carPosition.clone().sub(pose.position).setY(0).normalize();
    const carToBall = ballPosition.clone().sub(carPosition).setY(0).normalize();
    expect(cameraToCar.dot(carToBall)).toBeGreaterThan(0.999);
  });
});

const carState = (position: { readonly x: number; readonly y: number; readonly z: number }): CarState => ({
  transform: { position, rotation: IDENTITY_QUAT },
  linearVelocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  wheels: [],
  grounded: true,
  boost: 100,
  boosting: false,
});

const ballState = (position: { readonly x: number; readonly y: number; readonly z: number }): BallState => ({
  transform: { position, rotation: IDENTITY_QUAT },
  linearVelocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
});
