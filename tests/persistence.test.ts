import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { IssuerStore, type AuthContext } from '../services/issuer/src/store';
import type { DisclosureRecord } from '../packages/domain/src/demo';

const ctx: AuthContext = { principal: 'broker', scope: { issuer: 'issuer', subject: 'subject', cohort: 'cohort' } };
const resources: (() => void)[] = [];
afterEach(() => { for (const clean of resources.splice(0).reverse()) { try { clean(); } catch { /* already closed */ } } });
function setup(witness = 74, hook = () => {}, file = ':memory:') {
  const db = new DatabaseSync(file), store = new IssuerStore(db, hook);
  resources.push(() => store.close()); store.provision(ctx.scope, ctx.principal, witness);
  return { db, store };
}
const ask = (store: IssuerStore, threshold: number, idempotencyKey = `q${threshold}`, policyEpoch = 1, context = ctx) =>
  store.request(context, { threshold, idempotencyKey, policyEpoch });
const firstTwo = (store: IssuerStore) => { ask(store, 100); ask(store, 80); };
function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'vereqo-test-')); resources.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'issuer.sqlite');
}

describe('persistent atomic disclosure release', () => {
  it('denies the third question for ALL 81 compatible private values; never reads denied witnesses', () => {
    for (let x = 0; x <= 80; x++) {
      const onRead = vi.fn(), { store } = setup(x, onRead); firstTwo(store); onRead.mockClear();
      const denied = ask(store, 70);
      expect(denied.status).toBe('DENIED'); expect(denied).not.toHaveProperty('answer');
      expect(denied.partitions).toEqual({ yes: 71, no: 10 }); expect(onRead).not.toHaveBeenCalled();
      expect(store.view(ctx).candidates).toHaveLength(81);
      expect(store.view(ctx).history).toHaveLength(3);
    }
  });
  it('returns all 128 initial values correctly while preserving k', () => {
    for (let x = 0; x < 128; x++) {
      const { store } = setup(x); const result = ask(store, 100);
      expect(result.answer).toBe(x <= 100); expect(store.view(ctx).candidates).toContain(x);
      expect(result.remainingAfter).toBeGreaterThanOrEqual(16);
    }
  });
  it('denial does not call a witness reader that would throw', () => {
    const { store } = setup(74, () => { throw new Error('witness must not be read'); });
    expect(ask(store, 0).status).toBe('DENIED');
  });
  it('repeated questions, normalized duplicates and denied retries are idempotent', () => {
    const { store } = setup();
    const fixed = ask(store, -100, 'fixed'); expect(ask(store, -1, 'fixed')).toEqual(fixed);
    firstTwo(store);
    const before = store.view(ctx); ask(store, 80, 'repeat');
    expect(store.view(ctx).candidates).toEqual(before.candidates);
    const d = ask(store, 70); expect(ask(store, 70)).toEqual(d);
    expect(store.view(ctx).history).toHaveLength(5);
    expect(() => ask(store, 69, 'q70')).toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('survives a process/store restart and uncertain delivery retry', () => {
    const file = tempFile(), { store } = setup(74, () => {}, file); firstTwo(store); const saved = ask(store, 70); store.close();
    const next = new IssuerStore(new DatabaseSync(file)); resources.push(() => next.close());
    expect(ask(next, 70)).toEqual(saved); expect(next.view(ctx).candidates).toHaveLength(81);
  });
  it('authorizes cohort before cached retries and shares history across agent identities', () => {
    const { db, store } = setup(); firstTwo(store);
    expect(() => ask(store, 100, 'q100', 1, { ...ctx, principal: 'attacker' })).toThrow('UNAUTHORIZED');
    expect(() => ask(store, 100, 'q100', 1, { ...ctx, scope: { ...ctx.scope, cohort: 'new' } })).toThrow('UNAUTHORIZED');
    store.provision(ctx.scope, 'second-agent', 74);
    expect(ask(store, 70, 'agent2', 1, { ...ctx, principal: 'second-agent' }).status).toBe('DENIED');
    db.prepare('DELETE FROM authorizations WHERE principal=?').run('broker');
    expect(() => ask(store, 100)).toThrow('UNAUTHORIZED');
  });
  it('isolates subjects, issuers and explicitly authorized cohorts', () => {
    const { store } = setup(); firstTwo(store);
    for (const changed of [{ subject: 'other' }, { issuer: 'other' }, { cohort: 'other' }]) {
      const scope = { ...ctx.scope, ...changed }, context = { ...ctx, scope };
      store.provision(scope, ctx.principal, 74); expect(store.view(context).candidates).toHaveLength(128);
      expect(ask(store, 70, 'separate', 1, context).status).toBe('ALLOWED');
    }
    expect(ask(store, 70).status).toBe('DENIED');
  });
  it('does not reset knowledge across policy versions; stale retries fail and higher floors close access', () => {
    const { store } = setup(); firstTwo(store);
    expect(store.changePolicy(ctx, { epoch: 2, minCandidates: 16 }).candidates).toHaveLength(81);
    expect(() => ask(store, 100)).toThrow('STALE_POLICY');
    expect(ask(store, 70, 'v2', 2).status).toBe('DENIED');
    store.changePolicy(ctx, { epoch: 3, minCandidates: 90 });
    expect(ask(store, 127, 'v3', 3).status).toBe('DENIED');
    expect(() => store.changePolicy(ctx, { epoch: 5, minCandidates: 16 })).toThrow('STALE_POLICY');
  });
  it('rejects malformed input and prevents changing a witness under an existing scope', () => {
    const { db, store } = setup();
    for (const threshold of ['70', 1.2, NaN, null]) expect(() => store.request(ctx, { threshold, idempotencyKey: 'bad', policyEpoch: 1 })).toThrow('INVALID_INPUT');
    expect(() => ask(store, 100, '')).toThrow('INVALID_INPUT');
    expect(() => store.provision(ctx.scope, ctx.principal, 45)).toThrow('INVALID_INPUT');
    expect(() => db.exec('UPDATE witnesses SET value=45')).toThrow();
    expect(store.view(ctx).history).toEqual([]);
  });
  it('prevents deleting the latest disclosure or policy so replay cannot restore forgotten candidates', () => {
    const { db, store } = setup(74); firstTwo(store);
    const row = db.prepare('SELECT id FROM scopes').get();
    expect(row).toBeDefined();
    const scopeId = String(row!.id);
    const saved = store.view(ctx);
    expect(saved.candidates).toHaveLength(81);
    expect(() => db.prepare('DELETE FROM disclosures WHERE scope_id=? AND sequence=2').run(scopeId)).toThrow();
    expect(store.view(ctx).candidates).toEqual(saved.candidates);
    const denied = ask(store, 70, 'delete-latest-attempt');
    expect(denied.status).toBe('DENIED');
    expect(denied).not.toHaveProperty('answer');
    expect(() => db.prepare('DELETE FROM policies WHERE scope_id=? AND epoch=1').run(scopeId)).toThrow();
    const after = store.view(ctx);
    expect(after.candidates).toEqual(saved.candidates);
    expect(after.history).toHaveLength(3);
  });
  it('exposes a blinded, scope-specific disclosure head that survives restart and advances with every record', () => {
    const file = tempFile(), { store } = setup(74, () => {}, file);
    const empty = store.historyHead(ctx);
    expect(empty).toMatchObject({ historySequence: '0', policyEpoch: '1' });
    expect(empty.historyRoot).toMatch(/^0x[0-9a-f]{64}$/);
    firstTwo(store);
    const recorded = store.historyHead(ctx);
    expect(recorded.historySequence).toBe('2');
    expect(recorded.historyRoot).not.toBe(empty.historyRoot);
    store.close();
    const recovered = new IssuerStore(new DatabaseSync(file)); resources.push(() => recovered.close());
    expect(recovered.historyHead(ctx)).toEqual(recorded);
    const otherScope = { ...ctx, scope: { ...ctx.scope, subject: 'other-subject' } };
    recovered.provision(otherScope.scope, otherScope.principal, 74);
    expect(recovered.historyHead(otherScope).historyRoot).not.toBe(recorded.historyRoot);
    expect(() => recovered.historyHead({ ...ctx, principal: 'unauthorized' })).toThrow('UNAUTHORIZED');
  });
  it('fails closed on contradictory, tampered or gapped public histories', () => {
    for (const corruption of ['answer', 'count', 'gap', 'denial-answer', 'nested-field']) {
      const { db, store } = setup(); firstTwo(store); ask(store, 70);
      db.exec('DROP TRIGGER disclosure_immutable; DROP TRIGGER disclosure_delete_immutable; DROP TRIGGER disclosure_commitment_delete_immutable;');
      if (corruption === 'gap') {
        const scopeId = String(db.prepare('SELECT id FROM scopes').get()!.id);
        db.prepare('DELETE FROM disclosure_commitments WHERE scope_id=? AND sequence=1').run(scopeId);
        db.prepare('DELETE FROM disclosures WHERE scope_id=? AND sequence=1').run(scopeId);
      }
      else {
        const sequence = corruption === 'denial-answer' ? 3 : 2;
        const row = db.prepare('SELECT record FROM disclosures WHERE sequence=?').get(sequence)!;
        const record = JSON.parse(String(row.record)) as DisclosureRecord;
        if (corruption === 'answer') record.answer = false;
        if (corruption === 'count') record.remainingAfter = 128;
        if (corruption === 'denial-answer') record.answer = true;
        if (corruption === 'nested-field') Object.assign(record.partitions, { unrecognized: 'unexpected-data' });
        db.prepare('UPDATE disclosures SET record=? WHERE sequence=?').run(JSON.stringify(record), sequence);
      }
      expect(() => ask(store, 60, 'after-corruption')).toThrow('CORRUPT_HISTORY');
    }
  });
  it('write failure rolls back and never returns an answer', () => {
    const { db, store } = setup(); db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON disclosures BEGIN SELECT RAISE(ABORT, 'test write failure'); END;");
    expect(() => ask(store, 100)).toThrow('DATABASE_UNAVAILABLE');
    expect(store.view(ctx).history).toHaveLength(0);
    db.exec('DROP TRIGGER fail_insert'); expect(ask(store, 100).sequence).toBe(1);
  });
  it('actual deferred foreign-key COMMIT failure rolls back the staged answer', () => {
    const { db, store } = setup();
    db.exec(`CREATE TABLE fault_parent(id INTEGER PRIMARY KEY);
      CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER fail_commit AFTER INSERT ON disclosures BEGIN INSERT INTO fault_child VALUES(999); END;`);
    expect(() => ask(store, 100)).toThrow('DATABASE_UNAVAILABLE');
    expect(store.view(ctx).history).toHaveLength(0);
    expect(db.prepare('SELECT count(*) AS n FROM fault_child').get()?.n).toBe(0);
    db.exec('DROP TRIGGER fail_commit'); expect(ask(store, 100).sequence).toBe(1);
  });
  it('closed/read-only/locked databases do not release answers', () => {
    const file = tempFile(), { db, store } = setup(74, () => {}, file);
    const lock = new DatabaseSync(file); resources.push(() => lock.close()); lock.exec('BEGIN IMMEDIATE');
    expect(() => ask(store, 100)).toThrow('DATABASE_UNAVAILABLE'); lock.exec('ROLLBACK');
    expect(store.view(ctx).history).toHaveLength(0);
    db.exec('PRAGMA query_only=ON'); expect(() => ask(store, 100)).toThrow('DATABASE_UNAVAILABLE');
    store.close(); expect(() => ask(store, 100)).toThrow('DATABASE_UNAVAILABLE');
  });
  it('serializes real concurrent processes so only one of two initially safe queries releases', async () => {
    const file = tempFile(), { store } = setup(45, () => {}, file); firstTwo(store);
    const children: ChildProcess[] = [];
    const launch = (threshold: number) => {
      const child = fork(join(process.cwd(), 'tests/fixtures/query-worker.ts'), [file, String(threshold), `race${threshold}`],
        { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      children.push(child); resources.push(() => child.kill());
      const ready = new Promise<void>((resolve, reject) => { child.once('message', () => resolve()); child.once('error', reject); });
      const result = new Promise<DisclosureRecord>((resolve, reject) => {
        child.on('message', (message: unknown) => { if (typeof message === 'object' && message) {
          if ('result' in message) resolve(message.result as DisclosureRecord);
          else if ('error' in message) reject(new Error(String(message.error)));
        } }); child.once('error', reject);
      });
      return { ready, result };
    };
    const a = launch(40), b = launch(50); await Promise.all([a.ready, b.ready]); children.forEach(c => c.send('go'));
    const outcomes = await Promise.all([a.result, b.result]);
    expect(outcomes.map(x => x.status).sort()).toEqual(['ALLOWED', 'DENIED']);
    expect(outcomes.find(x => x.status === 'DENIED')).not.toHaveProperty('answer');
    const view = store.view(ctx); expect(view.candidates.length).toBeGreaterThanOrEqual(16);
    expect(view.history.map(x => x.sequence)).toEqual([1, 2, 3, 4]);
  });
});
