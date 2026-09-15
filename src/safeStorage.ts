import type { StorageKind } from './types';
import { SSRStorageError, classifyError } from './errors';

/**
 * IMPORTANT: never resolve `window.localStorage` at module scope — that throws
 * immediately on import in any SSR entry file, before a single component renders.
 * Every access goes through this function, called lazily inside component/hook bodies.
 */
export function resolveStorage(kind: StorageKind | undefined): Storage | null {
  if (typeof window === 'undefined') return null; // SSR: no storage, caller must handle

  if (kind === 'session') return window.sessionStorage;
  if (kind === 'local' || kind === undefined) return window.localStorage;
  return kind; // caller-supplied Storage-shaped object (testing/polyfills)
}

/** True only for the real, native browser storages — the `storage` event never fires for anything else. */
export function isNativeStorage(storage: Storage | null): boolean {
  if (typeof window === 'undefined' || storage === null) return false;
  return storage === window.localStorage || storage === window.sessionStorage;
}

export function safeRead(storage: Storage, key: string): string | null {
  return storage.getItem(key);
}

export function safeWrite(storage: Storage, key: string, raw: string): void {
  try {
    storage.setItem(key, raw);
  } catch (err) {
    throw new SSRStorageError(
      `Failed to write to storage for key "${key}"`,
      classifyError(err),
      key,
      'write'
    );
  }
}

export function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch (err) {
    throw new SSRStorageError(
      `Failed to remove storage key "${key}"`,
      classifyError(err),
      key,
      'remove'
    );
  }
}
