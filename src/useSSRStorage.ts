import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type { SSRStorageOptions, SetValue } from './types';
import { defaultSerializer } from './serializer';
import { SSRStorageError, classifyError } from './errors';
import { resolveStorage, isNativeStorage, safeRead, safeWrite, safeRemove } from './safeStorage';
import { subscribe, emitChange, ensureNativeStorageListener, checkInitialValueConsistency } from './store';

export function useSSRStorage<T>(
  key: string,
  initialValue: T,
  options: SSRStorageOptions<T> = {}
): [value: T, setValue: SetValue<T>, removeValue: () => void, error: SSRStorageError | null] {
  const { storage: storageOption, schema, syncTabs = true, debounceMs = 0 } = options;
  // Memoized so identity is stable across renders when the caller doesn't pass a
  // custom serializer — otherwise a fresh object every render would defeat the
  // `storedValue` memo below and force it to re-parse on every single render.
  const serializer = useMemo(() => options.serializer ?? defaultSerializer<T>(), [options.serializer]);

  checkInitialValueConsistency(key, initialValue);

  // Resolved lazily, client-side only — never at module scope, or importing this
  // package in an SSR entry file throws before anything renders.
  const storageRef = useRef<Storage | null>(null);
  if (storageRef.current === null && typeof window !== 'undefined') {
    storageRef.current = resolveStorage(storageOption);
  }

  // Two separate refs for two independent failure modes — do NOT merge these into one.
  // `useSyncExternalStore` calls getSnapshot more than once per render (once during
  // render, again as an internal post-commit tearing check, which runs BEFORE our own
  // effect since hooks fire in declaration order). That second call only re-reads the
  // raw string — it knows nothing about parsing — so if a single shared ref were used,
  // that internal call would clobber a parse/validation error back to null moments
  // after storedValue's memo had set it, before our effect ever saw it.
  const readErrorRef = useRef<SSRStorageError | null>(null); // set only inside getSnapshot
  const parseErrorRef = useRef<SSRStorageError | null>(null); // set only inside storedValue's memo
  const [error, setError] = useState<SSRStorageError | null>(null);

  // Optimistic local override — the displayed value while a (possibly debounced)
  // write is pending, and the rollback target if that write fails.
  const [override, setOverride] = useState<{ key: string; value: T } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pure, side-effect-free read for useSyncExternalStore. Never call setState in here —
  // React may invoke this multiple times per render for consistency checks, and doing so
  // risks "getSnapshot should be cached" warnings or infinite loops. Errors are stashed
  // in a ref and synced to state separately, after render, via the effect below.
  const getSnapshot = useCallback((): string | null => {
    const storage = storageRef.current;
    if (!storage) return null;
    try {
      const raw = safeRead(storage, key);
      readErrorRef.current = null;
      return raw;
    } catch (err) {
      readErrorRef.current = new SSRStorageError(
        `Failed to read storage for key "${key}"`,
        classifyError(err),
        key,
        'read'
      );
      return null;
    }
  }, [key]);

  // Always the same, stable value on every server render — never touches real storage.
  const getServerSnapshot = useCallback((): null => null, []);

  const subscribeFn = useCallback(
    (cb: () => void) => {
      const unsubscribe = subscribe(key, cb);
      // The native `storage` event only ever fires for real localStorage/sessionStorage,
      // never for a caller-supplied custom Storage object — guard accordingly.
      if (syncTabs && isNativeStorage(storageRef.current)) {
        ensureNativeStorageListener();
      }
      return unsubscribe;
    },
    [key, syncTabs]
  );

  const rawSnapshot = useSyncExternalStore(subscribeFn, getSnapshot, getServerSnapshot);

  const storedValue = useMemo<T>(() => {
    if (rawSnapshot === null) {
      parseErrorRef.current = null;
      return initialValue;
    }
    try {
      const parsed = serializer.parse(rawSnapshot);
      const result = schema ? schema.parse(parsed) : parsed;
      parseErrorRef.current = null;
      return result;
    } catch {
      parseErrorRef.current = new SSRStorageError(
        `Failed to parse or validate stored value for key "${key}"`,
        'validation',
        key,
        'read'
      );
      return initialValue;
    }
  }, [rawSnapshot, key, initialValue, serializer, schema]);

  // Read-path errors never throw (asymmetric handling) — they're surfaced here instead,
  // synced after render rather than during the getSnapshot/memo calls themselves.
  // parseErrorRef takes precedence: a parse/validation failure is more specific and
  // actionable than a raw-read failure, and the two are mutually exclusive in practice
  // (parsing only runs when the raw read already succeeded).
  useEffect(() => {
    setError(parseErrorRef.current ?? readErrorRef.current);
  }, [rawSnapshot]);

  // Once the real storage snapshot reflects a pending optimistic value, drop the override.
  useEffect(() => {
    if (!override || override.key !== key || rawSnapshot === null) return;
    try {
      const parsed = serializer.parse(rawSnapshot);
      const committed = schema ? schema.parse(parsed) : parsed;
      if (JSON.stringify(committed) === JSON.stringify(override.value)) {
        setOverride(null);
      }
    } catch {
      // leave override in place; the read-path error above already surfaces this
    }
  }, [rawSnapshot, override, key, serializer, schema]);

  const value = override && override.key === key ? override.value : storedValue;

  const currentValueRef = useRef(value);
  currentValueRef.current = value;

  const commitWrite = useCallback(
    (resolved: T, prevValue: T) => {
      const storage = storageRef.current;
      if (!storage) return; // SSR / no window — nothing to write, shouldn't be reachable anyway

      try {
        if (resolved === undefined) {
          // Edge case: `undefined` is not JSON-serializable in a meaningful way —
          // treat setting it as equivalent to removeValue().
          safeRemove(storage, key);
        } else {
          const validated = schema ? schema.parse(resolved) : resolved;
          safeWrite(storage, key, serializer.stringify(validated));
        }
        setError(null);
        emitChange(key);
      } catch (err) {
        const storageErr =
          err instanceof SSRStorageError
            ? err
            : new SSRStorageError(
                `Failed to write storage for key "${key}"`,
                classifyError(err),
                key,
                'write'
              );
        // flushSync forces React to commit the rollback + error state synchronously,
        // before we throw. Without it, a setState call immediately followed by a throw
        // in the same synchronous scope isn't guaranteed to be flushed before the
        // exception propagates out of the caller's batching context (e.g. act() in
        // tests, and potentially some production event-handling paths) — the caller
        // could read stale state even though the update was "scheduled."
        flushSync(() => {
          setOverride({ key, value: prevValue });
          setError(storageErr);
        });
        // Re-emit so any other component subscribed to this key (which may have
        // already re-rendered optimistically off the first emitChange) rolls back too.
        emitChange(key);
        throw storageErr;
      }
    },
    [key, schema, serializer]
  );

  const setValue = useCallback<SetValue<T>>(
    (next) => {
      const prevValue = currentValueRef.current;
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prevValue) : next;

      // Optimistic commit is always immediate, regardless of debounceMs — only the
      // actual storage write (and thus cross-tab/other-subscriber notification) is delayed.
      setOverride({ key, value: resolved });

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

      if (debounceMs > 0) {
        debounceTimerRef.current = setTimeout(() => commitWrite(resolved, prevValue), debounceMs);
      } else {
        commitWrite(resolved, prevValue);
      }
    },
    [key, debounceMs, commitWrite]
  );

  const removeValue = useCallback(() => {
    const prevValue = currentValueRef.current;
    const storage = storageRef.current;

    setOverride({ key, value: initialValue });

    if (!storage) return;
    try {
      safeRemove(storage, key);
      setError(null);
      emitChange(key);
    } catch (err) {
      const storageErr = new SSRStorageError(
        `Failed to remove storage key "${key}"`,
        classifyError(err),
        key,
        'remove'
      );
      flushSync(() => {
        setOverride({ key, value: prevValue });
        setError(storageErr);
      });
      emitChange(key);
      throw storageErr;
    }
  }, [key, initialValue]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return [value, setValue, removeValue, error];
}
