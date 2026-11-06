import type { GraphSnapshot, NodeChange } from '../../../packages/consequence/src/index';

/** Presentation of authoritative records, never a second graph evaluator. */
export function selectedGraphEvidence(graph: GraphSnapshot, changes: readonly NodeChange[], selected: string) {
  const node = graph.nodes.find(entry => entry.id === selected);
  const change = changes.find(entry => entry.nodeId === selected);
  return {
    node, change,
    path: change ? [...change.path] : [],
    affectedIds: [...new Set(changes.map(entry => entry.nodeId))],
    relationships: graph.edges.filter(edge => edge.from === selected || edge.to === selected),
  };
}
