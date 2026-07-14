export class PauseMenu {
  private readonly element: HTMLElement;

  constructor(
    root: HTMLElement,
    actions: {
      readonly onLeave: () => void | Promise<void>;
      readonly onResetMatch: () => void;
      readonly onStopMatch: () => void;
    },
  ) {
    const element = root.querySelector<HTMLElement>('[data-pause-menu]');
    if (!element) throw new Error('Pause menu element is missing');
    this.element = element;
    element.querySelector('[data-leave-match]')?.addEventListener('click', actions.onLeave);
    element.querySelector('[data-reset-match]')?.addEventListener('click', actions.onResetMatch);
    element.querySelector('[data-stop-match]')?.addEventListener('click', actions.onStopMatch);
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }
}
