import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { OwnerReviewPackage } from '../services/issuer/src/financial-finalization.js';
import { FinancialFinalizationEvidenceStore } from '../services/issuer/src/financial-finalization-store.js';

const principal = '0x' + '11'.repeat(20);
const hash = (char: string) => `0x${char.repeat(64)}`;
const dbs: DatabaseSync[] = [];
const store = () => {
  const db = new DatabaseSync(':memory:'); dbs.push(db);
  return { db, evidence: new FinancialFinalizationEvidenceStore(db) };
};
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function reviewPackage(requestId: string, patch: Partial<OwnerReviewPackage> = {}): OwnerReviewPackage {
  return {
    requestId, source: 'LIVE_PROVIDER', provenance: 'PROVIDER_DECLARED_NOT_AUTONOMY_VERIFIED',
    snapshotProvenance: 'SYNTHETIC_TEST_DOUBLE', dataClass: 'SYNTHETIC_TEST_FIXTURE',
    status: 'ASSEMBLED_PRE_GATE_NOT_EXECUTABLE', authorized: false, execution: 'NOT_IMPLEMENTED',
    ownerSignatureRequired: true, ownerSignatureStatus: 'NOT_REQUESTED_NATIVE_RISK_UNVERIFIED',
    intent: {} as OwnerReviewPackage['intent'], intentDigest: hash('a'),
    exchangeQuoteBalancePreflight: { status: 'SUFFICIENT_FOR_REVIEW', availableBalanceApi18: '100', requiredExposureApi18: '10', blockNumber: '1', blockHash: hash('b'), observedAt: new Date().toISOString(), trust: 'UNPINNED_PRECOMPILE_VIEW', atomicExecutionGuarantee: false },
    disclosureBinding: {} as OwnerReviewPackage['disclosureBinding'], disclosureBindingDigest: hash('c'),
    mandate: {} as OwnerReviewPackage['mandate'], mandateSignature: '0x' + 'aa'.repeat(65), mandateDigest: hash('d'),
    proof: {} as OwnerReviewPackage['proof'], proofDigest: hash('e'),
    disclosureAnchorProvenance: 'SYNTHETIC_TEST_DOUBLE', proofVerifierProvenance: 'SYNTHETIC_TEST_DOUBLE',
    proofStatus: 'VERIFIER_ADAPTER_ACCEPTED', marketRisk: { observationDigest: hash('f') } as OwnerReviewPackage['marketRisk'],
    gateStateProvenance: 'SYNTHETIC_TEST_DOUBLE', gateRegistration: 'REGISTERED_MANDATE_MATCHED_BY_ADAPTER',
    productionGateDecision: 'MARKET_RISK_UNVERIFIED', evidenceStatus: 'NOT_RECORDED_PRE_GATE',
    ...patch,
  };
}
const recordInput = (pkg: OwnerReviewPackage, objective = hash('1'), proposal = hash('2')) => ({
  package: pkg, principal, objectiveDigest: objective, proposalDigest: proposal, createdAt: new Date().toISOString(),
});

describe('pre-owner finalization evidence store', () => {
  it('stores digest-only owner-signature-pending evidence and returns the same Request idempotently', () => {
    const { evidence } = store();
    const input = recordInput(reviewPackage('request-a'));
    const first = evidence.recordOwnerReview(input);
    const retry = evidence.recordOwnerReview(input);
    expect(first).toMatchObject({ status: 'OWNER_SIGNATURE_REQUIRED', ownerSignatureStatus: 'REQUIRED', execution: 'NOT_IMPLEMENTED', requestId: 'request-a' });
    expect(retry.id).toBe(first.id);
    expect(first).not.toHaveProperty('proof');
    expect(first).not.toHaveProperty('mandateSignature');
    expect(first).not.toHaveProperty('signature');
    expect(evidence.history('request-a', principal)?.events).toHaveLength(1);
  });

  it('rejects proof reuse across distinct Business Requests', () => {
    const { evidence } = store();
    evidence.recordOwnerReview(recordInput(reviewPackage('request-a')));
    const reused = evidence.recordOwnerReview(recordInput(reviewPackage('request-b')));
    expect(reused).toMatchObject({ status: 'REJECTED', reason: 'GROTH16_PROOF_REPLAY', ownerSignatureStatus: 'NOT_REQUESTED', proofDigest: null });
  });

  it('rejects a changed digest under the same Request ID and preserves the first record', () => {
    const { evidence } = store();
    const first = evidence.recordOwnerReview(recordInput(reviewPackage('request-a')));
    const conflict = evidence.recordOwnerReview(recordInput(reviewPackage('request-a', { intentDigest: hash('9') })));
    expect(conflict).toMatchObject({ status: 'REJECTED', reason: 'REQUEST_ID_CONFLICT' });
    expect(evidence.latest('request-a', principal)?.id).toBe(conflict.id);
    expect(first.requestDigest).not.toBe(conflict.requestDigest);
  });

  it('stores Disclosure CAS rejection without pretending an owner signature was requested', () => {
    const { evidence } = store();
    const rejected = evidence.recordRejected({ requestId: 'request-c', principal, reason: 'DISCLOSURE_ADMISSION_OR_ANCHOR_CAS_FAILED', requestDigest: hash('8'), createdAt: new Date().toISOString() });
    expect(rejected).toMatchObject({ status: 'REJECTED', reason: 'DISCLOSURE_ADMISSION_OR_ANCHOR_CAS_FAILED', ownerSignatureStatus: 'NOT_REQUESTED', execution: 'NOT_IMPLEMENTED' });
  });

  it('fail-closes evidence retrieval if a stored digest chain row is altered', () => {
    const { db, evidence } = store();
    evidence.recordOwnerReview(recordInput(reviewPackage('request-a')));
    db.prepare("UPDATE financial_finalization_evidence SET reason='tampered' WHERE evidence_id=1").run();
    expect(() => evidence.history('request-a', principal)).toThrow('FINALIZATION_EVIDENCE_CHAIN_INVALID');
  });
});
