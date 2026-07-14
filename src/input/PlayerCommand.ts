export interface PlayerCommand {
  readonly throttle: number;
  readonly steer: number;
  readonly airRoll: number;
  readonly jumpPressed: boolean;
  readonly jumpHeld: boolean;
  readonly boost: boolean;
  readonly powerslide: boolean;
  readonly toggleBallCamera: boolean;
  readonly toggleFreeCamera: boolean;
  readonly togglePause: boolean;
}

export const NEUTRAL_COMMAND: PlayerCommand = Object.freeze({
  throttle: 0,
  steer: 0,
  airRoll: 0,
  jumpPressed: false,
  jumpHeld: false,
  boost: false,
  powerslide: false,
  toggleBallCamera: false,
  toggleFreeCamera: false,
  togglePause: false,
});
