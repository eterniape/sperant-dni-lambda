import { timingSafeEqual } from 'node:crypto';

export function isClientToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export function createBearerAuthenticator(loadToken) {
  return async function authenticate(header) {
    const match = typeof header === 'string' && /^Bearer (.+)$/i.exec(header);
    if (!match || !isClientToken(match[1])) return false;
    const expected = await loadToken();
    if (!isClientToken(expected)) throw new Error('Invalid client token configuration');
    return timingSafeEqual(Buffer.from(match[1], 'ascii'), Buffer.from(expected, 'ascii'));
  };
}
