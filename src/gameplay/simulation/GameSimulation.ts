import type { EventBus } from '../../core/events/EventBus';
import type { GameEventMap } from '../../core/events/GameEvents';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';
import { BALL_TUNING } from '../../core/config/BallTuning';
import type { VehicleConfig } from '../../core/config/GameplayScale';
import { MATCH_TUNING } from '../../core/config/MatchTuning';
import { distance, length, sub, type Vec3 } from '../../core/math/Vector3';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../../input/PlayerCommand';
import type { AuthoritativeFrame, LobbyPlayer, TeamId } from '../../networking/LobbyProtocol';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { createArena } from '../arena/Arena';
import { GOALS } from '../arena/ArenaDefinition';
import { detectScoringTeam } from '../arena/GoalVolume';
import { Ball } from '../ball/Ball';
import { BoostPickupSystem } from '../boost/BoostPickupSystem';
import { Car } from '../car/Car';
import { resolveDemolition } from '../car/DemolitionSystem';
import { GoalExplosionSystem } from '../effects/GoalExplosionSystem';
import { MatchController } from '../match/MatchController';
import { carTuningForMatch, DEFAULT_MATCH_SETTINGS, type MatchSettings } from '../match/MatchSettings';
import { kickoffSpawnFor, kickoffSpawnGroupForRoster } from '../match/KickoffSpawns';
import type { CarTuning } from '../../core/config/CarTuning';
import { createVictoryLineup, VICTORY_ROTATION } from '../match/VictoryLineup';
import { GoalReplayBuffer } from '../replay/GoalReplayBuffer';
import { interpolateCarState, interpolateSnapshots } from './SnapshotInterpolator';
import type { DemolitionSnapshot, SimulationSnapshot } from './SimulationSnapshot';

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
  private victoryAnchors: ReadonlyMap<string, Vec3> | null = null;
  private previousCars = new Map<string, ReturnType<Car['state']>>();
  private currentCars = new Map<string, ReturnType<Car['state']>>();
  private carTuning: CarTuning;
  private demolitionSequence = 0;
  private lastDemolition: DemolitionSnapshot | null = null;

  constructor(
    private readonly world: PhysicsWorld,
    private readonly events: EventBus<GameEventMap>,
    private readonly players: readonly LobbyPlayer[] = [{ id: 'local', name: 'Local player', team: 'azure', host: true }],
    private readonly localPlayerId: string = players[0]?.id ?? 'local',
    private readonly settings: MatchSettings = DEFAULT_MATCH_SETTINGS,
    freePlay = false,
  ) {
    createArena(world);
    this.carTuning = carTuningForMatch(settings);
    const teamSlots: Record<TeamId, number> = { azure: 0, coral: 0 };
    const teamSizes: Record<TeamId, number> = {
      azure: this.players.filter(({ team }) => team === 'azure').length,
      coral: this.players.filter(({ team }) => team === 'coral').length,
    };
    const spawnGroup = kickoffSpawnGroupForRoster(this.players);
    this.players.forEach((player) => {
      const teamSlot = teamSlots[player.team];
      teamSlots[player.team] += 1;
      const teamSize = Math.min(3, Math.max(1, teamSizes[player.team])) as 1 | 2 | 3;
      this.cars.set(player.id, new Car(
        world,
        this.carTuning,
        kickoffSpawnFor(player.team, teamSlot, teamSize, spawnGroup),
      ));
    });
    if (!this.cars.has(this.localPlayerId)) throw new Error('Local player is missing from the simulation roster');
    this.ball = new Ball(world);
    this.match = new MatchController(events, { unlimitedTime: freePlay });
    this.world.synchronizeSceneQueries();
    this.current = this.capture();
    this.previous = this.current;
    this.currentCars = this.captureCars();
    this.previousCars = this.currentCars;
  }

  update(command: PlayerCommand, deltaSeconds: number): void {
    this.updatePlayers(new Map([[this.localPlayerId, command]]), deltaSeconds);
  }

  updatePlayers(commands: ReadonlyMap<string, PlayerCommand>, deltaSeconds: number): void {
    this.previous = this.current;
    this.previousCars = this.currentCars;
    let enteredVictoryPresentation = false;
    const localCommand = commands.get(this.localPlayerId) ?? NEUTRAL_COMMAND;
    if (localCommand.togglePause) this.match.togglePause();
    if (localCommand.jumpPressed) this.match.skipReplay();
    this.match.update(deltaSeconds);
    const localRespawned = this.match.state().paused ? false : this.advanceRespawns(deltaSeconds);
    if (this.match.consumeResetRequest()) this.resetActors();

    if (this.match.state().phase === 'ended') {
      enteredVictoryPresentation = this.updateVictoryPresentation(commands, deltaSeconds);
    } else if (this.match.canSimulate()) {
      const carBefore = this.localCar().state().linearVelocity;
      const ballBefore = this.ball.state().linearVelocity;
      const carsBefore = this.captureCars();
      const activePlay = this.match.state().phase === 'playing' || this.match.state().phase === 'overtime';
      this.cars.forEach((car, playerId) => {
        car.update(this.world, commands.get(playerId) ?? NEUTRAL_COMMAND, deltaSeconds);
      });
      this.world.step(deltaSeconds);
      if (activePlay) this.detectDemolitions(carsBefore);
      this.applyHitPower(ballBefore);
      this.detectImpacts(carBefore, ballBefore, deltaSeconds);
      this.updateBoostPickups(deltaSeconds);
      const scoringTeam = detectScoringTeam(this.ball.state().transform.position);
      if (scoringTeam) this.scoreGoal(scoringTeam);
      this.cars.forEach((car) => {
        if (!car.isDemolished() && car.state().transform.position.y < -4) car.reset();
      });
    }

    this.tickNumber += 1;
    this.current = this.capture();
    this.currentCars = this.captureCars();
    if (enteredVictoryPresentation || localRespawned) {
      // Victory placement is a teleport, not gameplay movement to interpolate through.
      this.previous = this.current;
      this.previousCars = this.currentCars;
    }
    if (this.current.match.phase === 'playing' || this.current.match.phase === 'overtime') {
      this.replay.record(this.current, Object.fromEntries(this.currentCars));
    }
  }

  snapshot(alpha: number): SimulationSnapshot {
    const liveSnapshot = interpolateSnapshots(this.previous, this.current, alpha);
    if (liveSnapshot.match.phase !== 'replay') return liveSnapshot;
    const replayFrame = this.replay.sample(liveSnapshot.match.replayProgress);
    return replayFrame ? { ...replayFrame.snapshot, match: liveSnapshot.match } : liveSnapshot;
  }

  authoritativeFrame(sequence: number, alpha = 1): AuthoritativeFrame {
    const snapshot = this.snapshot(1);
    const replayFrame = snapshot.match.phase === 'replay'
      ? this.replay.sample(snapshot.match.replayProgress)
      : null;
    return {
      sequence,
      snapshot,
      cars: replayFrame?.cars ?? Object.fromEntries([...this.currentCars].map(([playerId, state]) => [
        playerId,
        this.previousCars.get(playerId)
          ? interpolateCarState(this.previousCars.get(playerId) as ReturnType<Car['state']>, state, alpha)
          : state,
      ])),
    };
  }

  resetMatch(): void {
    this.victoryAnchors = null;
    this.match.reset();
  }

  stopMatch(): void { this.match.stop(); }

  setVehicleConfig(config: VehicleConfig): void {
    this.carTuning = carTuningForMatch({
      ...this.settings,
      boostRechargePerSecond: config.boostRechargePerSecond,
    }, config);
    this.cars.forEach((car) => car.setTuning(this.carTuning));
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
      ...(this.lastDemolition ? { demolition: this.lastDemolition } : {}),
    };
  }

  private captureCars(): Map<string, ReturnType<Car['state']>> {
    return new Map([...this.cars]
      .filter(([, car]) => !car.isDemolished())
      .map(([playerId, car]) => [playerId, car.state()]));
  }

  private advanceRespawns(deltaSeconds: number): boolean {
    let localRespawned = false;
    this.cars.forEach((car, playerId) => {
      if (car.advanceRespawn(deltaSeconds) && playerId === this.localPlayerId) localRespawned = true;
    });
    return localRespawned;
  }

  private resetActors(): void {
    this.cars.forEach((car) => car.reset());
    this.ball.reset();
    this.boostPickups.reset();
    this.replay.clear();
    this.lastDemolition = null;
  }

  private updateVictoryPresentation(
    commands: ReadonlyMap<string, PlayerCommand>,
    deltaSeconds: number,
  ): boolean {
    const enteredVictoryPresentation = this.victoryAnchors === null;
    if (enteredVictoryPresentation) this.beginVictoryPresentation();
    const anchors = this.victoryAnchors;
    if (!anchors) return false;
    anchors.forEach((_anchor, playerId) => {
      this.cars.get(playerId)?.updateVictory(
        this.world,
        commands.get(playerId) ?? NEUTRAL_COMMAND,
        deltaSeconds,
      );
    });
    this.world.step(deltaSeconds);
    anchors.forEach((anchor, playerId) => this.cars.get(playerId)?.anchorHorizontal(anchor));
    return enteredVictoryPresentation;
  }

  private beginVictoryPresentation(): void {
    this.cars.forEach((car) => car.reset());
    const winningTeam = this.match.winningTeam();
    const anchors = createVictoryLineup(this.players, winningTeam);
    this.players.filter((player) => anchors.has(player.id)).forEach((player) => {
      const anchor = anchors.get(player.id);
      if (!anchor) return;
      this.cars.get(player.id)?.teleport({
        position: anchor,
        rotation: VICTORY_ROTATION,
      });
    });
    this.players.filter((player) => !anchors.has(player.id)).forEach((player, index) => {
      this.cars.get(player.id)?.teleport({
        position: {
          x: ARENA_TUNING.halfWidth - 3,
          y: 0.72,
          z: (index - 1) * 3.4,
        },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      });
    });
    this.victoryAnchors = anchors;
  }

  private scoreGoal(team: 'azure' | 'coral'): void {
    const goal = GOALS.find(({ teamScored }) => teamScored === team);
    if (!goal || !this.match.goal(team, goal.center)) return;
    this.replay.freeze(this.capture(), Object.fromEntries(this.captureCars()));
    this.goalExplosion.trigger(goal.center, [...this.cars.values()].filter((car) => !car.isDemolished()));
  }

  private updateBoostPickups(deltaSeconds: number): void {
    this.boostPickups.advance(deltaSeconds);
    this.cars.forEach((car) => {
      if (car.isDemolished()) return;
      const carState = car.state();
      const pickup = this.boostPickups.collect(carState.transform.position, carState.boost);
      if (!pickup) return;
      const amount = car.collectBoost(pickup.amount);
      this.events.emit('boostPickup', { amount, position: pickup.position });
    });
  }

  private detectDemolitions(carsBefore: ReadonlyMap<string, ReturnType<Car['state']>>): void {
    const playerById = new Map(this.players.map((player) => [player.id, player]));
    const playerByBody = new Map([...this.cars].map(([playerId, car]) => [car.bodyHandle(), playerId]));
    const processedPairs = new Set<string>();
    const maximumSpeed = Math.max(
      this.carTuning.maximumGroundDriveSpeed,
      this.carTuning.maximumGroundBoostSpeed,
    );

    this.cars.forEach((car, playerId) => {
      if (car.isDemolished()) return;
      car.contactingBodyHandles(this.world).forEach((bodyHandle) => {
        const otherId = playerByBody.get(bodyHandle);
        if (!otherId || otherId === playerId) return;
        const pairKey = [playerId, otherId].sort().join(':');
        if (processedPairs.has(pairKey)) return;
        processedPairs.add(pairKey);
        const other = this.cars.get(otherId);
        const player = playerById.get(playerId);
        const otherPlayer = playerById.get(otherId);
        const state = carsBefore.get(playerId);
        const otherState = carsBefore.get(otherId);
        if (!other || other.isDemolished() || !player || !otherPlayer || !state || !otherState) return;
        const result = resolveDemolition(
          {
            playerId,
            team: player.team,
            position: state.transform.position,
            velocity: state.linearVelocity,
          },
          {
            playerId: otherId,
            team: otherPlayer.team,
            position: otherState.transform.position,
            velocity: otherState.linearVelocity,
          },
          maximumSpeed,
          MATCH_TUNING.demolitionSpeedRatio,
          MATCH_TUNING.demolitionMinimumApproach,
        );
        if (!result) return;
        const victim = this.cars.get(result.victimId);
        const attackerPlayer = playerById.get(result.attackerId);
        const victimPlayer = playerById.get(result.victimId);
        if (!victim || victim.isDemolished() || !attackerPlayer || !victimPlayer) return;
        const position = victim.state().transform.position;
        victim.demolish(MATCH_TUNING.demolitionRespawnSeconds);
        this.demolitionSequence += 1;
        this.lastDemolition = {
          sequence: this.demolitionSequence,
          attackerId: result.attackerId,
          victimId: result.victimId,
          attackerTeam: attackerPlayer.team,
          victimTeam: victimPlayer.team,
          position,
        };
        this.events.emit('demolition', this.lastDemolition);
      });
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

  private applyHitPower(ballBefore: Vec3): void {
    if (this.settings.hitPowerMultiplier <= 1) return;
    const ballState = this.ball.state();
    if (length(sub(ballState.linearVelocity, ballBefore)) < 1.5) return;
    const hitDistance = BALL_TUNING.radius + 2.2;
    const nearCar = [...this.cars.values()].some((car) => (
      !car.isDemolished()
      && distance(car.state().transform.position, ballState.transform.position) <= hitDistance
    ));
    if (nearCar) this.ball.amplifyVelocityChange(ballBefore, this.settings.hitPowerMultiplier);
  }

  private localCar(): Car {
    const car = this.cars.get(this.localPlayerId);
    if (!car) throw new Error('Local car is unavailable');
    return car;
  }
}
