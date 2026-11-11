import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createLookups, createProcessor } from '../src/dni/application/lookups.mjs';
import { createJobStore } from '../src/dni/infrastructure/jobs.mjs';
import { createVault } from '../src/dni/infrastructure/vault.mjs';
import { createHttpHandler } from '../src/dni/transport/http.mjs';
import { createSqsHandler } from '../src/dni/transport/sqs.mjs';

const route = '/v1/dni/lookups';
const identity = { accountId: '123456789012', userId: 'ARO123:session-1' };
const get = (id, iam = identity) => ({
  routeKey: `GET ${route}/{id}`, pathParameters: { id }, requestContext: { authorizer: { iam } },
});
const post = (id, body) => ({
  routeKey: `POST ${route}`, headers: { 'content-type': 'application/json', 'idempotency-key': id },
  body: JSON.stringify(body), requestContext: { authorizer: { iam: identity } },
});

function setup(resolve) {
  let time = Date.parse('2026-11-11T10:00:00Z');
  const now = () => time;
  const keyring = { current: 'v1', keys: { v1: randomBytes(32).toString('base64') } };
  const vault = createVault(async () => keyring);
  const rows = new Map();
  const store = createJobStore({
    read: async (pk) => rows.get(pk) ?? null,
    put: async (item, condition, attrs, names) => {
      const row = rows.get(item.pk);
      if (condition.startsWith('attribute_not_exists(pk)')) {
        if (row && row.expiresAt > attrs[':now']) return false;
      } else if (!row || row.generation !== attrs[':generation'] ||
        ((names?.['#input'] === 'input' && condition.includes('attribute_exists(#input)')) &&
          (!row.input || row.expiresAt <= attrs[':now'] || row.retryAt > attrs[':time'] || row.leaseUntil > attrs[':time'])) ||
        (attrs[':lease'] && row.leaseId !== attrs[':lease'])) return false;
      rows.set(item.pk, item);
      return true;
    },
  }, now);
  const queue = [];
  const defer = [];
  const http = createHttpHandler({
    lookups: createLookups({ store, vault, enqueue: async (job) => queue.push(job), now }), now,
  });
  const worker = createSqsHandler({
    processLookup: createProcessor({ store, vault, resolve, now, random: () => 0 }),
    deferMessage: async (...args) => defer.push(args), now,
  });
  return { http, worker, queue, rows, defer, now, advance: (ms) => { time += ms; } };
}

const event = (job) => ({ Records: [{ body: JSON.stringify(job), messageId: 'msg', receiptHandle: 'receipt' }] });

test('submits, processes once under duplicate delivery, and protects result by role and TTL', async () => {
  let calls = 0;
  const sys = setup(async (dni) => {
    calls += 1;
    assert.equal(dni, '00000001');
    return { kind: 'found', data: { nombres: 'Ana María', apellidoPaterno: 'De la Cruz', apellidoMaterno: null }, provider: 'apisperu' };
  });
  const id = randomUUID();
  assert.equal((await sys.http(post(id, { dni: 1 }))).statusCode, 400);
  assert.equal((await sys.http(post(id, { dni: '00000001\n' }))).statusCode, 400);
  const accepted = await sys.http(post(id, { dni: '00000001' }));
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.headers.location, route + '/' + id);
  assert.equal((await sys.http(get(id))).statusCode, 202);
  assert.equal((await sys.http(post(id, { dni: '00000002' }))).statusCode, 409);
  assert.equal((await sys.http(get(id, { ...identity, userId: 'ARO456:session-1' }))).statusCode, 404);
  assert.equal(JSON.stringify(sys.queue).includes('00000001'), false);
  await Promise.all([sys.worker(event(sys.queue[0])), sys.worker(event(sys.queue[0]))]);
  assert.equal(calls, 1);
  assert.equal((await sys.http(post(id, { dni: '00000001' }))).statusCode, 202);
  assert.equal(sys.queue.length, 1);
  const result = await sys.http(get(id, { ...identity, userId: 'ARO123:session-2' }));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).data.apellidoPaterno, 'De la Cruz');
  assert.equal([...sys.rows.values()][0].input, undefined);
  assert.equal(JSON.stringify([...sys.rows.values()]).includes('Ana María'), false);
  sys.advance(86_400_000);
  assert.equal((await sys.http(get(id))).statusCode, 404);
  assert.equal((await sys.http({ ...get(id), requestContext: {} })).statusCode, 403);
});

test('defers rate-limited jobs without deleting the SQS message and reuses prior misses', async () => {
  let sys;
  sys = setup(async (dni, misses) => misses.length
    ? { kind: 'not_found' }
    : { kind: 'unavailable', retryAt: sys.now() + 20_000, misses: ['primary'] });
  const id = randomUUID();
  await sys.http(post(id, { dni: '00000001' }));
  const batch = event(sys.queue[0]);
  assert.deepEqual(await sys.worker(batch), { batchItemFailures: [{ itemIdentifier: 'msg' }] });
  assert.deepEqual(sys.defer, [['receipt', 20]]);
  assert.equal((await sys.http(get(id))).headers['retry-after'], '20');
  sys.advance(20_000);
  assert.deepEqual(await sys.worker(batch), { batchItemFailures: [] });
  const final = await sys.http(get(id));
  assert.equal(final.statusCode, 404);
  assert.equal(JSON.parse(final.body).code, 'DNI_NOT_FOUND');
});

test('monthly exhaustion stays unavailable with a retry date rather than a false 404', async () => {
  let sys;
  sys = setup(async () => ({ kind: 'unavailable', retryAt: sys.now() + 86_400_000, misses: ['primary'] }));
  const id = randomUUID();
  await sys.http(post(id, { dni: '00000001' }));
  assert.deepEqual(await sys.worker(event(sys.queue[0])), { batchItemFailures: [] });
  const final = await sys.http(get(id));
  assert.equal(final.statusCode, 503);
  assert.equal(JSON.parse(final.body).retryAt, '2026-11-12T10:00:00.000Z');
});

test('key rotation reads old jobs, and authentication fails if ciphertext is swapped', async () => {
  const k1 = randomBytes(32).toString('base64');
  let ring = { current: 'v1', keys: { v1: k1 } };
  const vault = createVault(async () => ring);
  const encrypted = await vault.seal('00000001', 'original');
  ring = { current: 'v2', keys: { v1: k1, v2: randomBytes(32).toString('base64') } };
  assert.equal(await vault.open(encrypted, 'original'), '00000001');
  await assert.rejects(vault.open(encrypted, 'different'));
});
