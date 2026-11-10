import { expect, it } from 'vitest';
import { Wallet } from 'ethers';
import { request } from 'node:http';
import { createServer, mergeConfig, type UserConfig } from 'vite';
import config from '../vite.config';
import { createLocalApp } from '../services/issuer/src/http';

it('keeps origin-scoped ownership sessions through the Vite proxy when browser GET omits Origin', async () => {
  const app = createLocalApp({ databasePath: ':memory:' });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const issuer = app.server.address();
  if (!issuer || typeof issuer === 'string') throw Error('NO_ISSUER');
  const proxy = await createServer(mergeConfig(config as UserConfig, {
    configFile: false,
    server: { port: 0, strictPort: false, hmr: false, proxy: { '/api': { target: `http://127.0.0.1:${issuer.port}` } } }
  }));
  try {
    await proxy.listen();
    const address = proxy.httpServer?.address();
    if (!address || typeof address === 'string') throw Error('NO_PROXY');
    const base = `http://127.0.0.1:${address.port}`;
    const origin = 'http://127.0.0.1:5173';
    // Use an ephemeral listener while retaining the real browser's Host/Origin.
    const host = { host: '127.0.0.1:5173' };
    const send = (path: string, headers: Record<string, string>, body?: string) => new Promise<Response>((resolve, reject) => {
      const req = request(base + path, { method: body === undefined ? 'GET' : 'POST', headers }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500, headers: { 'x-vereqo-auth-stage': String(res.headers['x-vereqo-auth-stage'] ?? '') } })));
      });
      req.on('error', reject); req.end(body);
    });
    const post = (path: string, body: unknown, token?: string) => send(path,
      { ...host, origin, 'content-type': 'application/json', ...(token ? { 'x-vereqo-session': token } : {}) }, JSON.stringify(body));
    const wallet = Wallet.createRandom();
    const issued = await post('/api/wallet/challenge', { address: wallet.address });
    expect(issued.status).toBe(200);
    const { challenge } = await issued.json();
    expect(challenge.value.origin).toBe(origin);
    const verified = await post('/api/wallet/verify', { nonce: challenge.value.nonce, signature: await wallet.signTypedData(challenge.domain, challenge.types, challenge.value) });
    expect(verified.status).toBe(200);
    const { session } = await verified.json();
    const status = await send('/api/wallet/status', { ...host, 'x-vereqo-session': session });
    expect(status.headers.get('x-vereqo-auth-stage')).toBe('SESSION_STATUS_CONFIRMED');
    expect((await status.json()).session).toMatchObject({ address: wallet.address, origin });
    const foreign = await send('/api/wallet/status', { ...host, origin: 'http://localhost:5173', 'x-vereqo-session': session });
    expect((await foreign.json()).session).toBeNull();
    expect((await post('/api/wallet/logout', {}, session)).status).toBe(200);
    const revoked = await send('/api/wallet/status', { ...host, 'x-vereqo-session': session });
    expect((await revoked.json()).session).toBeNull();
  } finally {
    await proxy.close();
    await app.close();
  }
}, 20_000);
