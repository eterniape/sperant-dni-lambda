export function createJobStore(table, now = Date.now) {
  const live = (row) => row && row.expiresAt * 1000 > now();
  return {
    async create(row) {
      const created = await table.put(row, 'attribute_not_exists(pk) OR expiresAt <= :now', {
        ':now': Math.floor(now() / 1000),
      });
      return created ? row : table.read(row.pk);
    },
    async read(pk) {
      const row = await table.read(pk);
      return live(row) ? row : null;
    },
    async claim(pk, generation, leaseId) {
      const row = await table.read(pk);
      if (!live(row) || row.generation !== generation || !row.input) return { kind: 'done' };
      const timestamp = now();
      if (row.retryAt > timestamp) return { kind: 'deferred', retryAt: row.retryAt };
      if (row.leaseUntil > timestamp) return { kind: 'locked' };
      const lease = { ...row, leaseId, leaseUntil: timestamp + 65_000 };
      const won = await table.put(lease,
        'generation = :generation AND attribute_exists(#input) AND expiresAt > :now AND ' +
        '(attribute_not_exists(retryAt) OR retryAt <= :time) AND ' +
        '(attribute_not_exists(leaseUntil) OR leaseUntil <= :time)',
        { ':generation': generation, ':now': Math.floor(timestamp / 1000), ':time': timestamp }, { '#input': 'input' });
      return won ? { kind: 'claimed', row: lease } : { kind: 'locked' };
    },
    defer(row, retryAt, misses) {
      const { leaseId, leaseUntil, ...rest } = row;
      return table.put({ ...rest, retryAt, misses: JSON.stringify(misses), defers: (row.defers ?? 0) + 1 },
        'generation = :generation AND leaseId = :lease', { ':generation': row.generation, ':lease': leaseId });
    },
    finish(row, output, status) {
      const { pk, generation, expiresAt, fingerprint, leaseId } = row;
      return table.put({ pk, generation, expiresAt, fingerprint, status, output },
        'generation = :generation AND leaseId = :lease', { ':generation': generation, ':lease': leaseId });
    },
  };
}
