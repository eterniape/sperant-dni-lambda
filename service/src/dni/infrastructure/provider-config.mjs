// Preserve the documented priority when providers are configured with individual variables.
const tokens = [
  ['apisperu', 'DNI_TOKEN_APISPERU'],
  ['intifact', 'DNI_TOKEN_INTIFACT'],
  ['factiliza', 'DNI_TOKEN_FACTILIZA'],
  ['peruapi-com', 'DNI_TOKEN_PERUAPI_COM'],
];

export function createProviderConfigLoader({ env, loadSecret }) {
  const arn = env.PROVIDERS_SECRET_ARN?.trim();
  if (arn) return loadSecret(arn);

  const providers = [];
  for (const [id, variable] of tokens) {
    const token = env[variable];
    if (!token?.trim()) continue;
    const provider = { id, token };
    if (id === 'peruapi-com' && env.DNI_PERUAPI_COM_BILLING_DAY) {
      provider.billingDay = Number(env.DNI_PERUAPI_COM_BILLING_DAY);
    }
    providers.push(provider);
  }

  const config = { providers };
  return async () => config;
}
