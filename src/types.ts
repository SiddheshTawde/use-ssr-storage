export type StorageKind = 'local' | 'session' | Storage;

export interface Serializer<T> {
  parse: (raw: string) => T;
  stringify: (value: T) => string;
}

export interface SchemaLike<T> {
  parse: (raw: unknown) => T;
}

export type ErrorCause = 'quota-exceeded' | 'storage-disabled' | 'validation' | 'unknown';

export interface SSRStorageOptions<T> {
  /** Which storage to use. Defaults to 'local'. Pass a raw Storage object for testing/polyfills. */
  storage?: StorageKind;
  /** Custom serializer. Defaults to JSON.parse/stringify. */
  serializer?: Serializer<T>;
  /** Zod-compatible schema (duck-typed to `{ parse }`). Validates on read AND write. */
  schema?: SchemaLike<T>;
  /** Whether to sync across browser tabs via the native `storage` event. Defaults to true. */
  syncTabs?: boolean;
  /** Debounce writes to storage (ms). Does not debounce the returned state update. Defaults to 0. */
  debounceMs?: number;
}

export type SetValue<T> = (value: T | ((prev: T) => T)) => void;
