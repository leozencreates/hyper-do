/** Minimal typed event emitter: subscribe with `on`, get an unsubscribe function back. */
export interface Emitter<T> {
  on(cb: (value: T) => void): () => void
  emit(value: T): void
}

export function createEmitter<T>(): Emitter<T> {
  const subs = new Set<(value: T) => void>()
  return {
    on(cb) {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    },
    emit(value) {
      subs.forEach((cb) => cb(value))
    },
  }
}
