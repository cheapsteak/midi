import type { Unsubscribe } from './types';

/** Minimal synchronous event emitter. Listener errors are isolated from each other. */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  on(cb: (value: T) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  emit(value: T): void {
    for (const cb of this.listeners) {
      try {
        cb(value);
      } catch (err) {
        console.error(err);
      }
    }
  }
}
