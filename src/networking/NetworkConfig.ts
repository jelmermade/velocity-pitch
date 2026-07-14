const defaultWebSocketUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};

interface MultiplayerEnvironment {
  readonly VITE_MULTIPLAYER_URL?: string;
  readonly VITE_PUBLIC_URL?: string;
}

const environment = import.meta.env as unknown as MultiplayerEnvironment;

export const NETWORK_CONFIG = Object.freeze({
  webSocketUrl: environment.VITE_MULTIPLAYER_URL || defaultWebSocketUrl(),
  publicGameUrl: environment.VITE_PUBLIC_URL || window.location.origin,
  snapshotRate: 20,
  interpolationDelaySeconds: 0.06,
  maximumExtrapolationSeconds: 0.05,
});
