import { describe, expect, it } from 'vitest';
import { applyGraphCommand, createDemoGraph, downstreamNodeIds } from '../packages/consequence/src/index';

describe('directed inspection scope', () => {
  it('counts all reachable affected nodes even when canonical explanations choose shorter bypasses', () => {
    const graph = createDemoGraph();
    const result = applyGraphCommand(graph, { type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', eventId: 'inspect', expectedSequence: 0 });
    expect(result.changes.filter(change => change.path.includes('claim_A')).length).toBeLessThan(5);
    const reachable = downstreamNodeIds(result.snapshot, 'claim_A');
    expect(reachable).toEqual(['action_A', 'claim_A', 'intent_A', 'permission_A', 'proof_A']);
    expect(result.changes.filter(change => reachable.includes(change.nodeId))).toHaveLength(5);
    expect(downstreamNodeIds(result.snapshot, 'credential_A')).toHaveLength(6);
    expect(downstreamNodeIds(result.snapshot, 'action_A')).toEqual(['action_A']);
    expect(downstreamNodeIds(result.snapshot, 'credential_A').some(id => id.endsWith('_B'))).toBe(false);
    expect(graph.sequence).toBe(0);
  });
  it('uses semantic edge direction and rejects unknown nodes or malformed graph', () => {
    const graph = createDemoGraph();
    expect(downstreamNodeIds(graph, 'issuer_A')).toContain('credential_A');
    expect(downstreamNodeIds(graph, 'credential_A')).not.toContain('issuer_A');
    expect(() => downstreamNodeIds(graph, 'unknown')).toThrow('MISSING_NODE');
    graph.edges.push({ from: 'action_A', to: 'credential_A', type: 'AFFECTS' });
    expect(() => downstreamNodeIds(graph, 'credential_A')).toThrow('CYCLE');
  });
});
