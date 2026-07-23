import type { Vec3 } from '../core/math/Vector3';
import type { Transform } from '../core/types/Transform';
import type { CarState } from '../gameplay/car/CarState';
import type { BallState } from '../gameplay/ball/BallState';
import type { GameSimulation } from '../gameplay/simulation/GameSimulation';
import { ARENA_TUNING } from '../core/config/ArenaTuning';
import { BALL_TUNING } from '../core/config/BallTuning';
import type { MatchPhase } from '../gameplay/match/MatchPhase';
import { NEUTRAL_COMMAND, type PlayerCommand } from '../input/PlayerCommand';
import type { InputManager } from '../input/InputManager';
import { RUNTIME_CONFIG } from './RuntimeConfig';
import type { GameLoop } from './GameLoop';
import type { GameSession } from '../networking/GameSession';
import type { LobbyPlayer } from '../networking/LobbyProtocol';
import { GOALS } from '../gameplay/arena/ArenaDefinition';
import type { BotTacticalPlan } from '../gameplay/bots/BotTeamCoordinator';

export interface E2ECarStage {
  readonly transform: Transform;
  readonly linearVelocity?: Vec3;
  readonly angularVelocity?: Vec3;
  readonly settleTicks?: number;
}

export interface E2EBallStage {
  readonly position: Vec3;
  readonly linearVelocity?: Vec3;
}

export interface E2EBotTickResult {
  readonly tick: number;
  readonly ball: BallState;
  readonly cars: Readonly<Record<string, CarState>>;
  readonly ballContactPlayerIds: readonly string[];
  readonly ballContacts: readonly {
    readonly playerId: string;
    readonly ballBeforeContact: BallState;
    readonly ball: BallState;
    readonly car: CarState;
  }[];
  readonly tacticalStates: Readonly<Partial<Record<string, BotTacticalPlan>>>;
}

export interface VelocityPitchE2EApi {
  readonly stageLocalCar: (stage: E2ECarStage) => void;
  readonly stageCar: (playerId: string, stage: E2ECarStage) => void;
  readonly stageBall: (stage: E2EBallStage) => void;
  readonly focusCar: (playerId: string) => void;
  readonly focusedCarId: () => string;
  readonly carState: () => CarState;
  readonly matchPhase: () => MatchPhase;
  readonly finishCountdown: () => void;
  readonly advanceInputTicks: (ticks: number) => readonly CarState[];
  readonly advanceBotTicks: (ticks: number) => E2EBotTickResult;
  readonly tacticalStates: () => Readonly<Partial<Record<string, BotTacticalPlan>>>;
  readonly latestInput: () => PlayerCommand;
  readonly players: readonly LobbyPlayer[];
  readonly goals: readonly {
    readonly teamScored: 'azure' | 'coral';
    readonly center: Vec3;
  }[];
  readonly arena: {
    readonly halfWidth: number;
    readonly halfLength: number;
    readonly floorWallCurveRadius: number;
    readonly height: number;
    readonly ballRadius: number;
  };
}

declare global {
  interface Window {
    __velocityPitchE2E?: VelocityPitchE2EApi;
  }
}

const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

export const installE2ETestApi = (
  simulation: GameSimulation,
  session: GameSession,
  input: InputManager,
  loop: GameLoop,
  setFocusedCar: (playerId: string) => void,
): (() => void) | null => {
  const enabled = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('e2e') === '1';
  if (!enabled) return null;
  loop.setFixedUpdatesEnabled(false);
  let latestInput = NEUTRAL_COMMAND;
  let focusedCarId = session.localPlayerId;
  let e2eTick = simulation.snapshot(1).tick;
  const advanceSimulation = (command: PlayerCommand): void => {
    const frame = simulation.authoritativeFrame(e2eTick);
    simulation.updatePlayers(
      session.commandsForTick(e2eTick, command, frame),
      1 / RUNTIME_CONFIG.physicsHz,
    );
    e2eTick += 1;
  };

  window.__velocityPitchE2E = Object.freeze({
    stageLocalCar: ({
      transform,
      linearVelocity = ZERO,
      angularVelocity = ZERO,
      settleTicks = 0,
    }: E2ECarStage) => {
      simulation.stageLocalCar(
        transform,
        settleTicks > 0 ? ZERO : linearVelocity,
        settleTicks > 0 ? ZERO : angularVelocity,
      );
      const safeSettleTicks = Math.min(RUNTIME_CONFIG.physicsHz * 3, Math.max(0, Math.floor(settleTicks)));
      for (let tick = 0; tick < safeSettleTicks; tick += 1) {
        advanceSimulation(NEUTRAL_COMMAND);
      }
      if (safeSettleTicks > 0) {
        simulation.stageLocalCar(
          simulation.snapshot(1).car.transform,
          linearVelocity,
          angularVelocity,
          false,
        );
      }
    },
    stageCar: (playerId: string, {
      transform,
      linearVelocity = ZERO,
      angularVelocity = ZERO,
    }: E2ECarStage) => simulation.stageCar(playerId, transform, linearVelocity, angularVelocity),
    stageBall: ({ position, linearVelocity = ZERO }: E2EBallStage) => (
      simulation.stageBall(position, linearVelocity)
    ),
    focusCar: (playerId: string) => {
      if (!session.players.some(({ id }) => id === playerId)) {
        throw new Error(`Cannot focus unavailable car ${playerId}`);
      }
      focusedCarId = playerId;
      setFocusedCar(playerId);
    },
    focusedCarId: () => focusedCarId,
    carState: () => simulation.snapshot(1).car,
    matchPhase: () => simulation.snapshot(1).match.phase,
    finishCountdown: () => {
      const maximumTicks = RUNTIME_CONFIG.physicsHz * 5;
      for (let tick = 0; tick < maximumTicks && simulation.snapshot(1).match.phase === 'countdown'; tick += 1) {
        advanceSimulation(NEUTRAL_COMMAND);
      }
    },
    advanceInputTicks: (ticks: number) => {
      const safeTicks = Math.min(RUNTIME_CONFIG.physicsHz * 5, Math.max(0, Math.floor(ticks)));
      const states: CarState[] = [];
      for (let tick = 0; tick < safeTicks; tick += 1) {
        latestInput = input.sample();
        advanceSimulation(latestInput);
        states.push(simulation.snapshot(1).car);
      }
      return states;
    },
    advanceBotTicks: (ticks: number) => {
      const safeTicks = Math.min(RUNTIME_CONFIG.physicsHz * 5, Math.max(0, Math.floor(ticks)));
      const contacts = new Set<string>();
      const ballContacts = new Map<string, E2EBotTickResult['ballContacts'][number]>();
      for (let tick = 0; tick < safeTicks; tick += 1) {
        const ballBeforeContact = simulation.snapshot(1).ball;
        advanceSimulation(NEUTRAL_COMMAND);
        const frame = simulation.authoritativeFrame(e2eTick);
        simulation.ballContactPlayerIds().forEach((playerId) => {
          contacts.add(playerId);
          const car = frame.cars[playerId];
          if (car && !ballContacts.has(playerId)) {
            ballContacts.set(playerId, {
              playerId,
              ballBeforeContact,
              ball: frame.snapshot.ball,
              car,
            });
          }
        });
      }
      const frame = simulation.authoritativeFrame(e2eTick);
      return {
        tick: frame.snapshot.tick,
        ball: frame.snapshot.ball,
        cars: frame.cars,
        ballContactPlayerIds: [...contacts],
        ballContacts: [...ballContacts.values()],
        tacticalStates: Object.fromEntries(session.tacticalStates?.() ?? []),
      };
    },
    tacticalStates: () => Object.fromEntries(session.tacticalStates?.() ?? []),
    latestInput: () => latestInput,
    players: session.players,
    goals: GOALS.map(({ teamScored, center }) => ({ teamScored, center })),
    arena: Object.freeze({
      halfWidth: ARENA_TUNING.halfWidth,
      halfLength: ARENA_TUNING.halfLength,
      floorWallCurveRadius: ARENA_TUNING.floorWallCurveRadius,
      height: ARENA_TUNING.height,
      ballRadius: BALL_TUNING.radius,
    }),
  });

  return () => {
    loop.setFixedUpdatesEnabled(true);
    delete window.__velocityPitchE2E;
  };
};
