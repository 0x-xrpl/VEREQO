import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { timingSafeEqual } from 'node:crypto';
import { GraphError, type GraphCommand } from '../../../packages/consequence/src/index';
import { DemoRepository, DEMO_CONTEXT } from './demo';
import { IssuerError } from './store';

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function exact(body: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(body).sort().join(',') !== keys.sort().join(',')) throw new HttpError(400, 'INVALID_FIELDS');
}
async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new HttpError(415, 'JSON_REQUIRED');
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk); length += buffer.length;
    if (length > 4096) throw new HttpError(413, 'BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, 'INVALID_JSON'); }
}

export function createLocalApp(options: { databasePath: string; staticRoot?: string }) {
  if (options.databasePath !== ':memory:') mkdirSync(dirname(resolve(options.databasePath)), { recursive: true, mode: 0o700 });
  const repo = new DemoRepository(new DatabaseSync(options.databasePath));
  const staticRoot = resolve(options.staticRoot ?? 'dist/web');
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
    try {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 4317;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5173', 'localhost:5173']);
      if (!req.headers.host || !allowedHosts.has(req.headers.host)) throw new HttpError(403, 'INVALID_HOST');
      if (req.headers.origin && ![...allowedHosts].some(host => req.headers.origin === `http://${host}`)) throw new HttpError(403, 'INVALID_ORIGIN');
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (path === '/api/state' && req.method === 'GET') { json(res, 200, repo.state()); return; }
      if (path.startsWith('/api/')) {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        const token = req.headers['x-vereqo-token'];
        // Reject non-ASCII bytes before timingSafeEqual's equal-byte-length precondition.
        if (typeof token !== 'string' || !/^[0-9a-f]{48}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(repo.requestToken))) throw new HttpError(403, 'INVALID_REQUEST_TOKEN');
        const body = await parseBody(req);
        // Body streaming yields to other requests; reset may rotate the generation.
        // Keep this check adjacent to the synchronous dispatch below.
        if (!timingSafeEqual(Buffer.from(token), Buffer.from(repo.requestToken))) throw new HttpError(403, 'INVALID_REQUEST_TOKEN');
        if (path === '/api/preflight') {
          exact(body, ['threshold', 'policyEpoch']);
          const preflight = repo.issuer.preflight(DEMO_CONTEXT, { threshold: body.threshold, policyEpoch: body.policyEpoch as number });
          json(res, 200, { preflight }); return;
        } else if (path === '/api/query') {
          exact(body, ['threshold', 'idempotencyKey', 'policyEpoch']);
          repo.issuer.request(DEMO_CONTEXT, { threshold: body.threshold, idempotencyKey: body.idempotencyKey as string, policyEpoch: body.policyEpoch as number });
        } else if (path === '/api/preview') {
          json(res, 200, repo.preview(body as unknown as GraphCommand)); return;
        } else if (path === '/api/graph') repo.command(body as unknown as GraphCommand);
        else if (path === '/api/reset') { exact(body, []); repo.reset(); }
        else throw new HttpError(404, 'NOT_FOUND');
        json(res, 200, { state: repo.state() }); return;
      }
      if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      const file = resolve(staticRoot, path === '/' ? 'index.html' : `.${path}`);
      if (!file.startsWith(staticRoot + sep)) throw new HttpError(404, 'NOT_FOUND');
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain' };
      const mime = types[extname(file)]; if (!mime) throw new HttpError(404, 'NOT_FOUND');
      let content; try { content = await readFile(file); } catch { throw new HttpError(404, 'NOT_FOUND'); }
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` }); res.end(content);
    } catch (e) {
      if (res.headersSent || res.destroyed) { res.end(); return; }
      if (e instanceof HttpError) json(res, e.status, { error: e.message });
      else if (e instanceof IssuerError) json(res, e.code === 'UNAUTHORIZED' ? 403 : e.code === 'INVALID_INPUT' ? 400 : e.code === 'STALE_POLICY' || e.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 503, { error: e.code });
      else if (e instanceof GraphError) json(res, e.code.includes('CONFLICT') || e.code.includes('SEQUENCE') || e.code.includes('EPOCH') || e.code.includes('REVOKED') ? 409 : 400, { error: e.code });
      else json(res, 503, { error: 'LOCAL_SERVICE_UNAVAILABLE' });
    }
  });
  return { server, close: async () => {
    if (server.listening) await new Promise<void>((resolveClose, reject) => server.close(e => e ? reject(e) : resolveClose()));
    repo.close();
  } };
}
