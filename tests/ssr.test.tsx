/**
 * @vitest-environment node
 *
 * Runs with NO jsdom and no `window` global at all. This is the test that catches
 * the single most damaging bug class for an SSR-safety package: a `localStorage`
 * or `window` reference accidentally hoisted to module scope, which would throw
 * on import in any real SSR entry file — before a single component even renders.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { useSSRStorage } from '../src';

function ThemeDisplay() {
  const [theme] = useSSRStorage('theme', 'light');
  return <div data-testid="theme">{theme}</div>;
}

describe('SSR safety', () => {
  test('renders on the server without throwing', () => {
    expect(() => renderToString(<ThemeDisplay />)).not.toThrow();
  });

  test('server render reflects initialValue, never real storage', () => {
    const html = renderToString(<ThemeDisplay />);
    expect(html).toContain('light');
  });

  test('importing the package does not touch window at module load time', () => {
    // If any module in src/ resolved `window.localStorage` at top level rather than
    // lazily inside a function, this file would already have thrown on the import above.
    expect(true).toBe(true);
  });
});
