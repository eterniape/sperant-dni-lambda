import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { jsonSecret } from './dni/infrastructure/secret.mjs';
import { createProviders } from './dni/infrastructure/providers.mjs';
import { createProviderConfigLoader } from './dni/infrastructure/provider-config.mjs';
import { createResolver } from './dni/application/resolve-dni.mjs';
import { createHttpHandler } from './dni/transport/http.mjs';
import { createBearerAuthenticator } from './dni/transport/bearer.mjs';

const secrets = new SecretsManagerClient({ maxAttempts: 2 });
const secret = (SecretId) => jsonSecret(async () => {
  const result = await secrets.send(new GetSecretValueCommand({ SecretId }), { abortSignal: AbortSignal.timeout(3000) });
  return result.SecretString;
});

const log = (event, provider) => console.log(JSON.stringify({ event, ...(provider ? { provider } : {}) }));
const clientSecretArn = process.env.CLIENT_AUTH_SECRET_ARN;
const loadClientSecret = clientSecretArn ? secret(clientSecretArn) : undefined;
const loadProviderConfig = createProviderConfigLoader({ env: process.env, loadSecret: secret });

export const http = createHttpHandler({
  authenticate: loadClientSecret
    ? createBearerAuthenticator(async () => (await loadClientSecret()).token)
    : undefined,
  async resolve(dni) {
    const providers = createProviders(await loadProviderConfig());
    return createResolver({ providers, observe: log })(dni);
  },
  log,
});
