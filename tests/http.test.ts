import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApp } from '../services/issuer/src/http';
import type { DemoState } from '../packages/domain/src/demo';
import type { GraphCommand, GraphSnapshot, NodeChange } from '../packages/consequence/src/index';

interface LocalHarness {
  base: string;
  token: string;
  server: Server;
  close: () => Promise<void>;
  state: () => Promise<DemoState>;
  post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
}
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const clean of cleanup.splice(0).reverse()) await clean();
});

it('serves the public font with its actual MIME while keeping private/source extensions unavailable',async()=>{
  const app=createLocalApp({databasePath:':memory:',staticRoot:join(process.cwd(),'apps/web/public')});cleanup.push(()=>app.close());
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const address=app.server.address();
  if(!address||typeof address==='string')throw Error('No listener');const base=`http://127.0.0.1:${address.port}`;
  const image=await fetch(`${base}/fonts/instrument-sans-latin.woff2`);
  expect(image.status).toBe(200);expect(image.headers.get('content-type')).toMatch(/^font\/woff2/);
  expect(image.headers.get('x-content-type-options')).toBe('nosniff');expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  for(const path of ['/../../services/issuer/src/store.ts','/.env','/issuer.sqlite','/product/../services/issuer/src/store.ts'])expect((await fetch(`${base}${path}`)).status).toBe(404);
});

function temporaryDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vereqo-http-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'issuer.sqlite');
}

function noWitnessProperties(value: unknown): void {
  if (Array.isArray(value)) { for (const child of value) noWitnessProperties(child); return; }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    // Public candidate values legitimately contain the fixture value. Test data
    // boundaries by property, never by searching for its numeric substring.
    expect(key).not.toMatch(/^(?:witness|privateWitness|privateValue|secret)$/i);
    noWitnessProperties(child);
  }
}

async function open(databasePath = temporaryDatabase()): Promise<LocalHarness> {
  const app = await createLocalApp({ databasePath });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.close(); } };
  cleanup.push(close);
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => { app.server.off('error', reject); resolve(); });
  });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP test listener has no TCP port');
  const base = `http://127.0.0.1:${address.port}`;
  const state = async () => {
    const response = await fetch(`${base}/api/state`, { cache: 'no-store' });
    expect(response.status).toBe(200);
    const data = await response.json() as DemoState;
    noWitnessProperties(data);
    return data;
  };
  const token = (await state()).requestToken;
  expect(token).toEqual(expect.any(String));
  expect(token.length).toBeGreaterThanOrEqual(16);
  return { base, token, server: app.server, close, state, post: (path, body, headers = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VEREQO-Token': token, ...headers }, body: JSON.stringify(body),
  }) };
}

async function mutate(app: LocalHarness, path: string, body: unknown): Promise<DemoState> {
  const response = await app.post(path, body);
  expect(response.status).toBe(200);
  const result = await response.json() as { state: DemoState };
  noWitnessProperties(result);
  return result.state;
}
const query = (threshold: number, key = `request-${threshold}`, policyEpoch = 1) => ({ threshold, idempotencyKey: key, policyEpoch });
const revoke = (expectedSequence = 0, eventId = 'revoke-A'): GraphCommand => ({ type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', expectedSequence, eventId });

async function rawRequest(base: string, headers: Record<string, string>, method = 'GET', path = '/api/state', body?: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown;
        try { json = JSON.parse(text); } catch { json = text; }
        resolve({ status: response.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('real local issuer HTTP boundary', () => {
  it('reproduces 128 → 101 → 81, then denies without an answer or witness properties', async () => {
    const app = await open();
    expect((await app.state()).disclosure.candidates).toHaveLength(128);
    const first = await mutate(app, '/api/query', query(100));
    expect(first.environment).toBe('LOCAL_REFERENCE');
    expect(first.disclosure.candidates).toHaveLength(101);
    expect(first.disclosure.history.at(-1)).toMatchObject({ status: 'ALLOWED', answer: true });
    const second = await mutate(app, '/api/query', query(80));
    expect(second.disclosure.candidates).toHaveLength(81);
    const denied = await mutate(app, '/api/query', query(70));
    expect(denied.disclosure.candidates).toEqual(second.disclosure.candidates);
    expect(denied.disclosure.history.at(-1)).toMatchObject({ status: 'DENIED', partitions: { yes: 71, no: 10 }, remainingAfter: 81 });
    expect(denied.disclosure.history.at(-1)).not.toHaveProperty('answer');
    expect(denied.capabilities).toEqual({ proof: 'NOT_IMPLEMENTED', authorization: 'NOT_IMPLEMENTED', execution: 'NOT_IMPLEMENTED' });
    const retry = await mutate(app, '/api/query', query(70));
    expect(retry.disclosure.history).toEqual(denied.disclosure.history);
    expect((await app.state()).disclosure.history).toEqual(denied.disclosure.history);
  });

  it('previews without committing, then revokes only A and preserves independent B', async () => {
    const app = await open(), before = await app.state(), command = revoke();
    const response = await app.post('/api/preview', command);
    expect(response.status).toBe(200);
    const preview = await response.json() as { snapshot: GraphSnapshot; changes: NodeChange[] };
    noWitnessProperties(preview);
    expect(preview.snapshot.nodes.find(node => node.id === 'credential_A')?.state).toBe('REVOKED');
    expect(preview.snapshot.nodes.find(node => node.id === 'action_A')?.state).toBe('BLOCKED');
    expect(preview.snapshot.nodes.find(node => node.id === 'action_B')?.state).toBe('VALID');
    expect(preview.changes.some(change => change.nodeId.endsWith('_B'))).toBe(false);
    expect(await app.state()).toEqual(before);
    const committed = await mutate(app, '/api/graph', command);
    expect(committed.graph).toEqual(preview.snapshot);
    expect(committed.lastChanges).toEqual(preview.changes);
    expect(committed.graph.nodes.filter(node => node.id.endsWith('_B'))).toEqual(before.graph.nodes.filter(node => node.id.endsWith('_B')));
    expect(committed.disclosure).toEqual(before.disclosure);
    const reset = await mutate(app, '/api/reset', {});
    expect(reset.disclosure.candidates).toHaveLength(128);
    expect(reset.disclosure.history).toEqual([]);
    expect(reset.graph.sequence).toBe(0);
    expect(reset.graph.nodes.every(node => node.state === 'VALID')).toBe(true);
    const firstAgain = await app.post('/api/query', query(100), { 'X-VEREQO-Token': reset.requestToken });
    expect(firstAgain.status).toBe(200);
    expect((await firstAgain.json() as { state: DemoState }).state.disclosure.candidates).toHaveLength(101);
  });

  it('retains committed decisions and graph state after restarting the real API', async () => {
    const path = temporaryDatabase(), app = await open(path);
    await mutate(app, '/api/query', query(100));
    const saved = await mutate(app, '/api/graph', revoke());
    await app.close();
    const restarted = await open(path), current = await restarted.state();
    expect(current.disclosure).toEqual(saved.disclosure);
    expect(current.graph).toEqual(saved.graph);
    const retried = await mutate(restarted, '/api/query', query(100));
    expect(retried.disclosure.history).toHaveLength(1);
  });

  it('rejects missing or wrong request tokens before mutation', async () => {
    const app = await open();
    for (const token of [undefined, 'wrong-token']) {
      const response = await fetch(`${app.base}/api/query`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-VEREQO-Token': token } : {}) },
        body: JSON.stringify(query(100)),
      });
      expect(response.status).toBe(403); noWitnessProperties(await response.json());
    }
    expect((await app.state()).disclosure.history).toEqual([]);
  });

  it('rejects foreign origins and foreign Host headers even with a valid token', async () => {
    const app = await open();
    const foreignOrigin = await app.post('/api/query', query(100), { Origin: 'https://attacker.invalid' });
    expect(foreignOrigin.status).toBe(403); noWitnessProperties(await foreignOrigin.json());
    const foreignHost = await rawRequest(app.base, { Host: 'attacker.invalid' });
    expect(foreignHost.status).toBe(403); noWitnessProperties(foreignHost.json);
    const rebinding = await rawRequest(app.base, { Host: 'attacker.invalid', 'Content-Type': 'application/json', 'X-VEREQO-Token': app.token }, 'POST', '/api/query', JSON.stringify(query(100)));
    expect(rebinding.status).toBe(403); noWitnessProperties(rebinding.json);
    expect((await app.state()).disclosure.history).toEqual([]);
  });

  it('rejects malformed, oversized and non-JSON request bodies without disclosure', async () => {
    const app = await open();
    for (const body of ['{"threshold":', 'null', '[]', '"query"']) {
      const response = await fetch(`${app.base}/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VEREQO-Token': app.token }, body });
      expect(response.status).toBe(400); noWitnessProperties(await response.json());
    }
    const oversized = await app.post('/api/query', { ...query(100), padding: 'x'.repeat(70000) });
    expect(oversized.status).toBe(413); noWitnessProperties(await oversized.json());
    const wrongType = await fetch(`${app.base}/api/query`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-VEREQO-Token': app.token }, body: JSON.stringify(query(100)) });
    expect(wrongType.status).toBe(415);
    expect((await app.state()).disclosure.history).toEqual([]);
  });

  it('refuses caller-selected subjects, cohorts, witnesses and other unrecognized fields', async () => {
    const app = await open();
    for (const extra of [{ subject: 'another-subject' }, { cohort: 'fresh-budget' }, { issuer: 'other' }, { principal: 'other-agent' }, { witness: 1 }, { answer: true }]) {
      const response = await app.post('/api/query', { ...query(100), ...extra });
      expect(response.status).toBe(400); noWitnessProperties(await response.json());
    }
    for (const threshold of ['100', 100.5, null]) {
      const response = await app.post('/api/query', { ...query(100), threshold });
      expect(response.status).toBe(400);
    }
    expect((await app.state()).disclosure.history).toEqual([]);
  });

  it('rejects stale policy, conflicting idempotency and stale graph sequences', async () => {
    const app = await open();
    const stalePolicy = await app.post('/api/query', query(100, 'stale', 2));
    expect(stalePolicy.status).toBe(409);
    expect((await app.state()).disclosure.history).toEqual([]);
    await mutate(app, '/api/query', query(100));
    const conflict = await app.post('/api/query', query(80, 'request-100'));
    expect(conflict.status).toBe(409);
    const staleGraph = await app.post('/api/graph', revoke(99));
    expect(staleGraph.status).toBe(409);
    expect((await app.state()).graph.sequence).toBe(0);
    expect((await app.state()).disclosure.history).toHaveLength(1);
  });

  it('rejects unknown API routes and unsupported methods without state changes', async () => {
    const app = await open(), before = await app.state();
    expect((await fetch(`${app.base}/api/not-a-route`)).status).toBe(405);
    expect((await app.post('/api/not-a-route', {})).status).toBe(404);
    const method = await fetch(`${app.base}/api/state`, { method: 'PUT', headers: { 'X-VEREQO-Token': app.token } });
    expect(method.status).toBe(405);
    expect(await app.state()).toEqual(before);
  });
});
