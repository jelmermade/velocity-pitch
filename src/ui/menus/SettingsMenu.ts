export interface SettingsHandlers {
  readonly onCameraDistance: (value: number) => void;
  readonly onFieldOfView: (value: number) => void;
  readonly onBloom: (value: number) => void;
  readonly onVolume: (value: number) => void;
  readonly onShowFps: (visible: boolean) => void;
}

export class SettingsMenu {
  private readonly element: HTMLElement;
  private readonly showFpsInput: HTMLInputElement;

  constructor(root: HTMLElement, handlers: SettingsHandlers) {
    const element = root.querySelector<HTMLElement>('[data-settings]');
    if (!element) throw new Error('Settings menu element is missing');
    this.element = element;
    this.bindRange('camera-distance', handlers.onCameraDistance);
    this.bindRange('field-of-view', handlers.onFieldOfView);
    this.bindRange('bloom', handlers.onBloom);
    this.bindRange('volume', handlers.onVolume);
    this.showFpsInput = this.bindCheckbox('show-fps', handlers.onShowFps);
    root.querySelector('[data-open-settings]')?.addEventListener('click', () => this.show());
    root.querySelector('[data-close-settings]')?.addEventListener('click', () => this.hide());
  }

  show(): void { this.element.hidden = false; }
  hide(): void { this.element.hidden = true; }
  setShowFps(visible: boolean): void { this.showFpsInput.checked = visible; }

  private bindRange(name: string, handler: (value: number) => void): void {
    const input = this.element.querySelector<HTMLInputElement>(`[name="${name}"]`);
    const output = this.element.querySelector<HTMLOutputElement>(`[data-output="${name}"]`);
    if (!input || !output) throw new Error(`Settings control ${name} is missing`);
    const update = (): void => {
      const value = Number(input.value);
      output.value = input.value;
      saveSetting(name, input.value);
      handler(value);
    };
    const stored = loadSetting(name);
    if (stored !== null && Number.isFinite(Number(stored))) input.value = stored;
    input.addEventListener('input', update);
    update();
  }

  private bindCheckbox(name: string, handler: (checked: boolean) => void): HTMLInputElement {
    const input = this.element.querySelector<HTMLInputElement>(`[name="${name}"]`);
    if (!input) throw new Error(`Settings control ${name} is missing`);
    input.addEventListener('change', () => handler(input.checked));
    return input;
  }
}

const settingKey = (name: string): string => `velocity-pitch:${name}`;

const loadSetting = (name: string): string | null => {
  try {
    return window.localStorage.getItem(settingKey(name));
  } catch {
    return null;
  }
};

const saveSetting = (name: string, value: string): void => {
  try {
    window.localStorage.setItem(settingKey(name), value);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
};
