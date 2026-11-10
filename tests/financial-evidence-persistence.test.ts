import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorizationRequestDigest, FinancialAuthorizationStore } from '../services/issuer/src/financial-authorization-store.js';

describe('financial authorization evidence restart boundary', () => {
  it('preserves owner-scoped rejection evidence and idempotency across database restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vereqo-financial-evidence-'));
    const databasePath = join(directory, 'issuer.sqlite');
    const principal = '0x1111111111111111111111111111111111111111';
    const requestId = 'fi_0123456789abcdef0123456789abcdef';
    const request = { requestId, draft: { side: 'BUY', orderType: 'LIMIT', price: '2', quantity: '1' } };
    const requestDigest = authorizationRequestDigest(request);
    const createdAt = new Date('2026-11-07T18:00:00.000Z').toISOString();
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(databasePath);
      const firstStore = new FinancialAuthorizationStore(db);
      const first = firstStore.recordRejected({
        requestId, principal, reason: 'SIGNED_AUTHORIZATION_REQUIRED',
        intentDigest: null, mandateDigest: null, requestDigest, createdAt,
      });
      expect(first).toMatchObject({ requestId, principal: principal.toLowerCase(), status: 'REJECTED', reason: 'SIGNED_AUTHORIZATION_REQUIRED' });
      expect(first.recordHash).toMatch(/^0x[0-9a-f]{64}$/);
      db.close();
      db = new DatabaseSync(databasePath);
      const restarted = new FinancialAuthorizationStore(db);
      expect(restarted.evidenceChainStatus().valid).toBe(true);
      expect(restarted.latest(requestId, principal)).toEqual(first);
      expect(restarted.history(requestId, principal, null, 10).events).toEqual([first]);
      expect(restarted.resolveRequest(requestId, principal, requestDigest, createdAt)?.kind).toBe('MATCH');
      expect(restarted.history(requestId, principal, null, 10).events).toEqual([first]);
      const changedDigest = authorizationRequestDigest({ ...request, draft: { ...request.draft, price: '3' } });
      const conflict = restarted.resolveRequest(requestId, principal, changedDigest, createdAt);
      expect(conflict).toMatchObject({ kind: 'CONFLICT', evidence: { status: 'REJECTED', reason: 'REQUEST_ID_CONFLICT' } });
      expect(restarted.history(requestId, principal, null, 10).events.map(event => event.id)).toEqual([conflict!.evidence.id, first.id]);
      expect(restarted.latest(requestId, '0x2222222222222222222222222222222222222222')).toBeNull();
      expect(restarted.evidenceChainStatus().valid).toBe(true);
    } finally {
      db?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
