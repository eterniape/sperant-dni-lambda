import { setTimeout } from 'node:timers/promises';
import { nextReservation } from '../domain/quota.mjs';

function encode(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [
    name, typeof value === 'number' ? { N: String(value) } : { S: value },
  ]));
}

function decode(item) {
  if (!item) return null;
  return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, value.N === undefined ? value.S : Number(value.N)]));
}

export function createTable(send, tableName) {
  return {
    async read(pk) {
      const result = await send('GetItem', { TableName: tableName, Key: encode({ pk }), ConsistentRead: true });
      return decode(result.Item);
    },
    async put(item, condition, values = {}, names = {}) {
      try {
        await send('PutItem', {
          TableName: tableName, Item: encode(item), ConditionExpression: condition,
          ...(Object.keys(values).length ? { ExpressionAttributeValues: encode(values) } : {}),
          ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
        });
        return true;
      } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    },
  };
}

export function createQuotaStore(table, now = Date.now) {
  async function change(id, compute) {
    const pk = 'provider#' + id;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const state = await table.read(pk);
      const { next, retryAt } = compute(state ?? {}, now());
      if (!next) return retryAt ? { retryAt } : {};
      const written = await table.put(
        { ...next, pk, rev: (state?.rev ?? 0) + 1 },
        state ? 'rev = :rev' : 'attribute_not_exists(pk)',
        state ? { ':rev': state.rev } : {},
      );
      if (written) return {};
      await setTimeout(8 + Math.floor(Math.random() * (attempt + 1) * 12));
    }
    // No provider was called without its budget reservation.
    throw new Error('Quota reservation contention');
  }
  return {
    reserve: (policy) => change(policy.id, (state, timestamp) => nextReservation(state, policy, timestamp)),
    block: (id, until) => change(id, (state) => (state.blockedUntil ?? 0) >= until
      ? {} : { next: { ...state, blockedUntil: until } }),
  };
}
