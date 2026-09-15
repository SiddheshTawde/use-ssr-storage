# use-ssr-storage

An SSR-safe `localStorage`/`sessionStorage` hook for React, built on `useSyncExternalStore`. No hydration mismatches, cross-tab sync, typed errors, optional schema validation.

## Install

```bash
npm install use-ssr-storage
```

## Usage

```tsx
import { useSSRStorage } from 'use-ssr-storage';

function ThemeToggle() {
  const [theme, setTheme, removeTheme, error] = useSSRStorage('theme', 'light');

  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      Current: {theme}
    </button>
  );
}
```

`initialValue` is required — it's what renders on the server and during the pre-hydration client render, so there's no `T | undefined` union to deal with in consumers.

## API

```ts
function useSSRStorage<T>(
  key: string,
  initialValue: T,
  options?: SSRStorageOptions<T>
): [value: T, setValue: SetValue<T>, removeValue: () => void, error: SSRStorageError | null]
```

### Options

| Option | Default | Description |
|---|---|---|
| `storage` | `'local'` | `'local'`, `'session'`, or a raw `Storage`-shaped object (for testing/polyfills) |
| `serializer` | JSON | Custom `{ parse, stringify }` |
| `schema` | — | Zod-compatible `{ parse }`. Validates on **both** read and write |
| `syncTabs` | `true` | Cross-tab sync via the native `storage` event. Only applies to real `localStorage`/`sessionStorage` |
| `debounceMs` | `0` | Debounces the storage **write** only — the returned value updates immediately |

### Error handling

Read and write failures are handled **asymmetrically**:

- **Reads never throw.** A missing key, corrupted JSON, or a schema validation failure all fall back to `initialValue`. The failure is still surfaced via the `error` return value.
- **Writes throw** (quota exceeded, storage disabled — e.g. Safari private mode) *and* populate `error`, so you can either `try/catch` around `setValue`/`removeValue`, or just read `error` reactively.
- A failed write **rolls back** the optimistic in-memory value — the UI never shows a value that didn't actually persist.

```tsx
const [value, setValue, removeValue, error] = useSSRStorage('cart', []);

try {
  setValue(newCart);
} catch (e) {
  // storage write failed — value has already rolled back
}

if (error) {
  // render a small "couldn't save" indicator, etc.
}
```

## Known limitations

- **Different `initialValue`s for the same key across components** will log a dev-only console warning (not an error) if they diverge before the first write — pick one canonical default per key.
- **Cross-tab sync (`syncTabs`) only works with real `localStorage`/`sessionStorage`** — the native `storage` event never fires for a custom `Storage` object passed via `options.storage`.
- **`setValue(undefined)` is treated as `removeValue()`**, since `undefined` isn't meaningfully JSON-serializable.

## License

MIT
