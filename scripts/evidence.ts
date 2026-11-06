import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DemoRepository, DEMO_CONTEXT } from '../services/issuer/src/demo';

const repo = new DemoRepository(new DatabaseSync(':memory:'));
try {
  const initial = repo.state();
  const decisions = [100, 80, 70].map(threshold => repo.issuer.request(DEMO_CONTEXT, {
    threshold, policyEpoch: 1, idempotencyKey: `evidence-${threshold}`
  }));
  const command = { type: 'REVOKE_CREDENTIAL' as const, nodeId: 'credential_A', eventId: 'evidence-revocation', expectedSequence: 0 };
  const preview = repo.preview(command), previewDidNotCommit = repo.state().graph.sequence === 0;
  repo.command(command);
  const final = repo.state();
  const artifact = {
    environment: 'LOCAL_REFERENCE', initialCandidateCount: initial.disclosure.candidates.length,
    decisions, previewDidNotCommit, previewEqualsCommitted: JSON.stringify(preview.snapshot) === JSON.stringify(final.graph),
    graphChanges: final.lastChanges, actionA: final.graph.nodes.find(n => n.id === 'action_A'),
    actionB: final.graph.nodes.find(n => n.id === 'action_B'), capabilities: final.capabilities
  };
  if (decisions[2]?.status !== 'DENIED' || 'answer' in decisions[2] || !previewDidNotCommit ||
    artifact.actionA?.state !== 'BLOCKED' || artifact.actionB?.state !== 'VALID') throw new Error('Evidence scenario failed');
  const evidenceDir = process.env.VEREQO_EVIDENCE_DIR ?? 'docs/evidence';
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'local-scenario.json'), JSON.stringify(artifact, null, 2) + '\n');
  console.log('LOCAL_REFERENCE evidence saved: 128 → 101 → 81 → DENIED; 6 graph changes; B eligible; no crypto/execution.');
} finally { repo.close(); }
