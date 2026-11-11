import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProviderConfigLoader } from '../src/dni/infrastructure/provider-config.mjs';
import { createProviders } from '../src/dni/infrastructure/providers.mjs';

test('configured environment tokens activate only their providers in priority order', async () => {
  const load = createProviderConfigLoader({
    env: {
      DNI_TOKEN_PERUAPI_NET: 'test-net',
      DNI_TOKEN_PERUAPI_COM: 'test-com',
      DNI_TOKEN_FACTILIZA: 'test-factiliza',
      DNI_TOKEN_INTIFACT: '',
      DNI_TOKEN_APISPERU: 'test-apisperu',
      DNI_PERUAPI_COM_BILLING_DAY: '21',
      DNI_APISPERU_PROMOTION_UNTIL: '2026-12-11T23:59:59-05:00',
      DNI_APISPERU_PROMOTION_LIMIT: '10000',
    },
    loadSecret: () => assert.fail('No ARN was configured'),
  });

  const providers = createProviders(await load());
  assert.deepEqual(providers.map(({ id }) => id), ['apisperu', 'factiliza', 'peruapi-com', 'peruapi-net']);
  assert.equal(providers[0].policy.promotionLimit, 10000);
  assert.equal(providers[2].policy.billingDay, 21);
});

test('Secrets Manager takes precedence; a secret failure does not switch accounts silently', async () => {
  const load = createProviderConfigLoader({
    env: { PROVIDERS_SECRET_ARN: ' test-secret-arn ', DNI_TOKEN_FACTILIZA: 'test-env-token' },
    loadSecret: (arn) => {
      assert.equal(arn, 'test-secret-arn');
      return async () => { throw new Error('Secret unavailable'); };
    },
  });
  await assert.rejects(load, /Secret unavailable/);
});
