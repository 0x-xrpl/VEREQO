import { describe, expect, it } from 'vitest';
import { admit, normalizeQuery, replay, INITIAL_CANDIDATES, applyAnswer } from '../packages/disclosure/src/index';

describe('exact finite-domain disclosure preflight', () => {
  const policy = { epoch: 1, minCandidates: 16 };
  it('implements the example and denies for all 81 compatible witnesses without taking a witness argument', () => {
    const after = replay([{ query: normalizeQuery(100), answer: true }, { query: normalizeQuery(80), answer: true }]);
    expect(after).toHaveLength(81);
    for (let x = 0; x <= 80; x++) {
      expect(after).toContain(x);
      expect(admit(after, normalizeQuery(70), policy)).toEqual({
        status: 'DENIED', reason: 'CANDIDATE_FLOOR', partitions: { yes: 71, no: 10 }, remainingBefore: 81
      });
    }
  });
  it('all 128 values preserve their membership after every permitted answer', () => {
    for (let x = 0; x < 128; x++) {
      let candidates = [...INITIAL_CANDIDATES];
      for (const t of [100, 80, 70, 0, 15, 16, 63, 111, 112, 127]) {
        const q = normalizeQuery(t), d = admit(candidates, q, policy);
        if (d.status === 'ALLOWED') candidates = applyAnswer(candidates, q, x <= t);
        expect(candidates).toContain(x);
        expect(candidates.length).toBeGreaterThanOrEqual(16);
      }
    }
  });
  it('exhaustively checks threshold boundaries on the initial domain', () => {
    for (let t = -1; t <= 127; t++) {
      const d = admit(INITIAL_CANDIDATES, normalizeQuery(t), policy);
      const n = t + 1;
      expect(d.status).toBe(n === 0 || n === 128 || (n >= 16 && 128 - n >= 16) ? 'ALLOWED' : 'DENIED');
    }
  });
  it('normalizes equivalent integer predicates, rejects malformed values and objects', () => {
    expect(normalizeQuery(-100)).toEqual(normalizeQuery(-1));
    expect(normalizeQuery(999)).toEqual(normalizeQuery(127));
    expect(normalizeQuery(-0)).toEqual(normalizeQuery(0));
    for (const t of ['70', 70.1, NaN, Infinity, {}, null, true, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => normalizeQuery(t)).toThrow();
    }
  });
  it('repeated and fixed predicates reveal nothing further', () => {
    const c = replay([{ query: normalizeQuery(80), answer: true }]);
    expect(admit(c, normalizeQuery(80), policy).status).toBe('ALLOWED');
    expect(applyAnswer(c, normalizeQuery(80), true)).toEqual(c);
  });
  it('rejects contradictory transcripts and malformed candidate sets / policy', () => {
    expect(() => replay([{ query: normalizeQuery(80), answer: true }, { query: normalizeQuery(100), answer: false }])).toThrow();
    for (const c of [[], [0, 0], [128], [2, 1], [0.5]]) expect(() => admit(c, normalizeQuery(1), policy)).toThrow();
    expect(() => admit(INITIAL_CANDIDATES, normalizeQuery(10), { epoch: 0, minCandidates: 0 })).toThrow();
    expect(admit(Array.from({ length: 10 }, (_, i) => i), normalizeQuery(100), policy).status).toBe('DENIED');
  });
});
