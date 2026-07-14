import type { EventBus } from '../../core/events/EventBus';
import type { GameEventMap } from '../../core/events/GameEvents';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { distance, length, type Vec3 } from '../../core/math/Vector3';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../input/PlayerCommand';
import type { AuthoritativeFrame, LobbyPlayer } from '../../networking/LobbyProtocol';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { createArena } from '../arena/Arena';
import { GOALS } from '../arena/ArenaDefinition';
import { detectScoringTeam } from '../arena/GoalVolume';
import { Ball } from '../ball/Ball';
import { BoostPickupSystem } from '../boost/BoostPickupSystem';
import { Car, type CarSpawn } from '../car/Car';
import { GoalExplosionSystem } from '../effects/GoalExplosionSystem';
import { MatchController } from '../match/MatchController';
import { GoalReplayBuffer } from '../replay/GoalReplayBuffer';
import { interpolateSnapshots } from './SnapshotInterpolator';
import type { SimulationSnapshot } from './SimulationSnapshot';

export class GameSimulation {
  private readonly cars = new Map<string, Car>();
  private readonly ball: Ball;
  private readonly match: MatchController;
  private readonly boostPickups = new BoostPickupSystem();
  private readonly goalExplosion = new GoalExplosionSystem();
  private readonly replay = new GoalReplayBuffer();
  private tickNumber = 0;
  private previous: SimulationSnapshot;
  private current: SimulationSnapshot;
  private impactCooldown = 0;

  constructor(
    private readonly world: PhysicsWorld,
    private readonly events: EventBus<GameEventMap>,
    players: readonly LobbyPlayer[] = [{ id: 'local', name: 'Local player', team: 'azure', host: true }],
    private readonly localPlayerId: string = players[0]?.id ?? 'local',
  ) {
    createArena(world);
    players.forEach((player, index) => this.cars.set(player.id, new Car(world, undefined, spawnFor(player, index))));
    if (!this.cars.has(this.localPlayerId)) throw new Error('Local player is missing from the simulation roster');
    this.ball = new Ball(world);
    this.match = new MatchController(events);
    this.world.synchronizeSceneQueries();
    this.current = this.capture();
    this.previous = this.current;
  }

  update(command: PlayerCommand, deltaSeconds: number): void {
    this.updatePlayers(new Map([[this.localPlayerId, command]]), deltaSeconds);
  }

  updatePlayers(commands: ReadonlyMap<string, PlayerCommand>, deltaSeconds: number): void {
    this.previous = this.current;
    const localCommand = commands.get(this.localPlayerId) ?? NEUTRAL_COMMAND;
    if (localCommand.togglePause) this.match.togglePause();
    if (localCommand.jumpPressed) this.match.skipReplay();
    this.match.update(deltaSeconds);
    if (this.match.consumeResetRequest()) this.resetActors();

    if (this.match.canSimulate()) {
      const carBefore = this.localCar().state().linearVelocity;
      const ballBefore = this.ball.state().linearVelocity;
      this.cars.forEach((car, playerId) => {
        car.update(this.world, commands.get(playerId) ?? NEUTRAL_COMMAND, deltaSeconds);
      });
      this.world.step(deltaSeconds);
      this.detectImpacts(carBefore, ballBefore, deltaSeconds);
      this.updateBoostPickups(deltaSeconds);
      const scoringTeam = detectScoringTeam(this.ball.state().transform.position);
      if (scoringTeam) this.scoreGoal(scoringTeam);
      this.cars.forEach((car) => {
        if (car.state().transform.position.y < -4) car.reset();
      });
    }

    this.tickNumber += 1;
    this.current = this.capture();
    if (this.current.match.phase === 'playing' || this.current.match.phase === 'overtime') {
      this.replay.record(this.current);
    }
  }

  snapshot(alpha: number): SimulationSnapshot {
    const liveSnapshot = interpolateSnapshots(this.previous, this.current, alpha);
    if (liveSnapshot.match.phase !== 'replay') return liveSnapshot;
    const replaySnapshot = this.replay.sample(liveSnapshot.match.replayProgress);
    return replaySnapshot ? { ...replaySnapshot, match: liveSnapshot.match } : liveSnapshot;
  }

  authoritativeFrame(sequence: number): AuthoritativeFrame {
    return {
      sequence,
      snapshot: this.snapshot(1),
      cars: Object.fromEntries([...this.cars].map(([playerId, car]) => [playerId, car.state()])),
    };
  }

  dispose(): void {
    this.world.dispose();
  }

  private capture(): SimulationSnapshot {
    return {
      tick: this.tickNumber,
      car: this.localCar().state(),
      ball: this.ball.state(),
      boostPickups: this.boostPickups.state(),
      match: this.match.state(),
    };
  }

  private resetActors(): void {
    this.cars.forEach((car) => car.reset());
    this.ball.reset();
    this.boostPickups.reset();
    this.replay.clear();
  }

  private scoreGoal(team: 'azure' | 'coral'): void {
    const goal = GOALS.find(({ teamScored }) => teamScored === team);
    if (!goal || !this.match.goal(team, goal.center)) return;
    this.replay.freeze(this.capture());
    this.goalExplosion.trigger(goal.center, [...this.cars.values()]);
  }

  private updateBoostPickups(deltaSeconds: number): void {
    this.boostPickups.advance(deltaSeconds);
    this.cars.forEach((car) => {
      const carState = car.state();
      const pickup = this.boostPickups.collect(carState.transform.position, carState.boost);
      if (!pickup) return;
      const amount = car.collectBoost(pickup.amount);
      this.events.emit('boostPickup', { amount, position: pickup.position });
    });
  }

  private detectImpacts(carBefore: Vec3, ballBefore: Vec3, deltaSeconds: number): void {
    this.impactCooldown = Math.max(0, this.impactCooldown - deltaSeconds);
    if (this.impactCooldown > 0) return;
    const carState = this.localCar().state();
    const ballState = this.ball.state();
    const carChange = distance(carBefore, carState.linearVelocity);
    const ballChange = distance(ballBefore, ballState.linearVelocity);
    if (carChange > 5.5 && length(carBefore) > 7) {
      this.events.emit('carImpact', { intensity: carChange, position: carState.transform.position });
      this.impactCooldown = 0.12;
    } else if (ballChange > 4.5) {
      this.events.emit('ballImpact', { intensity: ballChange, position: ballState.transform.position });
      this.impactCooldown = 0.08;
    }
  }

  private localCar(): Car {
    const car = this.cars.get(this.localPlayerId);
    if (!car) throw new Error('Local car is unavailable');
    return car;
  }
}

const spawnFor = (player: LobbyPlayer, rosterIndex: number): CarSpawn => {
  const teamSlot = Math.floor(rosterIndex / 2);
  const lateralSpacing = ARENA_TUNING.halfWidth * 0.235;
  const xOffsets = [0, -lateralSpacing, lateralSpacing, -lateralSpacing * 2, lateralSpacing * 2] as const;
  const x = xOffsets[teamSlot] ?? 0;
  const z = ARENA_TUNING.halfLength * 0.46;
  if (player.team === 'azure') {
    return { position: { x, y: 0.62, z }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  }
  return { position: { x: -x, y: 0.62, z: -z }, rotation: { x: 0, y: 1, z: 0, w: 0 } };
};
