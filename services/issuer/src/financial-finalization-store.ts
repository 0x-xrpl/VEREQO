import { keccak256, toUtf8Bytes } from 'ethers';
import type { DatabaseSync } from 'node:sqlite';
import type { OwnerReviewPackage } from './financial-finalization.js';

export interface FinancialFinalizationEvidence {
  readonly id: string;
  readonly requestId: string;
  readonly principal: string;
  readonly status: 'OWNER_SIGNATURE_REQUIRED' | 'REJECTED';
  readonly reason: string | null;
  readonly ownerSignatureStatus: 'REQUIRED' | 'NOT_REQUESTED';
  readonly execution: 'NOT_IMPLEMENTED';
  readonly intentDigest: string | null;
  readonly mandateDigest: string | null;
  readonly proofDigest: string | null;
  readonly disclosureBindingDigest: string | null;
  readonly marketObservationDigest: string | null;
  readonly requestDigest: string;
  readonly previousRecordHash: string;
  readonly recordHash: string;
  readonly createdAt: string;
}

interface EvidenceRow {
  evidence_id: number | bigint;
  request_id: string;
  principal: string;
  status: FinancialFinalizationEvidence['status'];
  reason: string | null;
  owner_signature_status: FinancialFinalizationEvidence['ownerSignatureStatus'];
  intent_digest: string | null;
  mandate_digest: string | null;
  proof_digest: string | null;
  disclosure_binding_digest: string | null;
  market_observation_digest: string | null;
  request_digest: string;
  previous_record_hash: string;
  record_hash: string;
  created_at: string;
}

const EMPTY_HASH = `0x${'0'.repeat(64)}`;
const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const REQUEST_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const canonical = (row: Pick<EvidenceRow, 'evidence_id' | 'request_id' | 'principal' | 'status' | 'reason' | 'owner_signature_status' | 'intent_digest' | 'mandate_digest' | 'proof_digest' | 'disclosure_binding_digest' | 'market_observation_digest' | 'request_digest' | 'created_at'>, previousHash: string): string => JSON.stringify({
  id: String(row.evidence_id), requestId: row.request_id, principal: row.principal,
  status: row.status, reason: row.reason, ownerSignatureStatus: row.owner_signature_status,
  execution: 'NOT_IMPLEMENTED', intentDigest: row.intent_digest, mandateDigest: row.mandate_digest,
  proofDigest: row.proof_digest, disclosureBindingDigest: row.disclosure_binding_digest,
  marketObservationDigest: row.market_observation_digest, requestDigest: row.request_digest,
  createdAt: row.created_at, previousHash,
});
const hashRecord = (row: EvidenceRow, previousHash: string) => keccak256(toUtf8Bytes(`VEREQO_FINALIZATION_EVIDENCE_V1:${canonical(row, previousHash)}`));

export class FinancialFinalizationEvidenceStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS financial_finalization_evidence (
        evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('OWNER_SIGNATURE_REQUIRED','REJECTED')),
        reason TEXT,
        owner_signature_status TEXT NOT NULL CHECK(owner_signature_status IN ('REQUIRED','NOT_REQUESTED')),
        intent_digest TEXT,
        mandate_digest TEXT,
        proof_digest TEXT,
        disclosure_binding_digest TEXT,
        market_observation_digest TEXT,
        request_digest TEXT NOT NULL,
        previous_record_hash TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS financial_finalization_evidence_owner_request
        ON financial_finalization_evidence (principal, request_id, evidence_id);
      CREATE TABLE IF NOT EXISTS financial_finalization_requests (
        principal TEXT NOT NULL, request_id TEXT NOT NULL, request_digest TEXT NOT NULL, evidence_id INTEGER NOT NULL,
        PRIMARY KEY (principal, request_id)
      ) STRICT, WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS financial_finalization_proof_uses (
        proof_digest TEXT PRIMARY KEY, evidence_id INTEGER NOT NULL
      ) STRICT, WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS financial_finalization_chain_meta (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), head_evidence_id TEXT NOT NULL, head_hash TEXT NOT NULL
      ) STRICT;
    `);
    const meta = db.prepare('SELECT head_evidence_id FROM financial_finalization_chain_meta WHERE singleton=1').get();
    if (!meta) db.prepare('INSERT INTO financial_finalization_chain_meta (singleton,head_evidence_id,head_hash) VALUES (1,?,?)').run('0', EMPTY_HASH);
    this.assertChain();
  }

  recordOwnerReview(input: {
    readonly package: OwnerReviewPackage;
    readonly principal: string;
    readonly objectiveDigest: string;
    readonly proposalDigest: string;
    readonly createdAt: string;
  }): FinancialFinalizationEvidence {
    if (!ADDRESS.test(input.principal.toLowerCase()) || !HASH.test(input.objectiveDigest) || !HASH.test(input.proposalDigest) ||
        !Number.isFinite(Date.parse(input.createdAt)) || !REQUEST_ID.test(input.package.requestId) ||
        input.package.status !== 'ASSEMBLED_PRE_GATE_NOT_EXECUTABLE' || input.package.authorized !== false ||
        input.package.execution !== 'NOT_IMPLEMENTED' || input.package.ownerSignatureRequired !== true ||
        input.package.ownerSignatureStatus !== 'NOT_REQUESTED_NATIVE_RISK_UNVERIFIED' ||
        input.package.evidenceStatus !== 'NOT_RECORDED_PRE_GATE' || !HASH.test(input.package.intentDigest) ||
        !HASH.test(input.package.mandateDigest) || !HASH.test(input.package.proofDigest) ||
        !HASH.test(input.package.disclosureBindingDigest) ||
        (input.package.marketRisk.observationDigest !== null && !HASH.test(input.package.marketRisk.observationDigest))) {
      throw Error('FINALIZATION_EVIDENCE_INPUT_INVALID');
    }
    const p = input.package;
    const requestDigest = keccak256(toUtf8Bytes(`VEREQO_FINALIZATION_REQUEST_V1:${JSON.stringify({
      requestId: p.requestId, principal: input.principal.toLowerCase(), objectiveDigest: input.objectiveDigest,
      proposalDigest: input.proposalDigest, intentDigest: p.intentDigest, disclosureBindingDigest: p.disclosureBindingDigest,
      mandateDigest: p.mandateDigest, proofDigest: p.proofDigest, marketObservationDigest: p.marketRisk.observationDigest,
    })}`));
    return this.appendRequest({
      request_id: p.requestId, principal: input.principal, status: 'OWNER_SIGNATURE_REQUIRED', reason: null,
      owner_signature_status: 'REQUIRED', intent_digest: p.intentDigest, mandate_digest: p.mandateDigest,
      proof_digest: p.proofDigest, disclosure_binding_digest: p.disclosureBindingDigest,
      market_observation_digest: p.marketRisk.observationDigest, request_digest: requestDigest, created_at: input.createdAt,
    }, p.proofDigest);
  }

  recordRejected(input: {
    readonly requestId: string;
    readonly principal: string;
    readonly reason: string;
    readonly requestDigest: string;
    readonly createdAt: string;
  }): FinancialFinalizationEvidence {
    if (!ADDRESS.test(input.principal.toLowerCase()) || !HASH.test(input.requestDigest) || !/^[A-Z0-9_]{1,80}$/.test(input.reason) ||
        !REQUEST_ID.test(input.requestId) || !Number.isFinite(Date.parse(input.createdAt))) throw Error('FINALIZATION_EVIDENCE_INPUT_INVALID');
    return this.appendRequest({
      request_id: input.requestId, principal: input.principal, status: 'REJECTED', reason: input.reason,
      owner_signature_status: 'NOT_REQUESTED', intent_digest: null, mandate_digest: null, proof_digest: null,
      disclosure_binding_digest: null, market_observation_digest: null, request_digest: input.requestDigest, created_at: input.createdAt,
    }, null);
  }

  latest(requestId: string, principal: string): FinancialFinalizationEvidence | null {
    this.assertChain();
    const row = this.db.prepare(`SELECT evidence_id,request_id,principal,status,reason,owner_signature_status,intent_digest,mandate_digest,proof_digest,disclosure_binding_digest,market_observation_digest,request_digest,previous_record_hash,record_hash,created_at FROM financial_finalization_evidence WHERE request_id=? AND principal=? ORDER BY evidence_id DESC LIMIT 1`)
      .get(requestId, principal.toLowerCase()) as EvidenceRow | undefined;
    return row ? this.toEvidence(row) : null;
  }

  history(requestId: string, principal: string, limit = 20): { readonly evidence: FinancialFinalizationEvidence; readonly events: readonly FinancialFinalizationEvidence[]; readonly nextCursor: string | null } | null {
    this.assertChain();
    const bounded = Math.max(1, Math.min(20, Math.trunc(limit)));
    const rows = this.db.prepare(`SELECT evidence_id,request_id,principal,status,reason,owner_signature_status,intent_digest,mandate_digest,proof_digest,disclosure_binding_digest,market_observation_digest,request_digest,previous_record_hash,record_hash,created_at FROM financial_finalization_evidence WHERE request_id=? AND principal=? ORDER BY evidence_id DESC LIMIT ?`)
      .all(requestId, principal.toLowerCase(), bounded + 1) as unknown as EvidenceRow[];
    if (!rows.length) return null;
    const hasMore = rows.length > bounded;
    const events = rows.slice(0, bounded).map(row => this.toEvidence(row));
    return { evidence: events[0]!, events, nextCursor: hasMore ? events[events.length - 1]!.id : null };
  }

  private appendRequest(value: Omit<EvidenceRow, 'evidence_id' | 'previous_record_hash' | 'record_hash' | 'principal'> & { principal: string }, proofDigest: string | null): FinancialFinalizationEvidence {
    this.assertChain();
    const principal = value.principal.toLowerCase();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT request_digest,evidence_id FROM financial_finalization_requests WHERE principal=? AND request_id=?').get(principal, value.request_id) as { request_digest: string; evidence_id: number | bigint } | undefined;
      if (prior) {
        if (prior.request_digest === value.request_digest) {
          const row = this.rowById(prior.evidence_id);
          this.db.exec('COMMIT');
          return this.toEvidence(row);
        }
        const conflict = this.insert({ ...value, principal, status: 'REJECTED', reason: 'REQUEST_ID_CONFLICT', owner_signature_status: 'NOT_REQUESTED', intent_digest: null, mandate_digest: null, proof_digest: null, disclosure_binding_digest: null, market_observation_digest: null });
        this.db.exec('COMMIT');
        return this.toEvidence(conflict);
      }
      if (proofDigest) {
        const priorProof = this.db.prepare('SELECT evidence_id FROM financial_finalization_proof_uses WHERE proof_digest=?').get(proofDigest) as { evidence_id: number | bigint } | undefined;
        if (priorProof) {
          const replay = this.insert({ ...value, principal, status: 'REJECTED', reason: 'GROTH16_PROOF_REPLAY', owner_signature_status: 'NOT_REQUESTED', proof_digest: null });
          this.db.prepare('INSERT INTO financial_finalization_requests (principal,request_id,request_digest,evidence_id) VALUES (?,?,?,?)').run(principal, value.request_id, value.request_digest, replay.evidence_id);
          this.db.exec('COMMIT');
          return this.toEvidence(replay);
        }
      }
      const row = this.insert({ ...value, principal });
      this.db.prepare('INSERT INTO financial_finalization_requests (principal,request_id,request_digest,evidence_id) VALUES (?,?,?,?)').run(principal, value.request_id, value.request_digest, row.evidence_id);
      if (proofDigest) this.db.prepare('INSERT INTO financial_finalization_proof_uses (proof_digest,evidence_id) VALUES (?,?)').run(proofDigest, row.evidence_id);
      this.db.exec('COMMIT');
      return this.toEvidence(row);
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
  }

  private insert(value: Omit<EvidenceRow, 'evidence_id' | 'previous_record_hash' | 'record_hash'>): EvidenceRow {
    const meta = this.db.prepare('SELECT head_evidence_id,head_hash FROM financial_finalization_chain_meta WHERE singleton=1').get() as { head_evidence_id: string; head_hash: string };
    const result = this.db.prepare(`INSERT INTO financial_finalization_evidence (request_id,principal,status,reason,owner_signature_status,intent_digest,mandate_digest,proof_digest,disclosure_binding_digest,market_observation_digest,request_digest,previous_record_hash,record_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(value.request_id, value.principal, value.status, value.reason, value.owner_signature_status, value.intent_digest, value.mandate_digest, value.proof_digest, value.disclosure_binding_digest, value.market_observation_digest, value.request_digest, meta.head_hash, EMPTY_HASH, value.created_at);
    const row = this.rowById(result.lastInsertRowid);
    const hash = hashRecord(row, meta.head_hash);
    this.db.prepare('UPDATE financial_finalization_evidence SET record_hash=? WHERE evidence_id=?').run(hash, result.lastInsertRowid);
    this.db.prepare('UPDATE financial_finalization_chain_meta SET head_evidence_id=?,head_hash=? WHERE singleton=1').run(String(result.lastInsertRowid), hash);
    return { ...row, record_hash: hash };
  }

  private assertChain(): void {
    const rows = this.db.prepare(`SELECT evidence_id,request_id,principal,status,reason,owner_signature_status,intent_digest,mandate_digest,proof_digest,disclosure_binding_digest,market_observation_digest,request_digest,previous_record_hash,record_hash,created_at FROM financial_finalization_evidence ORDER BY evidence_id`).all() as unknown as EvidenceRow[];
    let previousHash = EMPTY_HASH, previousId = '0';
    for (const row of rows) {
      if (row.previous_record_hash !== previousHash || BigInt(row.evidence_id) <= BigInt(previousId) || hashRecord(row, previousHash) !== row.record_hash) throw Error('FINALIZATION_EVIDENCE_CHAIN_INVALID');
      previousHash = row.record_hash;
      previousId = String(row.evidence_id);
    }
    const meta = this.db.prepare('SELECT head_evidence_id,head_hash FROM financial_finalization_chain_meta WHERE singleton=1').get() as { head_evidence_id: string; head_hash: string } | undefined;
    if (!meta || meta.head_evidence_id !== previousId || meta.head_hash !== previousHash) throw Error('FINALIZATION_EVIDENCE_CHAIN_INVALID');
  }

  private rowById(id: number | bigint): EvidenceRow {
    const row = this.db.prepare(`SELECT evidence_id,request_id,principal,status,reason,owner_signature_status,intent_digest,mandate_digest,proof_digest,disclosure_binding_digest,market_observation_digest,request_digest,previous_record_hash,record_hash,created_at FROM financial_finalization_evidence WHERE evidence_id=?`).get(id) as EvidenceRow | undefined;
    if (!row) throw Error('FINALIZATION_EVIDENCE_NOT_FOUND');
    return row;
  }

  private toEvidence(row: EvidenceRow): FinancialFinalizationEvidence {
    return Object.freeze({
      id: String(row.evidence_id), requestId: row.request_id, principal: row.principal,
      status: row.status, reason: row.reason, ownerSignatureStatus: row.owner_signature_status,
      execution: 'NOT_IMPLEMENTED', intentDigest: row.intent_digest, mandateDigest: row.mandate_digest,
      proofDigest: row.proof_digest, disclosureBindingDigest: row.disclosure_binding_digest,
      marketObservationDigest: row.market_observation_digest, requestDigest: row.request_digest,
      previousRecordHash: row.previous_record_hash, recordHash: row.record_hash, createdAt: row.created_at,
    });
  }
}
