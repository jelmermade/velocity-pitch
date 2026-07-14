import * as THREE from 'three';
import type { InputManager } from '../input/InputManager';

export class FreeCamera {
  update(camera: THREE.PerspectiveCamera, input: InputManager, deltaSeconds: number): void {
    const moveSpeed = input.isDown('ShiftLeft') ? 28 : 13;
    const forwardAmount = Number(input.isDown('KeyW')) - Number(input.isDown('KeyS'));
    const rightAmount = Number(input.isDown('KeyD')) - Number(input.isDown('KeyA'));
    const upAmount = Number(input.isDown('Space')) - Number(input.isDown('ControlLeft'));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(forward, forwardAmount * moveSpeed * deltaSeconds);
    camera.position.addScaledVector(right, rightAmount * moveSpeed * deltaSeconds);
    camera.position.y += upAmount * moveSpeed * deltaSeconds;

    const yaw = Number(input.isDown('ArrowRight')) - Number(input.isDown('ArrowLeft'));
    const pitch = Number(input.isDown('ArrowDown')) - Number(input.isDown('ArrowUp'));
    camera.rotation.order = 'YXZ';
    camera.rotation.y -= yaw * 1.4 * deltaSeconds;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + pitch * 1.4 * deltaSeconds, -Math.PI * 0.49, Math.PI * 0.49);
  }
}
