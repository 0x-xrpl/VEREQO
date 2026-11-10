import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { assertCurrentDisclosureHistory } from '../services/issuer/src/financial-authorization.js';
import { createDisclosureHistoryReader } from '../services/issuer/src/disclosure-history.js';
import { IssuerStore } from '../services/issuer/src/store.js';
import type { DisclosureHistoryAnchor } from '../services/issuer/src/disclosure-history.js';
import type { DisclosureBinding } from '../packages/domain/src/disclosure-binding.js';

const principal = '0x0000000000000000000000000000000000000011';
const issuer = '0x0000000000000000000000000000000000000022';
const agent = '0x0000000000000000000000000000000000000033';
const credentialId = `0x${'44'.repeat(32)}`;
const binding: DisclosureBinding = {
  issuer, principal, agent, credentialId,
  requestIdHash: `0x${'55'.repeat(32)}`, historyRoot: `0x${'66'.repeat(32)}`,
  historySequence: '0', policyEpoch: '1', credentialEpoch: '7', issuedAt: '1700000000', expiresAt: '1700000060',
};
const resources: Array<() => void> = [];
afterEach(() => { for (const close of resources.splice(0).reverse()) close(); });

function anchorFor(head: { historyRoot: string; historySequence: string; policyEpoch: string }): DisclosureHistoryAnchor {
  return { issuer, principal, agent, credentialId, ...head };
}

describe('issuer-backed current disclosure history reader', () => {
  it('binds the current root to issuer, principal, Agent and credential scope', async () => {
    const store = new IssuerStore(new DatabaseSync(':memory:')); resources.push(() => store.close());
    const scope = { issuer: issuer.toLowerCase(), subject: credentialId.toLowerCase(), cohort: agent.toLowerCase() };
    store.provision(scope, principal.toLowerCase(), 74);
    let trustedHead = store.historyHead({ principal: principal.toLowerCase(), scope });
    const reader = createDisclosureHistoryReader(
      store,
      async () => ({ credentialEpoch: '7', active: true }),
      async () => anchorFor(trustedHead),
    );
    const initial = await reader(binding);
    expect(initial).toMatchObject({ issuer, principal, agent, credentialId, historySequence: '0', policyEpoch: '1', credentialEpoch: '7', active: true });
    expect(initial?.historyRoot).toMatch(/^0x[0-9a-f]{64}$/);

    const currentBinding = { ...binding, historyRoot: initial!.historyRoot };
    assertCurrentDisclosureHistory(currentBinding, initial);
    store.request({ principal: principal.toLowerCase(), scope }, { threshold: 100, policyEpoch: 1, idempotencyKey: 'request-1' });
    expect(await reader(binding)).toBeNull(); // Stale independent anchor cannot bless newer SQLite state.
    trustedHead = store.historyHead({ principal: principal.toLowerCase(), scope });
    const advanced = await reader(binding);
    expect(advanced?.historySequence).toBe('1');
    expect(advanced?.historyRoot).not.toBe(initial?.historyRoot);
    expect(() => assertCurrentDisclosureHistory(currentBinding, advanced)).toThrow('DISCLOSURE_HISTORY_STALE');
    expect((await reader(binding))?.historySequence).toBe('1');
  });

  it('returns no current state for a different principal or Agent scope and carries revocation state separately', async () => {
    const store = new IssuerStore(new DatabaseSync(':memory:')); resources.push(() => store.close());
    const scope = { issuer: issuer.toLowerCase(), subject: credentialId.toLowerCase(), cohort: agent.toLowerCase() };
    store.provision(scope, principal.toLowerCase(), 74);
    const head = store.historyHead({ principal: principal.toLowerCase(), scope });
    const reader = createDisclosureHistoryReader(
      store,
      async () => ({ credentialEpoch: '8', active: false }),
      async () => anchorFor(head),
    );
    expect(await reader({ ...binding, principal: '0x0000000000000000000000000000000000000099' })).toBeNull();
    expect(await reader({ ...binding, agent: '0x0000000000000000000000000000000000000088' })).toBeNull();
    const revoked = await reader(binding);
    expect(revoked).toMatchObject({ credentialEpoch: '8', active: false });
    expect(() => assertCurrentDisclosureHistory({ ...binding, historyRoot: revoked!.historyRoot }, revoked)).toThrow('DISCLOSURE_CREDENTIAL_REVOKED');
  });

  it('rejects rollback to an older local database head when the independent anchor has advanced', async () => {
    const db = new DatabaseSync(':memory:');
    const store = new IssuerStore(db); resources.push(() => store.close());
    const scope = { issuer: issuer.toLowerCase(), subject: credentialId.toLowerCase(), cohort: agent.toLowerCase() };
    const context = { principal: principal.toLowerCase(), scope };
    store.provision(scope, context.principal, 74);
    store.request(context, { threshold: 100, policyEpoch: 1, idempotencyKey: 'anchored-release' });
    const committedHead = store.historyHead(context);
    const reader = createDisclosureHistoryReader(
      store,
      async () => ({ credentialEpoch: '7', active: true }),
      async () => anchorFor(committedHead),
    );
    expect((await reader(binding))?.historySequence).toBe('1');

    // Model restoring a previous SQLite backup: row-level append-only triggers no
    // longer exist in the restored image, while the independent checkpoint stays ahead.
    db.exec(`DROP TRIGGER disclosure_immutable; DROP TRIGGER disclosure_delete_immutable;
      DROP TRIGGER disclosure_commitment_delete_immutable;`);
    db.prepare('DELETE FROM disclosure_commitments WHERE sequence=1').run();
    db.prepare('DELETE FROM disclosures WHERE sequence=1').run();
    expect(store.historyHead(context).historySequence).toBe('0');
    expect(await reader(binding)).toBeNull();
  });
});
