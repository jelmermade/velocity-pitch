import {
  CHAT_CHARACTER_LIMIT,
  CHAT_COOLDOWN_MS,
  type ChatChannel,
  type ChatMessageType,
} from '../networking/LobbyProtocol';

export type ChatColorKey = ChatMessageType | 'opponent';

export interface ChatBindings {
  readonly global: string;
  readonly team: string;
  readonly party: string;
}

export interface ChatPosition {
  readonly top: string;
  readonly left: string;
}

export interface ChatConfig {
  readonly position: ChatPosition;
  readonly uiScale: number;
  readonly fontSize: string;
  readonly backgroundOpacity: number;
  readonly interfaceOpacity: number;
  readonly maximumVisibleMessages: number;
  readonly maximumHistoryMessages: number;
  readonly messageFadeDurationMs: number;
  readonly inputCharacterLimit: number;
  readonly characterCounterThreshold: number;
  readonly messageCooldownMs: number;
  readonly animationDurationMs: number;
  readonly closeAfterSend: boolean;
  readonly showTimestamps: boolean;
  readonly showChannelPrefixes: boolean;
  readonly bindings: ChatBindings;
  readonly channelColors: Readonly<Record<ChatColorKey, string>>;
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = Object.freeze({
  position: { top: '1.3rem', left: '1.5rem' },
  uiScale: 1,
  fontSize: '0.72rem',
  backgroundOpacity: 0.68,
  interfaceOpacity: 0.96,
  maximumVisibleMessages: 6,
  maximumHistoryMessages: 50,
  messageFadeDurationMs: 6500,
  inputCharacterLimit: CHAT_CHARACTER_LIMIT,
  characterCounterThreshold: 20,
  messageCooldownMs: CHAT_COOLDOWN_MS,
  animationDurationMs: 180,
  closeAfterSend: true,
  showTimestamps: false,
  showChannelPrefixes: true,
  bindings: {
    global: 'Enter',
    team: 'KeyT',
    party: 'KeyY',
  },
  channelColors: {
    global: '#e9ffff',
    team: '#2cd9ff',
    opponent: '#ff8a5b',
    party: '#83e875',
    system: '#ffd166',
    error: '#ff685d',
  },
});

export const chatChannelLabel = (channel: ChatChannel): string => {
  if (channel === 'global') return 'ALL';
  return channel.toUpperCase();
};
