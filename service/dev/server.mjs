import { createServer } from 'node:http';
import { createResolver } from '../src/dni/application/resolve-dni.mjs';
import { createBearerAuthenticator, isClientToken } from '../src/dni/transport/bearer.mjs';
import { createHttpHandler, LOOKUP_PATH } from '../src/dni/transport/http.mjs';

const token = process.env.DNI_CLIENT_TOKEN;
const port = Number(process.env.DNI_LOCAL_PORT || 3000);
if (!isClientToken(token)) throw new Error('Configura DNI_CLIENT_TOKEN en el .env con el formato descrito en el README.');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DNI_LOCAL_PORT debe ser un puerto válido.');

const demoProvider = {
  id: 'demo',
  async lookup(dni) {
    if (dni !== '00000001') return { kind: 'not_found' };
    return {
      kind: 'found',
      data: { nombres: 'Ana María', apellidoPaterno: 'De la Cruz', apellidoMaterno: null },
    };
  },
};

const handle = createHttpHandler({
  authenticate: createBearerAuthenticator(async () => token),
  resolve: createResolver({ providers: [demoProvider] }),
});

const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes <= 1024) chunks.push(chunk);
    }
    const result = await handle({
      routeKey: `${request.method} ${pathname}`, headers: request.headers,
      body: bytes <= 1024 ? Buffer.concat(chunks).toString('utf8') : null,
    });
    response.writeHead(result.statusCode, result.headers).end(result.body);
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' }).end('{"code":"INVALID_REQUEST"}');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`DNI Lambda en http://127.0.0.1:${port}${LOOKUP_PATH} (datos de prueba)`);
});
