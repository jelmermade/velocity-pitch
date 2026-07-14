import type { ChatChannel, LobbyChatMessage } from '../networking/LobbyProtocol';
import {
  chatChannelLabel,
  DEFAULT_CHAT_CONFIG,
  type ChatConfig,
  type ChatBindings,
} from './ChatConfig';

export interface ChatPanelSource {
  readonly messages: readonly LobbyChatMessage[];
  readonly send: (text: string, channel: ChatChannel) => boolean;
  readonly subscribe: (handler: (message: LobbyChatMessage) => void) => () => void;
}

type ChatPanelMode = 'lobby' | 'match';
type ChatConfigOverrides = Partial<Omit<ChatConfig, 'bindings' | 'channelColors' | 'position'>> & {
  readonly bindings?: Partial<ChatBindings>;
  readonly channelColors?: Partial<ChatConfig['channelColors']>;
  readonly position?: Partial<ChatConfig['position']>;
};

export interface ChatPanelOptions {
  readonly mode?: ChatPanelMode;
  readonly config?: ChatConfigOverrides;
  readonly filterText?: (text: string) => string;
  readonly isPlayerMuted?: (playerId: string) => boolean;
  readonly isPlayerBlocked?: (playerId: string) => boolean;
}

export class ChatPanel {
  private readonly panel: HTMLElement;
  private readonly messages: HTMLOListElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly channelButton: HTMLButtonElement;
  private readonly counter: HTMLOutputElement;
  private readonly config: ChatConfig;
  private readonly mode: ChatPanelMode;
  private readonly unsubscribe: () => void;
  private readonly sentMessages: string[] = [];
  private channel: ChatChannel = 'global';
  private historyIndex = -1;
  private historyDraft = '';
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private fadeTimer: number | null = null;
  private autoScroll = true;
  private open = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly source: ChatPanelSource,
    private readonly options: ChatPanelOptions = {},
  ) {
    this.config = mergeChatConfig(options.config);
    this.mode = options.mode ?? 'lobby';
    root.innerHTML = `
      <section class="multiplayer-chat multiplayer-chat--${this.mode}" aria-label="Multiplayer chat">
        <header>
          <b>QUICK COMMS</b>
          <span>ENTER TO CHAT</span>
        </header>
        <ol data-chat-messages aria-live="polite" aria-label="Chat history" tabindex="0"></ol>
        <form data-chat-form>
          <button class="multiplayer-chat__channel" type="button" data-chat-channel aria-label="Change chat channel">ALL:</button>
          <input data-chat-input autocomplete="off" placeholder="Type a message..." aria-label="Chat message">
          <output data-chat-counter hidden aria-live="polite"></output>
          <button class="multiplayer-chat__send" type="submit">SEND</button>
        </form>
      </section>`;
    this.panel = this.require('.multiplayer-chat');
    this.messages = this.require('[data-chat-messages]') as HTMLOListElement;
    this.form = this.require('[data-chat-form]') as HTMLFormElement;
    this.input = this.require('[data-chat-input]') as HTMLInputElement;
    this.channelButton = this.require('[data-chat-channel]') as HTMLButtonElement;
    this.counter = this.require('[data-chat-counter]') as HTMLOutputElement;
    this.messages.tabIndex = this.mode === 'match' ? -1 : 0;
    this.applyConfiguration();
    source.messages.forEach((message) => this.append(message, false));
    this.unsubscribe = source.subscribe((message) => this.append(message, true));
    this.form.inert = this.mode === 'match';
    this.form.addEventListener('submit', this.onSubmit);
    this.channelButton.addEventListener('click', this.onCycleChannel);
    this.input.addEventListener('input', this.onInput);
    this.input.addEventListener('keydown', this.onInputKeyDown);
    this.input.addEventListener('mousedown', this.stopInputPropagation);
    this.messages.addEventListener('scroll', this.onScroll);
    this.panel.addEventListener('focusout', this.onFocusOut);
    window.addEventListener('keydown', this.onWindowKeyDown);
    if (this.mode === 'lobby') this.panel.classList.add('multiplayer-chat--visible');
  }

  dispose(): void {
    this.unsubscribe();
    if (this.fadeTimer !== null) window.clearTimeout(this.fadeTimer);
    window.removeEventListener('keydown', this.onWindowKeyDown);
    this.root.replaceChildren();
  }

  private applyConfiguration(): void {
    this.input.maxLength = this.config.inputCharacterLimit;
    this.panel.style.setProperty('--chat-scale', this.config.uiScale.toString());
    this.panel.style.setProperty('--chat-font-size', this.config.fontSize);
    this.panel.style.setProperty('--chat-background-opacity', this.config.backgroundOpacity.toString());
    this.panel.style.setProperty('--chat-interface-opacity', this.config.interfaceOpacity.toString());
    this.panel.style.setProperty('--chat-animation-duration', `${this.config.animationDurationMs}ms`);
    Object.entries(this.config.channelColors).forEach(([channel, color]) => {
      this.panel.style.setProperty(`--chat-${channel}`, color);
    });
    if (this.mode === 'match') {
      this.root.parentElement?.style.setProperty('--chat-top', this.config.position.top);
      this.root.parentElement?.style.setProperty('--chat-left', this.config.position.left);
    }
    this.setChannel('global');
  }

  private append(message: LobbyChatMessage, announce: boolean): void {
    if (this.options.isPlayerMuted?.(message.playerId) || this.options.isPlayerBlocked?.(message.playerId)) return;
    const item = document.createElement('li');
    item.className = [
      'multiplayer-chat__message',
      `multiplayer-chat__message--${message.channel}`,
      message.team ? `multiplayer-chat__message--${message.team}` : '',
      announce ? 'multiplayer-chat__message--new' : '',
    ].filter(Boolean).join(' ');
    item.dataset.messageId = message.id;
    if (this.config.showTimestamps) {
      const time = document.createElement('time');
      time.dateTime = new Date(message.sentAt).toISOString();
      time.textContent = new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      item.append(time);
    }
    if (this.config.showChannelPrefixes && message.channel !== 'global') {
      const prefix = document.createElement('small');
      prefix.textContent = `[${message.channel.toUpperCase()}]`;
      item.append(prefix);
    }
    if (message.channel !== 'system' && message.channel !== 'error') {
      const name = document.createElement('b');
      name.textContent = `${message.playerName}:`;
      item.append(name);
    }
    const text = document.createElement('span');
    text.textContent = this.options.filterText?.(message.text) ?? message.text;
    item.append(text);
    this.messages.append(item);
    while (this.messages.childElementCount > this.config.maximumHistoryMessages) {
      this.messages.firstElementChild?.remove();
    }
    this.refreshMessageVisibility();
    if (this.autoScroll || !this.open) this.scrollToNewest();
    if (announce) {
      window.setTimeout(() => item.classList.remove('multiplayer-chat__message--new'), this.config.animationDurationMs);
      this.revealTemporarily();
    }
  }

  private appendNotice(text: string, type: 'system' | 'error'): void {
    this.append({
      id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      playerId: '',
      playerName: '',
      channel: type,
      text,
      sentAt: Date.now(),
    }, true);
  }

  private refreshMessageVisibility(): void {
    const items = [...this.messages.children] as HTMLElement[];
    items.reverse().forEach((item, age) => {
      item.classList.toggle('multiplayer-chat__message--outside-limit', age >= this.config.maximumVisibleMessages);
      const progress = age / Math.max(1, this.config.maximumVisibleMessages - 1);
      item.style.setProperty('--chat-message-opacity', Math.max(0.34, 1 - progress * 0.66).toFixed(2));
    });
  }

  private revealTemporarily(): void {
    this.panel.classList.add('multiplayer-chat--visible');
    if (this.open || this.mode === 'lobby') return;
    if (this.fadeTimer !== null) window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.panel.classList.remove('multiplayer-chat--visible');
      this.fadeTimer = null;
    }, this.config.messageFadeDurationMs);
  }

  private openInput(channel: ChatChannel): void {
    this.open = true;
    this.autoScroll = true;
    this.setChannel(channel);
    if (this.fadeTimer !== null) window.clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    this.panel.classList.add('multiplayer-chat--open', 'multiplayer-chat--visible');
    this.form.inert = false;
    this.messages.tabIndex = 0;
    this.input.focus();
    this.scrollToNewest();
  }

  private closeInput(): void {
    if (!this.open) return;
    this.open = false;
    this.historyIndex = -1;
    this.historyDraft = '';
    this.panel.classList.remove('multiplayer-chat--open');
    this.form.inert = this.mode === 'match';
    this.messages.tabIndex = this.mode === 'match' ? -1 : 0;
    this.input.blur();
    this.revealTemporarily();
  }

  private setChannel(channel: ChatChannel): void {
    this.channel = channel;
    this.panel.dataset.channel = channel;
    this.channelButton.textContent = `${chatChannelLabel(channel)}:`;
    this.channelButton.setAttribute('aria-label', `Current channel ${chatChannelLabel(channel)}. Activate to change channel.`);
  }

  private scrollToNewest(): void {
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  private navigateHistory(direction: -1 | 1): void {
    if (this.sentMessages.length === 0) return;
    if (this.historyIndex === -1) this.historyDraft = this.input.value;
    this.historyIndex = direction === 1
      ? Math.min(this.sentMessages.length - 1, this.historyIndex + 1)
      : Math.max(-1, this.historyIndex - 1);
    this.input.value = this.historyIndex === -1
      ? this.historyDraft
      : this.sentMessages[this.sentMessages.length - 1 - this.historyIndex] ?? '';
    this.onInput();
  }

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const filtered = this.options.filterText?.(this.input.value) ?? this.input.value;
    const text = normalizeInput(filtered).slice(0, this.config.inputCharacterLimit);
    if (!text) return;
    const now = Date.now();
    if (now - this.lastSentAt < this.config.messageCooldownMs) {
      this.appendNotice('Chat is cooling down. Try again in a moment.', 'error');
      return;
    }
    if (!this.source.send(text, this.channel)) {
      this.appendNotice('Message could not be sent.', 'error');
      return;
    }
    this.lastSentAt = now;
    this.sentMessages.push(text);
    if (this.sentMessages.length > this.config.maximumHistoryMessages) this.sentMessages.shift();
    this.input.value = '';
    this.historyIndex = -1;
    this.historyDraft = '';
    this.onInput();
    if (this.config.closeAfterSend && this.mode === 'match') this.closeInput();
  };

  private readonly onWindowKeyDown = (event: KeyboardEvent): void => {
    if (this.open || isEditable(event.target) || event.repeat) return;
    const channel = channelForBinding(event.code, this.config.bindings);
    if (!channel) return;
    event.preventDefault();
    event.stopPropagation();
    this.openInput(channel);
  };

  private readonly onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.open) this.closeInput();
      else this.input.blur();
      return;
    }
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
      this.navigateHistory(event.code === 'ArrowUp' ? 1 : -1);
    }
    event.stopPropagation();
  };

  private readonly onInput = (): void => {
    const remaining = this.config.inputCharacterLimit - this.input.value.length;
    this.counter.hidden = remaining > this.config.characterCounterThreshold;
    this.counter.textContent = remaining.toString();
    this.counter.classList.toggle('multiplayer-chat__counter--limit', remaining <= 5);
  };

  private readonly onScroll = (): void => {
    const distanceFromBottom = this.messages.scrollHeight - this.messages.scrollTop - this.messages.clientHeight;
    this.autoScroll = distanceFromBottom < 12;
  };

  private readonly onCycleChannel = (event: Event): void => {
    event.stopPropagation();
    const channels: readonly ChatChannel[] = ['global', 'team', 'party'];
    const index = channels.indexOf(this.channel);
    this.setChannel(channels[(index + 1) % channels.length] ?? 'global');
    this.input.focus();
  };

  private readonly onFocusOut = (): void => {
    queueMicrotask(() => {
      if (this.open && !this.panel.contains(document.activeElement)) this.closeInput();
    });
  };

  private readonly stopInputPropagation = (event: Event): void => event.stopPropagation();

  private require(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Chat element ${selector} is missing`);
    return element;
  }
}

const mergeChatConfig = (overrides: ChatConfigOverrides = {}): ChatConfig => ({
  ...DEFAULT_CHAT_CONFIG,
  ...overrides,
  position: { ...DEFAULT_CHAT_CONFIG.position, ...overrides.position },
  bindings: { ...DEFAULT_CHAT_CONFIG.bindings, ...overrides.bindings },
  channelColors: { ...DEFAULT_CHAT_CONFIG.channelColors, ...overrides.channelColors },
});

const channelForBinding = (code: string, bindings: ChatBindings): ChatChannel | null => {
  if (code === bindings.global) return 'global';
  if (code === bindings.team) return 'team';
  if (code === bindings.party) return 'party';
  return null;
};

const normalizeInput = (value: string): string => value.replace(/\s+/g, ' ').trim();

const isEditable = (target: EventTarget | null): boolean => {
  const element = target as { closest?: (selector: string) => Element | null } | null;
  return Boolean(element?.closest?.('input, textarea, select, button, [contenteditable="true"]'));
};
