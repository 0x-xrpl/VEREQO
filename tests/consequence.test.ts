import { describe, expect, it } from 'vitest';
import {
  EDGE_TYPES, NODE_TYPES, GraphError, applyGraphCommand, createDemoGraph,
  previewGraphCommand, validateGraph,
  type GraphCommand, type GraphSnapshot,
} from '../packages/consequence/src/index';

const revoke = (eventId = 'revoke-A', expectedSequence = 0): GraphCommand => ({ type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', eventId, expectedSequence });
const policy = (newEpoch = 2, eventId = 'policy-A', expectedSequence = 0): GraphCommand => ({ type: 'CHANGE_POLICY', nodeId: 'policy_A', newEpoch, eventId, expectedSequence });
const node = (graph: GraphSnapshot, id: string) => graph.nodes.find(value => value.id === id)!;
const code = (run: () => unknown, expected: string) => {
  expect(run).toThrow(GraphError);
  expect(run).toThrow(expected);
};

describe('deterministic consequence graph', () => {
  it('contains every required node and relation, with two independent lanes', () => {
    const graph = createDemoGraph();
    expect(new Set(graph.nodes.map(value => value.type))).toEqual(new Set(NODE_TYPES));
    expect(new Set(graph.edges.map(value => value.type))).toEqual(new Set(EDGE_TYPES));
    expect(graph.nodes).toHaveLength(16);
    expect(graph.sequence).toBe(0);
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it('revokes exactly A dependencies, preserves B, and explains each actual change', () => {
    const before = createDemoGraph(); const serialized = JSON.stringify(before);
    const { snapshot, changes } = applyGraphCommand(before, revoke());
    expect(changes.map(value => value.nodeId).sort()).toEqual(['credential_A', 'claim_A', 'proof_A', 'permission_A', 'intent_A', 'action_A'].sort());
    expect(node(snapshot, 'credential_A')).toMatchObject({ state: 'REVOKED', epoch: 2 });
    expect(node(snapshot, 'action_A').state).toBe('BLOCKED');
    expect(snapshot.nodes.filter(value => value.id.endsWith('_B'))).toEqual(before.nodes.filter(value => value.id.endsWith('_B')));
    expect(node(snapshot, 'issuer_A').state).toBe('VALID');
    expect(node(snapshot, 'policy_A').state).toBe('VALID');
    for (const change of changes) {
      expect(change.path[0]).toBe('credential_A');
      expect(change.path.at(-1)).toBe(change.nodeId);
      expect(change.reason).toContain(change.nodeId);
    }
    expect(snapshot.events).toEqual([{ sequence: 1, eventId: 'revoke-A', command: revoke(), changes }]);
    expect(JSON.stringify(before)).toBe(serialized);
  });

  it('uses prerequisite edge direction, never visual adjacency or shared node type', () => {
    const graph = createDemoGraph();
    graph.nodes.reverse();
    const result = applyGraphCommand(graph, revoke());
    expect(node(result.snapshot, 'action_B').state).toBe('VALID');
    expect(node(result.snapshot, 'issuer_A').state).toBe('VALID');
    expect(result.changes.some(value => value.nodeId === 'proof_A')).toBe(true);
  });

  it('supports an explicitly declared forward AFFECTS edge across lanes', () => {
    const graph = createDemoGraph();
    graph.edges.push({ from: 'credential_A', to: 'action_B', type: 'AFFECTS' });
    const { snapshot, changes } = applyGraphCommand(graph, revoke());
    expect(node(snapshot, 'action_B').state).toBe('BLOCKED');
    expect(node(snapshot, 'credential_B').state).toBe('VALID');
    expect(changes.find(value => value.nodeId === 'action_B')?.path).toEqual(['credential_A', 'action_B']);
  });

  it('policy epoch advances only dependent bindings to STALE without revoking credentials', () => {
    const before = createDemoGraph();
    const { snapshot, changes } = applyGraphCommand(before, policy());
    expect(changes.map(value => value.nodeId).sort()).toEqual(['policy_A', 'permission_A', 'intent_A', 'action_A'].sort());
    expect(node(snapshot, 'policy_A')).toMatchObject({ epoch: 2, state: 'VALID' });
    expect(node(snapshot, 'credential_A').state).toBe('VALID');
    expect(node(snapshot, 'proof_A').state).toBe('VALID');
    expect(node(snapshot, 'action_A').state).toBe('STALE');
    expect(node(snapshot, 'action_B').state).toBe('VALID');
  });

  it('a policy change never repairs a revoked or blocked path', () => {
    const revoked = applyGraphCommand(createDemoGraph(), revoke()).snapshot;
    const changed = applyGraphCommand(revoked, policy(2, 'policy-after-revocation', 1));
    expect(changed.changes.map(value => value.nodeId)).toEqual(['policy_A']);
    expect(node(changed.snapshot, 'credential_A').state).toBe('REVOKED');
    expect(node(changed.snapshot, 'action_A').state).toBe('BLOCKED');
    expect(changed.snapshot.sequence).toBe(2);
  });

  it('revocation supersedes stale dependent state', () => {
    const stale = applyGraphCommand(createDemoGraph(), policy()).snapshot;
    const blocked = applyGraphCommand(stale, revoke('revoke-after-policy', 1));
    expect(node(blocked.snapshot, 'action_A').state).toBe('BLOCKED');
    expect(blocked.changes.find(value => value.nodeId === 'action_A')).toMatchObject({ before: 'STALE', after: 'BLOCKED' });
  });

  it('WHAT-IF exactly predicts a commit and never mutates its input', () => {
    const graph = createDemoGraph(); const original = JSON.stringify(graph);
    const preview = previewGraphCommand(graph, revoke());
    expect(JSON.stringify(graph)).toBe(original);
    expect(graph.events).toHaveLength(0);
    expect(preview).toEqual(applyGraphCommand(graph, revoke()));
    preview.snapshot.nodes[0]!.label = 'Changed preview only';
    expect(JSON.stringify(graph)).toBe(original);
  });

  it('is deterministic under arbitrary input order and has stable causal paths', () => {
    const graph = createDemoGraph();
    const permuted = structuredClone(graph);
    permuted.nodes.reverse(); permuted.edges.reverse();
    expect(applyGraphCommand(permuted, revoke())).toEqual(applyGraphCommand(graph, revoke()));
  });

  it('commits consecutive events and treats the same command retry as a no-op', () => {
    const first = applyGraphCommand(createDemoGraph(), revoke()).snapshot;
    const retry = applyGraphCommand(first, revoke());
    expect(retry.snapshot).toEqual(first);
    expect(retry.changes).toEqual([]);
    const second = applyGraphCommand(first, policy(2, 'next', 1)).snapshot;
    expect(second.events.map(value => value.sequence)).toEqual([1, 2]);
    expect(applyGraphCommand(second, revoke()).snapshot).toEqual(second);
  });

  it('rejects reused event IDs bound to a different canonical command', () => {
    const graph = applyGraphCommand(createDemoGraph(), revoke()).snapshot;
    code(() => applyGraphCommand(graph, { ...revoke(), nodeId: 'credential_B' }), 'IDEMPOTENCY_CONFLICT');
    code(() => applyGraphCommand(graph, { ...revoke(), expectedSequence: 1 }), 'IDEMPOTENCY_CONFLICT');
  });

  it('rejects stale concurrent updates and repeated revocation with a new event ID', () => {
    const graph = applyGraphCommand(createDemoGraph(), revoke()).snapshot;
    code(() => applyGraphCommand(graph, policy()), 'STALE_SEQUENCE');
    code(() => applyGraphCommand(graph, revoke('again', 1)), 'ALREADY_REVOKED');
  });

  it.each([0, 1, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects a non-monotonic/malformed policy epoch %s', epoch => {
    code(() => applyGraphCommand(createDemoGraph(), policy(epoch)), epoch === 1 ? 'NON_MONOTONIC_EPOCH' : 'MALFORMED_COMMAND');
  });

  it('rejects unknown targets and wrong target types', () => {
    code(() => applyGraphCommand(createDemoGraph(), { ...revoke(), nodeId: 'unknown' }), 'MISSING_NODE');
    code(() => applyGraphCommand(createDemoGraph(), { ...revoke(), nodeId: 'issuer_A' }), 'WRONG_COMMAND_TARGET');
    code(() => applyGraphCommand(createDemoGraph(), { ...policy(), nodeId: 'credential_A' }), 'WRONG_COMMAND_TARGET');
  });

  it('rejects credential epoch overflow', () => {
    const graph = createDemoGraph(); node(graph, 'credential_A').epoch = Number.MAX_SAFE_INTEGER;
    code(() => applyGraphCommand(graph, revoke()), 'EPOCH_OVERFLOW');
  });

  it.each([null, {}, { nodes: [], edges: [], events: [], sequence: 0 }, { nodes: [], edges: [], events: [], sequence: -1 }])('rejects malformed snapshots', graph => {
    code(() => validateGraph(graph), 'MALFORMED_GRAPH');
  });

  it('rejects malformed nodes, duplicate IDs and illegal states', () => {
    const duplicate = createDemoGraph(); duplicate.nodes.push(structuredClone(duplicate.nodes[0]!));
    code(() => validateGraph(duplicate), 'DUPLICATE_NODE');
    const badNode = createDemoGraph(); node(badNode, 'credential_A').epoch = 0;
    code(() => validateGraph(badNode), 'MALFORMED_NODE');
    const badState = createDemoGraph(); node(badState, 'issuer_A').state = 'REVOKED';
    code(() => validateGraph(badState), 'INVALID_NODE_STATE');
  });

  it('rejects missing endpoints, duplicate edges and incorrect relation types', () => {
    const missing = createDemoGraph(); missing.edges.push({ from: 'missing', to: 'credential_A', type: 'AFFECTS' });
    code(() => validateGraph(missing), 'MISSING_NODE');
    const duplicate = createDemoGraph(); duplicate.edges.push(structuredClone(duplicate.edges[0]!));
    code(() => validateGraph(duplicate), 'DUPLICATE_EDGE');
    const wrongTypes = createDemoGraph(); wrongTypes.edges.push({ from: 'action_A', to: 'issuer_A', type: 'ISSUED_BY' });
    code(() => validateGraph(wrongTypes), 'INVALID_EDGE_TYPES');
  });

  it('rejects self cycles and multi-node cycles even across mixed edge directions', () => {
    const self = createDemoGraph(); self.edges.push({ from: 'action_A', to: 'action_A', type: 'AFFECTS' });
    code(() => validateGraph(self), 'CYCLE');
    const cycle = createDemoGraph(); cycle.edges.push({ from: 'action_A', to: 'issuer_A', type: 'AFFECTS' });
    code(() => validateGraph(cycle), 'CYCLE');
  });

  it('rejects a snapshot claiming a valid dependent of a revoked credential', () => {
    const graph = createDemoGraph(); node(graph, 'credential_A').state = 'REVOKED';
    code(() => validateGraph(graph), 'INCONSISTENT_NODE_STATE');
  });

  it('rejects missing event sequences, duplicate event IDs and malformed explanation paths', () => {
    const mismatch = applyGraphCommand(createDemoGraph(), revoke()).snapshot;
    mismatch.sequence = 2;
    code(() => validateGraph(mismatch), 'MALFORMED_GRAPH');
    const duplicate = applyGraphCommand(applyGraphCommand(createDemoGraph(), revoke()).snapshot, policy(2, 'second', 1)).snapshot;
    duplicate.events[1]!.eventId = 'revoke-A'; duplicate.events[1]!.command.eventId = 'revoke-A';
    code(() => validateGraph(duplicate), 'MALFORMED_EVENT');
    const invalidPath = applyGraphCommand(createDemoGraph(), revoke()).snapshot;
    invalidPath.events[0]!.changes.find(value => value.nodeId === 'action_A')!.path = ['credential_A', 'action_B', 'action_A'];
    code(() => validateGraph(invalidPath), 'MALFORMED_CHANGE');
  });

  it('rejects current states or epochs that contradict their latest committed events', () => {
    const wrongState = applyGraphCommand(createDemoGraph(), policy()).snapshot;
    for (const value of wrongState.nodes) value.state = 'VALID';
    code(() => validateGraph(wrongState), 'INCONSISTENT_EVENT_STATE');
    const wrongEpoch = applyGraphCommand(createDemoGraph(), policy()).snapshot;
    node(wrongEpoch, 'policy_A').epoch = 3;
    code(() => validateGraph(wrongEpoch), 'INCONSISTENT_EVENT_EPOCH');
  });

  it('rejects a historical before-state that contradicts the previous event', () => {
    const graph = applyGraphCommand(applyGraphCommand(createDemoGraph(), policy()).snapshot, revoke('after-policy', 1)).snapshot;
    graph.events[1]!.changes.find(value => value.nodeId === 'action_A')!.before = 'VALID';
    code(() => validateGraph(graph), 'INCONSISTENT_EVENT_STATE');
  });

  it('rejects malformed commands and unknown properties instead of ignoring them', () => {
    const malformed = { ...revoke(), witness: 74 } as unknown as GraphCommand;
    code(() => applyGraphCommand(createDemoGraph(), malformed), 'MALFORMED_COMMAND');
    code(() => applyGraphCommand(createDemoGraph(), { ...revoke(), expectedSequence: -1 }), 'MALFORMED_COMMAND');
  });
});
