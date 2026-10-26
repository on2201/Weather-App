const store = new Map();

export function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function set(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

// Sweep expired keys so the Map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (now > v.expires) store.delete(k);
}, 5 * 60_000).unref();