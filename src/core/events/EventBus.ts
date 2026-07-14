type EventMap = object;
type EventKey<T extends EventMap> = Extract<keyof T, string>;
type Handler<T> = (payload: T) => void;

export class EventBus<TEvents extends EventMap> {
  private readonly handlers = new Map<keyof TEvents, Set<Handler<TEvents[keyof TEvents]>>>();

  on<TKey extends EventKey<TEvents>>(event: TKey, handler: Handler<TEvents[TKey]>): () => void {
    let eventHandlers = this.handlers.get(event);
    if (!eventHandlers) {
      eventHandlers = new Set();
      this.handlers.set(event, eventHandlers);
    }
    eventHandlers.add(handler as Handler<TEvents[keyof TEvents]>);
    return () => {
      eventHandlers.delete(handler as Handler<TEvents[keyof TEvents]>);
    };
  }

  emit<TKey extends EventKey<TEvents>>(event: TKey, payload: TEvents[TKey]): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}
