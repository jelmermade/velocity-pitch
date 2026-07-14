import { GameApplication } from './GameApplication';
import { LobbyScreen } from '../ui/LobbyScreen';

export const bootstrapGame = async (): Promise<GameApplication> => {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Application mount point #app is missing');
  const lobby = await new LobbyScreen(root).show();
  const application = await GameApplication.create(root, lobby);
  application.start();
  return application;
};
