export function createResolver({ providers, observe = () => {}, now = Date.now }) {
  return async function resolve(dni) {
    let misses = 0;
    let retryAt = Infinity;
    for (const provider of providers) {
      const result = await provider.lookup(dni);
      observe(result.kind, provider.id);
      if (result.kind === 'found') return { kind: 'found', data: result.data, provider: provider.id };
      if (result.kind === 'not_found') {
        misses += 1;
        continue;
      }
      if (result.kind !== 'auth') retryAt = Math.min(retryAt, result.retryAt ?? now() + 30_000);
    }
    if (misses > 0 && misses === providers.length) return { kind: 'not_found' };
    return Number.isFinite(retryAt) ? { kind: 'unavailable', retryAt } : { kind: 'unavailable' };
  };
}
