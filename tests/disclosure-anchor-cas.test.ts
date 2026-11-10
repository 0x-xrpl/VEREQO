import { describe, expect, it } from 'vitest';
import { advanceDisclosureAnchorCAS, DisclosureAnchorCASError, type DisclosureAnchorCAS } from '../services/issuer/src/disclosure-anchor-cas.js';
import type { DisclosureHistoryAnchor } from '../services/issuer/src/disclosure-history.js';

const scope = {
  issuer: '0x0000000000000000000000000000000000000022',
  principal: '0x0000000000000000000000000000000000000011',
  agent: '0x0000000000000000000000000000000000000033',
  credentialId: `0x${'44'.repeat(32)}`,
};
const initial: DisclosureHistoryAnchor = { ...scope, historyRoot: `0x${'66'.repeat(32)}`, historySequence: '0', policyEpoch: '1' };
const nextA: DisclosureHistoryAnchor = { ...scope, historyRoot: `0x${'77'.repeat(32)}`, historySequence: '1', policyEpoch: '1' };
const nextB: DisclosureHistoryAnchor = { ...scope, historyRoot: `0x${'88'.repeat(32)}`, historySequence: '1', policyEpoch: '1' };
const binding = { ...scope };
const keyA = `0x${'aa'.repeat(32)}`;

function memoryAnchor(start: DisclosureHistoryAnchor = initial): DisclosureAnchorCAS {
  let current = start;
  const idempotency = new Map<string, string>();
  return {
    readCurrent: async () => current,
    compareAndSet: async ({ expected, next, idempotencyKey }) => {
      const old = idempotency.get(idempotencyKey);
      if (old) return old === next.historyRoot ? 'IDEMPOTENT' : 'CONFLICT';
      if (current.historyRoot !== expected.historyRoot || current.historySequence !== expected.historySequence) return 'CONFLICT';
      current = next;
      idempotency.set(idempotencyKey, next.historyRoot);
      return 'APPLIED';
    },
  };
}

describe('independent Disclosure Anchor CAS protocol', () => {
  it('advances a scoped monotonic head and safely repeats the same result', async () => {
    const anchor = memoryAnchor();
    await expect(advanceDisclosureAnchorCAS({ anchor, binding, expected: initial, next: nextA, idempotencyKey: keyA })).resolves.toBe('APPLIED');
    await expect(advanceDisclosureAnchorCAS({ anchor, binding, expected: initial, next: nextA, idempotencyKey: keyA })).resolves.toBe('IDEMPOTENT');
  });

  it('rejects a lost update when two requests try to advance the same sequence', async () => {
    const anchor = memoryAnchor();
    const results = await Promise.allSettled([
      advanceDisclosureAnchorCAS({ anchor, binding, expected: initial, next: nextA, idempotencyKey: keyA }),
      advanceDisclosureAnchorCAS({ anchor, binding, expected: initial, next: nextB, idempotencyKey: `0x${'bb'.repeat(32)}` }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(DisclosureAnchorCASError);
    expect(rejected.reason.code).toBe('DISCLOSURE_ANCHOR_CAS_CONFLICT');
  });

  it('rejects sequence jumps, scope substitution, policy rollback, and an unavailable anchor', async () => {
    const anchor = memoryAnchor();
    await expect(advanceDisclosureAnchorCAS({
      anchor, binding, expected: initial,
      next: { ...nextA, historySequence: '2' }, idempotencyKey: keyA,
    })).rejects.toMatchObject({ code: 'DISCLOSURE_ANCHOR_SEQUENCE_INVALID' });
    await expect(advanceDisclosureAnchorCAS({
      anchor, binding, expected: initial,
      next: { ...nextA, agent: '0x0000000000000000000000000000000000000099' }, idempotencyKey: keyA,
    })).rejects.toMatchObject({ code: 'DISCLOSURE_ANCHOR_INPUT_INVALID' });
    await expect(advanceDisclosureAnchorCAS({
      anchor, binding, expected: { ...initial, policyEpoch: '2' },
      next: { ...nextA, policyEpoch: '0' }, idempotencyKey: keyA,
    })).rejects.toMatchObject({ code: 'DISCLOSURE_ANCHOR_INPUT_INVALID' });
    await expect(advanceDisclosureAnchorCAS({
      anchor, binding, expected: { ...initial, policyEpoch: '2' },
      next: nextA, idempotencyKey: keyA,
    })).rejects.toMatchObject({ code: 'DISCLOSURE_ANCHOR_SEQUENCE_INVALID' });
    const unavailable: DisclosureAnchorCAS = { readCurrent: async () => { throw Error(); }, compareAndSet: async () => 'APPLIED' };
    await expect(advanceDisclosureAnchorCAS({ anchor: unavailable, binding, expected: initial, next: nextA, idempotencyKey: keyA }))
      .rejects.toMatchObject({ code: 'DISCLOSURE_ANCHOR_UNAVAILABLE' });
  });
});
