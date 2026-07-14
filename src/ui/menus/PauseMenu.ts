export class PauseMenu {
  private readonly element: HTMLElement;

  constructor(root: HTMLElement) {
    const element = root.querySelector<HTMLElement>('[data-pause-menu]');
    if (!element) throw new Error('Pause menu element is missing');
    this.element = element;
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }
}
