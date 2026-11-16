/**
 * Device-local settings in localStorage (locale, theme, gratitude schedule…).
 * Every key gets the `bacuyy_` prefix. Storage can be missing or throw (private mode,
 * blocked site data), so every access is wrapped and falls back to "no value".
 * Data rows never go here: they live in IndexedDB.
 */
export const KV_PREFIX = "bacuyy_";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function kvGet(key: string): string | null {
  try {
    return storage()?.getItem(KV_PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function kvSet(key: string, value: string): void {
  try {
    storage()?.setItem(KV_PREFIX + key, value);
  } catch {
    // storage full or blocked: the setting just won't persist
  }
}

export function kvRemove(key: string): void {
  try {
    storage()?.removeItem(KV_PREFIX + key);
  } catch {
    // ignore
  }
}

export function kvGetJson<T>(key: string, fallback: T): T {
  const raw = kvGet(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function kvSetJson(key: string, value: unknown): void {
  kvSet(key, JSON.stringify(value));
}
