// Ports: providers (lookup), quotas (reserve/block), observe (safe structured log).
export function createResolver({ providers, quotas, observe = () => {}, now = Date.now }) {
  return async function resolve(dni, previousMisses = []) {
    const misses = new Set(previousMisses);
    const retryDates = [];
    for (const provider of providers) {
      if (misses.has(provider.id)) continue;
      const reservation = await quotas.reserve(provider.policy);
      if (reservation.retryAt) {
        retryDates.push(reservation.retryAt);
        observe('skipped', provider.id);
        continue;
      }
      const result = await provider.lookup(dni);
      observe(result.kind, provider.id);
      if (result.kind === 'found') return { kind: 'found', data: result.data, provider: provider.id };
      if (result.kind === 'not_found') {
        misses.add(provider.id);
        continue;
      }
      if (result.blockUntil) await quotas.block(provider.id, result.blockUntil);
      if (result.kind !== 'auth') retryDates.push(result.retryAt ?? now() + 30_000);
    }
    if (providers.length && providers.every(({ id }) => misses.has(id))) return { kind: 'not_found' };
    return {
      kind: 'unavailable',
      misses: [...misses],
      ...(retryDates.length ? { retryAt: Math.min(...retryDates) } : {}),
    };
  };
}
