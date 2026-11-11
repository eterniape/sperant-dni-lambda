import { randomBytes, randomUUID } from 'node:crypto';
import { linkSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { createProviderConfigLoader } from '../service/src/dni/infrastructure/provider-config.mjs';
import { createProviders } from '../service/src/dni/infrastructure/providers.mjs';
import { isClientToken } from '../service/src/dni/transport/bearer.mjs';

function readPrivateFile(path) {
  const file = lstatSync(path);
  if (!file.isFile() || (file.mode & 0o077) !== 0) {
    throw new Error(`Se necesita un archivo regular con permisos privados: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

function writePrivateJson(path, value, { replace }) {
  const temporary = `${path}.${randomUUID()}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    if (replace) renameSync(temporary, path);
    else linkSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function keepOrCreateSecret(path, create, validate) {
  try {
    const secret = JSON.parse(readPrivateFile(path));
    if (!validate(secret)) throw new Error(`El archivo privado no tiene el formato esperado: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    writePrivateJson(path, create(), { replace: false });
  }
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { values } = parseArgs({
    options: {
      stage: { type: 'string' },
      'env-file': { type: 'string', default: resolve(root, '.env') },
    },
  });
  const stage = values.stage;
  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(stage ?? '')) {
    throw new Error('Indica un entorno válido, por ejemplo --stage prod');
  }
  const env = parseEnv(readPrivateFile(resolve(values['env-file'])));
  const loadConfig = createProviderConfigLoader({
    env,
    loadSecret: () => { throw new Error('El archivo local debe contener las variables DNI_TOKEN de los proveedores'); },
  });
  const config = await loadConfig();
  const providers = createProviders(config);
  if (!providers.length) throw new Error('Configura al menos un token real en el archivo .env');

  const target = resolve(root, '.local/deploy', stage);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  keepOrCreateSecret(resolve(target, 'client-auth.json'),
    () => ({ token: randomBytes(32).toString('base64url') }),
    (secret) => isClientToken(secret?.token));
  writePrivateJson(resolve(target, 'providers.json'), config, { replace: true });

  console.log(`Proveedores: ${providers.map(({ id }) => id).join(', ')}`);
  console.log(`Archivos privados para Secrets Manager: ${target}/providers.json y ${target}/client-auth.json`);
}

try {
  await main();
} catch (error) {
  // Never print input values or parse errors that could include parts of a secret.
  if (error instanceof SyntaxError) console.error('Un archivo privado no contiene JSON válido.');
  else console.error(error.message);
  process.exitCode = 1;
}
