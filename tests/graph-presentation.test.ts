import { describe, expect, it } from 'vitest';
import { applyGraphCommand, createDemoGraph } from '../packages/consequence/src/index';
import { selectedGraphEvidence } from '../apps/web/src/graphPresentation';

describe('Living Board authoritative presentation', () => {
  const original = createDemoGraph();
  const result = applyGraphCommand(original, { type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', eventId: 'presentation-regression', expectedSequence: 0 });
  it('keeps affected membership separate from the exact selected explanation', () => {
    const view = selectedGraphEvidence(result.snapshot, result.changes, 'action_A');
    expect(view.affectedIds).toHaveLength(6);
    expect(view.affectedIds).toContain('claim_A');
    expect(view.path).toEqual(['credential_A', 'permission_A', 'intent_A', 'action_A']);
    expect(view.path).not.toContain('claim_A');
    for (let index = 1; index < view.path.length; index++) {
      expect(result.snapshot.edges.some(edge => edge.type === 'AFFECTS'
        ? edge.from === view.path[index - 1] && edge.to === view.path[index]
        : edge.to === view.path[index - 1] && edge.from === view.path[index])).toBe(true);
    }
  });
  it('never gives independent B the changed A path or a fabricated transition', () => {
    const view = selectedGraphEvidence(result.snapshot, result.changes, 'action_B');
    expect(view.node?.state).toBe('VALID');
    expect(view.change).toBeUndefined();
    expect(view.path).toEqual([]);
    expect(view.relationships).toEqual([{ from: 'action_B', to: 'intent_B', type: 'DEPENDS_ON' }]);
    expect(view.affectedIds.some(id => id.endsWith('_B'))).toBe(false);
    expect(original.sequence).toBe(0);
    expect(result.snapshot.sequence).toBe(1);
  });
});
