import { BINDINGS } from './bindings';
import type { PlayerCommand } from './PlayerCommand';

export class InputManager {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly heldMouseButtons = new Set<number>();
  private readonly pressedMouseButtons = new Set<number>();

  constructor(private readonly target: Window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('contextmenu', this.onContextMenu);
    target.addEventListener('blur', this.onBlur);
  }

  sample(): PlayerCommand {
    const command: PlayerCommand = {
      throttle: Number(this.isDown(BINDINGS.throttleForward)) - Number(this.isDown(BINDINGS.throttleReverse)),
      steer: Number(this.isDown(BINDINGS.steerRight)) - Number(this.isDown(BINDINGS.steerLeft)),
      airRoll: Number(this.isDown(BINDINGS.airRollRight)) - Number(this.isDown(BINDINGS.airRollLeft)),
      jumpPressed: this.wasMousePressed(BINDINGS.jumpMouseButton),
      jumpHeld: this.isMouseDown(BINDINGS.jumpMouseButton),
      boost: this.isMouseDown(BINDINGS.boostMouseButton),
      powerslide: this.isDown(BINDINGS.powerslide) || this.isDown(BINDINGS.powerslideAlternate),
      toggleBallCamera: this.wasPressed(BINDINGS.ballCamera),
      toggleFpsCounter: this.wasPressed(BINDINGS.fpsCounter),
      toggleFreeCamera: this.wasPressed(BINDINGS.freeCamera),
      togglePause: this.wasPressed(BINDINGS.pause),
    };
    this.pressed.clear();
    this.pressedMouseButtons.clear();
    return command;
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    this.target.removeEventListener('mouseup', this.onMouseUp);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
    this.target.removeEventListener('blur', this.onBlur);
  }

  private wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  private isMouseDown(button: number): boolean {
    return this.heldMouseButtons.has(button);
  }

  private wasMousePressed(button: number): boolean {
    return this.pressedMouseButtons.has(button);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.held.has(event.code)) this.pressed.add(event.code);
    this.held.add(event.code);
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.heldMouseButtons.has(event.button)) this.pressedMouseButtons.add(event.button);
    this.heldMouseButtons.add(event.button);
    if (event.button === BINDINGS.jumpMouseButton) event.preventDefault();
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.heldMouseButtons.delete(event.button);
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.pressed.clear();
    this.heldMouseButtons.clear();
    this.pressedMouseButtons.clear();
  };
}
