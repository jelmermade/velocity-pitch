import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CameraController } from '../../src/camera/CameraController';
import { EventBus } from '../../src/core/events/EventBus';
import type { GameEventMap } from '../../src/core/events/GameEvents';
import type { InputManager } from '../../src/input/InputManager';
import type { SimulationSnapshot } from '../../src/gameplay/simulation/SimulationSnapshot';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { RapierPhysicsWorld } from '../../src/physics/rapier/RapierPhysicsWorld';

describe('victory camera', () => {
  let world: PhysicsWorld | undefined;

  afterEach(() => world?.dispose());

  it('follows the winning car instead of an underground ball', async () => {
    world = await RapierPhysicsWorld.create();
    const camera = new THREE.PerspectiveCamera();
    const input = { isDown: () => false } as unknown as InputManager;
    const controller = new CameraController(camera, world, input, new EventBus<GameEventMap>());

    controller.update(VICTORY_SNAPSHOT, 1 / 60);

    expect(controller.modeName()).toBe('victory');
    expect(camera.position.y).toBeGreaterThan(2);
    expect(camera.position.z).toBeGreaterThan(5);
    controller.dispose();
  });
});

const VICTORY_SNAPSHOT: SimulationSnapshot = {
  tick: 1,
  car: {
    transform: {
      position: { x: 0, y: 0.72, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    wheels: [],
    grounded: true,
    boost: 100,
    boosting: false,
  },
  ball: {
    transform: {
      position: { x: 0, y: -10, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
  },
  boostPickups: [],
  match: {
    phase: 'ended',
    paused: false,
    timeRemaining: 0,
    countdown: 0,
    azureScore: 2,
    coralScore: 1,
    overtime: false,
    replayProgress: 0,
    lastGoalTeam: 'azure',
  },
};
