import { keccak256, toUtf8Bytes } from 'ethers';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentProposalService } from './agent-api.js';

export type AcceptedAgentProposal = ReturnType<AgentProposalService['propose']>;

export class AgentProposalReplayError extends Error {
  constructor(readonly code = 'AGENT_PROPOSAL_REPLAY') { super(code); }
}

export interface AgentRunRecord {
  readonly proposal: AcceptedAgentProposal;
  readonly objectiveDigest: string;
  readonly proposalDigest: string;
  readonly idempotent: boolean;
}

/**
 * Durable idempotency for authenticated proposal previews.
 * This records no authorization and triggers no execution. The on-chain Gate
 * still owns the final nonce decision for any future transaction.
 */
export class AgentProposalStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_proposals (
        chain_id TEXT NOT NULL,
        gate TEXT NOT NULL,
        principal TEXT NOT NULL,
        agent TEXT NOT NULL,
        credential_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        PRIMARY KEY (chain_id, gate, principal, agent, credential_id, nonce)
      ) STRICT, WITHOUT ROWID

      ;CREATE TABLE IF NOT EXISTS agent_run_requests (
        principal TEXT NOT NULL,
        request_id TEXT NOT NULL,
        objective_digest TEXT NOT NULL,
        proposal_digest TEXT NOT NULL,
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (principal, request_id)
      ) STRICT, WITHOUT ROWID
    `);
  }

  private objectiveDigest(objective: string): string {
    return keccak256(toUtf8Bytes('VEREQO_AGENT_OBJECTIVE_V1:' + objective.trim()));
  }

  private proposalDigest(proposal: AcceptedAgentProposal): { json: string; digest: string } {
    const json = JSON.stringify(proposal);
    if (Buffer.byteLength(json) > 32_768) throw new AgentProposalReplayError('AGENT_PROPOSAL_TOO_LARGE');
    return { json, digest: keccak256(toUtf8Bytes('VEREQO_AGENT_PROPOSAL_V1:' + json)) };
  }

  private storedRun(row: { objective_digest: string; proposal_digest: string; proposal_json: string }, expectedObjectiveDigest: string): AgentRunRecord {
    if (row.objective_digest !== expectedObjectiveDigest) throw new AgentProposalReplayError('AGENT_REQUEST_ID_CONFLICT');
    let proposal: unknown;
    try { proposal = JSON.parse(row.proposal_json) as unknown; } catch { throw Error('AGENT_RUN_RECORD_CORRUPT'); }
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) ||
        keccak256(toUtf8Bytes('VEREQO_AGENT_PROPOSAL_V1:' + row.proposal_json)) !== row.proposal_digest) {
      throw Error('AGENT_RUN_RECORD_CORRUPT');
    }
    return { proposal: proposal as AcceptedAgentProposal, objectiveDigest: row.objective_digest, proposalDigest: row.proposal_digest, idempotent: true };
  }

  /** Read-only idempotency lookup. Raw objective text is never persisted. */
  resolveRun(principal: string, requestId: string, objective: string): AgentRunRecord | null {
    const digest = this.objectiveDigest(objective);
    const row = this.db.prepare(`SELECT objective_digest, proposal_digest, proposal_json FROM agent_run_requests WHERE principal=? AND request_id=?`)
      .get(principal.toLowerCase(), requestId) as { objective_digest: string; proposal_digest: string; proposal_json: string } | undefined;
    return row ? this.storedRun(row, digest) : null;
  }

  /** Commit one immutable objective/proposal pair for a principal-scoped Request ID. */
  recordRun(principal: string, requestId: string, objective: string, proposal: AcceptedAgentProposal): AgentRunRecord {
    const owner = principal.toLowerCase();
    const objectiveDigest = this.objectiveDigest(objective);
    const { json, digest: proposalDigest } = this.proposalDigest(proposal);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare(`SELECT objective_digest, proposal_digest, proposal_json FROM agent_run_requests WHERE principal=? AND request_id=?`)
        .get(owner, requestId) as { objective_digest: string; proposal_digest: string; proposal_json: string } | undefined;
      if (existing) {
        const result = this.storedRun(existing, objectiveDigest);
        this.db.exec('COMMIT');
        return result;
      }
      this.db.prepare(`INSERT INTO agent_run_requests (principal, request_id, objective_digest, proposal_digest, proposal_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(owner, requestId, objectiveDigest, proposalDigest, json, new Date().toISOString());
      this.db.exec('COMMIT');
      return { proposal, objectiveDigest, proposalDigest, idempotent: false };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      if (error instanceof AgentProposalReplayError) throw error;
      const raced = this.db.prepare(`SELECT objective_digest, proposal_digest, proposal_json FROM agent_run_requests WHERE principal=? AND request_id=?`)
        .get(owner, requestId) as { objective_digest: string; proposal_digest: string; proposal_json: string } | undefined;
      if (raced) return this.storedRun(raced, objectiveDigest);
      throw error;
    }
  }

  record(proposal: AcceptedAgentProposal): AcceptedAgentProposal {
    const i = proposal.intent;
    const requestHash = keccak256(toUtf8Bytes(JSON.stringify({
      requestId: proposal.requestId,
      source: proposal.source,
      providerId: proposal.providerId,
      digest: proposal.preview.digest,
      marketRisk: proposal.marketRisk,
    })));

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare(`
        SELECT request_hash FROM agent_proposals
        WHERE chain_id=? AND gate=? AND principal=? AND agent=? AND credential_id=? AND nonce=?
      `).get(i.chainId, i.verifyingContract, i.principal, i.agent, i.credentialId, i.nonce) as
        { request_hash: string } | undefined;
      if (existing) {
        if (existing.request_hash !== requestHash) throw new AgentProposalReplayError();
        this.db.exec('COMMIT');
        return proposal;
      }
      this.db.prepare(`
        INSERT INTO agent_proposals
        (chain_id, gate, principal, agent, credential_id, nonce, request_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(i.chainId, i.verifyingContract, i.principal, i.agent, i.credentialId, i.nonce, requestHash);
      this.db.exec('COMMIT');
      return proposal;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
  }
}
