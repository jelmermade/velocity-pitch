import * as THREE from 'three';
import type { EventBus } from '../core/events/EventBus';
import type { GameEventMap } from '../core/events/GameEvents';
import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';
import type { CarState } from '../gameplay/car/CarState';
import type { LobbyPlayer } from '../networking/LobbyProtocol';
import { RUNTIME_CONFIG } from '../app/RuntimeConfig';
import { AdaptivePixelRatio } from './AdaptivePixelRatio';
import { configureLighting } from './Lighting';
import { BloomPipeline } from './postprocessing/BloomPipeline';
import { ArenaView } from './views/ArenaView';
import { BallView } from './views/BallView';
import { CarView } from './views/CarView';
import { BoostPickupView } from './views/BoostPickupView';
import { GoalExplosionView } from './views/GoalExplosionView';

export class GameRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly bloom: BloomPipeline;
  private readonly arena: ArenaView;
  private readonly cars = new Map<string, CarView>();
  private readonly nameplates = new Map<string, HTMLElement>();
  private readonly nameplateLayer: HTMLElement;
  private readonly nameplatePosition = new THREE.Vector3();
  private readonly ball = new BallView();
  private readonly boostPickups = new BoostPickupView();
  private readonly goalExplosion: GoalExplosionView;
  private readonly adaptivePixelRatio: AdaptivePixelRatio;

  constructor(
    container: HTMLElement,
    events: EventBus<GameEventMap>,
    players: readonly LobbyPlayer[],
    private readonly localPlayerId: string,
  ) {
    this.scene.background = new THREE.Color(0x07141b);
    this.scene.fog = new THREE.FogExp2(0x07141b, 0.0065);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 220);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const initialPixelRatio = Math.min(window.devicePixelRatio, RUNTIME_CONFIG.maximumPixelRatio);
    this.renderer.setPixelRatio(initialPixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.append(this.renderer.domElement);
    this.nameplateLayer = document.createElement('div');
    this.nameplateLayer.className = 'vehicle-nameplates';
    players.forEach((player) => {
      const label = document.createElement('span');
      label.className = `vehicle-nameplate vehicle-nameplate--${player.team}`;
      label.textContent = player.name;
      this.nameplates.set(player.id, label);
      this.nameplateLayer.append(label);
    });
    container.append(this.nameplateLayer);
    configureLighting(this.scene, this.renderer);

    this.arena = new ArenaView();
    players.forEach((player) => this.cars.set(player.id, new CarView(player.team)));
    this.goalExplosion = new GoalExplosionView(events);
    this.scene.add(
      this.arena.group,
      this.boostPickups.group,
      ...[...this.cars.values()].map(({ group }) => group),
      this.ball.group,
      this.goalExplosion.group,
    );
    this.bloom = new BloomPipeline(this.renderer, this.scene, this.camera);
    this.adaptivePixelRatio = new AdaptivePixelRatio(
      initialPixelRatio,
      Math.min(RUNTIME_CONFIG.minimumPixelRatio, initialPixelRatio),
      initialPixelRatio,
      RUNTIME_CONFIG.targetFramesPerSecond,
    );
    window.addEventListener('resize', this.onResize);
  }

  update(
    snapshot: SimulationSnapshot,
    carStates?: Readonly<Record<string, CarState>>,
    deltaSeconds = 0,
  ): void {
    this.cars.forEach((view, playerId) => {
      const state = selectCarStateForRender(playerId, this.localPlayerId, snapshot, carStates);
      view.group.visible = state !== undefined;
      if (state) view.update(state, deltaSeconds);
    });
    this.ball.update(snapshot.ball, snapshot.match.phase !== 'ended');
    this.boostPickups.update(snapshot.boostPickups);
  }

  render(deltaSeconds: number): void {
    this.updateNameplates();
    this.boostPickups.animate(deltaSeconds);
    this.goalExplosion.update(deltaSeconds);
    const pixelRatio = document.hidden ? null : this.adaptivePixelRatio.update(deltaSeconds);
    if (pixelRatio !== null) {
      this.renderer.setPixelRatio(pixelRatio);
      this.bloom.setPixelRatio(pixelRatio);
    }
    this.bloom.render(deltaSeconds);
  }

  setBloom(strength: number): void { this.bloom.setStrength(strength); }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.arena.dispose();
    this.cars.forEach((car) => car.dispose());
    this.ball.dispose();
    this.boostPickups.dispose();
    this.goalExplosion.dispose();
    this.nameplateLayer.remove();
    this.bloom.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private updateNameplates(): void {
    this.camera.updateMatrixWorld();
    this.cars.forEach((car, playerId) => {
      const label = this.nameplates.get(playerId);
      if (!label) return;
      this.nameplatePosition.set(car.group.position.x, car.group.position.y + 2.7, car.group.position.z);
      this.nameplatePosition.project(this.camera);
      const visible = car.group.visible
        && this.nameplatePosition.z >= -1
        && this.nameplatePosition.z <= 1;
      label.hidden = !visible;
      if (!visible) return;
      label.style.left = `${(this.nameplatePosition.x * 0.5 + 0.5) * 100}%`;
      label.style.top = `${(-this.nameplatePosition.y * 0.5 + 0.5) * 100}%`;
    });
  }

  private readonly onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.bloom.resize(width, height);
  };
}

export const selectCarStateForRender = (
  playerId: string,
  localPlayerId: string,
  snapshot: SimulationSnapshot,
  carStates?: Readonly<Record<string, CarState>>,
): CarState | undefined => (
  carStates === undefined
    ? playerId === localPlayerId ? snapshot.car : undefined
    : carStates[playerId]
);
