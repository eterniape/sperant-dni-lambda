import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProviderConfigLoader } from '../src/dni/infrastructure/provider-config.mjs';
import { createProviders } from '../src/dni/infrastructure/providers.mjs';

test('configured environment tokens activate only their providers in priority order', async () => {
  const load = createProviderConfigLoader({
    env: {
      DNI_TOKEN_FACTILIZA: 'test-factiliza',
      DNI_TOKEN_APISPERU: 'test-apisperu',
    },
    loadSecret: () => assert.fail('No ARN was configured'),
  });

  const config = await load();
  const providers = createProviders(config);
  assert.deepEqual(providers.map(({ id }) => id), ['apisperu', 'factiliza']);
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
