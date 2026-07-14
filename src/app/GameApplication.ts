import { AudioManager } from '../audio/AudioManager';
import { CameraController } from '../camera/CameraController';
import { EventBus } from '../core/events/EventBus';
import type { GameEventMap } from '../core/events/GameEvents';
import { GameSimulation } from '../gameplay/simulation/GameSimulation';
import { DEFAULT_MATCH_SETTINGS, type MatchSettings } from '../gameplay/match/MatchSettings';
import { createVictoryLineup, selectVictoryCars } from '../gameplay/match/VictoryLineup';
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
import { RUNTIME_CONFIG } from './RuntimeConfig';

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
    private readonly unsubscribeSessionError: (() => void) | null,
  ) {}

  static async create(
    root: HTMLElement,
    startedLobby: StartedLobby | null = null,
    matchSettings: MatchSettings = startedLobby?.settings ?? DEFAULT_MATCH_SETTINGS,
    onLeave: () => void = () => {},
    onReturnToLobby: () => void = () => {},
  ): Promise<GameApplication> {
    const events = new EventBus<GameEventMap>();
    const input = new InputManager(window);
    const world = await RapierPhysicsWorld.create();
    const session: GameSession = startedLobby ? new NetworkSession(startedLobby) : new LocalSession();
    const simulation = new GameSimulation(world, events, session.players, session.localPlayerId, matchSettings);
    const runtime: {
      renderer?: GameRenderer;
      camera?: CameraController;
      audio?: AudioManager;
      cameraDistance?: number;
      fieldOfView?: number;
      bloom?: number;
      volume?: number;
    } = {};

    const ui = new UIManager(
      root,
      {
        onCameraDistance: (value) => {
          runtime.cameraDistance = value;
          runtime.camera?.setDistance(value);
        },
        onFieldOfView: (value) => {
          runtime.fieldOfView = value;
          runtime.camera?.setFieldOfView(value);
        },
        onBloom: (value) => {
          runtime.bloom = value;
          runtime.renderer?.setBloom(value);
        },
        onVolume: (value) => {
          runtime.volume = value;
          runtime.audio?.setVolume(value);
        },
      },
      {
        multiplayer: startedLobby !== null,
        host: startedLobby !== null && startedLobby.playerId === startedLobby.hostId,
        onLeave,
        onResetMatch: () => startedLobby?.client.controlMatch('reset'),
        onStopMatch: () => startedLobby?.client.controlMatch('stop'),
      },
    );
    const renderer = new GameRenderer(ui.renderContainer(), events, session.players, session.localPlayerId);
    const camera = new CameraController(renderer.camera, world, input, events);
    const audio = new AudioManager(events);
    runtime.renderer = renderer;
    runtime.camera = camera;
    runtime.audio = audio;
    if (runtime.cameraDistance !== undefined) camera.setDistance(runtime.cameraDistance);
    if (runtime.fieldOfView !== undefined) camera.setFieldOfView(runtime.fieldOfView);
    if (runtime.bloom !== undefined) renderer.setBloom(runtime.bloom);
    if (runtime.volume !== undefined) audio.setVolume(runtime.volume);
    let tick = 0;
    let guestFrame: AuthoritativeFrame | null = null;
    let lastGuestFrameSequence = -1;
    const snapshotInterval = Math.max(1, Math.round(RUNTIME_CONFIG.physicsHz / NETWORK_CONFIG.snapshotRate));
    const guestInterpolator = new AuthoritativeFrameInterpolator(
      NETWORK_CONFIG.interpolationDelaySeconds,
      RUNTIME_CONFIG.physicsHz,
      NETWORK_CONFIG.maximumExtrapolationSeconds,
    );
    let endedSeconds = 0;
    let finishMatchSent = false;
    const loop = new GameLoop(
      (deltaSeconds) => {
        const localCommand = input.sample();
        const commands = session.commandsForTick(tick, localCommand);
        if (localCommand.toggleFpsCounter) ui.toggleFpsCounter();
        camera.handleCommand(localCommand);
        if (session.authoritative) {
          simulation.updatePlayers(commands, deltaSeconds);
          if (tick % snapshotInterval === 0) session.publish(simulation.authoritativeFrame(tick));
          if (startedLobby && simulation.snapshot(1).match.phase === 'ended') {
            endedSeconds += deltaSeconds;
            if (!finishMatchSent && endedSeconds >= 8) {
              finishMatchSent = true;
              startedLobby.client.finishMatch();
            }
          } else {
            endedSeconds = 0;
          }
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
          ? simulation.authoritativeFrame(tick, alpha)
          : guestInterpolator.sample(performance.now() / 1000) ?? guestFrame;
        const baseSnapshot = session.authoritative ? simulation.snapshot(alpha) : networkFrame?.snapshot ?? simulation.snapshot(alpha);
        const replaying = baseSnapshot.match.phase === 'replay';
        const ended = baseSnapshot.match.phase === 'ended';
        const winningTeam = baseSnapshot.match.azureScore === baseSnapshot.match.coralScore
          ? null
          : baseSnapshot.match.azureScore > baseSnapshot.match.coralScore ? 'azure' : 'coral';
        const victoryLineup = ended ? createVictoryLineup(session.players, winningTeam) : null;
        const focusPlayerId = ended
          ? victoryLineup?.keys().next().value
          : session.localPlayerId;
        const localCar = replaying ? undefined : networkFrame?.cars[focusPlayerId ?? session.localPlayerId];
        const snapshot = localCar ? { ...baseSnapshot, car: localCar } : baseSnapshot;
        const renderedCars = replaying
          ? { [session.localPlayerId]: snapshot.car }
          : ended && networkFrame && victoryLineup
            ? selectVictoryCars(networkFrame.cars, victoryLineup)
            : networkFrame?.cars;
        renderer.update(snapshot, renderedCars, deltaSeconds);
        camera.update(snapshot, deltaSeconds);
        ui.update(snapshot, camera.modeName());
        ui.updateFrameRate(deltaSeconds, snapshot.car.transform.position);
        renderer.render(deltaSeconds);
      },
    );
    const sessionUnsubscribes = startedLobby ? [
      startedLobby.client.onError(onLeave),
      startedLobby.client.onRemoved(onLeave),
      startedLobby.client.onMatchControl((action) => {
        if (action === 'reset') simulation.resetMatch();
        else simulation.stopMatch();
      }),
      startedLobby.client.onReturnedToLobby(onReturnToLobby),
    ] : [];
    const unsubscribeSessionError = (): void => sessionUnsubscribes.forEach((unsubscribe) => unsubscribe());
    return new GameApplication(
      loop,
      simulation,
      renderer,
      camera,
      input,
      audio,
      ui,
      session,
      events,
      unsubscribeSessionError,
    );
  }

  start(): void { this.loop.start(); }

  dispose(disconnect = true): void {
    this.loop.stop();
    this.unsubscribeSessionError?.();
    if (disconnect) this.session.dispose();
    this.camera.dispose();
    this.audio.dispose();
    this.input.dispose();
    this.simulation.dispose();
    this.renderer.dispose();
    this.ui.dispose();
    this.events.clear();
  }
}
