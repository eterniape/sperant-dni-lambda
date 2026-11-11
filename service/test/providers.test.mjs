import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProviders } from '../src/dni/infrastructure/providers.mjs';

const dni = '00000001';
const camel = { dni, nombres: 'Ana  María', apellidoPaterno: 'De la Cruz', apellidoMaterno: null };
const snake = { dni, nombres: 'Ana  María', apellido_paterno: 'De la Cruz', apellido_materno: null };
const expected = { kind: 'found', data: { nombres: 'Ana María', apellidoPaterno: 'De la Cruz', apellidoMaterno: null } };

for (const [id, path, body, auth] of [
  ['apisperu', '/api/v1/dni/00000001', { ...camel, codVerifica: '7' }, 'query'],
  ['factiliza', '/v1/dni/info/00000001', { success: true, data: { ...snake, numero: dni, direccion: 'Omitir' } }, 'bearer'],
]) {
  test(`${id} uses the documented contract and returns only normalized names`, async () => {
    const [provider] = createProviders({ providers: [{ id, token: 'test-token' }] }, {
      fetchImpl: async (url, options) => {
        assert.equal(url.protocol, 'https:');
        assert.equal(url.pathname, path);
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal instanceof AbortSignal);
        if (auth === 'query') assert.equal(url.searchParams.get('token'), 'test-token');
        else assert.equal(options.headers.Authorization, 'Bearer test-token');
        return Response.json(body);
      },
    });
    assert.deepEqual(await provider.lookup(dni), expected);
  });
}

test('separates 404, invalid payload, quota, rate limit, invalid credential and timeouts', async () => {
  const now = Date.parse('2026-11-12T02:00:00Z');
  for (const [makeResponse, kind, until] of [
    [() => Response.json({ success: false }, { status: 404 }), 'not_found'],
    [() => Response.json({ success: false, message: 'No se encontraron resultados.' }), 'not_found'],
    [() => new Response('<html>Proxy error</html>', { status: 404 }), 'temporary'],
    [() => Response.json({ ...camel, dni: '00000002' }), 'invalid_response'],
    [() => Response.json({ success: false, message: 'Cuota mensual agotada' }), 'quota', Date.parse('2026-12-01T05:00:00Z')],
    [() => Response.json({}, { status: 429, headers: { 'retry-after': '12' } }), 'rate_limit', now + 12000],
    [() => new Response('', { status: 401 }), 'auth'],
    [() => { throw new Error('upstream error containing sensitive info'); }, 'temporary'],
    [() => new Response('x'.repeat(33_000)), 'temporary'],
  ]) {
    const [provider] = createProviders({ providers: [{ id: 'apisperu', token: 'test' }] }, { fetchImpl: makeResponse, now: () => now });
    const result = await provider.lookup(dni);
    assert.equal(result.kind, kind);
    assert.equal(result.retryAt, until);
  }
});

test('rejects invalid provider configuration', () => {
  assert.throws(() => createProviders({ providers: [{ id: 'factiliza', token: 'test', billingDay: 32 }] }));
  assert.throws(() => createProviders({ providers: [{ id: 'apisperu', token: 'REEMPLAZAR' }] }));
});

test('ignores the retired provider in existing secrets and keeps the supported providers', () => {
  const providers = createProviders({ providers: [
    { id: 'apisperu', token: 'test-apisperu' },
    { id: 'factiliza', token: 'test-factiliza' },
    { id: 'peruapi-com', token: 'test-retired', billingDay: 11 },
  ] });
  assert.deepEqual(providers.map(({ id }) => id), ['apisperu', 'factiliza']);
});
