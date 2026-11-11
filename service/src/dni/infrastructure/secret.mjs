export function jsonSecret(fetchSecret, { cacheMs = 60_000, now = Date.now } = {}) {
  let expires = 0;
  let value;
  let pending;
  return async function load(refresh = false) {
    if (!refresh && expires > now()) return value;
    pending ??= (async () => {
      try {
        value = JSON.parse(await fetchSecret());
        expires = now() + cacheMs;
        return value;
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };
}
