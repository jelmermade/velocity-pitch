import './ui/styles/global.css';
import { bootstrapGame } from './app/GameBootstrap';

void bootstrapGame().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  document.body.innerHTML = `<main style="padding:2rem;color:#fff;background:#07141b;font-family:sans-serif"><h1>Unable to start Velocity Pitch</h1><pre>${message}</pre></main>`;
  console.error(error);
});
