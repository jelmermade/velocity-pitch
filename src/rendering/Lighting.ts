import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARENA_TUNING } from '../core/config/ArenaTuning';

export const configureLighting = (scene: THREE.Scene, renderer: THREE.WebGLRenderer): void => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentScene = new RoomEnvironment();
  scene.environment = pmrem.fromScene(environmentScene, 0.04).texture;
  environmentScene.dispose();
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xd9f8ff, 3.5);
  key.position.set(-16, 30, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -(ARENA_TUNING.halfWidth + 8);
  key.shadow.camera.right = ARENA_TUNING.halfWidth + 8;
  key.shadow.camera.top = ARENA_TUNING.halfLength + 10;
  key.shadow.camera.bottom = -(ARENA_TUNING.halfLength + 10);
  key.shadow.camera.far = 145;
  scene.add(key);

  const fill = new THREE.HemisphereLight(0x68c7dc, 0x091116, 1.2);
  scene.add(fill);
};
