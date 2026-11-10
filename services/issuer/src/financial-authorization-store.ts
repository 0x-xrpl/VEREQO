import { keccak256, toUtf8Bytes } from 'ethers';
import type { DatabaseSync } from 'node:sqlite';
import type { ValidatedFinancialAuthorization } from './financial-authorization.js';

export interface AuthorizationEvidence {
  readonly id: string;
  readonly requestId: string;
  readonly principal: string;
  readonly status: 'PRE_GATE_VALIDATED' | 'REJECTED';
  readonly reason: string | null;
  readonly intentDigest: string | null;
  readonly mandateDigest: string | null;
  readonly proofDigest: string | null;
  readonly requestDigest: string | null;
  readonly marketObservationDigest?: string | null;
  readonly disclosureBindingDigest?: string | null;
  readonly disclosureHistorySequence?: string | null;
  readonly disclosurePolicyEpoch?: string | null;
  readonly disclosureCredentialEpoch?: string | null;
  readonly disclosureHistoryRoot?: string | null;
  readonly disclosureIssuer?: string | null;
  readonly disclosureCredentialId?: string | null;
  readonly previousRecordHash: string | null;
  readonly recordHash: string | null;
  readonly createdAt: string;
}

export interface RejectedAuthorizationEvidence {
  readonly requestId: string | null;
  readonly principal: string;
  readonly reason: string;
  readonly intentDigest: string | null;
  readonly mandateDigest: string | null;
  readonly requestDigest: string;
  readonly createdAt: string;
}

interface EvidenceRow {
  evidence_id: number | bigint;
  request_id: string;
  principal: string;
  status: 'PRE_GATE_VALIDATED' | 'REJECTED';
  reason: string | null;
  intent_digest: string | null;
  mandate_digest: string | null;
  proof_digest: string | null;
  request_digest: string | null;
  market_observation_digest: string | null;
  disclosure_binding_digest: string | null;
  disclosure_history_sequence: string | null;
  disclosure_policy_epoch: string | null;
  disclosure_credential_epoch: string | null;
  disclosure_history_root: string | null;
  disclosure_issuer: string | null;
  disclosure_credential_id: string | null;
  previous_record_hash: string | null;
  record_hash: string | null;
  created_at: string;
}
interface RequestRow { request_digest: string; evidence_id: number | bigint; }
export type RequestResolution = { readonly kind: 'MATCH' | 'CONFLICT'; readonly evidence: AuthorizationEvidence };
export interface EvidenceChainStatus { readonly valid: boolean; readonly headEvidenceId: string; readonly headHash: string; readonly legacyUnchainedCount: number; }
const EMPTY_HASH = `0x${'0'.repeat(64)}`;

function canonicalJson(value: unknown): string {
  const canonical = (entry: unknown, depth: number): string => {
    if (depth > 32) throw Error('IDEMPOTENCY_PAYLOAD_TOO_DEEP');
    if (entry === null || typeof entry === 'boolean' || typeof entry === 'string') return JSON.stringify(entry);
    if (typeof entry === 'number') {
      if (!Number.isSafeInteger(entry)) throw Error('IDEMPOTENCY_UNSAFE_NUMBER');
      return JSON.stringify(entry);
    }
    if (Array.isArray(entry)) return `[${entry.map((child) => canonical(child, depth + 1)).join(',')}]`;
    if (typeof entry === 'object' && Object.getPrototypeOf(entry) === Object.prototype) {
      const descriptors = Object.getOwnPropertyDescriptors(entry);
      const keys = Reflect.ownKeys(entry);
      if (keys.some((key) => typeof key !== 'string' || !Object.hasOwn(descriptors[key]!, 'value'))) throw Error('IDEMPOTENCY_INVALID_OBJECT');
      return `{${(keys as string[]).sort().map((key) => `${JSON.stringify(key)}:${canonical(descriptors[key]!.value, depth + 1)}`).join(',')}}`;
    }
    throw Error('IDEMPOTENCY_INVALID_VALUE');
  };
  return canonical(value, 0);
}

/** Versioned canonical hash of every request field, including signatures and proof. */
export function authorizationRequestDigest(value: unknown): string {
  return keccak256(toUtf8Bytes(`VEREQO_AUTH_REQUEST_V1:${canonicalJson(value)}`));
}

function evidenceRecordHash(row: Pick<EvidenceRow, 'evidence_id' | 'request_id' | 'principal' | 'status' | 'reason' | 'intent_digest' | 'mandate_digest' | 'proof_digest' | 'request_digest' | 'market_observation_digest' | 'disclosure_binding_digest' | 'disclosure_history_sequence' | 'disclosure_policy_epoch' | 'disclosure_credential_epoch' | 'disclosure_history_root' | 'disclosure_issuer' | 'disclosure_credential_id' | 'created_at'>, previousHash: string): string {
  const payload = {
    id: String(row.evidence_id), requestId: row.request_id, principal: row.principal,
    status: row.status, reason: row.reason, intentDigest: row.intent_digest,
    mandateDigest: row.mandate_digest, proofDigest: row.proof_digest,
    requestDigest: row.request_digest, createdAt: row.created_at, previousHash,
  };
  // Preserve existing V1 hashes byte-for-byte; new risk-linked records use V2.
  if (row.market_observation_digest === null && row.disclosure_binding_digest === null) return keccak256(toUtf8Bytes(`VEREQO_EVIDENCE_V1:${canonicalJson(payload)}`));
  if (row.disclosure_binding_digest === null) return keccak256(toUtf8Bytes(`VEREQO_EVIDENCE_V2:${canonicalJson({ ...payload, marketObservationDigest: row.market_observation_digest })}`));
  return keccak256(toUtf8Bytes(`VEREQO_EVIDENCE_V3:${canonicalJson({ ...payload, marketObservationDigest: row.market_observation_digest, disclosureBindingDigest: row.disclosure_binding_digest, disclosureHistorySequence: row.disclosure_history_sequence, disclosurePolicyEpoch: row.disclosure_policy_epoch, disclosureCredentialEpoch: row.disclosure_credential_epoch, disclosureHistoryRoot: row.disclosure_history_root, disclosureIssuer: row.disclosure_issuer, disclosureCredentialId: row.disclosure_credential_id })}`));
}

/** Durable append-only local audit trail. It stores digests, never proofs or witnesses. */
export class FinancialAuthorizationStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS financial_authorization_gate_nonces (
        chain_id TEXT NOT NULL,
        gate TEXT NOT NULL,
        nonce TEXT NOT NULL,
        intent_digest TEXT NOT NULL,
        PRIMARY KEY (chain_id, gate, nonce)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS financial_authorization_evidence (
        evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PRE_GATE_VALIDATED', 'REJECTED')),
        reason TEXT,
        intent_digest TEXT,
        mandate_digest TEXT,
        proof_digest TEXT,
        request_digest TEXT,
        market_observation_digest TEXT,
        disclosure_binding_digest TEXT,
        disclosure_history_sequence TEXT,
        disclosure_policy_epoch TEXT,
        disclosure_credential_epoch TEXT,
        disclosure_history_root TEXT,
        disclosure_issuer TEXT,
        disclosure_credential_id TEXT,
        previous_record_hash TEXT,
        record_hash TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS financial_authorization_requests (
        principal TEXT NOT NULL,
        request_id TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        first_evidence_id INTEGER NOT NULL,
        PRIMARY KEY (principal, request_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS financial_authorization_chain_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        head_evidence_id TEXT NOT NULL,
        head_hash TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS financial_authorization_evidence_owner
        ON financial_authorization_evidence (principal, request_id, evidence_id);
    `);
    const columns = db.prepare('PRAGMA table_info(financial_authorization_evidence)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'request_digest')) {
      db.exec('ALTER TABLE financial_authorization_evidence ADD COLUMN request_digest TEXT');
    }
    if (!columns.some((column) => column.name === 'market_observation_digest')) db.exec('ALTER TABLE financial_authorization_evidence ADD COLUMN market_observation_digest TEXT');
    if (!columns.some((column) => column.name === 'disclosure_binding_digest')) db.exec('ALTER TABLE financial_authorization_evidence ADD COLUMN disclosure_binding_digest TEXT');
    for (const name of ['disclosure_history_sequence', 'disclosure_policy_epoch', 'disclosure_credential_epoch', 'disclosure_history_root', 'disclosure_issuer', 'disclosure_credential_id']) {
      if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE financial_authorization_evidence ADD COLUMN ${name} TEXT`);
    }
    if (!columns.some((column) => column.name === 'previous_record_hash')) db.exec('ALTER TABLE financial_authorization_evidence ADD COLUMN previous_record_hash TEXT');
    if (!columns.some((column) => column.name === 'record_hash')) db.exec('ALTER TABLE financial_authorization_evidence ADD COLUMN record_hash TEXT');
    const metadata = db.prepare('SELECT head_evidence_id, head_hash FROM financial_authorization_chain_meta WHERE singleton=1').get() as { head_evidence_id: string; head_hash: string } | undefined;
    if (!metadata) {
      const existingChainRows = db.prepare('SELECT COUNT(*) AS count FROM financial_authorization_evidence WHERE record_hash IS NOT NULL').get() as { count: number | bigint };
      if (Number(existingChainRows.count) !== 0) throw Error('EVIDENCE_CHAIN_METADATA_MISSING');
      db.prepare('INSERT INTO financial_authorization_chain_meta (singleton, head_evidence_id, head_hash) VALUES (1, ?, ?)').run('0', EMPTY_HASH);
    }
    if (!this.evidenceChainStatus().valid) throw Error('EVIDENCE_CHAIN_INVALID');
  }

  /** Local hash-chain check. Store the returned head outside this DB to detect whole-DB rollback. */
  evidenceChainStatus(): EvidenceChainStatus {
    const rows = this.db.prepare(`SELECT evidence_id, request_id, principal, status, reason, intent_digest, mandate_digest, proof_digest, request_digest, market_observation_digest, disclosure_binding_digest, disclosure_history_sequence, disclosure_policy_epoch, disclosure_credential_epoch, disclosure_history_root, disclosure_issuer, disclosure_credential_id, previous_record_hash, record_hash, created_at FROM financial_authorization_evidence WHERE record_hash IS NOT NULL ORDER BY evidence_id`).all() as unknown as EvidenceRow[];
    let previousHash = EMPTY_HASH;
    let previousId = '0';
    let valid = true;
    for (const row of rows) {
      if (row.previous_record_hash !== previousHash || BigInt(row.evidence_id) <= BigInt(previousId) || evidenceRecordHash(row, previousHash) !== row.record_hash) { valid = false; break; }
      previousHash = row.record_hash!;
      previousId = String(row.evidence_id);
    }
    const head = this.db.prepare('SELECT head_evidence_id, head_hash FROM financial_authorization_chain_meta WHERE singleton=1').get() as { head_evidence_id: string; head_hash: string } | undefined;
    if (!head || head.head_hash !== previousHash || head.head_evidence_id !== previousId) valid = false;
    const total = this.db.prepare('SELECT COUNT(*) AS count FROM financial_authorization_evidence').get() as { count: number | bigint };
    return { valid, headEvidenceId: previousId, headHash: previousHash, legacyUnchainedCount: Number(total.count) - rows.length };
  }

  private assertEvidenceChain(): void {
    if (!this.evidenceChainStatus().valid) throw Error('EVIDENCE_CHAIN_INVALID');
  }

  /** Fast replay lookup; mismatched payloads are durably appended as conflicts. */
  resolveRequest(requestId: string, principal: string, requestDigest: string, createdAt: string): RequestResolution | null {
    this.assertEvidenceChain();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const owner = principal.toLowerCase();
      const prior = this.findRequest(owner, requestId);
      if (!prior) { this.db.exec('COMMIT'); return null; }
      if (prior.request_digest === requestDigest) {
        const evidence = this.evidenceById(prior.evidence_id);
        this.db.exec('COMMIT');
        return { kind: 'MATCH', evidence };
      }
      const evidence = this.insertEvidence({
        requestId, principal: owner, status: 'REJECTED', reason: 'REQUEST_ID_CONFLICT',
        intentDigest: null, mandateDigest: null, proofDigest: null, requestDigest, createdAt,
      });
      this.db.exec('COMMIT');
      return { kind: 'CONFLICT', evidence };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
  }

  recordValidated(result: ValidatedFinancialAuthorization, createdAt: string, requestDigest: string): AuthorizationEvidence {
    this.assertEvidenceChain();
    const i = result.intent;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const marketObservationDigest = result.marketRisk.observationDigest;
      const disclosureBindingDigest = result.disclosureBindingDigest ?? null;
      const disclosure = disclosureBindingDigest ? {
        sequence: result.disclosureHistorySequence, policyEpoch: result.disclosurePolicyEpoch,
        credentialEpoch: result.disclosureCredentialEpoch, root: result.disclosureHistoryRoot,
        issuer: result.disclosureIssuer, credentialId: result.disclosureCredentialId,
      } : null;
      if (disclosureBindingDigest !== null && (!/^0x[0-9a-f]{64}$/.test(disclosureBindingDigest) || !disclosure || !disclosure.sequence || !disclosure.policyEpoch || !disclosure.credentialEpoch || !disclosure.root || !/^0x[0-9a-f]{64}$/.test(disclosure.root) || !disclosure.issuer || !/^0x[0-9a-f]{40}$/i.test(disclosure.issuer) || !disclosure.credentialId || !/^0x[0-9a-f]{64}$/.test(disclosure.credentialId))) throw Error('DISCLOSURE_BINDING_DIGEST_INVALID');
      if (!marketObservationDigest || !/^0x[0-9a-f]{64}$/.test(marketObservationDigest)) throw Error('MARKET_OBSERVATION_DIGEST_REQUIRED');
      const priorRequest = this.findRequest(i.principal.toLowerCase(), result.requestId);
      if (priorRequest) {
        if (priorRequest.request_digest === requestDigest) {
          const evidence = this.evidenceById(priorRequest.evidence_id);
          this.db.exec('COMMIT');
          return evidence;
        }
        const evidence = this.insertConflict(result.requestId, i.principal, requestDigest, result.intentDigest, result.mandateDigest, createdAt);
        this.db.exec('COMMIT');
        return evidence;
      }
      if (disclosure) {
        const previous = this.db.prepare(`
          SELECT disclosure_history_sequence, disclosure_policy_epoch, disclosure_credential_epoch, disclosure_history_root
          FROM financial_authorization_evidence
          WHERE status='PRE_GATE_VALIDATED' AND disclosure_issuer=? AND principal=? AND disclosure_credential_id=?
          ORDER BY evidence_id DESC LIMIT 1
        `).get(disclosure.issuer!.toLowerCase(), i.principal.toLowerCase(), disclosure.credentialId!.toLowerCase()) as {
          disclosure_history_sequence: string; disclosure_policy_epoch: string; disclosure_credential_epoch: string; disclosure_history_root: string;
        } | undefined;
        let rollbackReason: string | null = null;
        if (previous) {
          if (BigInt(disclosure.sequence!) < BigInt(previous.disclosure_history_sequence)) rollbackReason = 'DISCLOSURE_HISTORY_ROLLBACK';
          else if (BigInt(disclosure.sequence!) === BigInt(previous.disclosure_history_sequence) && disclosure.root!.toLowerCase() !== previous.disclosure_history_root) rollbackReason = 'DISCLOSURE_HISTORY_FORK';
          else if (BigInt(disclosure.policyEpoch!) < BigInt(previous.disclosure_policy_epoch)) rollbackReason = 'DISCLOSURE_POLICY_ROLLBACK';
          else if (BigInt(disclosure.credentialEpoch!) < BigInt(previous.disclosure_credential_epoch)) rollbackReason = 'DISCLOSURE_CREDENTIAL_ROLLBACK';
        }
        if (rollbackReason) {
          const evidence = this.insertEvidence({
            requestId: result.requestId, principal: i.principal, status: 'REJECTED', reason: rollbackReason,
            intentDigest: result.intentDigest, mandateDigest: result.mandateDigest, proofDigest: null, requestDigest,
            marketObservationDigest, disclosureBindingDigest, disclosureHistorySequence: disclosure.sequence,
            disclosurePolicyEpoch: disclosure.policyEpoch, disclosureCredentialEpoch: disclosure.credentialEpoch,
            disclosureHistoryRoot: disclosure.root, disclosureIssuer: disclosure.issuer, disclosureCredentialId: disclosure.credentialId, createdAt,
          });
          this.rememberRequest(i.principal, result.requestId, requestDigest, evidence.id);
          this.db.exec('COMMIT');
          return evidence;
        }
      }
      const priorNonce = this.db.prepare(`
        SELECT 1 FROM financial_authorization_gate_nonces
        WHERE chain_id=? AND gate=? AND nonce=?
      `).get(i.chainId, i.verifyingContract.toLowerCase(), i.nonce);
      if (priorNonce) {
        const evidence = this.insertEvidence({
          requestId: result.requestId, principal: i.principal, status: 'REJECTED', reason: 'REPLAY',
          intentDigest: result.intentDigest, mandateDigest: result.mandateDigest, proofDigest: null, requestDigest, marketObservationDigest, createdAt,
        });
        this.rememberRequest(i.principal, result.requestId, requestDigest, evidence.id);
        this.db.exec('COMMIT');
        return evidence;
      }
      this.db.prepare(`
        INSERT INTO financial_authorization_gate_nonces
        (chain_id, gate, nonce, intent_digest)
        VALUES (?, ?, ?, ?)
      `).run(i.chainId, i.verifyingContract.toLowerCase(), i.nonce, result.intentDigest);
      const evidence = this.insertEvidence({
        requestId: result.requestId, principal: i.principal, status: 'PRE_GATE_VALIDATED', reason: null,
        intentDigest: result.intentDigest, mandateDigest: result.mandateDigest, proofDigest: result.proofDigest, requestDigest, marketObservationDigest, disclosureBindingDigest,
        ...(disclosure ? { disclosureHistorySequence: disclosure.sequence, disclosurePolicyEpoch: disclosure.policyEpoch, disclosureCredentialEpoch: disclosure.credentialEpoch, disclosureHistoryRoot: disclosure.root, disclosureIssuer: disclosure.issuer, disclosureCredentialId: disclosure.credentialId } : {}), createdAt,
      });
      this.rememberRequest(i.principal, result.requestId, requestDigest, evidence.id);
      this.db.exec('COMMIT');
      return evidence;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
  }

  recordRejected(value: RejectedAuthorizationEvidence): AuthorizationEvidence {
    this.assertEvidenceChain();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const owner = value.principal.toLowerCase();
      const requestId = value.requestId ?? 'invalid-request';
      const prior = value.requestId ? this.findRequest(owner, requestId) : undefined;
      if (prior) {
        if (prior.request_digest === value.requestDigest) {
          const evidence = this.evidenceById(prior.evidence_id);
          this.db.exec('COMMIT');
          return evidence;
        }
        const evidence = this.insertConflict(requestId, owner, value.requestDigest, value.intentDigest, value.mandateDigest, value.createdAt);
        this.db.exec('COMMIT');
        return evidence;
      }
      const evidence = this.insertEvidence({
        requestId, principal: owner, status: 'REJECTED', reason: value.reason,
        intentDigest: value.intentDigest, mandateDigest: value.mandateDigest, proofDigest: null,
        requestDigest: value.requestDigest, createdAt: value.createdAt,
      });
      if (value.requestId) this.rememberRequest(owner, requestId, value.requestDigest, evidence.id);
      this.db.exec('COMMIT');
      return evidence;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
  }

  latest(requestId: string, principal: string): AuthorizationEvidence | null {
    this.assertEvidenceChain();
    const row = this.db.prepare(`
      SELECT evidence_id, request_id, principal, status, reason, intent_digest, mandate_digest, proof_digest, request_digest, previous_record_hash, record_hash, created_at
      FROM financial_authorization_evidence WHERE request_id=? AND principal=? ORDER BY evidence_id DESC LIMIT 1
    `).get(requestId, principal.toLowerCase()) as EvidenceRow | undefined;
    return row ? this.toEvidence(row) : null;
  }

  history(requestId: string, principal: string, before: string | null, limit: number): { events: AuthorizationEvidence[]; nextCursor: string | null } {
    this.assertEvidenceChain();
    const boundedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    const rows = (before
      ? this.db.prepare(`SELECT evidence_id, request_id, principal, status, reason, intent_digest, mandate_digest, proof_digest, request_digest, market_observation_digest, disclosure_binding_digest, disclosure_history_sequence, disclosure_policy_epoch, disclosure_credential_epoch, disclosure_history_root, disclosure_issuer, disclosure_credential_id, previous_record_hash, record_hash, created_at FROM financial_authorization_evidence WHERE request_id=? AND principal=? AND evidence_id<? ORDER BY evidence_id DESC LIMIT ?`).all(requestId, principal.toLowerCase(), before, boundedLimit + 1)
      : this.db.prepare(`SELECT evidence_id, request_id, principal, status, reason, intent_digest, mandate_digest, proof_digest, request_digest, market_observation_digest, disclosure_binding_digest, disclosure_history_sequence, disclosure_policy_epoch, disclosure_credential_epoch, disclosure_history_root, disclosure_issuer, disclosure_credential_id, previous_record_hash, record_hash, created_at FROM financial_authorization_evidence WHERE request_id=? AND principal=? ORDER BY evidence_id DESC LIMIT ?`).all(requestId, principal.toLowerCase(), boundedLimit + 1)) as unknown as EvidenceRow[];
    const hasMore = rows.length > boundedLimit;
    const page = rows.slice(0, boundedLimit).map((row) => this.toEvidence(row));
    return { events: page, nextCursor: hasMore && page.length ? page[page.length - 1]!.id : null };
  }

  byId(evidenceId: string, principal: string): AuthorizationEvidence | null {
    this.assertEvidenceChain();
    const row = this.db.prepare(`SELECT evidence_id, request_id, principal, status, reason, intent_digest, mandate_digest, proof_digest, request_digest, market_observation_digest, disclosure_binding_digest, disclosure_history_sequence, disclosure_policy_epoch, disclosure_credential_epoch, disclosure_history_root, disclosure_issuer, disclosure_credential_id, previous_record_hash, record_hash, created_at FROM financial_authorization_evidence WHERE evidence_id=? AND principal=?`).get(evidenceId, principal.toLowerCase()) as EvidenceRow | undefined;
    return row ? this.toEvidence(row) : null;
  }

  private findRequest(principal: string, requestId: string): RequestRow | undefined {
    return this.db.prepare('SELECT request_digest, first_evidence_id AS evidence_id FROM financial_authorization_requests WHERE principal=? AND request_id=?').get(principal, requestId) as RequestRow | undefined;
  }
  private evidenceById(id: number | bigint): AuthorizationEvidence {
    const row = this.db.prepare(`SELECT evidence_id, request_id, principal, status, reason, intent_digest, mandate_digest, proof_digest, request_digest, market_observation_digest, disclosure_binding_digest, disclosure_history_sequence, disclosure_policy_epoch, disclosure_credential_epoch, disclosure_history_root, disclosure_issuer, disclosure_credential_id, previous_record_hash, record_hash, created_at FROM financial_authorization_evidence WHERE evidence_id=?`).get(id) as EvidenceRow | undefined;
    if (!row) throw Error('IDEMPOTENCY_EVIDENCE_MISSING');
    return this.toEvidence(row);
  }
  private rememberRequest(principal: string, requestId: string, requestDigest: string, evidenceId: string): void {
    this.db.prepare('INSERT INTO financial_authorization_requests (principal, request_id, request_digest, first_evidence_id) VALUES (?, ?, ?, ?)').run(principal.toLowerCase(), requestId, requestDigest, evidenceId);
  }
  private insertConflict(requestId: string, principal: string, requestDigest: string, intentDigest: string | null, mandateDigest: string | null, createdAt: string): AuthorizationEvidence {
    return this.insertEvidence({ requestId, principal, status: 'REJECTED', reason: 'REQUEST_ID_CONFLICT', intentDigest, mandateDigest, proofDigest: null, requestDigest, createdAt });
  }
  private insertEvidence(value: {
    requestId: string; principal: string; status: 'PRE_GATE_VALIDATED' | 'REJECTED'; reason: string | null;
    intentDigest: string | null; mandateDigest: string | null; proofDigest: string | null; requestDigest: string | null; marketObservationDigest?: string | null; disclosureBindingDigest?: string | null; disclosureHistorySequence?: string | null; disclosurePolicyEpoch?: string | null; disclosureCredentialEpoch?: string | null; disclosureHistoryRoot?: string | null; disclosureIssuer?: string | null; disclosureCredentialId?: string | null; createdAt: string;
  }): AuthorizationEvidence {
    this.assertEvidenceChain();
    const chainHead = this.db.prepare('SELECT head_evidence_id, head_hash FROM financial_authorization_chain_meta WHERE singleton=1').get() as { head_evidence_id: string; head_hash: string } | undefined;
    if (!chainHead) throw Error('EVIDENCE_CHAIN_METADATA_MISSING');
    const result = this.db.prepare(`
      INSERT INTO financial_authorization_evidence
      (request_id, principal, status, reason, intent_digest, mandate_digest, proof_digest, request_digest, market_observation_digest, disclosure_binding_digest, disclosure_history_sequence, disclosure_policy_epoch, disclosure_credential_epoch, disclosure_history_root, disclosure_issuer, disclosure_credential_id, previous_record_hash, record_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(value.requestId, value.principal.toLowerCase(), value.status, value.reason,
      value.intentDigest, value.mandateDigest, value.proofDigest, value.requestDigest, value.marketObservationDigest ?? null, value.disclosureBindingDigest ?? null, value.disclosureHistorySequence ?? null, value.disclosurePolicyEpoch ?? null, value.disclosureCredentialEpoch ?? null, value.disclosureHistoryRoot ?? null, value.disclosureIssuer?.toLowerCase() ?? null, value.disclosureCredentialId?.toLowerCase() ?? null, chainHead.head_hash, value.createdAt);
    const row = this.db.prepare('SELECT evidence_id, request_id, principal, status, reason, intent_digest, mandate_digest, proof_digest, request_digest, market_observation_digest, disclosure_binding_digest, disclosure_history_sequence, disclosure_policy_epoch, disclosure_credential_epoch, disclosure_history_root, disclosure_issuer, disclosure_credential_id, previous_record_hash, record_hash, created_at FROM financial_authorization_evidence WHERE evidence_id=?').get(result.lastInsertRowid) as unknown as EvidenceRow;
    const recordHash = evidenceRecordHash(row, chainHead.head_hash);
    this.db.prepare('UPDATE financial_authorization_evidence SET record_hash=? WHERE evidence_id=?').run(recordHash, result.lastInsertRowid);
    this.db.prepare('UPDATE financial_authorization_chain_meta SET head_evidence_id=?, head_hash=? WHERE singleton=1').run(String(result.lastInsertRowid), recordHash);
    return {
      id: String(result.lastInsertRowid), requestId: value.requestId, principal: value.principal.toLowerCase(),
      status: value.status, reason: value.reason, intentDigest: value.intentDigest,
      mandateDigest: value.mandateDigest, proofDigest: value.proofDigest,
      requestDigest: value.requestDigest, ...(value.marketObservationDigest ? { marketObservationDigest: value.marketObservationDigest } : {}), ...(value.disclosureBindingDigest ? { disclosureBindingDigest: value.disclosureBindingDigest } : {}), ...(value.disclosureHistorySequence ? { disclosureHistorySequence: value.disclosureHistorySequence } : {}), ...(value.disclosurePolicyEpoch ? { disclosurePolicyEpoch: value.disclosurePolicyEpoch } : {}), ...(value.disclosureCredentialEpoch ? { disclosureCredentialEpoch: value.disclosureCredentialEpoch } : {}), ...(value.disclosureHistoryRoot ? { disclosureHistoryRoot: value.disclosureHistoryRoot } : {}), ...(value.disclosureIssuer ? { disclosureIssuer: value.disclosureIssuer.toLowerCase() } : {}), ...(value.disclosureCredentialId ? { disclosureCredentialId: value.disclosureCredentialId.toLowerCase() } : {}), createdAt: value.createdAt,
      previousRecordHash: chainHead.head_hash, recordHash,
    };
  }
  private toEvidence(row: EvidenceRow): AuthorizationEvidence {
    return {
      id: String(row.evidence_id), requestId: row.request_id, principal: row.principal,
      status: row.status, reason: row.reason, intentDigest: row.intent_digest,
      mandateDigest: row.mandate_digest, proofDigest: row.proof_digest,
      requestDigest: row.request_digest, ...(row.market_observation_digest ? { marketObservationDigest: row.market_observation_digest } : {}), ...(row.disclosure_binding_digest ? { disclosureBindingDigest: row.disclosure_binding_digest } : {}), ...(row.disclosure_history_sequence ? { disclosureHistorySequence: row.disclosure_history_sequence } : {}), ...(row.disclosure_policy_epoch ? { disclosurePolicyEpoch: row.disclosure_policy_epoch } : {}), ...(row.disclosure_credential_epoch ? { disclosureCredentialEpoch: row.disclosure_credential_epoch } : {}), ...(row.disclosure_history_root ? { disclosureHistoryRoot: row.disclosure_history_root } : {}), ...(row.disclosure_issuer ? { disclosureIssuer: row.disclosure_issuer } : {}), ...(row.disclosure_credential_id ? { disclosureCredentialId: row.disclosure_credential_id } : {}), createdAt: row.created_at,
      previousRecordHash: row.previous_record_hash, recordHash: row.record_hash,
    };
  }
}
