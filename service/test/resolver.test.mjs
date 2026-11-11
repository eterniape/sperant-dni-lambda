import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResolver } from '../src/dni/application/resolve-dni.mjs';
import { nextReservation, quotaWindows } from '../src/dni/domain/quota.mjs';
import { createQuotaStore } from '../src/dni/infrastructure/dynamo.mjs';

const time = Date.parse('2026-11-12T10:00:00Z');
const provider = (id, kind, extra = {}) => ({
  id, policy: { id },
  async lookup() { return { kind, ...extra }; },
});

test('skips exhausted providers and stops after a valid fallback', async () => {
  const calls = [];
  const resolver = createResolver({
    providers: [provider('a', 'temporary'), provider('b', 'found'), provider('c', 'found', { data: 'names' }), provider('d', 'found')],
    quotas: { reserve: async ({ id }) => id === 'b' ? { retryAt: time + 1000 } : {} },
    observe: (kind, id) => calls.push([id, kind]),
  });
  assert.deepEqual(await resolver('00000001'), { kind: 'found', data: 'names', provider: 'c' });
  assert.deepEqual(calls, [['a', 'temporary'], ['b', 'skipped'], ['c', 'found']]);
});

test('a known miss survives a short rate limit and unavailable never becomes a false 404', async () => {
  const block = [];
  const quotas = { reserve: async () => ({}), block: async (...args) => block.push(args) };
  const temporary = createResolver({
    providers: [provider('a', 'not_found'), provider('b', 'quota', { retryAt: time + 60000, blockUntil: time + 60000 })],
    quotas,
  });
  const result = await temporary('00000001');
  assert.deepEqual(result, { kind: 'unavailable', retryAt: time + 60000, misses: ['a'] });
  assert.deepEqual(block, [['b', time + 60000]]);
  const resolver = createResolver({
    providers: [{ ...provider('a', 'not_found'), lookup() { throw new Error('should skip known miss'); } }, provider('b', 'not_found')],
    quotas,
  });
  assert.deepEqual(await resolver('00000001', result.misses), { kind: 'not_found' });
  assert.equal((await createResolver({ providers: [], quotas })('00000001')).kind, 'unavailable');
});

test('enforces a shared daily, minute and monthly limit under parallel contention', async () => {
  let row = null;
  const table = {
    read: async () => row,
    async put(item, condition, values) {
      if (row ? values[':rev'] !== row.rev : condition !== 'attribute_not_exists(pk)') return false;
      row = item;
      return true;
    },
  };
  let now = time;
  const first = createQuotaStore(table, () => now);
  const second = createQuotaStore(table, () => now);
  const policy = { id: 'p', perMinute: 2, perDay: 3, perMonth: 4, billingDay: 12 };
  const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? first : second).reserve(policy)));
  assert.equal(outcomes.filter((x) => !x.retryAt).length, 2);
  assert.equal(row.monthCount, 2);
  now += 60_000;
  assert.deepEqual(await first.reserve(policy), {});
  assert.equal((await first.reserve(policy)).retryAt, quotaWindows(now, 12).dayEnd);
  now = quotaWindows(now, 12).dayEnd;
  assert.deepEqual(await second.reserve(policy), {});
  assert.equal((await first.reserve(policy)).retryAt, quotaWindows(now, 12).monthEnd);
});

test('simulates 10,000 reserved calls in promotion, then restores the 1,000 cap', () => {
  const start = time;
  const promotionUntil = start + 86_400_000;
  const policy = { perMonth: 1000, perMinute: 120, promotionUntil, promotionLimit: 10_000 };
  let state = {};
  for (let i = 0; i < 10_000; i++) {
    const result = nextReservation(state, policy, start + i * 500);
    assert.ok(result.next);
    state = result.next;
  }
  assert.equal(nextReservation(state, policy, start + 5_000_000).retryAt, promotionUntil);
  const firstNormal = nextReservation(state, policy, promotionUntil);
  assert.equal(firstNormal.next.monthCount, 1);
  assert.equal(quotaWindows(Date.parse('2027-02-28T05:00:00Z'), 31).monthEnd, Date.parse('2027-03-31T05:00:00Z'));
});
