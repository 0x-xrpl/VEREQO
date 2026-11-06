import type { CSSProperties } from 'react';
import type { NodeChange } from '../../../../packages/consequence/src/index';
import { disclosureBarLevels, impactBarLevels, LCD_BAR_KEYS } from '../dialMath';

interface LcdMeterProps {
  mode: 'impact' | 'disclosure';
  candidates: readonly number[];
  changes: readonly NodeChange[];
  totalNodes: number;
  label: string;
}

export function LcdMeter({ mode, candidates, changes, totalNodes, label }: LcdMeterProps) {
  // An authoritative change can preserve its status while changing its epoch.
  const count = new Set(changes.map(change => change.nodeId)).size;
  const levels = mode === 'disclosure' ? disclosureBarLevels(candidates) : impactBarLevels(count, totalNodes);
  return <div className="lcdRuler" role="img" aria-label={label} data-testid="lcd-meter">
    {LCD_BAR_KEYS.map(index => {
      const level = levels[index] ?? 0;
      const style = { '--h': `${13 + (index % 4 === 3 ? 9 : index % 5 === 1 ? 4 : 0)}px`, opacity: level > 0 ? .36 + .64 * level : .12 } as CSSProperties;
      return <i key={index} aria-hidden="true" className={level > 0 ? 'on' : undefined} style={style} />;
    })}
  </div>;
}
