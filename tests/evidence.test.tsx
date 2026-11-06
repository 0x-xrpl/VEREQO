// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { createDemoGraph, applyGraphCommand } from '../packages/consequence/src/index';
import { CausalEvidence } from '../apps/web/src/components/CausalEvidence';
import type { DemoState } from '../packages/domain/src/demo';

describe('separate evidence namespaces', () => {
  it('never presents hypothetical graph sequence or disclosure epoch as a committed graph record', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const graph = createDemoGraph();
    const command = { type: 'REVOKE_CREDENTIAL' as const, nodeId: 'credential_A', eventId: 'evidence-record', expectedSequence: 0 };
    const result = applyGraphCommand(graph, command);
    const state: DemoState = { environment: 'LOCAL_REFERENCE', graph, lastChanges: [], requestToken: 'a'.repeat(48), disclosure: { candidates: Array.from({ length:128 }, (_, i) => i), history: [], policy: { epoch: 7, minCandidates:16 } }, capabilities: { proof:'NOT_IMPLEMENTED', authorization:'NOT_IMPLEMENTED', execution:'NOT_IMPLEMENTED' } };
    const host = document.createElement('div'), root = createRoot(host);
    try {
      await act(async () => root.render(<CausalEvidence language="en" mode="impact" state={state} preview={{ ...result, command }} selected="credential_A" preflight={null} depth={3} onDepth={() => {}} unknown={false}/>));
      const value = (id: string) => host.querySelector(`[data-testid="${id}"] dd`)?.textContent;
      expect(value('evidence-graph-sequence')).toBe('0');
      expect(value('evidence-preview-sequence')).toBe('1');
      expect(value('evidence-node-epoch')).toBe('2');
      expect(host.querySelector('[data-testid="evidence-disclosure-epoch"]')).toBeNull();
      expect(host.querySelector('[data-testid="capability-boundary"]')?.textContent).toContain('NOT IMPLEMENTED');
      await act(async () => root.render(<CausalEvidence language="en" mode="disclosure" state={state} preview={{ ...result, command }} selected="credential_A" preflight={null} depth={3} onDepth={() => {}} unknown={true}/>));
      expect(value('evidence-disclosure-epoch')).toBe('7');
      expect(host.querySelector('[data-testid="evidence-graph-sequence"]')).toBeNull();
      expect(host.textContent).toContain('latest server outcome is unknown');
    } finally { await act(async () => root.unmount()); delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT; }
  });
});
