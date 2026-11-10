import type { DisclosureBinding } from '../../../packages/domain/src/disclosure-binding.js';
import type { DisclosureHistoryAnchor } from './disclosure-history.js';

export interface DisclosureAnchorScope extends Pick<DisclosureHistoryAnchor,
  'issuer' | 'principal' | 'agent' | 'credentialId'> {}

export interface DisclosureAnchorCAS {
  /** Must read from a trust domain independent of the Issuer SQLite database. */
  readCurrent(scope: DisclosureAnchorScope): Promise<DisclosureHistoryAnchor | null>;
  /** Compare sequence AND root, and persist the request key atomically. */
  compareAndSet(input: {
    readonly scope: DisclosureAnchorScope;
    readonly expected: DisclosureHistoryAnchor;
    readonly next: DisclosureHistoryAnchor;
    readonly idempotencyKey: string;
  }): Promise<'APPLIED' | 'IDEMPOTENT' | 'CONFLICT'>;
}

export class DisclosureAnchorCASError extends Error {
  constructor(readonly code: string) { super(code); }
}

function validHead(value: unknown): value is DisclosureHistoryAnchor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const head = value as Record<string, unknown>;
  const address = (v: unknown) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/i.test(v);
  const hash = (v: unknown) => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) && !/^0x0{64}$/i.test(v);
  const uint = (v: unknown, positive = false) => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < (1n << 256n) && (!positive || v !== '0');
  return address(head.issuer) && address(head.principal) && address(head.agent) && hash(head.credentialId) &&
    hash(head.historyRoot) && uint(head.historySequence) && uint(head.policyEpoch, true);
}

function sameScope(a: DisclosureAnchorScope, b: DisclosureAnchorScope): boolean {
  return a.issuer.toLowerCase() === b.issuer.toLowerCase() &&
    a.principal.toLowerCase() === b.principal.toLowerCase() &&
    a.agent.toLowerCase() === b.agent.toLowerCase() &&
    a.credentialId.toLowerCase() === b.credentialId.toLowerCase();
}

function sameHead(a: DisclosureHistoryAnchor, b: DisclosureHistoryAnchor): boolean {
  return sameScope(a, b) && a.historyRoot.toLowerCase() === b.historyRoot.toLowerCase() &&
    a.historySequence === b.historySequence && a.policyEpoch === b.policyEpoch;
}

/**
 * Advance an externally operated disclosure head without permitting lost updates,
 * rollback, scope substitution, or stale retries. This does not make an in-process or
 * same-SQLite adapter independent; callers must configure a separately trusted Anchor.
 */
export async function advanceDisclosureAnchorCAS(input: {
  readonly anchor: DisclosureAnchorCAS;
  readonly binding: Pick<DisclosureBinding, 'issuer' | 'principal' | 'agent' | 'credentialId'>;
  readonly expected: DisclosureHistoryAnchor;
  readonly next: DisclosureHistoryAnchor;
  readonly idempotencyKey: string;
}): Promise<'APPLIED' | 'IDEMPOTENT'> {
  const { anchor, binding, expected, next, idempotencyKey } = input;
  const scope: DisclosureAnchorScope = {
    issuer: binding.issuer,
    principal: binding.principal,
    agent: binding.agent,
    credentialId: binding.credentialId,
  };
  if (!/^0x[0-9a-fA-F]{64}$/.test(idempotencyKey) || /^0x0{64}$/i.test(idempotencyKey) ||
      !validHead(expected) || !validHead(next) || !sameScope(expected, scope) || !sameScope(next, scope)) {
    throw new DisclosureAnchorCASError('DISCLOSURE_ANCHOR_INPUT_INVALID');
  }
  if (BigInt(next.historySequence) !== BigInt(expected.historySequence) + 1n ||
      BigInt(next.policyEpoch) < BigInt(expected.policyEpoch)) {
    throw new DisclosureAnchorCASError('DISCLOSURE_ANCHOR_SEQUENCE_INVALID');
  }

  const read = async (): Promise<DisclosureHistoryAnchor> => {
    let head: DisclosureHistoryAnchor | null;
    try { head = await anchor.readCurrent(scope); }
    catch { throw new DisclosureAnchorCASError('DISCLOSURE_ANCHOR_UNAVAILABLE'); }
    if (!head || !validHead(head) || !sameScope(head, scope)) throw new DisclosureAnchorCASError('DISCLOSURE_ANCHOR_UNAVAILABLE');
    return head;
  };

  const current = await read();
  if (sameHead(current, next)) return 'IDEMPOTENT';
  if (!sameHead(current, expected)) throw new DisclosureAnchorCASError('DISCLOSURE_ANCHOR_CAS_CONFLICT');

  let result: 'APPLIED' | 'IDEMPOTENT' | 'CONFLICT';
  try { result = await anchor.compareAndSet({ scope, expected, next, idempotencyKey }); }
  catch { throw new DisclosureAnchorCASError('DISCLOSURE_ANCHOR_UNAVAILABLE'); }
  if (result === 'CONFLICT') {
    const raced = await read();
    if (sameHead(raced, next)) return 'IDEMPOTENT';
    throw new DisclosureAnchorCASError('DISCLOSURE_ANCHOR_CAS_CONFLICT');
  }
  if (result !== 'APPLIED' && result !== 'IDEMPOTENT') throw new DisclosureAnchorCASError('DISCLOSURE_ANCHOR_UNAVAILABLE');
  const confirmed = await read();
  if (!sameHead(confirmed, next)) throw new DisclosureAnchorCASError('DISCLOSURE_ANCHOR_CAS_CONFLICT');
  return result;
}
