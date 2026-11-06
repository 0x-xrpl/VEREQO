import type { GraphSnapshot, NodeChange } from '../../consequence/src/index';

export interface NormalizedQuery { kind: 'LTE'; threshold: number; predicateId: 'x.lte.v1' }
export interface DisclosurePolicy { epoch: number; minCandidates: number }
export interface DisclosurePreflight {
  query: NormalizedQuery;
  policyEpoch: number;
  minCandidates: number;
  status: 'ALLOWED' | 'DENIED';
  reason: string;
  partitions: { yes: number; no: number };
  remainingBefore: number;
  historySequence: number;
}
export interface DisclosureRecord {
  sequence: number;
  query: NormalizedQuery;
  policyEpoch: number;
  status: 'ALLOWED' | 'DENIED';
  reason: string;
  partitions: { yes: number; no: number };
  remainingBefore: number;
  remainingAfter: number;
  answer?: boolean;
  idempotencyKey: string;
}
export interface DisclosureView {
  candidates: number[];
  history: DisclosureRecord[];
  policy: DisclosurePolicy;
}
export interface DemoState {
  environment: 'LOCAL_REFERENCE';
  disclosure: DisclosureView;
  graph: GraphSnapshot;
  lastChanges: NodeChange[];
  requestToken: string;
  capabilities: { proof: 'NOT_IMPLEMENTED'; authorization: 'NOT_IMPLEMENTED'; execution: 'NOT_IMPLEMENTED' };
}
