export class ObjectPool<T> {
  private readonly available: T[] = [];

  constructor(private readonly factory: () => T) {}

  acquire(): T { return this.available.pop() ?? this.factory(); }
  release(value: T): void { this.available.push(value); }
}
