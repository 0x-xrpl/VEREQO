import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NodeChange } from '../packages/consequence/src/index';
import { Dial } from '../apps/web/src/components/Dial';
import { LcdMeter } from '../apps/web/src/components/LcdMeter';
import { angularDelta, clampDialValue, disclosureBarLevels, impactBarLevels, keyboardDialValue, pointerAngle, valueFromRotation, valueToAngle } from '../apps/web/src/dialMath';

describe('relative precision dial math', () => {
  it('crosses the pointer angle wrap in either direction without a jump', () => {
    expect(angularDelta(179, -179)).toBe(2);
    expect(angularDelta(-179, 179)).toBe(-2);
    expect(pointerAngle(0, -10, 0, 0)).toBe(0);
    expect(pointerAngle(10, 0, 0, 0)).toBe(90);
    // First contact records its angle; no angular movement preserves the proposal.
    for (const value of [0, 70, 100, 127]) expect(valueFromRotation(value, 0, 0, 127)).toBe(value);
  });

  it('maps endpoints and rounds only when relative rotation reaches the next integer', () => {
    expect(valueToAngle(1, 1, 3)).toBe(-135);
    expect(valueToAngle(2, 1, 3)).toBe(0);
    expect(valueToAngle(3, 1, 3)).toBe(135);
    expect(valueToAngle(0, 0, 127)).toBe(-135);
    expect(valueToAngle(127, 0, 127)).toBe(135);
    expect(valueFromRotation(1, 67, 1, 3)).toBe(1);
    expect(valueFromRotation(1, 68, 1, 3)).toBe(2);
    expect(valueFromRotation(70, 270, 0, 127)).toBe(127);
    expect(valueFromRotation(70, -270, 0, 127)).toBe(0);
    expect(clampDialValue(Number.NaN, 0, 127)).toBe(0);
  });

  it('handles arrows, page increments and exact limits without transforming disclosure thresholds', () => {
    for (const value of [0, 1, 69, 70, 71, 79, 80, 81, 99, 100, 101, 126, 127]) {
      expect(keyboardDialValue('ArrowRight', value, 0, 127)).toBe(Math.min(127, value + 1));
      expect(keyboardDialValue('ArrowLeft', value, 0, 127)).toBe(Math.max(0, value - 1));
    }
    expect(keyboardDialValue('PageUp', 120, 0, 127)).toBe(127);
    expect(keyboardDialValue('PageDown', 7, 0, 127)).toBe(0);
    expect(keyboardDialValue('Home', 70, 0, 127)).toBe(0);
    expect(keyboardDialValue('End', 70, 0, 127)).toBe(127);
    expect(keyboardDialValue('ArrowUp', 3, 1, 3)).toBe(3);
    expect(keyboardDialValue('ArrowDown', 1, 1, 3)).toBe(1);
    expect(keyboardDialValue('Enter', 70, 0, 127)).toBeUndefined();
  });
});

describe('truthful fixed LCD meter', () => {
  const domain = Array.from({ length: 128 }, (_, index) => index);
  it('covers every public candidate once, ignores duplicates and excludes out-of-domain values', () => {
    expect(disclosureBarLevels(domain)).toEqual(Array(34).fill(1));
    expect(disclosureBarLevels([])).toEqual(Array(34).fill(0));
    expect(disclosureBarLevels([0, 0, -1, 128, 1.5, Number.NaN])).toEqual(disclosureBarLevels([0]));
    expect(disclosureBarLevels([0]).filter(level => level > 0)).toHaveLength(1);
    expect(disclosureBarLevels([127])[33]).toBeGreaterThan(0);
    for (const candidate of domain) {
      const levels = disclosureBarLevels([candidate]);
      expect(levels.filter(level => level > 0)).toHaveLength(1);
      expect(levels.every(level => level >= 0 && level <= 1)).toBe(true);
    }
    expect(disclosureBarLevels(domain.slice(0, 81)).filter(level => level > 0).length).toBeLessThan(34);
  });

  it('represents the actual proportion of affected graph nodes with bounded coverage', () => {
    expect(impactBarLevels(0, 8)).toEqual(Array(34).fill(0));
    expect(impactBarLevels(6, 8).reduce((sum, level) => sum + level, 0)).toBe(25.5);
    expect(impactBarLevels(2, 8).reduce((sum, level) => sum + level, 0)).toBe(8.5);
    expect(impactBarLevels(6, 0)).toEqual(Array(34).fill(0));
    expect(impactBarLevels(99, 8)).toEqual(Array(34).fill(1));
    expect(impactBarLevels(-2, 8)).toEqual(Array(34).fill(0));
  });

  it('renders precisely 34 stable indexed bars in both modes and a single localized description', () => {
    const change: NodeChange = { nodeId: 'credential_A', before: 'VALID', after: 'REVOKED', reason: 'local', path: ['credential_A'] };
    for (const mode of ['impact', 'disclosure'] as const) {
      const html = renderToStaticMarkup(createElement(LcdMeter, { mode, candidates: domain, changes: [change], totalNodes: 8, label: '公開状態' }));
      expect(html.match(/<i /g)).toHaveLength(34);
      expect(html.match(/role="img"/g)).toHaveLength(1);
      expect(html.match(/aria-label="公開状態"/g)).toHaveLength(1);
      expect(html.match(/aria-hidden="true"/g)).toHaveLength(34);
    }
    const duplicate = renderToStaticMarkup(createElement(LcdMeter, { mode: 'impact', candidates: [], changes: [change, change], totalNodes: 8, label: '影響' }));
    const single = renderToStaticMarkup(createElement(LcdMeter, { mode: 'impact', candidates: [], changes: [change], totalNodes: 8, label: '影響' }));
    expect(duplicate).toBe(single);
    const epochOnly = { ...change, nodeId: 'policy', before: 'VALID', after: 'VALID' } as const;
    const epochHtml = renderToStaticMarkup(createElement(LcdMeter, { mode: 'impact', candidates: [], changes: [epochOnly], totalNodes: 8, label: '影響' }));
    expect(epochHtml).toBe(single);
  });
});

describe('dial accessible presentation', () => {
  it('exposes exact disclosure bounds and localized alternative controls', () => {
    const html = renderToStaticMarkup(createElement(Dial, { value: 70, min: 0, max: 127, label: '照会閾値', valueText: 'x ≤ 70', onChange() {}, decreaseLabel: '減らす', increaseLabel: '増やす', alternativeLabel: '別の入力' }));
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="127"');
    expect(html).toContain('aria-valuenow="70"');
    expect(html).toContain('aria-label="減らす"');
    expect(html).toContain('aria-label="増やす"');
    expect(html).toContain('aria-label="別の入力"');
    expect(html).toContain('type="range"');
    expect(html).toContain('min-height:44px');
  });

  it('keeps the hero at inspection depth 1–3 even when the working mode uses threshold bounds', () => {
    const html = renderToStaticMarkup(createElement(Dial, { hero: true, value: 70, min: 0, max: 127, label: '説明の深さ', valueText: '証拠', onChange() {} }));
    expect(html).toContain('aria-valuemin="1"');
    expect(html).toContain('aria-valuemax="3"');
    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain('knobRing heroRing');
    expect(html).toContain('knobShell');
    expect(html).toContain('knobGrip');
    expect(html).toContain('knobNeedle');
  });
});
