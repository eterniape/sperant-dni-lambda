import { makeIdentity, isDni } from '../domain/identity.mjs';
import { quotaWindows } from '../domain/quota.mjs';

const camel = (r) => ({ dni: r?.dni, names: r?.nombres, firstSurname: r?.apellidoPaterno, secondSurname: r?.apellidoMaterno });
const snake = (r, dni = r?.dni) => ({ dni, names: r?.nombres, firstSurname: r?.apellido_paterno, secondSurname: r?.apellido_materno });
const specs = new Map([
  ['apisperu', {
    perMonth: 1000, perMinute: 120,
    url: (dni) => new URL(`https://dniruc.apisperu.com/api/v1/dni/${dni}`),
    auth: (url, headers, token) => url.searchParams.set('token', token),
    map: (body) => body?.success === false ? {} : camel(body),
  }],
  ['intifact', {
    perMonth: 100, perMinute: 30,
    url: (dni) => new URL(`https://api-consultas.intifact.com/api/v1/dni/${dni}`),
    map: (body) => body?.success === true ? camel(body.data) : {},
  }],
  ['factiliza', {
    perMonth: 100, perMinute: 30,
    url: (dni) => new URL(`https://api.factiliza.com/v1/dni/info/${dni}`),
    map: (body) => body?.success === true ? snake(body.data, body.data?.numero) : {},
  }],
  ['peruapi-com', {
    perMonth: 1000, perDay: 50, perMinute: 10,
    url: (dni) => new URL(`https://peruapi.com/api/dni/${dni}`),
    auth: (url, headers, token) => { headers['X-API-KEY'] = token; },
    map: (body) => String(body?.code) === '200' ? snake(body) : {},
  }],
  ['peruapi-net', {
    perMonth: 50, perMinute: 60,
    url: (dni) => new URL(`https://peruapi.net/api/public/v1/dni?number=${dni}`),
    auth: (url, headers, token) => { headers['X-API-KEY'] = token; },
    map: (body) => body?.success === true && body.data?.result?.desglose_exacto === true
      ? snake(body.data.result) : {},
  }],
]);

async function readJson(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    reader.releaseLock();
  }
}

function retryAfter(value, now) {
  if (!value) return;
  const date = /^[0-9]+$/u.test(value) ? now + Number(value) * 1000 : Date.parse(value);
  if (Number.isFinite(date) && date > now) return Math.min(date, now + 45 * 86_400_000);
}

function interpret(response, body, policy, now) {
  const code = String(body?.error?.code ?? body?.error ?? body?.code ?? body?.status ?? '').toLowerCase();
  const message = String(body?.message ?? body?.mensaje ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const headerRetry = retryAfter(response.headers.get('retry-after'), now);
  const quotaHit = code === 'quota_exceeded' ||
    /(?:cuota|quota|cupo).{0,25}(?:agot|exced|alcanz)|(?:agot|exced|alcanz).{0,45}(?:cuota|quota|cupo|limite de (?:consultas|peticiones))|limite mensual/u.test(message);
  if (quotaHit) {
    const windows = quotaWindows(now, policy.billingDay);
    const daily = /diari|daily/u.test(message);
    const until = headerRetry ?? (daily ? windows.dayEnd : windows.monthEnd);
    return { kind: 'quota', blockUntil: until, retryAt: until };
  }
  if (response.status === 429 || code === '429' || code === 'rate_limited') {
    const until = headerRetry ?? now + 60_000;
    return { kind: 'rate_limit', blockUntil: until, retryAt: until };
  }
  if ([401, 403].includes(response.status) || ['401', '403'].includes(code)) {
    if (code === 'service_maintenance') return { kind: 'temporary', retryAt: headerRetry };
    return { kind: 'auth', blockUntil: now + 60_000 };
  }
  if ((response.status === 404 && body && typeof body === 'object' && !Array.isArray(body)) ||
    code === 'dni_not_found' ||
    (body?.success === false && /(?:dni|documento|persona|registro).{0,24}(?:no encontrad|no existe)|no se encontr[oó].{0,12}(?:dni|documento|persona|registro)/u.test(message))) {
    return { kind: 'not_found' };
  }
  if (!response.ok || !body) return { kind: 'temporary', retryAt: headerRetry };
}

function limit(value, ceiling) {
  if (value === undefined) return ceiling;
  if (!Number.isSafeInteger(value) || value < 1 || (ceiling !== undefined && value > ceiling)) {
    throw new Error('Invalid provider limit');
  }
  return value;
}

export function createProviders(config, { fetchImpl = fetch, now = Date.now, timeoutMs = 2300 } = {}) {
  if (!Array.isArray(config.providers) || config.providers.length > specs.size) {
    throw new Error('Invalid providers configuration');
  }
  const seen = new Set();
  return config.providers.map(({ id, token, perMonth, perDay, perMinute, billingDay = 1, promotionUntil, promotionLimit }) => {
    const spec = specs.get(id);
    if (!spec || seen.has(id) || typeof token !== 'string' || !token.trim() || token === 'REEMPLAZAR' || /[\x00-\x20\x7f]/u.test(token) ||
      !Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) {
      throw new Error('Invalid provider configuration');
    }
    seen.add(id);
    const end = typeof promotionUntil === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(promotionUntil)
      ? Date.parse(promotionUntil) : undefined;
    if ((promotionUntil !== undefined || promotionLimit !== undefined) &&
      (id !== 'apisperu' || !Number.isFinite(end) || !Number.isSafeInteger(promotionLimit) || promotionLimit < 1)) {
      throw new Error('Invalid promotion configuration');
    }
    const policy = {
      id, billingDay, promotionUntil: end, promotionLimit,
      perMonth: limit(perMonth, spec.perMonth), perDay: limit(perDay, spec.perDay), perMinute: limit(perMinute, spec.perMinute),
    };
    return {
      id, policy,
      async lookup(dni) {
        if (!isDni(dni)) throw new Error('Invalid lookup input');
        const url = spec.url(dni);
        const headers = { Accept: 'application/json' };
        if (spec.auth) spec.auth(url, headers, token);
        else headers.Authorization = `Bearer ${token}`;
        try {
          const response = await fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
          const body = await readJson(response).catch((err) => {
            if (err instanceof SyntaxError) return null;
            throw err;
          });
          const failure = interpret(response, body, policy, now());
          if (failure) return failure;
          const data = makeIdentity(dni, spec.map(body));
          return data ? { kind: 'found', data } : { kind: 'invalid_response' };
        } catch {
          // A fetch error can include a URL containing the DNI and, for APIsPERU, the token.
          return { kind: 'temporary' };
        }
      },
    };
  });
}
