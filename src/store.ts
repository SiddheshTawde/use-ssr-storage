// Module-level (not per-hook-instance) so cross-tab sync and same-tab notification
// both work without prop-drilling an event emitter through the component tree.

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const initialValueRegistry = new Map<string, unknown>();

let nativeListenerAttached = false;

export function subscribe(key: string, callback: Listener): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(callback);

  return () => {
    const set = listeners.get(key);
    if (!set) return;
    set.delete(callback);
    if (set.size === 0) {
      listeners.delete(key);
      // Last subscriber for this key gone — clear the dev-only registry entry too,
      // so a future, unrelated feature reusing this key doesn't get a stale warning.
      initialValueRegistry.delete(key);
    }
  };
}

export function emitChange(key: string): void {
  listeners.get(key)?.forEach((cb) => cb());
}

/**
 * Attaches exactly one native `storage` event listener (regardless of how many
 * keys/components are active) and fans events out to the same listeners map used
 * for same-tab notification. Only ever called for real localStorage/sessionStorage —
 * the native event never fires for custom Storage-shaped objects.
 */
export function ensureNativeStorageListener(): void {
  if (nativeListenerAttached || typeof window === 'undefined') return;
  nativeListenerAttached = true;

  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === null) return; // storage.clear() was called — no single key to target
    emitChange(event.key);
  });
}

/**
 * Dev-only (no-op in production) check: warns if two hook instances register
 * different initialValues for the same key, which otherwise silently diverges
 * until one of them writes. Warn, not throw — a temporarily different fallback
 * default can be legitimate.
 */
export function checkInitialValueConsistency(key: string, initialValue: unknown): void {
  if (process.env.NODE_ENV === 'production') return;

  if (initialValueRegistry.has(key)) {
    const existing = initialValueRegistry.get(key);
    const same =
      Object.is(existing, initialValue) ||
      JSON.stringify(existing) === JSON.stringify(initialValue);
    if (!same) {
      console.warn(
        `[use-ssr-storage] Multiple calls to useSSRStorage("${key}", ...) registered ` +
          `different initialValues. First: ${JSON.stringify(existing)}, now: ` +
          `${JSON.stringify(initialValue)}. This can cause inconsistent state across ` +
          `components until the first write occurs.`
      );
    }
  } else {
    initialValueRegistry.set(key, initialValue);
  }
}

// Test-only reset hook — not exported from the package's public entry point.
export function __resetStoreForTests(): void {
  listeners.clear();
  initialValueRegistry.clear();
  nativeListenerAttached = false;
}
