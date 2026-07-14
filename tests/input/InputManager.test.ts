import { afterEach, describe, expect, it } from 'vitest';
import { InputManager } from '../../src/input/InputManager';

describe('InputManager controls', () => {
  const target = new EventTarget();
  const input = new InputManager(target as unknown as Window);

  afterEach(() => dispatch(target, 'blur'));

  it('uses left mouse for held boost', () => {
    dispatchMouse(target, 'mousedown', 0);
    expect(input.sample().boost).toBe(true);
    expect(input.sample().boost).toBe(true);
    dispatchMouse(target, 'mouseup', 0);
    expect(input.sample().boost).toBe(false);
  });

  it('uses right mouse for jump press and hold', () => {
    dispatchMouse(target, 'mousedown', 2);
    const pressed = input.sample();
    expect(pressed.jumpPressed).toBe(true);
    expect(pressed.jumpHeld).toBe(true);

    const held = input.sample();
    expect(held.jumpPressed).toBe(false);
    expect(held.jumpHeld).toBe(true);
    dispatchMouse(target, 'mouseup', 2);
    expect(input.sample().jumpHeld).toBe(false);
  });

  it('uses Shift for powerslide and Space for ball camera', () => {
    dispatchKeyboard(target, 'keydown', 'ShiftLeft');
    expect(input.sample().powerslide).toBe(true);
    dispatchKeyboard(target, 'keyup', 'ShiftLeft');

    dispatchKeyboard(target, 'keydown', 'Space');
    const command = input.sample();
    expect(command.toggleBallCamera).toBe(true);
    expect(command.jumpPressed).toBe(false);
    expect(command.boost).toBe(false);
  });

  it('suppresses the browser context menu', () => {
    const event = eventWithProperties('contextmenu', { button: 2 });
    expect(target.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('emits the FPS counter toggle once per F2 press', () => {
    dispatchKeyboard(target, 'keydown', 'F2');
    expect(input.sample().toggleFpsCounter).toBe(true);
    expect(input.sample().toggleFpsCounter).toBe(false);
    dispatchKeyboard(target, 'keyup', 'F2');
  });
});

const dispatch = (target: EventTarget, type: string): void => {
  target.dispatchEvent(new Event(type));
};

const dispatchKeyboard = (target: EventTarget, type: string, code: string): void => {
  target.dispatchEvent(eventWithProperties(type, { code }));
};

const dispatchMouse = (target: EventTarget, type: string, button: number): void => {
  target.dispatchEvent(eventWithProperties(type, { button }));
};

const eventWithProperties = (type: string, properties: Record<string, unknown>): Event => {
  const event = new Event(type, { cancelable: true });
  Object.entries(properties).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
  return event;
};
