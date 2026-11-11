import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

// The previous key stays available until all jobs encrypted with it have expired.
export function createVault(loadKeyring) {
  function key(ring, id) {
    const value = Object.hasOwn(ring.keys ?? {}, id) ? ring.keys[id] : null;
    if (typeof value !== 'string' || !/^[a-zA-Z0-9+/]{43}=$/u.test(value)) {
      throw new Error('Invalid encryption key configuration');
    }
    return Buffer.from(value, 'base64');
  }
  async function findKey(id) {
    let ring = await loadKeyring();
    if (!Object.hasOwn(ring.keys ?? {}, id)) ring = await loadKeyring(true);
    return key(ring, id);
  }
  return {
    async fingerprint(value, scope, existing) {
      const id = existing ? existing.split('.')[0] : (await loadKeyring()).current;
      const mac = createHmac('sha256', await findKey(id))
        .update(JSON.stringify(['sperant-dni-idempotency-v1', scope, value])).digest('base64url');
      return id + '.' + mac;
    },
    async seal(value, associatedData) {
      const ring = await loadKeyring();
      const id = ring.current;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/u.test(id)) throw new Error('Invalid key ID');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key(ring, id), iv);
      cipher.setAAD(Buffer.from(associatedData));
      const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return [id, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
    },
    async open(envelope, associatedData) {
      const [id, iv, tag, body] = envelope.split('.');
      // A warm process can encounter a new key immediately after rotation.
      const decipher = createDecipheriv('aes-256-gcm', await findKey(id), Buffer.from(iv, 'base64url'), { authTagLength: 16 });
      decipher.setAAD(Buffer.from(associatedData));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8'));
    },
  };
}
