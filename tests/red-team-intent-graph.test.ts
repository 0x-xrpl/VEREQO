import { describe, expect, it } from 'vitest';
import { applyGraphCommand, previewGraphCommand, validateGraph,
  type GraphCommand, type GraphSnapshot } from '../packages/consequence/src/index';

describe('bounded causal explanations', () => {
  it.each(['REVOKE_CREDENTIAL', 'CHANGE_POLICY'] as const)('supports long paths and identifiers for %s', type => {
    const ids = Array.from({ length: 8 }, (_, index) => `${index}${'x'.repeat(95)}`);
    const independent = { id: 'action_B', type: 'ACTION', label: 'Independent B', state: 'VALID', epoch: 1 } as const;
    const graph: GraphSnapshot = {
      nodes: [...ids.map((id, index) => ({ id, type: index === 0
        ? type === 'REVOKE_CREDENTIAL' ? 'CREDENTIAL' as const : 'POLICY' as const
        : 'ACTION' as const, label: 'Long path', state: 'VALID' as const, epoch: 1 })), independent],
      edges: ids.slice(1).map((id, index) => ({ from: ids[index]!, to: id, type: 'AFFECTS' })),
      sequence: 0, events: [],
    };
    const command: GraphCommand = type === 'REVOKE_CREDENTIAL'
      ? { type, nodeId: ids[0]!, eventId: 'long-revoke', expectedSequence: 0 }
      : { type, nodeId: ids[0]!, newEpoch: 2, eventId: 'long-policy', expectedSequence: 0 };
    const original = structuredClone(graph);
    expect(() => validateGraph(graph)).not.toThrow();
    const preview = previewGraphCommand(graph, command);
    const result = applyGraphCommand(graph, command);
    expect(preview).toEqual(result);
    expect(graph).toEqual(original);
    expect(result.changes).toHaveLength(ids.length);
    expect(() => validateGraph(result.snapshot)).not.toThrow();
    expect(result.snapshot.nodes.find(node => node.id === independent.id)).toEqual(independent);
    for (const [index, id] of ids.entries()) {
      const change = result.changes.find(value => value.nodeId === id)!;
      expect(change.path).toEqual(ids.slice(0, index + 1));
      expect(change.reason.length).toBeLessThanOrEqual(512);
      expect(change.reason).toContain(ids[0]);
      expect(change.reason).toContain(id);
      if (index > 0) {
        expect(change.reason).toContain(ids[index - 1]);
        expect(change.after).toBe(type === 'REVOKE_CREDENTIAL' ? 'BLOCKED' : 'STALE');
      }
    }
  });
});
