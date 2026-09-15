import type { Serializer } from './types';

export function defaultSerializer<T>(): Serializer<T> {
  return {
    parse: (raw: string) => JSON.parse(raw) as T,
    stringify: (value: T) => JSON.stringify(value),
  };
}
