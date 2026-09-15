import type { ErrorCause } from './types';

export class SSRStorageError extends Error {
  public readonly cause2: ErrorCause; // `cause` is used by native Error in newer TS libs; keep our own field to avoid collision
  public readonly key: string;
  public readonly op: 'read' | 'write' | 'remove';

  constructor(message: string, cause: ErrorCause, key: string, op: 'read' | 'write' | 'remove') {
    super(message);
    this.name = 'SSRStorageError';
    this.cause2 = cause;
    this.key = key;
    this.op = op;
  }
}

/**
 * Classifies a thrown value from a storage operation into a stable cause.
 * Handles the two real-world cases that matter:
 *  - QuotaExceededError (Safari private mode throws this even for tiny writes)
 *  - SecurityError (storage disabled entirely, e.g. some locked-down webviews)
 */
export function classifyError(err: unknown): ErrorCause {
  if (err instanceof DOMException) {
    if (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014) {
      return 'quota-exceeded';
    }
    if (err.name === 'SecurityError') {
      return 'storage-disabled';
    }
  }
  return 'unknown';
}
