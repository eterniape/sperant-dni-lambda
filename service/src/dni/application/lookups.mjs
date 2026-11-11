import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

function key(owner, id) {
  return 'lookup#' + createHash('sha256').update(JSON.stringify([owner, id])).digest('hex');
}

const aad = (row, kind) => `${row.pk}:${row.generation}:${kind}`;
const expires = (row) => new Date(row.expiresAt * 1000).toISOString();

export function createLookups({ store, enqueue, vault, now = Date.now }) {
  return {
    async submit(owner, id, dni) {
      const pk = key(owner, id);
      let row = await store.read(pk);
      if (!row) {
        const draft = { pk, generation: randomUUID(), expiresAt: Math.floor(now() / 1000) + 86_400 };
        const [input, fingerprint] = await Promise.all([
          vault.seal(dni, aad(draft, 'input')),
          vault.fingerprint(dni, pk),
        ]);
        row = await store.create({ ...draft, input, fingerprint, status: 'pending' });
      }
      const fingerprint = await vault.fingerprint(dni, pk, row.fingerprint);
      const a = Buffer.from(row.fingerprint);
      const b = Buffer.from(fingerprint);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return { kind: 'conflict' };
      // SQS FIFO dedupes rapid HTTP retries. The worker also claims the row conditionally.
      // A failed send returns 503; resending the same HTTP id can repair the enqueue.
      if (row.status === 'pending' && !row.leaseId && !row.defers) {
        await enqueue({ pk, generation: row.generation });
      }
      return { kind: 'accepted', expiresAt: expires(row) };
    },
    async read(owner, id) {
      const row = await store.read(key(owner, id));
      if (!row) return { kind: 'missing' };
      if (row.status === 'pending') return {
        kind: 'pending', expiresAt: expires(row),
        ...(row.retryAt > now() ? { retryAt: row.retryAt } : {}),
      };
      return {
        ...await vault.open(row.output, aad(row, 'output')), expiresAt: expires(row),
      };
    },
  };
}

export function createProcessor({ store, vault, resolve, now = Date.now, random = Math.random }) {
  return async function process({ pk, generation }) {
    const claim = await store.claim(pk, generation, randomUUID());
    if (claim.kind !== 'claimed') return claim;
    const row = claim.row;
    const dni = await vault.open(row.input, aad(row, 'input'));
    const result = await resolve(dni, JSON.parse(row.misses ?? '[]'));
    const current = now();
    const retryDelay = result.retryAt - current;
    if (result.kind === 'unavailable' && retryDelay <= 900_000 && (row.defers ?? 0) < 40) {
      // Spread retries at minute boundaries so bulk submissions do not all contend again at once.
      const spread = Math.min(840_000, 10_000 * 2 ** Math.min(row.defers ?? 0, 7));
      const retryAt = Math.min(current + 900_000,
        Math.max(current + 2000, result.retryAt) + Math.floor(random() * spread));
      if (retryAt + 30_000 < row.expiresAt * 1000) {
        return await store.defer(row, retryAt, result.misses) ? { kind: 'deferred', retryAt } : { kind: 'locked' };
      }
    }
    const { misses, ...outcome } = result;
    const output = await vault.seal(outcome, aad(row, 'output'));
    return await store.finish(row, output, outcome.kind) ? { kind: 'done' } : { kind: 'locked' };
  };
}
