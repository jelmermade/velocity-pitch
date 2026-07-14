export interface SettingsHandlers {
  readonly onCameraDistance: (value: number) => void;
  readonly onFieldOfView: (value: number) => void;
  readonly onBloom: (value: number) => void;
  readonly onVolume: (value: number) => void;
}

export class SettingsMenu {
  private readonly element: HTMLElement;

  constructor(root: HTMLElement, handlers: SettingsHandlers) {
    const element = root.querySelector<HTMLElement>('[data-settings]');
    if (!element) throw new Error('Settings menu element is missing');
    this.element = element;
    this.bindRange('camera-distance', handlers.onCameraDistance);
    this.bindRange('field-of-view', handlers.onFieldOfView);
    this.bindRange('bloom', handlers.onBloom);
    this.bindRange('volume', handlers.onVolume);
    root.querySelector('[data-open-settings]')?.addEventListener('click', () => this.show());
    root.querySelector('[data-close-settings]')?.addEventListener('click', () => this.hide());
  }

  show(): void { this.element.hidden = false; }
  hide(): void { this.element.hidden = true; }

  private bindRange(name: string, handler: (value: number) => void): void {
    const input = this.element.querySelector<HTMLInputElement>(`[name="${name}"]`);
    const output = this.element.querySelector<HTMLOutputElement>(`[data-output="${name}"]`);
    if (!input || !output) throw new Error(`Settings control ${name} is missing`);
    const update = (): void => {
      const value = Number(input.value);
      output.value = input.value;
      handler(value);
    };
    input.addEventListener('input', update);
  }
}
