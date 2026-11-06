/** Pending eligibility only: these states never assert financial execution. */
export const NODE_TYPES = ['ISSUER', 'CREDENTIAL', 'CLAIM', 'PROOF', 'POLICY', 'PERMISSION', 'INTENT', 'ACTION'] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export const NODE_STATES = ['VALID', 'REVOKED', 'STALE', 'BLOCKED'] as const;
export type NodeState = (typeof NODE_STATES)[number];
export const EDGE_TYPES = ['ISSUED_BY', 'DEPENDS_ON', 'AUTHORIZED_BY', 'BOUND_TO', 'REVOKED_BY', 'AFFECTS'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export interface GraphNode { id: string; type: NodeType; label: string; state: NodeState; epoch: number }
export interface GraphEdge { from: string; to: string; type: EdgeType }
export interface NodeChange { nodeId: string; before: NodeState; after: NodeState; reason: string; path: string[] }
export type GraphCommand =
  | { type: 'REVOKE_CREDENTIAL'; nodeId: string; eventId: string; expectedSequence: number }
  | { type: 'CHANGE_POLICY'; nodeId: string; newEpoch: number; eventId: string; expectedSequence: number };
export interface GraphEvent { sequence: number; eventId: string; command: GraphCommand; changes: NodeChange[] }
export interface GraphSnapshot { nodes: GraphNode[]; edges: GraphEdge[]; sequence: number; events: GraphEvent[] }
export interface GraphResult { snapshot: GraphSnapshot; changes: NodeChange[] }

export class GraphError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'GraphError'; }
}

const pairs: Record<Exclude<EdgeType, 'AFFECTS'>, readonly string[]> = {
  ISSUED_BY: ['CREDENTIAL:ISSUER'],
  DEPENDS_ON: ['CLAIM:CREDENTIAL', 'PROOF:CLAIM', 'PROOF:CREDENTIAL', 'PERMISSION:PROOF', 'PERMISSION:POLICY', 'INTENT:PERMISSION', 'ACTION:INTENT'],
  AUTHORIZED_BY: ['PERMISSION:POLICY', 'INTENT:PERMISSION', 'ACTION:PERMISSION'],
  BOUND_TO: ['PROOF:CREDENTIAL', 'PROOF:POLICY', 'INTENT:CREDENTIAL', 'INTENT:POLICY'],
  REVOKED_BY: ['CREDENTIAL:ISSUER', 'PERMISSION:CREDENTIAL'],
};
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
function fail(code: string): never { throw new GraphError(code); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, i) => key === [...keys].sort()[i]);
}
function identifier(value: unknown): value is string { return typeof value === 'string' && idPattern.test(value); }
function integer(value: unknown, minimum = 0): value is number { return Number.isSafeInteger(value) && (value as number) >= minimum; }
function state(value: unknown): value is NodeState { return NODE_STATES.includes(value as NodeState); }
function clone<T>(value: T): T { return structuredClone(value); }
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function edgeKey(edge: GraphEdge): string { return `${edge.from}|${edge.to}|${edge.type}`; }

function validateCommand(value: unknown): asserts value is GraphCommand {
  if (!record(value) || !identifier(value.nodeId) || !identifier(value.eventId) || !integer(value.expectedSequence)) fail('MALFORMED_COMMAND');
  if (value.type === 'REVOKE_CREDENTIAL') {
    if (!exactKeys(value, ['type', 'nodeId', 'eventId', 'expectedSequence'])) fail('MALFORMED_COMMAND');
  } else if (value.type === 'CHANGE_POLICY') {
    if (!exactKeys(value, ['type', 'nodeId', 'newEpoch', 'eventId', 'expectedSequence']) || !integer(value.newEpoch, 1)) fail('MALFORMED_COMMAND');
  } else fail('MALFORMED_COMMAND');
}

/** All relationships are converted to prerequisite -> dependent arcs. */
function arcs(graph: GraphSnapshot): Map<string, string[]> {
  const result = new Map(graph.nodes.map(node => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    const source = edge.type === 'AFFECTS' ? edge.from : edge.to;
    const target = edge.type === 'AFFECTS' ? edge.to : edge.from;
    const outgoing = result.get(source);
    if (!outgoing) fail('MISSING_NODE');
    if (!outgoing.includes(target)) outgoing.push(target);
  }
  for (const outgoing of result.values()) outgoing.sort(compare);
  return result;
}

function topologicalOrder(graph: GraphSnapshot, adjacency: Map<string, string[]>): string[] {
  const indegree = new Map(graph.nodes.map(node => [node.id, 0]));
  for (const outgoing of adjacency.values()) for (const target of outgoing) indegree.set(target, (indegree.get(target) ?? 0) + 1);
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort(compare);
  const result: string[] = [];
  while (ready.length) {
    const source = ready.shift();
    if (source === undefined) fail('MALFORMED_GRAPH');
    result.push(source);
    for (const target of adjacency.get(source) ?? []) {
      const count = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, count);
      if (count === 0) { ready.push(target); ready.sort(compare); }
    }
  }
  if (result.length !== graph.nodes.length) fail('CYCLE');
  return result;
}

/** Validates complete, bounded snapshots before they can drive a transition. */
export function validateGraph(value: unknown): asserts value is GraphSnapshot {
  if (!record(value) || !exactKeys(value, ['nodes', 'edges', 'sequence', 'events']) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.events) || !integer(value.sequence)) fail('MALFORMED_GRAPH');
  if (value.nodes.length === 0 || value.nodes.length > 256 || value.edges.length > 2048 || value.events.length > 10000 || value.sequence !== value.events.length) fail('MALFORMED_GRAPH');
  const nodes = new Map<string, GraphNode>();
  for (const node of value.nodes) {
    if (!record(node) || !exactKeys(node, ['id', 'type', 'label', 'state', 'epoch']) || !identifier(node.id) || !NODE_TYPES.includes(node.type as NodeType) || typeof node.label !== 'string' || node.label.trim().length === 0 || node.label.length > 120 || !state(node.state) || !integer(node.epoch, 1)) fail('MALFORMED_NODE');
    if (nodes.has(node.id)) fail('DUPLICATE_NODE');
    if (node.state === 'REVOKED' && node.type !== 'CREDENTIAL') fail('INVALID_NODE_STATE');
    nodes.set(node.id, node as unknown as GraphNode);
  }
  const edges = new Set<string>();
  for (const edge of value.edges) {
    if (!record(edge) || !exactKeys(edge, ['from', 'to', 'type']) || !identifier(edge.from) || !identifier(edge.to) || !EDGE_TYPES.includes(edge.type as EdgeType)) fail('MALFORMED_EDGE');
    const source = nodes.get(edge.from); const target = nodes.get(edge.to);
    if (!source || !target) fail('MISSING_NODE');
    if (source.id === target.id) fail('CYCLE');
    if (edge.type !== 'AFFECTS' && !pairs[edge.type as Exclude<EdgeType, 'AFFECTS'>].includes(`${source.type}:${target.type}`)) fail('INVALID_EDGE_TYPES');
    const key = edgeKey(edge as unknown as GraphEdge);
    if (edges.has(key)) fail('DUPLICATE_EDGE');
    edges.add(key);
  }
  const graph = value as unknown as GraphSnapshot;
  const adjacency = arcs(graph);
  topologicalOrder(graph, adjacency);
  for (const [source, targets] of adjacency) {
    const prerequisite = nodes.get(source);
    if (!prerequisite) fail('MISSING_NODE');
    for (const target of targets) {
      const dependent = nodes.get(target);
      if (!dependent) fail('MISSING_NODE');
      if ((prerequisite.state === 'REVOKED' || prerequisite.state === 'BLOCKED') && dependent.state !== 'BLOCKED' && dependent.state !== 'REVOKED') fail('INCONSISTENT_NODE_STATE');
      if (prerequisite.state === 'STALE' && dependent.state === 'VALID') fail('INCONSISTENT_NODE_STATE');
    }
  }
  const eventIds = new Set<string>();
  const latestStates = new Map<string, NodeState>();
  const policyEpochs = new Map<string, number>();
  const revokedRoots = new Set<string>();
  for (let index = 0; index < value.events.length; index++) {
    const event: unknown = value.events[index];
    if (!record(event) || !exactKeys(event, ['sequence', 'eventId', 'command', 'changes']) || event.sequence !== index + 1 || !identifier(event.eventId) || !Array.isArray(event.changes) || event.changes.length === 0 || event.changes.length > nodes.size) fail('MALFORMED_EVENT');
    validateCommand(event.command);
    if (event.command.eventId !== event.eventId || event.command.expectedSequence !== index || eventIds.has(event.eventId)) fail('MALFORMED_EVENT');
    eventIds.add(event.eventId);
    const root = nodes.get(event.command.nodeId);
    if (!root || root.type !== (event.command.type === 'REVOKE_CREDENTIAL' ? 'CREDENTIAL' : 'POLICY')) fail('MALFORMED_EVENT');
    if (event.command.type === 'REVOKE_CREDENTIAL') {
      if (revokedRoots.has(root.id) || root.epoch < 2) fail('MALFORMED_EVENT');
      revokedRoots.add(root.id);
    } else {
      const previousEpoch = policyEpochs.get(root.id);
      if (previousEpoch !== undefined && event.command.newEpoch <= previousEpoch) fail('MALFORMED_EVENT');
      policyEpochs.set(root.id, event.command.newEpoch);
    }
    const changed = new Set<string>();
    for (const change of event.changes) {
      if (!record(change) || !exactKeys(change, ['nodeId', 'before', 'after', 'reason', 'path']) || !identifier(change.nodeId) || !nodes.has(change.nodeId) || changed.has(change.nodeId) || !state(change.before) || !state(change.after) || typeof change.reason !== 'string' || change.reason.length === 0 || change.reason.length > 512 || !Array.isArray(change.path) || change.path.length === 0 || change.path.length > nodes.size || change.path[0] !== root.id || change.path.at(-1) !== change.nodeId) fail('MALFORMED_CHANGE');
      const previousState = latestStates.get(change.nodeId);
      if (previousState !== undefined && previousState !== change.before) fail('INCONSISTENT_EVENT_STATE');
      if (change.nodeId === root.id) {
        if (event.command.type === 'REVOKE_CREDENTIAL' ? change.before === 'REVOKED' || change.after !== 'REVOKED' : change.before !== change.after) fail('INCONSISTENT_EVENT_STATE');
      } else if (event.command.type === 'REVOKE_CREDENTIAL') {
        if (!['VALID', 'STALE'].includes(change.before) || change.after !== 'BLOCKED') fail('INCONSISTENT_EVENT_STATE');
      } else if (change.before !== 'VALID' || change.after !== 'STALE') fail('INCONSISTENT_EVENT_STATE');
      latestStates.set(change.nodeId, change.after);
      changed.add(change.nodeId);
      for (let step = 0; step < change.path.length; step++) {
        const id: unknown = change.path[step];
        if (!identifier(id) || !nodes.has(id) || (step > 0 && !(adjacency.get(change.path[step - 1] as string) ?? []).includes(id))) fail('MALFORMED_CHANGE');
      }
    }
    if (!changed.has(root.id)) fail('MALFORMED_EVENT');
  }
  for (const [id, latest] of latestStates) if (nodes.get(id)?.state !== latest) fail('INCONSISTENT_EVENT_STATE');
  for (const [id, epoch] of policyEpochs) if (nodes.get(id)?.epoch !== epoch) fail('INCONSISTENT_EVENT_EPOCH');
}

function commandKey(command: GraphCommand): string {
  return JSON.stringify([command.type, command.nodeId, command.type === 'CHANGE_POLICY' ? command.newEpoch : null, command.eventId, command.expectedSequence]);
}

function canonicalSnapshot(graph: GraphSnapshot): GraphSnapshot {
  const snapshot = clone(graph);
  snapshot.nodes.sort((a, b) => compare(a.id, b.id));
  snapshot.edges.sort((a, b) => compare(edgeKey(a), edgeKey(b)));
  return snapshot;
}

export function applyGraphCommand(graph: GraphSnapshot, command: GraphCommand): GraphResult {
  validateGraph(graph); validateCommand(command);
  const snapshot = canonicalSnapshot(graph);
  const prior = snapshot.events.find(event => event.eventId === command.eventId);
  if (prior) {
    if (commandKey(prior.command) !== commandKey(command)) fail('IDEMPOTENCY_CONFLICT');
    return { snapshot, changes: [] };
  }
  if (command.expectedSequence !== snapshot.sequence) fail('STALE_SEQUENCE');
  const root = snapshot.nodes.find(node => node.id === command.nodeId);
  if (!root) fail('MISSING_NODE');
  if (command.type === 'REVOKE_CREDENTIAL' && root.type !== 'CREDENTIAL') fail('WRONG_COMMAND_TARGET');
  if (command.type === 'CHANGE_POLICY' && root.type !== 'POLICY') fail('WRONG_COMMAND_TARGET');
  if (command.type === 'REVOKE_CREDENTIAL' && root.state === 'REVOKED') fail('ALREADY_REVOKED');
  if (command.type === 'CHANGE_POLICY' && command.newEpoch <= root.epoch) fail('NON_MONOTONIC_EPOCH');
  if (command.type === 'REVOKE_CREDENTIAL' && root.epoch === Number.MAX_SAFE_INTEGER) fail('EPOCH_OVERFLOW');
  if (snapshot.events.length >= 10000) fail('EVENT_LIMIT');

  const adjacency = arcs(snapshot);
  const order = topologicalOrder(snapshot, adjacency);
  // Choose a deterministic, shortest causal explanation; equal paths tie lexically.
  const paths = new Map<string, string[]>([[root.id, [root.id]]]);
  const queue = [root.id];
  while (queue.length) {
    const source = queue.shift();
    if (source === undefined) fail('MALFORMED_GRAPH');
    const path = paths.get(source);
    if (!path) fail('MALFORMED_GRAPH');
    for (const target of adjacency.get(source) ?? []) {
      if (!paths.has(target)) { paths.set(target, [...path, target]); queue.push(target); }
    }
  }

  const changes: NodeChange[] = [];
  const byId = new Map(snapshot.nodes.map(node => [node.id, node]));
  for (const id of order) {
    const path = paths.get(id); const node = byId.get(id);
    if (!path || !node) continue;
    const before = node.state;
    if (id === root.id) {
      if (command.type === 'REVOKE_CREDENTIAL') { node.state = 'REVOKED'; node.epoch++; }
      else { node.epoch = command.newEpoch; }
    } else if (node.state !== 'REVOKED') {
      // A policy revision cannot repair an already blocked path.
      node.state = command.type === 'REVOKE_CREDENTIAL' || node.state === 'BLOCKED' ? 'BLOCKED' : 'STALE';
    }
    if (id !== root.id && before === node.state) continue;
    const cause = command.type === 'REVOKE_CREDENTIAL' ? 'Revoked credential' : 'Changed policy';
    const fullReason = `${cause} ${root.id} invalidates ${id} through ${path.join(' -> ')}.`;
    // Preserve the complete explanation in path while bounding the display text.
    const dependentReason = fullReason.length <= 512 ? fullReason
      : `${cause} ${root.id} invalidates ${id} through prerequisite ${path.at(-2)}; full causal path recorded separately.`;
    changes.push({
      nodeId: id, before, after: node.state, path,
      reason: id === root.id
        ? command.type === 'REVOKE_CREDENTIAL' ? `Credential ${id} revoked; epoch advanced to ${node.epoch}.` : `Policy ${id} advanced to epoch ${node.epoch}; existing dependent bindings require re-evaluation.`
        : dependentReason,
    });
  }
  snapshot.sequence++;
  snapshot.events.push({ sequence: snapshot.sequence, eventId: command.eventId, command: clone(command), changes: clone(changes) });
  validateGraph(snapshot);
  return { snapshot, changes: clone(changes) };
}

/** Identical evaluation, with no writes and no mutation of the supplied snapshot. */
export function previewGraphCommand(graph: GraphSnapshot, command: GraphCommand): GraphResult {
  return applyGraphCommand(graph, command);
}

/** Public graph inspection only. A chosen shortest explanation is not full reachability. */
export function downstreamNodeIds(graph: GraphSnapshot, nodeId: string): string[] {
  validateGraph(graph);
  if (!graph.nodes.some(node => node.id === nodeId)) fail('MISSING_NODE');
  const adjacency = arcs(graph), seen = new Set<string>([nodeId]), queue = [nodeId];
  for (let index = 0; index < queue.length; index++) {
    for (const next of adjacency.get(queue[index]!) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return [...seen].sort(compare);
}

export function createDemoGraph(): GraphSnapshot {
  const nodes: GraphNode[] = []; const edges: GraphEdge[] = [];
  for (const lane of ['A', 'B']) {
    for (const type of NODE_TYPES) nodes.push({ id: `${type.toLowerCase()}_${lane}`, type, label: `${type[0]}${type.slice(1).toLowerCase()} ${lane}`, state: 'VALID', epoch: 1 });
    const edge = (from: string, to: string, type: EdgeType): void => { edges.push({ from: `${from}_${lane}`, to: `${to}_${lane}`, type }); };
    edge('credential', 'issuer', 'ISSUED_BY');
    edge('credential', 'issuer', 'REVOKED_BY');
    edge('claim', 'credential', 'DEPENDS_ON');
    edge('proof', 'claim', 'DEPENDS_ON');
    edge('proof', 'credential', 'BOUND_TO');
    edge('permission', 'proof', 'DEPENDS_ON');
    edge('permission', 'policy', 'AUTHORIZED_BY');
    edge('permission', 'credential', 'REVOKED_BY');
    edge('intent', 'permission', 'DEPENDS_ON');
    edge('intent', 'policy', 'BOUND_TO');
    edge('action', 'intent', 'DEPENDS_ON');
    edge('policy', 'permission', 'AFFECTS');
  }
  const graph = canonicalSnapshot({ nodes, edges, sequence: 0, events: [] });
  validateGraph(graph);
  return graph;
}
