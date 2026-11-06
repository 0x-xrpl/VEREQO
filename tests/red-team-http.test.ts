import { afterEach, describe, expect, it } from 'vitest';
import { connect } from 'node:net';
import { createLocalApp } from '../services/issuer/src/http';
import type { DemoState } from '../packages/domain/src/demo';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function open() {
  const app = createLocalApp({ databasePath: ':memory:' }); closers.push(app.close);
  await new Promise<void>((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const state = async () => (await (await fetch(`${base}/api/state`)).json()) as DemoState;
  const post = async (path: string, token: string, body: unknown) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VEREQO-Token': token }, body: JSON.stringify(body)
  });
  return { base, state, post };
}

describe('independent HTTP red team', () => {
  it('characterizes the public token as shared demo CSRF protection, never identity authentication', async () => {
    const app = await open();
    // Separate HTTP clients send no cookie, login or bearer identity.
    const alice = await app.state(), bob = await app.state();
    expect(bob.requestToken).toBe(alice.requestToken);
    const first = await app.post('/api/query', bob.requestToken, { threshold: 100, policyEpoch: 1, idempotencyKey: 'other-client' });
    expect(first.status).toBe(200);
    expect((await app.state()).disclosure.history).toHaveLength(1);
    const revoke = await app.post('/api/graph', bob.requestToken, {
      type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', eventId: 'other-client-revoke', expectedSequence: 0
    });
    expect(revoke.status).toBe(200);
    const reset = await app.post('/api/reset', bob.requestToken, {}); expect(reset.status).toBe(200);
    expect((await app.state()).disclosure.history).toHaveLength(0);
    expect((await app.state()).graph.sequence).toBe(0);
  });

  it('rejects delayed pre-reset commands after creating a fresh local fixture', async () => {
    const app = await open(), before = await app.state();
    const oldCommand = { type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', eventId: 'delayed-revoke', expectedSequence: 0 };
    const reset = await app.post('/api/reset', before.requestToken, {});
    expect(reset.status).toBe(200);
    const fresh = (await reset.json() as { state: DemoState }).state;
    for (const [path, body] of [
      ['/api/graph', oldCommand],
      ['/api/query', { threshold: 100, policyEpoch: 1, idempotencyKey: 'delayed-query' }],
      ['/api/reset', {}]
    ] as const) expect((await app.post(path, before.requestToken, body)).status).toBe(403);
    expect(fresh.requestToken).not.toBe(before.requestToken);
    expect((await app.state()).graph.sequence).toBe(0);
    expect((await app.state()).disclosure.history).toHaveLength(0);
    expect((await app.post('/api/graph', fresh.requestToken, oldCommand)).status).toBe(200);
  });

  it('returns 403, without an internal comparison error, for non-ASCII token bytes', async () => {
    const app = await open(), token = (await app.state()).requestToken;
    const status = await new Promise<number>((resolve, reject) => {
      const url = new URL(app.base), socket = connect(Number(url.port), '127.0.0.1');
      let reply = '';
      socket.on('data', chunk => { reply += String(chunk); });
      socket.on('error', reject);
      socket.on('end', () => resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(reply)?.[1] ?? 0)));
      socket.on('connect', () => socket.write(Buffer.from([
        'POST /api/reset HTTP/1.1', `Host: ${url.host}`, 'Connection: close',
        'Content-Type: application/json', `X-VEREQO-Token: ${'é'.repeat(token.length)}`,
        'Content-Length: 2', '', '{}'
      ].join('\r\n'), 'latin1')));
    });
    expect(status).toBe(403);
    expect((await app.state()).disclosure.history).toHaveLength(0);
  });
});
