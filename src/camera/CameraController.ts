import * as THREE from 'three';
import { CAMERA_TUNING } from '../core/config/CameraTuning';
import type { EventBus } from '../core/events/EventBus';
import type { GameEventMap } from '../core/events/GameEvents';
import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';
import type { InputManager } from '../input/InputManager';
import type { PlayerCommand } from '../input/PlayerCommand';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { BallCamera } from './BallCamera';
import { CameraCollision } from './CameraCollision';
import { CameraShake } from './CameraShake';
import { FollowCamera } from './FollowCamera';
import { FreeCamera } from './FreeCamera';
import { ReplayCamera } from './ReplayCamera';

type CameraMode = 'follow' | 'ball' | 'free';

export class CameraController {
  private mode: CameraMode = 'ball';
  private previousPlayMode: Exclude<CameraMode, 'free'> = 'ball';
  private distance: number = CAMERA_TUNING.distance;
  private baseFov: number = CAMERA_TUNING.fieldOfView;
  private readonly follow = new FollowCamera();
  private readonly ball = new BallCamera();
  private readonly free = new FreeCamera();
  private readonly replay = new ReplayCamera();
  private readonly collision: CameraCollision;
  private readonly shake = new CameraShake();
  private readonly unsubscribeImpact: () => void;
  private readonly unsubscribeGoal: () => void;
  private replayActive = false;
  private victoryActive = false;
  private hasAppliedPlayPose = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    world: PhysicsWorld,
    private readonly input: InputManager,
    events: EventBus<GameEventMap>,
  ) {
    this.collision = new CameraCollision(world, CAMERA_TUNING.collisionPadding);
    this.camera.position.set(0, 5, 27);
    this.unsubscribeImpact = events.on('carImpact', ({ intensity }) => this.shake.add(intensity));
    this.unsubscribeGoal = events.on('goal', () => this.shake.add(30));
  }

  handleCommand(command: PlayerCommand): void {
    if (command.toggleBallCamera && this.mode !== 'free') this.mode = this.mode === 'ball' ? 'follow' : 'ball';
    if (command.toggleFreeCamera) {
      if (this.mode === 'free') this.mode = this.previousPlayMode;
      else {
        this.previousPlayMode = this.mode;
        this.mode = 'free';
      }
    }
  }

  update(snapshot: SimulationSnapshot, deltaSeconds: number): void {
    this.replayActive = snapshot.match.phase === 'replay';
    this.victoryActive = snapshot.match.phase === 'ended';
    if (this.replayActive) {
      this.applyPose(this.replay.pose(snapshot), deltaSeconds, 4.5, 78);
      return;
    }
    if (this.victoryActive) {
      this.applyPose(
        this.follow.pose(snapshot.car, this.distance, CAMERA_TUNING.height, CAMERA_TUNING.targetHeight),
        deltaSeconds,
        CAMERA_TUNING.stiffness,
        this.baseFov,
      );
      return;
    }
    if (this.mode === 'free') {
      this.free.update(this.camera, this.input, deltaSeconds);
      return;
    }
    const pose = this.mode === 'ball'
      ? this.ball.pose(snapshot.car, snapshot.ball, this.distance, CAMERA_TUNING.height)
      : this.follow.pose(snapshot.car, this.distance, CAMERA_TUNING.height, CAMERA_TUNING.targetHeight);
    const desiredFov = snapshot.car.boosting ? CAMERA_TUNING.boostFieldOfView : this.baseFov;
    this.applyPose(pose, deltaSeconds, CAMERA_TUNING.stiffness, desiredFov);
  }

  private applyPose(
    pose: { readonly position: THREE.Vector3; readonly lookAt: THREE.Vector3; readonly collisionAnchor: THREE.Vector3 },
    deltaSeconds: number,
    stiffness: number,
    desiredFov: number,
  ): void {
    const target = pose.lookAt.clone();
    const safePosition = this.collision.resolve(pose.collisionAnchor, pose.position);
    if (!this.hasAppliedPlayPose) {
      this.camera.position.copy(safePosition);
      this.hasAppliedPlayPose = true;
    } else {
      const blend = 1 - Math.exp(-stiffness * deltaSeconds);
      const smoothedPosition = this.camera.position.clone().lerp(safePosition, blend);
      this.camera.position.copy(this.collision.resolve(pose.collisionAnchor, smoothedPosition));
    }
    this.camera.position.add(this.shake.sample(deltaSeconds));
    this.camera.lookAt(target);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, desiredFov, 1 - Math.exp(-6 * deltaSeconds));
    this.camera.updateProjectionMatrix();
  }

  setDistance(distance: number): void { this.distance = distance; }
  setFieldOfView(fieldOfView: number): void { this.baseFov = fieldOfView; }
  modeName(): string {
    if (this.replayActive) return 'replay';
    if (this.victoryActive) return 'victory';
    return this.mode;
  }
  dispose(): void {
    this.unsubscribeImpact();
    this.unsubscribeGoal();
  }
}
