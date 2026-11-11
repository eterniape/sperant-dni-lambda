import { isDni } from '../domain/identity.mjs';

export const LOOKUP_PATH = '/v1/dni/consulta';

function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', ...headers,
    },
    body: JSON.stringify(body),
  };
}

function isIamAuthenticated(event) {
  const iam = event.requestContext?.authorizer?.iam;
  return typeof iam?.userId === 'string' && iam.userId.length > 0 && /^[0-9]{12}$/u.test(iam.accountId ?? '');
}

function parseBody(event) {
  if (typeof event.body !== 'string' || event.body.length > 2048) return null;
  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(body, 'utf8') > 1024) return null;
  try {
    const value = JSON.parse(body);
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === 1 && isDni(value.dni) ? value.dni : null;
  } catch {
    return null;
  }
}

export function createHttpHandler({ resolve, authenticate, log = () => {}, now = Date.now }) {
  return async function handle(event) {
    try {
      const authorized = authenticate ? await authenticate(event.headers?.authorization) : isIamAuthenticated(event);
      if (!authorized) {
        return authenticate
          ? response(401, { code: 'UNAUTHORIZED' }, { 'www-authenticate': 'Bearer' })
          : response(403, { code: 'FORBIDDEN' });
      }
      if (event.routeKey !== `POST ${LOOKUP_PATH}`) return response(404, { code: 'ROUTE_NOT_FOUND' });
      if (!/^application\/json(?:\s*;|$)/iu.test(event.headers?.['content-type'] ?? '')) {
        return response(415, { code: 'UNSUPPORTED_MEDIA_TYPE' });
      }
      const dni = parseBody(event);
      if (!dni) return response(400, { code: 'INVALID_DNI' });
      const result = await resolve(dni);
      switch (result.kind) {
        case 'found':
          return response(200, { status: 'found', data: result.data, provider: result.provider });
        case 'not_found':
          return response(404, { code: 'DNI_NOT_FOUND' });
        case 'unavailable': {
          const retry = result.retryAt;
          const headers = retry ? { 'retry-after': String(Math.max(1, Math.ceil((retry - now()) / 1000))) } : {};
          return response(503, {
            code: 'PROVIDERS_UNAVAILABLE', retryAt: retry ? new Date(retry).toISOString() : undefined,
          }, headers);
        }
        default:
          throw new Error('Unexpected lookup outcome');
      }
    } catch {
      log('http_error');
      return response(503, { code: 'SERVICE_UNAVAILABLE' }, { 'retry-after': '5' });
    }
  };
}
