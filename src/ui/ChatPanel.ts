import type { LobbyChatMessage } from '../networking/LobbyProtocol';

export interface ChatPanelSource {
  readonly messages: readonly LobbyChatMessage[];
  readonly send: (text: string) => void;
  readonly subscribe: (handler: (message: LobbyChatMessage) => void) => () => void;
}

export class ChatPanel {
  private readonly messages: HTMLOListElement;
  private readonly input: HTMLInputElement;
  private readonly unsubscribe: () => void;

  constructor(private readonly root: HTMLElement, private readonly source: ChatPanelSource) {
    root.innerHTML = `
      <section class="multiplayer-chat" aria-label="Multiplayer chat">
        <header>COMMS <span>ENTER TO CHAT</span></header>
        <ol data-chat-messages aria-live="polite"></ol>
        <form data-chat-form>
          <input data-chat-input maxlength="160" autocomplete="off" aria-label="Chat message">
          <button type="submit">SEND</button>
        </form>
      </section>`;
    this.messages = this.require('[data-chat-messages]') as HTMLOListElement;
    this.input = this.require('[data-chat-input]') as HTMLInputElement;
    source.messages.forEach((message) => this.append(message));
    this.unsubscribe = source.subscribe((message) => this.append(message));
    this.require('[data-chat-form]').addEventListener('submit', this.onSubmit);
    this.input.addEventListener('keydown', this.stopInputPropagation);
    this.input.addEventListener('mousedown', this.stopInputPropagation);
    window.addEventListener('keydown', this.onWindowKeyDown);
  }

  dispose(): void {
    this.unsubscribe();
    window.removeEventListener('keydown', this.onWindowKeyDown);
    this.root.replaceChildren();
  }

  private append(message: LobbyChatMessage): void {
    const item = document.createElement('li');
    item.className = `multiplayer-chat__message multiplayer-chat__message--${message.team}`;
    const name = document.createElement('b');
    const text = document.createElement('span');
    name.textContent = message.playerName;
    text.textContent = message.text;
    item.append(name, text);
    this.messages.append(item);
    while (this.messages.childElementCount > 50) this.messages.firstElementChild?.remove();
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const text = this.input.value.trim();
    if (!text) return;
    this.source.send(text);
    this.input.value = '';
  };

  private readonly onWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Enter' || document.activeElement === this.input || isEditable(event.target)) return;
    event.preventDefault();
    this.input.focus();
  };

  private readonly stopInputPropagation = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.code === 'Escape') {
      event.preventDefault();
      this.input.blur();
    }
    event.stopPropagation();
  };

  private require(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Chat element ${selector} is missing`);
    return element;
  }
}

const isEditable = (target: EventTarget | null): boolean => {
  const element = target as { closest?: (selector: string) => Element | null } | null;
  return Boolean(element?.closest?.('input, textarea, select, button, [contenteditable="true"]'));
};
