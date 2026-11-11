// Preserve the documented priority when providers are configured with individual variables.
const tokens = [
  ['apisperu', 'DNI_TOKEN_APISPERU'],
  ['factiliza', 'DNI_TOKEN_FACTILIZA'],
];

export function createProviderConfigLoader({ env, loadSecret }) {
  const arn = env.PROVIDERS_SECRET_ARN?.trim();
  if (arn) return loadSecret(arn);

  const providers = [];
  for (const [id, variable] of tokens) {
    const token = env[variable];
    if (!token?.trim()) continue;
    providers.push({ id, token });
  }

  const config = { providers };
  return async () => config;
}
