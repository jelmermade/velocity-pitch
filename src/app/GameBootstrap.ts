import { GameApplication } from './GameApplication';
import { LobbyScreen, type GameLaunch } from '../ui/LobbyScreen';
import type { StartedLobby } from '../networking/WebSocketLobbyClient';

export const bootstrapGame = async (): Promise<GameApplication> => {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Application mount point #app is missing');
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
  application = await GameApplication.create(
    root,
    launch.lobby,
    launch.settings,
    leave,
    returnToLobby,
    launch.mode,
    restartTraining,
  );
  application.start();
  return application;
};

const showError = (root: HTMLElement, error: unknown): void => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  root.innerHTML = `<main style="padding:2rem;color:#fff;background:#07141b;font-family:sans-serif"><h1>Unable to start Velocity Pitch</h1><pre>${message}</pre></main>`;
  console.error(error);
};
