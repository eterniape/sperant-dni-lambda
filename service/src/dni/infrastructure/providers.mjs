import { makeIdentity, isDni } from '../domain/identity.mjs';
import { quotaReset } from '../domain/quota.mjs';

const camel = (r) => ({ dni: r?.dni, names: r?.nombres, firstSurname: r?.apellidoPaterno, secondSurname: r?.apellidoMaterno });
const snake = (r, dni = r?.dni) => ({ dni, names: r?.nombres, firstSurname: r?.apellido_paterno, secondSurname: r?.apellido_materno });
const specs = new Map([
  ['apisperu', {
    url: (dni) => new URL(`https://dniruc.apisperu.com/api/v1/dni/${dni}`),
    auth: (url, headers, token) => url.searchParams.set('token', token),
    map: (body) => body?.success === false ? {} : camel(body),
  }],
  ['intifact', {
    url: (dni) => new URL(`https://api-consultas.intifact.com/api/v1/dni/${dni}`),
    map: (body) => body?.success === true ? camel(body.data) : {},
  }],
  ['factiliza', {
    url: (dni) => new URL(`https://api.factiliza.com/v1/dni/info/${dni}`),
    map: (body) => body?.success === true ? snake(body.data, body.data?.numero) : {},
  }],
  ['peruapi-com', {
    url: (dni) => new URL(`https://peruapi.com/api/dni/${dni}`),
    auth: (url, headers, token) => { headers['X-API-KEY'] = token; },
    map: (body) => String(body?.code) === '200' ? snake(body) : {},
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

function interpret(response, body, billingDay, now) {
  const code = String(body?.error?.code ?? body?.error ?? body?.code ?? body?.status ?? '').toLowerCase();
  const message = String(body?.message ?? body?.mensaje ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const headerRetry = retryAfter(response.headers.get('retry-after'), now);
  const quotaHit = code === 'quota_exceeded' ||
    /(?:cuota|quota|cupo).{0,25}(?:agot|exced|alcanz)|(?:agot|exced|alcanz).{0,45}(?:cuota|quota|cupo|limite de (?:consultas|peticiones))|limite mensual/u.test(message);
  if (quotaHit) {
    const daily = /diari|daily/u.test(message);
    return { kind: 'quota', retryAt: headerRetry ?? quotaReset(now, billingDay, daily) };
  }
  if (response.status === 429 || code === '429' || code === 'rate_limited') {
    return { kind: 'rate_limit', retryAt: headerRetry ?? now + 60_000 };
  }
  if ([401, 403].includes(response.status) || ['401', '403'].includes(code)) {
    if (code === 'service_maintenance') return { kind: 'temporary', retryAt: headerRetry };
    return { kind: 'auth' };
  }
  if ((response.status === 404 && body && typeof body === 'object' && !Array.isArray(body)) ||
    code === 'dni_not_found' ||
    (body?.success === false && /(?:dni|documento|persona|registro).{0,24}(?:no encontrad|no existe)|no se encontr[oó].{0,12}(?:dni|documento|persona|registro)/u.test(message))) {
    return { kind: 'not_found' };
  }
  if (!response.ok || !body) return { kind: 'temporary', retryAt: headerRetry };
}

export function createProviders(config, { fetchImpl = fetch, now = Date.now, timeoutMs = 2300 } = {}) {
  if (!Array.isArray(config.providers) || config.providers.length > specs.size) {
    throw new Error('Invalid providers configuration');
  }
  const seen = new Set();
  return config.providers.map(({ id, token, billingDay = 1 }) => {
    const spec = specs.get(id);
    if (!spec || seen.has(id) || typeof token !== 'string' || !token.trim() || token === 'REEMPLAZAR' || /[\x00-\x20\x7f]/u.test(token) ||
      !Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) {
      throw new Error('Invalid provider configuration');
    }
    seen.add(id);
    return {
      id,
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
          const failure = interpret(response, body, billingDay, now());
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
