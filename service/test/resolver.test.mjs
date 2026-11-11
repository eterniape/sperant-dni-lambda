import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResolver } from '../src/dni/application/resolve-dni.mjs';
import { quotaReset } from '../src/dni/domain/quota.mjs';

const time = Date.parse('2026-11-12T10:00:00Z');
const provider = (id, kind, extra = {}) => ({
  id,
  async lookup() { return { kind, ...extra }; },
});

test('tries providers in order and stops after finding a result', async () => {
  const calls = [];
  const resolver = createResolver({
    providers: [
      provider('a', 'temporary'),
      provider('b', 'quota', { retryAt: time + 60_000 }),
      provider('c', 'found', { data: 'names' }),
      { id: 'd', lookup() { assert.fail('Should stop after the first match'); } },
    ],
    observe: (kind, id) => calls.push([id, kind]),
  });
  assert.deepEqual(await resolver('00000001'), { kind: 'found', data: 'names', provider: 'c' });
  assert.deepEqual(calls, [['a', 'temporary'], ['b', 'quota'], ['c', 'found']]);
});

test('returns the earliest retry when a miss and provider limits occur together', async () => {
  const resolve = createResolver({
    providers: [
      provider('a', 'not_found'),
      provider('b', 'quota', { retryAt: time + 60_000 }),
      provider('c', 'rate_limit', { retryAt: time + 10_000 }),
    ],
  });
  assert.deepEqual(await resolve('00000001'), { kind: 'unavailable', retryAt: time + 10_000 });
});

test('returns not found only when every configured provider reports a miss', async () => {
  const resolve = createResolver({ providers: [provider('a', 'not_found'), provider('b', 'not_found')] });
  assert.deepEqual(await resolve('00000001'), { kind: 'not_found' });
  const empty = createResolver({ providers: [] });
  assert.deepEqual(await empty('00000001'), { kind: 'unavailable' });
});

test('estimates daily and monthly resets in Lima using the account billing day', () => {
  assert.equal(quotaReset(time, 12, true), Date.parse('2026-11-13T05:00:00Z'));
  assert.equal(quotaReset(time, 12, false), Date.parse('2026-12-12T05:00:00Z'));
  assert.equal(quotaReset(Date.parse('2027-02-28T05:00:00Z'), 31, false), Date.parse('2027-03-31T05:00:00Z'));
});
