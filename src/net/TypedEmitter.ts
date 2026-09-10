export type EventMap = Record<string, unknown[]>;

type AnyHandler = (...args: never[]) => void;

/**
 * Minimal typed event emitter.
 *
 * Node's EventEmitter is not available in the browser and the DOM's EventTarget loses
 * argument types, so the protocol layer carries its own.
 */
export class TypedEmitter<M extends EventMap> {
  // Handler argument types vary per event, so the store is deliberately opaque and the
  // public methods reintroduce the types.
  private readonly handlers = new Map<keyof M, Set<AnyHandler>>();

  /** Subscribes, and returns a function that unsubscribes. */
  on<K extends keyof M>(event: K, handler: (...args: M[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as unknown as AnyHandler);
    return () => {
      set.delete(handler as unknown as AnyHandler);
    };
  }

  once<K extends keyof M>(event: K, handler: (...args: M[K]) => void): () => void {
    const off = this.on(event, (...args) => {
      off();
      handler(...args);
    });
    return off;
  }

  emit<K extends keyof M>(event: K, ...args: M[K]): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    // Copy first: a handler may unsubscribe itself or others while we iterate.
    for (const handler of [...set]) {
      try {
        (handler as unknown as (...a: M[K]) => void)(...args);
      } catch (error) {
        // A subscriber must not be able to break its siblings or the code that emitted.
        // The UI subscribes to session events, and a fault in the frame engine taking
        // down a live connection mid-handshake is not an acceptable failure mode.
        console.error(`error in '${String(event)}' handler:`, error);
      }
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }
}
