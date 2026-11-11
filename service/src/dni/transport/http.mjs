import { isDni, isLookupId } from '../domain/identity.mjs';

const BASE = '/v1/dni/lookups';

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

function ownerOf(event) {
  const iam = event.requestContext?.authorizer?.iam;
  if (typeof iam?.userId !== 'string' || !iam.userId || !/^[0-9]{12}$/u.test(iam.accountId ?? '')) return null;
  // STS appends a session name to the stable IAM role ID. One role is one access boundary.
  return `${iam.accountId}:${iam.userId.split(':')[0]}`;
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

export function createHttpHandler({ lookups, log = () => {}, now = Date.now }) {
  return async function handle(event) {
    const owner = ownerOf(event);
    if (!owner) return response(403, { code: 'FORBIDDEN' });
    try {
      if (event.routeKey === `POST ${BASE}`) {
        if (!/^application\/json(?:\s*;|$)/iu.test(event.headers?.['content-type'] ?? '')) {
          return response(415, { code: 'UNSUPPORTED_MEDIA_TYPE' });
        }
        const id = event.headers?.['idempotency-key'];
        if (!isLookupId(id)) return response(400, { code: 'INVALID_IDEMPOTENCY_KEY' });
        const dni = parseBody(event);
        if (!dni) return response(400, { code: 'INVALID_DNI' });
        const result = await lookups.submit(owner, id, dni);
        if (result.kind === 'conflict') return response(409, { code: 'IDEMPOTENCY_CONFLICT' });
        const prefix = event.requestContext?.stage && event.requestContext.stage !== '$default'
          ? '/' + encodeURIComponent(event.requestContext.stage) : '';
        return response(202, { id, expiresAt: result.expiresAt }, { location: `${prefix}${BASE}/${id}`, 'retry-after': '2' });
      }
      if (event.routeKey !== `GET ${BASE}/{id}`) return response(404, { code: 'ROUTE_NOT_FOUND' });
      const id = event.pathParameters?.id;
      if (!isLookupId(id)) return response(404, { code: 'LOOKUP_NOT_FOUND' });
      const result = await lookups.read(owner, id);
      const expiresAt = result.expiresAt;
      const retryAt = result.retryAt ? new Date(result.retryAt).toISOString() : undefined;
      switch (result.kind) {
        case 'pending':
          return response(202, { id, status: 'pending', retryAt, expiresAt }, {
            'retry-after': String(result.retryAt ? Math.max(2, Math.ceil((result.retryAt - now()) / 1000)) : 2),
          });
        case 'found':
          return response(200, { id, status: 'found', data: result.data, provider: result.provider, expiresAt });
        case 'not_found':
          return response(404, { id, code: 'DNI_NOT_FOUND', expiresAt });
        case 'missing':
          return response(404, { code: 'LOOKUP_NOT_FOUND' });
        case 'unavailable':
          return response(503, { id, code: 'PROVIDERS_UNAVAILABLE', retryAt, expiresAt });
        default:
          throw new Error('Unexpected lookup outcome');
      }
    } catch {
      log('http_error');
      return response(503, { code: 'SERVICE_UNAVAILABLE' }, { 'retry-after': '5' });
    }
  };
}
