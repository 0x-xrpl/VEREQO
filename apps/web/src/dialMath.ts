/** Presentation math only; turning a dial never admits or executes a proposal. */
export function clampDialValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
}

export function valueToAngle(value: number, min: number, max: number): number {
  return max > min ? -135 + (clampDialValue(value, min, max) - min) / (max - min) * 270 : -135;
}

export function angularDelta(previous: number, current: number): number {
  return ((current - previous + 540) % 360) - 180;
}

export function pointerAngle(x: number, y: number, centerX: number, centerY: number): number {
  return Math.atan2(x - centerX, -(y - centerY)) * 180 / Math.PI;
}

export function valueFromRotation(start: number, degrees: number, min: number, max: number): number {
  return clampDialValue(start + degrees * (max - min) / 270, min, max);
}

export function keyboardDialValue(key: string, value: number, min: number, max: number): number | undefined {
  if (key === 'Home') return min;
  if (key === 'End') return max;
  const steps: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
  const step = Object.hasOwn(steps, key) ? steps[key] : undefined;
  return step === undefined ? undefined : clampDialValue(value + step, min, max);
}

export const LCD_BAR_COUNT = 34;
export const LCD_BAR_KEYS = Array.from({ length: LCD_BAR_COUNT }, (_, index) => index);

/** Each public domain value belongs to exactly one of the fixed 34 buckets. */
export function disclosureBarLevels(candidates: readonly number[]): number[] {
  const present = new Set(candidates.filter(value => Number.isInteger(value) && value >= 0 && value <= 127));
  return LCD_BAR_KEYS.map(index => {
    const start = Math.ceil(index * 128 / LCD_BAR_COUNT);
    const end = Math.ceil((index + 1) * 128 / LCD_BAR_COUNT);
    let count = 0;
    for (let value = start; value < end; value++) if (present.has(value)) count++;
    return count / (end - start);
  });
}

/** Coverage of actual changed nodes relative to the complete directed graph. */
export function impactBarLevels(changedNodes: number, totalNodes: number): number[] {
  const total = Number.isFinite(totalNodes) ? Math.max(0, Math.floor(totalNodes)) : 0;
  const count = Number.isFinite(changedNodes) ? Math.max(0, Math.min(total, Math.floor(changedNodes))) : 0;
  const coverage = total > 0 ? count / total * LCD_BAR_COUNT : 0;
  return LCD_BAR_KEYS.map(index => Math.max(0, Math.min(1, coverage - index)));
}
