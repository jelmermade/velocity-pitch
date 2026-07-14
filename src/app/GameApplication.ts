import { AudioManager } from '../audio/AudioManager';
import { CameraController } from '../camera/CameraController';
import { EventBus } from '../core/events/EventBus';
import type { GameEventMap } from '../core/events/GameEvents';
import { GameSimulation } from '../gameplay/simulation/GameSimulation';
import { InputManager } from '../input/InputManager';
import { LocalSession } from '../networking/LocalSession';
import { NetworkSession } from '../networking/NetworkSession';
import type { StartedLobby } from '../networking/WebSocketLobbyClient';
import type { AuthoritativeFrame } from '../networking/LobbyProtocol';
import type { GameSession } from '../networking/GameSession';
import { AuthoritativeFrameInterpolator } from '../networking/AuthoritativeFrameInterpolator';
import { NETWORK_CONFIG } from '../networking/NetworkConfig';
import { GOALS } from '../gameplay/arena/ArenaDefinition';
import { RapierPhysicsWorld } from '../physics/rapier/RapierPhysicsWorld';
import { GameRenderer } from '../rendering/GameRenderer';
import { UIManager } from '../ui/UIManager';
import { GameLoop } from './GameLoop';

export class GameApplication {
  private constructor(
    private readonly loop: GameLoop,
    private readonly simulation: GameSimulation,
    private readonly renderer: GameRenderer,
    private readonly camera: CameraController,
    private readonly input: InputManager,
    private readonly audio: AudioManager,
    private readonly ui: UIManager,
    private readonly session: GameSession,
    private readonly events: EventBus<GameEventMap>,
  ) {}

  static async create(root: HTMLElement, startedLobby: StartedLobby | null = null): Promise<GameApplication> {
    const events = new EventBus<GameEventMap>();
    const input = new InputManager(window);
    const world = await RapierPhysicsWorld.create();
    const session: GameSession = startedLobby ? new NetworkSession(startedLobby) : new LocalSession();
    const simulation = new GameSimulation(world, events, session.players, session.localPlayerId);
    const runtime: {
      renderer?: GameRenderer;
      camera?: CameraController;
      audio?: AudioManager;
    } = {};

    const ui = new UIManager(root, {
      onCameraDistance: (value) => runtime.camera?.setDistance(value),
      onFieldOfView: (value) => runtime.camera?.setFieldOfView(value),
      onBloom: (value) => runtime.renderer?.setBloom(value),
      onVolume: (value) => runtime.audio?.setVolume(value),
    });
    const renderer = new GameRenderer(ui.renderContainer(), events, session.players, session.localPlayerId);
    const camera = new CameraController(renderer.camera, world, input, events);
    const audio = new AudioManager(events);
    runtime.renderer = renderer;
    runtime.camera = camera;
    runtime.audio = audio;
    let tick = 0;
    let guestFrame: AuthoritativeFrame | null = null;
    let lastGuestFrameSequence = -1;
    const guestInterpolator = new AuthoritativeFrameInterpolator(NETWORK_CONFIG.interpolationDelaySeconds);
    const loop = new GameLoop(
      (deltaSeconds) => {
        const localCommand = input.sample();
        const commands = session.commandsForTick(tick, localCommand);
        camera.handleCommand(localCommand);
        if (session.authoritative) {
          simulation.updatePlayers(commands, deltaSeconds);
          session.publish(simulation.authoritativeFrame(tick));
        } else {
          const nextFrame = session.latestFrame();
          if (nextFrame && nextFrame.sequence > lastGuestFrameSequence) {
            const enteredGoalExplosion = nextFrame.snapshot.match.phase === 'goalExplosion'
              && guestFrame?.snapshot.match.phase !== 'goalExplosion';
            guestFrame = nextFrame;
            lastGuestFrameSequence = nextFrame.sequence;
            guestInterpolator.push(nextFrame, performance.now() / 1000);
            const team = nextFrame.snapshot.match.lastGoalTeam;
            const goal = GOALS.find(({ teamScored }) => teamScored === team);
            if (enteredGoalExplosion && team && goal) {
              events.emit('goal', {
                team,
                position: goal.center,
                azure: nextFrame.snapshot.match.azureScore,
                coral: nextFrame.snapshot.match.coralScore,
              });
            }
          }
        }
        tick += 1;
      },
      (alpha, deltaSeconds) => {
        const networkFrame = session.authoritative
          ? simulation.authoritativeFrame(tick)
          : guestInterpolator.sample(performance.now() / 1000) ?? guestFrame;
        const baseSnapshot = session.authoritative ? simulation.snapshot(alpha) : networkFrame?.snapshot ?? simulation.snapshot(alpha);
        const replaying = baseSnapshot.match.phase === 'replay';
        const localCar = replaying ? undefined : networkFrame?.cars[session.localPlayerId];
        const snapshot = localCar ? { ...baseSnapshot, car: localCar } : baseSnapshot;
        const renderedCars = replaying ? { [session.localPlayerId]: snapshot.car } : networkFrame?.cars;
        renderer.update(snapshot, renderedCars);
        camera.update(snapshot, deltaSeconds);
        ui.update(snapshot, camera.modeName());
        renderer.render(deltaSeconds);
      },
    );
    return new GameApplication(loop, simulation, renderer, camera, input, audio, ui, session, events);
  }

  start(): void { this.loop.start(); }

  dispose(): void {
    this.loop.stop();
    this.session.dispose();
    this.camera.dispose();
    this.audio.dispose();
    this.input.dispose();
    this.simulation.dispose();
    this.renderer.dispose();
    this.ui.dispose();
    this.events.clear();
  }
}
