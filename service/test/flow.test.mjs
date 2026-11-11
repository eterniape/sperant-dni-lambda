import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createHttpHandler, LOOKUP_PATH } from '../src/dni/transport/http.mjs';
import { createBearerAuthenticator } from '../src/dni/transport/bearer.mjs';

const iam = { accountId: '123456789012', userId: 'ARO123:session-1' };
const dni = '00000001';
const data = { nombres: 'Ana María', apellidoPaterno: 'De la Cruz', apellidoMaterno: null };
const post = (body = { dni }) => ({
  routeKey: `POST ${LOOKUP_PATH}`,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  requestContext: { authorizer: { iam } },
});

test('resolves in one POST and accepts only a string of eight digits', async () => {
  let calls = 0;
  const http = createHttpHandler({
    async resolve(input) {
      assert.equal(input, dni);
      calls += 1;
      return { kind: 'found', data, provider: 'factiliza' };
    },
  });
  for (const body of [{ dni: 1 }, { dni: '00000001\n' }, { dni, extra: true }]) {
    assert.equal((await http(post(body))).statusCode, 400);
  }
  assert.equal((await http({ ...post(), headers: {} })).statusCode, 415);
  assert.equal((await http({ ...post(), requestContext: {} })).statusCode, 403);
  assert.equal((await http({ ...post(), routeKey: `GET ${LOOKUP_PATH}/{id}` })).statusCode, 404);
  assert.equal(calls, 0);
  const result = await http(post());
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(result.body), { status: 'found', data, provider: 'factiliza' });
  assert.equal(calls, 1);
});

test('distinguishes a missing DNI from unavailable providers and supplies retry timing', async () => {
  const now = Date.parse('2026-11-12T10:00:00Z');
  const missing = await createHttpHandler({ resolve: async () => ({ kind: 'not_found' }) })(post());
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(JSON.parse(missing.body), { code: 'DNI_NOT_FOUND' });

  const unavailable = await createHttpHandler({
    resolve: async () => ({ kind: 'unavailable', retryAt: now + 86_400_000 }),
    now: () => now,
  })(post());
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.headers['retry-after'], '86400');
  assert.deepEqual(JSON.parse(unavailable.body), {
    code: 'PROVIDERS_UNAVAILABLE', retryAt: '2026-11-13T10:00:00.000Z',
  });
});

test('Bearer authentication gates the POST and rejects the old token after rotation', async () => {
  const firstToken = randomBytes(32).toString('base64url');
  let token = firstToken;
  let calls = 0;
  const http = createHttpHandler({
    authenticate: createBearerAuthenticator(async () => token),
    async resolve() {
      calls += 1;
      return { kind: 'found', data, provider: 'factiliza' };
    },
  });
  const event = post();
  const withToken = (value) => ({
    ...event, headers: { ...event.headers, authorization: `Bearer ${value}` },
  });

  const rejected = await http(event);
  assert.equal(rejected.statusCode, 401);
  assert.equal(rejected.headers['www-authenticate'], 'Bearer');
  assert.equal(calls, 0);
  assert.equal((await http(withToken(firstToken))).statusCode, 200);
  token = randomBytes(32).toString('base64url');
  assert.equal((await http(withToken(firstToken))).statusCode, 401);
  assert.equal((await http(withToken(token))).statusCode, 200);
  token = null;
  assert.equal((await http(withToken(firstToken))).statusCode, 503);
  assert.equal(calls, 2);
});
