/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useSSRStorage } from '../src';
import { SSRStorageError } from '../src/errors';
import { __resetStoreForTests } from '../src/store';

beforeEach(() => {
  window.localStorage.clear();
  __resetStoreForTests();
  vi.restoreAllMocks();
});

describe('basic read/write', () => {
  test('returns initialValue when storage is empty', () => {
    const { result } = renderHook(() => useSSRStorage('k1', 'default'));
    expect(result.current[0]).toBe('default');
  });

  test('setValue persists and updates the returned value', () => {
    const { result } = renderHook(() => useSSRStorage('k2', 'a'));
    act(() => result.current[1]('b'));
    expect(result.current[0]).toBe('b');
    expect(window.localStorage.getItem('k2')).toBe(JSON.stringify('b'));
  });

  test('removeValue clears storage and reverts to initialValue', () => {
    const { result } = renderHook(() => useSSRStorage('k3', 'default'));
    act(() => result.current[1]('changed'));
    act(() => result.current[2]());
    expect(result.current[0]).toBe('default');
    expect(window.localStorage.getItem('k3')).toBeNull();
  });
});

describe('edge case: setValue(undefined) behaves like removeValue', () => {
  test('writing undefined removes the key instead of storing "undefined"', () => {
    const { result } = renderHook(() => useSSRStorage<string | undefined>('k4', 'x'));
    act(() => result.current[1]('y'));
    act(() => result.current[1](undefined as unknown as string));
    expect(window.localStorage.getItem('k4')).toBeNull();
  });
});

describe('edge case: write failure rolls back and populates error', () => {
  test('setValue throws, reverts to previous value, and sets error', () => {
    const { result } = renderHook(() => useSSRStorage('k5', 'a'));
    act(() => result.current[1]('b'));
    expect(result.current[0]).toBe('b');

    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    expect(() => {
      act(() => result.current[1]('c'));
    }).toThrow(SSRStorageError);

    expect(result.current[0]).toBe('b'); // rolled back
    expect(result.current[3]).toBeInstanceOf(SSRStorageError);
    expect(result.current[3]?.cause2).toBe('quota-exceeded');
  });
});

describe('edge case: corrupted stored data degrades to initialValue on read', () => {
  test('read errors never throw — they fall back and populate error', () => {
    window.localStorage.setItem('k6', '{not valid json');
    const { result } = renderHook(() => useSSRStorage('k6', 'fallback'));
    expect(result.current[0]).toBe('fallback');
    expect(result.current[3]).toBeInstanceOf(SSRStorageError);
  });
});

describe('edge case: mismatched initialValue across instances warns in dev', () => {
  test('logs a console warning, does not throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHook(() => useSSRStorage('k7', 'light'));
    renderHook(() => useSSRStorage('k7', 'dark'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('different initialValues'));
  });
});
