import type { NetworkMessage } from './NetworkMessage';

export interface Transport {
  send(message: NetworkMessage): void;
  onMessage(handler: (message: NetworkMessage) => void): () => void;
  close(): void;
}
