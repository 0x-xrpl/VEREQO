import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { AbiCoder, keccak256, toUtf8Bytes } from 'ethers';
import { admit, applyAnswer, INITIAL_CANDIDATES, normalizeQuery, validatePolicy } from '../../../packages/disclosure/src/index';
import type { DisclosurePolicy, DisclosurePreflight, DisclosureRecord, DisclosureView } from '../../../packages/domain/src/demo';

export interface Scope { issuer: string; subject: string; cohort: string }
export interface AuthContext { principal: string; scope: Scope }
export interface DisclosureHistoryHead { readonly historyRoot: string; readonly historySequence: string; readonly policyEpoch: string }
export type ErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED' | 'STALE_POLICY' | 'IDEMPOTENCY_CONFLICT' | 'CORRUPT_HISTORY' | 'DATABASE_UNAVAILABLE';
export class IssuerError extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
const identifier = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9._:-]{1,96}$/.test(s);
function scopeId(scope: Scope): string {
  if (!scope || !identifier(scope.issuer) || !identifier(scope.subject) || !identifier(scope.cohort)) throw new IssuerError('INVALID_INPUT');
  return JSON.stringify([scope.issuer, scope.subject, scope.cohort]);
}

/** SQLite is the release boundary. No answer may escape this class before COMMIT. */
export class IssuerStore {
  constructor(private readonly db: DatabaseSync, private readonly onWitnessRead: () => void = () => {}) {
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS witnesses (
        issuer TEXT NOT NULL, subject TEXT NOT NULL, value INTEGER NOT NULL CHECK(value BETWEEN 0 AND 127),
        PRIMARY KEY(issuer,subject));
      CREATE TABLE IF NOT EXISTS scopes (
        id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, cohort TEXT NOT NULL,
        policy_epoch INTEGER NOT NULL CHECK(policy_epoch>0),
        UNIQUE(issuer,subject,cohort), FOREIGN KEY(issuer,subject) REFERENCES witnesses(issuer,subject));
      CREATE TABLE IF NOT EXISTS policies (
        scope_id TEXT NOT NULL REFERENCES scopes(id), epoch INTEGER NOT NULL CHECK(epoch>0),
        floor INTEGER NOT NULL CHECK(floor BETWEEN 1 AND 128), PRIMARY KEY(scope_id,epoch));
      CREATE TABLE IF NOT EXISTS authorizations (
        principal TEXT NOT NULL, scope_id TEXT NOT NULL REFERENCES scopes(id), PRIMARY KEY(principal,scope_id));
      CREATE TABLE IF NOT EXISTS disclosures (
        scope_id TEXT NOT NULL REFERENCES scopes(id), sequence INTEGER NOT NULL CHECK(sequence>0),
        idempotency_key TEXT NOT NULL, request TEXT NOT NULL, record TEXT NOT NULL,
        PRIMARY KEY(scope_id,sequence), UNIQUE(scope_id,idempotency_key));
      CREATE TABLE IF NOT EXISTS disclosure_commitments (
        scope_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0), blind TEXT NOT NULL CHECK(length(blind)=66),
        PRIMARY KEY(scope_id,sequence), FOREIGN KEY(scope_id,sequence) REFERENCES disclosures(scope_id,sequence));
      CREATE TRIGGER IF NOT EXISTS witness_immutable BEFORE UPDATE ON witnesses BEGIN SELECT RAISE(ABORT,'immutable witness'); END;
      CREATE TRIGGER IF NOT EXISTS policy_immutable BEFORE UPDATE ON policies BEGIN SELECT RAISE(ABORT,'immutable policy'); END;
      CREATE TRIGGER IF NOT EXISTS policy_delete_immutable BEFORE DELETE ON policies BEGIN SELECT RAISE(ABORT,'immutable policy'); END;
      CREATE TRIGGER IF NOT EXISTS disclosure_immutable BEFORE UPDATE ON disclosures BEGIN SELECT RAISE(ABORT,'immutable transcript'); END;
      CREATE TRIGGER IF NOT EXISTS disclosure_delete_immutable BEFORE DELETE ON disclosures BEGIN SELECT RAISE(ABORT,'immutable transcript'); END;
      CREATE TRIGGER IF NOT EXISTS disclosure_commitment_immutable BEFORE UPDATE ON disclosure_commitments BEGIN SELECT RAISE(ABORT,'immutable commitment'); END;
      CREATE TRIGGER IF NOT EXISTS disclosure_commitment_delete_immutable BEFORE DELETE ON disclosure_commitments BEGIN SELECT RAISE(ABORT,'immutable commitment'); END;
    `);
    // Backfill opaque blinds for old transcripts. Blinds stay server-side so the public
    // root cannot be used as an offline oracle for the low-entropy disclosure answers.
    this.atomic(() => {
      const missing = db.prepare(`SELECT d.scope_id, d.sequence FROM disclosures d
        LEFT JOIN disclosure_commitments c ON c.scope_id=d.scope_id AND c.sequence=d.sequence
        WHERE c.sequence IS NULL ORDER BY d.scope_id, d.sequence`).all() as Array<{ scope_id: string; sequence: number | bigint }>;
      const insert = db.prepare('INSERT INTO disclosure_commitments(scope_id,sequence,blind) VALUES(?,?,?)');
      for (const row of missing) insert.run(row.scope_id, row.sequence, `0x${randomBytes(32).toString('hex')}`);
    });
  }

  close(): void { this.db.close(); }

  private atomic<T>(work: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try { const result = work(); this.db.exec('COMMIT'); return result; }
      catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* Never release staged data. */ } throw e; }
    } catch (e) { if (e instanceof IssuerError) throw e; throw new IssuerError('DATABASE_UNAVAILABLE'); }
  }

  /** Administrative local provisioning, never exposed as a requester endpoint. */
  provision(scope: Scope, principal: string, witness: number, policy: DisclosurePolicy = { epoch: 1, minCandidates: 16 }): void {
    const id = scopeId(scope);
    if (!identifier(principal) || !Number.isInteger(witness) || witness < 0 || witness > 127) throw new IssuerError('INVALID_INPUT');
    try { validatePolicy(policy); } catch { throw new IssuerError('INVALID_INPUT'); }
    this.atomic(() => {
      const oldWitness = this.db.prepare('SELECT value FROM witnesses WHERE issuer=? AND subject=?').get(scope.issuer, scope.subject);
      if (oldWitness && oldWitness.value !== witness) throw new IssuerError('INVALID_INPUT');
      if (!oldWitness) this.db.prepare('INSERT INTO witnesses VALUES(?,?,?)').run(scope.issuer, scope.subject, witness);
      const old = this.db.prepare('SELECT id FROM scopes WHERE id=?').get(id);
      if (!old) {
        this.db.prepare('INSERT INTO scopes VALUES(?,?,?,?,?)').run(id, scope.issuer, scope.subject, scope.cohort, policy.epoch);
        this.db.prepare('INSERT INTO policies VALUES(?,?,?)').run(id, policy.epoch, policy.minCandidates);
      }
      this.db.prepare('INSERT OR IGNORE INTO authorizations VALUES(?,?)').run(principal, id);
    });
  }

  private authorize(context: AuthContext): { id: string; policy: DisclosurePolicy } {
    const id = scopeId(context.scope);
    if (!identifier(context.principal)) throw new IssuerError('UNAUTHORIZED');
    if (!this.db.prepare('SELECT 1 FROM authorizations WHERE principal=? AND scope_id=?').get(context.principal, id)) throw new IssuerError('UNAUTHORIZED');
    const row = this.db.prepare('SELECT s.policy_epoch, p.floor FROM scopes s JOIN policies p ON p.scope_id=s.id AND p.epoch=s.policy_epoch WHERE s.id=?').get(id);
    if (!row) throw new IssuerError('CORRUPT_HISTORY');
    const policy = { epoch: Number(row.policy_epoch), minCandidates: Number(row.floor) };
    try { validatePolicy(policy); } catch { throw new IssuerError('CORRUPT_HISTORY'); }
    return { id, policy };
  }

  private replay(id: string, policy: DisclosurePolicy): DisclosureView {
    try {
      let candidates = [...INITIAL_CANDIDATES];
      const history: DisclosureRecord[] = [];
      const rows = this.db.prepare(`SELECT d.*, c.blind AS commitment_blind FROM disclosures d
        LEFT JOIN disclosure_commitments c ON c.scope_id=d.scope_id AND c.sequence=d.sequence
        WHERE d.scope_id=? ORDER BY d.sequence`).all(id);
      let lastEpoch = 0;
      for (const row of rows) {
        if (typeof row.commitment_blind !== 'string' || !/^0x[0-9a-f]{64}$/.test(row.commitment_blind)) throw new Error('MISSING_COMMITMENT');
        const record = JSON.parse(String(row.record)) as DisclosureRecord;
        if (record.sequence !== history.length + 1 || row.sequence !== record.sequence ||
          record.idempotencyKey !== row.idempotency_key || !identifier(record.idempotencyKey) ||
          record.policyEpoch < lastEpoch || record.policyEpoch > policy.epoch) throw new Error('INVALID_SEQUENCE');
        const query = normalizeQuery(record.query.threshold);
        if (JSON.stringify(record.query) !== JSON.stringify(query)) throw new Error('INVALID_QUERY');
        const historicalPolicy = this.db.prepare('SELECT floor FROM policies WHERE scope_id=? AND epoch=?').get(id, record.policyEpoch);
        if (!historicalPolicy) throw new Error('MISSING_POLICY');
        if (!record.partitions || Object.keys(record.partitions).sort().join(',') !== 'no,yes') throw new Error('INVALID_PARTITIONS');
        const decision = admit(candidates, query, { epoch: record.policyEpoch, minCandidates: Number(historicalPolicy.floor) });
        const expectedRequest = JSON.stringify({ query, policyEpoch: record.policyEpoch });
        if (row.request !== expectedRequest || decision.status !== record.status || decision.reason !== record.reason ||
          record.remainingBefore !== candidates.length || record.partitions.yes !== decision.partitions.yes ||
          record.partitions.no !== decision.partitions.no) throw new Error('INVALID_DECISION');
        if (record.status === 'ALLOWED') candidates = applyAnswer(candidates, query, record.answer as boolean);
        else if ('answer' in record) throw new Error('DENIAL_WITH_ANSWER');
        if (record.remainingAfter !== candidates.length) throw new Error('INVALID_REMAINING');
        const allowedKeys = ['sequence', 'query', 'policyEpoch', 'status', 'reason', 'partitions', 'remainingBefore', 'remainingAfter', 'idempotencyKey', ...(record.status === 'ALLOWED' ? ['answer'] : [])];
        if (Object.keys(record).some(k => !allowedKeys.includes(k))) throw new Error('INVALID_FIELDS');
        history.push(record); lastEpoch = record.policyEpoch;
      }
      return { candidates, history, policy };
    } catch (e) {
      if (e instanceof Error && 'code' in e && String(e.code).startsWith('ERR_SQLITE')) throw e;
      throw new IssuerError('CORRUPT_HISTORY');
    }
  }

  view(context: AuthContext): DisclosureView {
    return this.atomic(() => { const { id, policy } = this.authorize(context); return this.replay(id, policy); });
  }

  /** Return the current opaque, scope-specific history commitment for server-side issuer checks. */
  historyHead(context: AuthContext): DisclosureHistoryHead {
    return this.atomic(() => {
      const { id, policy } = this.authorize(context);
      const view = this.replay(id, policy);
      const scopeHash = keccak256(toUtf8Bytes(id));
      let root = keccak256(AbiCoder.defaultAbiCoder().encode(
        ['string', 'bytes32'], ['VEREQO_DISCLOSURE_HISTORY_V1_INITIAL', scopeHash],
      ));
      const rows = this.db.prepare(`SELECT d.sequence, d.record, c.blind FROM disclosures d
        JOIN disclosure_commitments c ON c.scope_id=d.scope_id AND c.sequence=d.sequence
        WHERE d.scope_id=? ORDER BY d.sequence`).all(id) as Array<{ sequence: number | bigint; record: string; blind: string }>;
      for (const row of rows) {
        if (!/^0x[0-9a-f]{64}$/.test(row.blind)) throw new IssuerError('CORRUPT_HISTORY');
        const recordHash = keccak256(toUtf8Bytes(row.record));
        root = keccak256(AbiCoder.defaultAbiCoder().encode(
          ['string', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'bytes32'],
          ['VEREQO_DISCLOSURE_HISTORY_V1_STEP', root, scopeHash, BigInt(row.sequence), recordHash, row.blind],
        ));
      }
      if (rows.length !== view.history.length) throw new IssuerError('CORRUPT_HISTORY');
      return Object.freeze({ historyRoot: root, historySequence: String(view.history.length), policyEpoch: String(policy.epoch) });
    });
  }

  /** Public-history-only proposal check; it neither reads a witness nor records a release. */
  preflight(context: AuthContext, input: { threshold: unknown; policyEpoch: number }): DisclosurePreflight {
    return this.atomic(() => {
      const { id, policy } = this.authorize(context);
      let query;
      try { query = normalizeQuery(input.threshold); } catch { throw new IssuerError('INVALID_INPUT'); }
      if (!Number.isSafeInteger(input.policyEpoch) || input.policyEpoch < 1) throw new IssuerError('INVALID_INPUT');
      if (input.policyEpoch !== policy.epoch) throw new IssuerError('STALE_POLICY');
      const view = this.replay(id, policy);
      return { query, policyEpoch: policy.epoch, minCandidates: policy.minCandidates,
        ...admit(view.candidates, query, policy), historySequence: view.history.length };
    });
  }

  request(context: AuthContext, input: { threshold: unknown; policyEpoch: number; idempotencyKey: string }): DisclosureRecord {
    let query;
    try { query = normalizeQuery(input.threshold); } catch { throw new IssuerError('INVALID_INPUT'); }
    if (!identifier(input.idempotencyKey) || !Number.isSafeInteger(input.policyEpoch) || input.policyEpoch < 1) throw new IssuerError('INVALID_INPUT');
    return this.atomic(() => {
      const { id, policy } = this.authorize(context);
      // Old releases are not renewed grants, even when their idempotency key exists.
      if (input.policyEpoch !== policy.epoch) throw new IssuerError('STALE_POLICY');
      const view = this.replay(id, policy);
      const request = JSON.stringify({ query, policyEpoch: policy.epoch });
      const previous = this.db.prepare('SELECT request, sequence FROM disclosures WHERE scope_id=? AND idempotency_key=?').get(id, input.idempotencyKey);
      if (previous) {
        if (previous.request !== request) throw new IssuerError('IDEMPOTENCY_CONFLICT');
        const saved = view.history.find(e => e.sequence === previous.sequence);
        if (!saved) throw new IssuerError('CORRUPT_HISTORY');
        return saved;
      }
      const decision = admit(view.candidates, query, policy);
      const record: DisclosureRecord = { sequence: view.history.length + 1, query, policyEpoch: policy.epoch,
        ...decision, remainingAfter: view.candidates.length, idempotencyKey: input.idempotencyKey };
      if (decision.status === 'ALLOWED') {
        this.onWitnessRead();
        const row = this.db.prepare('SELECT value FROM witnesses WHERE issuer=? AND subject=?').get(context.scope.issuer, context.scope.subject);
        if (!row || !view.candidates.includes(Number(row.value))) throw new IssuerError('CORRUPT_HISTORY');
        const answer = Number(row.value) <= query.threshold;
        record.answer = answer;
        record.remainingAfter = applyAnswer(view.candidates, query, answer).length;
      }
      this.db.prepare('INSERT INTO disclosures VALUES(?,?,?,?,?)').run(id, record.sequence, input.idempotencyKey, request, JSON.stringify(record));
      this.db.prepare('INSERT INTO disclosure_commitments(scope_id,sequence,blind) VALUES(?,?,?)')
        .run(id, record.sequence, `0x${randomBytes(32).toString('hex')}`);
      return record;
    });
  }

  /** Trusted administrator API. Knowledge survives an epoch change, including a stricter floor. */
  changePolicy(context: AuthContext, policy: DisclosurePolicy): DisclosureView {
    try { validatePolicy(policy); } catch { throw new IssuerError('INVALID_INPUT'); }
    return this.atomic(() => {
      const current = this.authorize(context);
      this.replay(current.id, current.policy);
      if (policy.epoch !== current.policy.epoch + 1) throw new IssuerError('STALE_POLICY');
      this.db.prepare('INSERT INTO policies VALUES(?,?,?)').run(current.id, policy.epoch, policy.minCandidates);
      this.db.prepare('UPDATE scopes SET policy_epoch=? WHERE id=?').run(policy.epoch, current.id);
      return this.replay(current.id, policy);
    });
  }
}
