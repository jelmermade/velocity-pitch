import { GameApplication } from './GameApplication';
import { LobbyScreen, type GameLaunch } from '../ui/LobbyScreen';
import type { StartedLobby } from '../networking/WebSocketLobbyClient';
import { DEFAULT_MATCH_SETTINGS } from '../gameplay/match/MatchSettings';
import {
  clearRuntimeGameplayConfig,
  readRuntimeGameplayConfig,
  saveRuntimeGameplayConfig,
  type GameplayConfig,
} from '../core/config/GameplayScale';

const BOT_LAB_TUNING_PARAMETER = 'botLabTuning';

export const bootstrapGame = async (): Promise<GameApplication> => {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Application mount point #app is missing');
  const tuningRequested = new URLSearchParams(window.location.search).get(BOT_LAB_TUNING_PARAMETER) === '1';
  if (tuningRequested && readRuntimeGameplayConfig()) {
    return launchGame(root, {
      lobby: null,
      settings: DEFAULT_MATCH_SETTINGS,
      mode: 'botTraining',
    });
  }
  return startGame(root);
};

const startGame = async (root: HTMLElement, resumedLobby: StartedLobby | null = null): Promise<GameApplication> => {
  const lobbyScreen = new LobbyScreen(root);
  const launch = resumedLobby ? await lobbyScreen.resume(resumedLobby) : await lobbyScreen.show();
  return launchGame(root, launch);
};

const launchGame = async (root: HTMLElement, launch: GameLaunch): Promise<GameApplication> => {
  let application: GameApplication | null = null;
  const leave = (): void => {
    application?.dispose();
    application = null;
    if (readRuntimeGameplayConfig()) {
      clearRuntimeGameplayConfig();
      window.location.assign(window.location.pathname);
      return;
    }
    window.history.replaceState({}, '', window.location.pathname);
    void startGame(root).catch((error: unknown) => showError(root, error));
  };
  const returnToLobby = (): void => {
    if (!launch.lobby || !application) return;
    application.dispose(false);
    application = null;
    void startGame(root, launch.lobby).catch((error: unknown) => showError(root, error));
  };
  const restartTraining = (): void => {
    if (!application || launch.mode !== 'botTraining') return;
    application.dispose();
    application = null;
    void launchGame(root, launch).catch((error: unknown) => showError(root, error));
  };
  const rebuildTraining = (config: GameplayConfig): void => {
    if (!application || launch.mode !== 'botTraining') return;
    saveRuntimeGameplayConfig(config);
    application.dispose();
    application = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('lobby');
    url.searchParams.set(BOT_LAB_TUNING_PARAMETER, '1');
    window.location.assign(url.toString());
  };
  application = await GameApplication.create(
    root,
    launch.lobby,
    launch.settings,
    leave,
    returnToLobby,
    launch.mode,
    restartTraining,
    rebuildTraining,
  );
  application.start();
  return application;
};

const showError = (root: HTMLElement, error: unknown): void => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  root.innerHTML = `<main style="padding:2rem;color:#fff;background:#07141b;font-family:sans-serif"><h1>Unable to start Velocity Pitch</h1><pre>${message}</pre></main>`;
  console.error(error);
};
