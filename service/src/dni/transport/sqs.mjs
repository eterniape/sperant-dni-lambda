import { isLookupId } from '../domain/identity.mjs';

export function createSqsHandler({ processLookup, deferMessage, log = () => {}, now = Date.now }) {
  return async function handle(event) {
    // FIFO with one record per batch and separate message groups for separate lookups.
    const batchItemFailures = [];
    for (const record of event.Records) {
      try {
        const job = JSON.parse(record.body);
        if (typeof job?.pk !== 'string' || !/^lookup#[a-f0-9]{64}$/u.test(job.pk) || !isLookupId(job.generation)) {
          throw new Error('Invalid lookup message');
        }
        const result = await processLookup(job);
        if (result.kind === 'deferred') {
          const seconds = Math.max(1, Math.min(900, Math.ceil((result.retryAt - now()) / 1000)));
          await deferMessage(record.receiptHandle, seconds);
          batchItemFailures.push({ itemIdentifier: record.messageId });
        } else if (result.kind !== 'done') {
          batchItemFailures.push({ itemIdentifier: record.messageId });
        }
      } catch {
        log('worker_error');
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}
