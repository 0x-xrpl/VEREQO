import type { DisclosurePolicy, NormalizedQuery } from '../../domain/src/demo';

export const INITIAL_CANDIDATES: readonly number[] = Object.freeze(Array.from({ length: 128 }, (_, i) => i));

export function normalizeQuery(threshold: unknown): NormalizedQuery {
  if (typeof threshold !== 'number' || !Number.isSafeInteger(threshold)) throw new Error('INVALID_THRESHOLD');
  return { kind: 'LTE', threshold: Math.max(-1, Math.min(127, threshold)) || 0, predicateId: 'x.lte.v1' };
}

export function validatePolicy(policy: DisclosurePolicy): void {
  if (!Number.isSafeInteger(policy.epoch) || policy.epoch < 1 ||
    !Number.isSafeInteger(policy.minCandidates) || policy.minCandidates < 1 || policy.minCandidates > 128) throw new Error('INVALID_POLICY');
}

export function validateCandidates(candidates: readonly number[]): void {
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 128) throw new Error('INVALID_CANDIDATES');
  let previous = -1;
  for (const c of candidates) {
    if (!Number.isInteger(c) || c < 0 || c > 127 || c <= previous) throw new Error('INVALID_CANDIDATES');
    previous = c;
  }
}

function validateQuery(query: NormalizedQuery): void {
  if (query.kind !== 'LTE' || query.predicateId !== 'x.lte.v1' || normalizeQuery(query.threshold).threshold !== query.threshold) throw new Error('NON_CANONICAL_QUERY');
}

export function partition(candidates: readonly number[], query: NormalizedQuery): { yes: number[]; no: number[] } {
  validateCandidates(candidates); validateQuery(query);
  return { yes: candidates.filter(x => x <= query.threshold), no: candidates.filter(x => x > query.threshold) };
}

/** Public-input-only admission: there is deliberately no witness parameter. */
export function admit(candidates: readonly number[], query: NormalizedQuery, policy: DisclosurePolicy) {
  validatePolicy(policy);
  const p = partition(candidates, query);
  const permitted = [p.yes.length, p.no.length].filter(n => n > 0).every(n => n >= policy.minCandidates);
  return {
    status: permitted ? 'ALLOWED' as const : 'DENIED' as const,
    reason: permitted ? 'ALL_POSSIBLE_OUTCOMES_MEET_FLOOR' : 'CANDIDATE_FLOOR',
    partitions: { yes: p.yes.length, no: p.no.length }, remainingBefore: candidates.length
  };
}

export function applyAnswer(candidates: readonly number[], query: NormalizedQuery, answer: boolean): number[] {
  if (typeof answer !== 'boolean') throw new Error('INVALID_ANSWER');
  const parts = partition(candidates, query), next = answer ? parts.yes : parts.no;
  if (!next.length) throw new Error('CONTRADICTORY_TRANSCRIPT');
  return next;
}

export function replay(history: readonly { query: NormalizedQuery; answer: boolean }[]): number[] {
  return history.reduce((c, event) => applyAnswer(c, event.query, event.answer), [...INITIAL_CANDIDATES]);
}
