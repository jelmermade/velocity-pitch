import type { PlayerCommand } from '../input/PlayerCommand';

const EDGE_FIELDS = ['jumpPressed', 'toggleBallCamera', 'toggleFpsCounter', 'toggleFreeCamera', 'togglePause'] as const;

export const mergeCommandEdges = (previous: PlayerCommand, latest: PlayerCommand): PlayerCommand => {
  const merged = { ...latest };
  EDGE_FIELDS.forEach((field) => {
    merged[field] = previous[field] || latest[field];
  });
  return merged;
};

export const clearCommandEdges = (command: PlayerCommand): PlayerCommand => ({
  ...command,
  jumpPressed: false,
  toggleBallCamera: false,
  toggleFpsCounter: false,
  toggleFreeCamera: false,
  togglePause: false,
});
