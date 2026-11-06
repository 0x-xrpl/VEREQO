import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalApp } from '../services/issuer/src/http';
import { IssuerStore, type AuthContext } from '../services/issuer/src/store';
import type { DemoState, DisclosurePreflight } from '../packages/domain/src/demo';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function open() {
  const app = createLocalApp({ databasePath: ':memory:' });
  cleanup.push(app.close);
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => { app.server.off('error', reject); resolve(); });
  });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  const base = `http://127.0.0.1:${address.port}`;
  const state = async () => {
    const response = await fetch(`${base}/api/state`);
    expect(response.status).toBe(200);
    return await response.json() as DemoState;
  };
  const token = (await state()).requestToken;
  const post = (path: string, body: unknown, requestToken = token) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VEREQO-Token': requestToken }, body: JSON.stringify(body),
  });
  return { base, token, state, post };
}

const revoke = { type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', expectedSequence: 0, eventId: 'paused-revoke' };

describe('reset rejects requests already awaiting their body', () => {
  it.each([
    ['/api/query', { threshold: 100, policyEpoch: 1, idempotencyKey: 'paused-query' }],
    ['/api/graph', revoke],
    ['/api/reset', {}],
    ['/api/preview', revoke],
    ['/api/preflight', { threshold: 70, policyEpoch: 1 }],
  ])('rejects paused %s after token rotation without changing the fresh state', async (path, body) => {
    const app = await open();
    const payload = JSON.stringify(body);
    let resume!: () => void;
    const continued = new Promise<void>(resolve => { resume = resolve; });
    let result!: Promise<{ status: number; body: unknown }>;
    const req = httpRequest(`${app.base}${path}`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-VEREQO-Token': app.token,
      Expect: '100-continue', 'Content-Length': Buffer.byteLength(payload),
    } });
    cleanup.push(() => { req.destroy(); });
    result = new Promise((resolve, reject) => {
      req.on('error', reject);
      req.on('response', response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
    });
    req.once('continue', resume);
    req.flushHeaders();
    await continued;
    // The old-token request is now inside parseBody, but no body has arrived.
    const reset = await app.post('/api/reset', {});
    expect(reset.status).toBe(200);
    const fresh = (await reset.json() as { state: DemoState }).state;
    expect(fresh.requestToken).not.toBe(app.token);
    req.end(payload);
    expect(await result).toEqual({ status: 403, body: { error: 'INVALID_REQUEST_TOKEN' } });
    expect(await app.state()).toEqual(fresh);
  });
});

const context: AuthContext = { principal: 'requester', scope: { issuer: 'issuer', subject: 'subject', cohort: 'authorized-cohort' } };
const deniedPreflight: DisclosurePreflight = {
  query: { kind: 'LTE', threshold: 70, predicateId: 'x.lte.v1' }, policyEpoch: 1, minCandidates: 16,
  status: 'DENIED', reason: 'CANDIDATE_FLOOR', partitions: { yes: 71, no: 10 }, remainingBefore: 81, historySequence: 2,
};

describe('read-only issuer preflight', () => {
  it('returns identical public admission for all 81 compatible witnesses without reading one or writing history', () => {
    for (let witness = 0; witness <= 80; witness++) {
      const db = new DatabaseSync(':memory:');
      let reads = 0;
      const store = new IssuerStore(db, () => { reads++; });
      try {
        store.provision(context.scope, context.principal, witness);
        store.request(context, { threshold: 100, policyEpoch: 1, idempotencyKey: 'first' });
        store.request(context, { threshold: 80, policyEpoch: 1, idempotencyKey: 'second' });
        const before = store.view(context);
        expect(reads).toBe(2);
        reads = 0;
        const changes = db.prepare('SELECT total_changes() AS n').get()?.n;
        expect(store.preflight(context, { threshold: 70, policyEpoch: 1 })).toEqual(deniedPreflight);
        expect(store.preflight(context, { threshold: 40, policyEpoch: 1 })).toEqual({
          ...deniedPreflight, query: { kind: 'LTE', threshold: 40, predicateId: 'x.lte.v1' },
          status: 'ALLOWED', reason: 'ALL_POSSIBLE_OUTCOMES_MEET_FLOOR', partitions: { yes: 41, no: 40 },
        });
        expect(reads).toBe(0);
        expect(db.prepare('SELECT total_changes() AS n').get()?.n).toBe(changes);
        expect(store.view(context)).toEqual(before);
      } finally { store.close(); }
    }
  });

  it('authorizes the actual scope, rejects stale policy, and replays knowledge across epochs', () => {
    const db = new DatabaseSync(':memory:');
    const store = new IssuerStore(db);
    try {
      store.provision(context.scope, context.principal, 74);
      store.request(context, { threshold: 100, policyEpoch: 1, idempotencyKey: 'first' });
      store.request(context, { threshold: 80, policyEpoch: 1, idempotencyKey: 'second' });
      const before = store.changePolicy(context, { epoch: 2, minCandidates: 20 });
      expect(() => store.preflight({ ...context, principal: 'intruder' }, { threshold: 70, policyEpoch: 2 })).toThrow('UNAUTHORIZED');
      expect(() => store.preflight({ ...context, scope: { ...context.scope, cohort: 'caller-selected' } }, { threshold: 70, policyEpoch: 2 })).toThrow('UNAUTHORIZED');
      expect(() => store.preflight(context, { threshold: 70, policyEpoch: 1 })).toThrow('STALE_POLICY');
      expect(store.preflight(context, { threshold: 70, policyEpoch: 2 })).toEqual({ ...deniedPreflight, policyEpoch: 2, minCandidates: 20 });
      expect(store.view(context)).toEqual(before);
    } finally { store.close(); }
  });

  it('normalizes equivalent queries and rejects malformed inputs without witness access', () => {
    const db = new DatabaseSync(':memory:');
    const store = new IssuerStore(db, () => { throw new Error('Unexpected witness read'); });
    try {
      store.provision(context.scope, context.principal, 74);
      for (const threshold of ['70', null, undefined, 70.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => store.preflight(context, { threshold, policyEpoch: 1 })).toThrow('INVALID_INPUT');
      }
      for (const policyEpoch of [0, -1, 1.5, NaN, Infinity]) {
        expect(() => store.preflight(context, { threshold: 70, policyEpoch })).toThrow('INVALID_INPUT');
      }
      expect(store.preflight(context, { threshold: 128, policyEpoch: 1 })).toEqual(store.preflight(context, { threshold: 127, policyEpoch: 1 }));
      expect(store.preflight(context, { threshold: -2, policyEpoch: 1 })).toEqual(store.preflight(context, { threshold: -1, policyEpoch: 1 }));
      expect(store.view(context).history).toEqual([]);
    } finally { store.close(); }
  });

  it('fails closed on corrupt public history before returning any proposal', () => {
    const db = new DatabaseSync(':memory:');
    const store = new IssuerStore(db);
    try {
      store.provision(context.scope, context.principal, 74);
      store.request(context, { threshold: 100, policyEpoch: 1, idempotencyKey: 'first' });
      db.exec('DROP TRIGGER disclosure_immutable');
      db.prepare('UPDATE disclosures SET record=?').run('{}');
      expect(() => store.preflight(context, { threshold: 70, policyEpoch: 1 })).toThrow('CORRUPT_HISTORY');
    } finally { store.close(); }
  });
});

describe('HTTP preflight contract', () => {
  it('returns only typed public admission, stays read-only, and leaves a later query authoritative', async () => {
    const app = await open();
    for (const threshold of [100, 80]) {
      expect((await app.post('/api/query', { threshold, policyEpoch: 1, idempotencyKey: `query-${threshold}` })).status).toBe(200);
    }
    const before = await app.state();
    for (let repeat = 0; repeat < 3; repeat++) {
      const response = await app.post('/api/preflight', { threshold: 70, policyEpoch: 1 });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ preflight: deniedPreflight });
    }
    expect(await app.state()).toEqual(before);
    const query = await app.post('/api/query', { threshold: 70, policyEpoch: 1, idempotencyKey: 'actual-query' });
    expect(query.status).toBe(200);
    const after = (await query.json() as { state: DemoState }).state;
    expect(after.disclosure.history).toHaveLength(3);
    expect(after.disclosure.history.at(-1)).toMatchObject({ status: 'DENIED', partitions: { yes: 71, no: 10 }, remainingAfter: 81 });
    expect(after.disclosure.history.at(-1)).not.toHaveProperty('answer');
    expect(after.disclosure.candidates).toEqual(before.disclosure.candidates);
    expect(after.capabilities.authorization).toBe('NOT_IMPLEMENTED');
  });

  it('rejects absent/invalid tokens, stale epoch, malformed input and extra fields without state changes', async () => {
    const app = await open(), before = await app.state();
    const valid = { threshold: 70, policyEpoch: 1 };
    for (const token of ['', 'bad', '0'.repeat(48)]) expect((await app.post('/api/preflight', valid, token)).status).toBe(403);
    const missing = await fetch(`${app.base}/api/preflight`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid) });
    expect(missing.status).toBe(403);
    expect((await app.post('/api/preflight', { ...valid, policyEpoch: 2 })).status).toBe(409);
    for (const body of [{}, { threshold: 70 }, { policyEpoch: 1 }, { ...valid, threshold: '70' }, { ...valid, threshold: null },
      { ...valid, threshold: 70.5 }, { ...valid, policyEpoch: '1' }, { ...valid, policyEpoch: 0 },
      ...['subject', 'cohort', 'issuer', 'principal', 'witness', 'answer', 'idempotencyKey', 'proof'].map(key => ({ ...valid, [key]: 'extra' }))]) {
      expect((await app.post('/api/preflight', body)).status).toBe(400);
    }
    for (const body of ['null', '[]', '{"threshold":']) {
      const response = await fetch(`${app.base}/api/preflight`, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-VEREQO-Token': app.token,
      }, body });
      expect(response.status).toBe(400);
    }
    expect(await app.state()).toEqual(before);
  });
});
