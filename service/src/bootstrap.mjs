import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand, ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createTable, createQuotaStore } from './dni/infrastructure/dynamo.mjs';
import { createJobStore } from './dni/infrastructure/jobs.mjs';
import { createVault } from './dni/infrastructure/vault.mjs';
import { jsonSecret } from './dni/infrastructure/secret.mjs';
import { createProviders } from './dni/infrastructure/providers.mjs';
import { createProviderConfigLoader } from './dni/infrastructure/provider-config.mjs';
import { createLookups, createProcessor } from './dni/application/lookups.mjs';
import { createResolver } from './dni/application/resolve-dni.mjs';
import { createHttpHandler } from './dni/transport/http.mjs';
import { createSqsHandler } from './dni/transport/sqs.mjs';

const dynamo = new DynamoDBClient({ maxAttempts: 2 });
const sqs = new SQSClient({ maxAttempts: 2 });
const secrets = new SecretsManagerClient({ maxAttempts: 2 });
const send = (client, command) => client.send(command, { abortSignal: AbortSignal.timeout(3000) });
const table = (name) => createTable((op, params) => send(dynamo,
  op === 'GetItem' ? new GetItemCommand(params) : new PutItemCommand(params)), name);
const secret = (SecretId) => jsonSecret(async () => {
  const result = await send(secrets, new GetSecretValueCommand({ SecretId }));
  return result.SecretString;
});

const store = createJobStore(table(process.env.JOBS_TABLE));
const vault = createVault(secret(process.env.KEYRING_SECRET_ARN));
const queueUrl = process.env.QUEUE_URL;
const log = (event, provider) => console.log(JSON.stringify({ event, ...(provider ? { provider } : {}) }));

export const http = createHttpHandler({
  lookups: createLookups({
    store, vault,
    enqueue: ({ pk, generation }) => send(sqs, new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageGroupId: pk,
      MessageDeduplicationId: generation,
      MessageBody: JSON.stringify({ pk, generation }),
    })),
  }),
  log,
});

const quotas = createQuotaStore(table(process.env.QUOTAS_TABLE));
const loadProviderConfig = createProviderConfigLoader({ env: process.env, loadSecret: secret });
let cachedConfig;
let resolver;
const resolve = async (dni, misses) => {
  const config = await loadProviderConfig();
  if (config !== cachedConfig) {
    resolver = createResolver({ providers: createProviders(config), quotas, observe: log });
    cachedConfig = config;
  }
  return resolver(dni, misses);
};

export const worker = createSqsHandler({
  processLookup: createProcessor({ store, vault, resolve }),
  deferMessage: (ReceiptHandle, VisibilityTimeout) => send(sqs, new ChangeMessageVisibilityCommand({
    QueueUrl: queueUrl, ReceiptHandle, VisibilityTimeout,
  })),
  log,
});
