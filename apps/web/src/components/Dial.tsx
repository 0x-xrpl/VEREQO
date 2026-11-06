import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { angularDelta, clampDialValue, keyboardDialValue, pointerAngle, valueFromRotation, valueToAngle } from '../dialMath';

interface DialProps {
  value: number;
  min: number;
  max: number;
  label: string;
  valueText: string;
  onChange: (value: number) => void;
  hero?: boolean;
  decreaseLabel?: string;
  increaseLabel?: string;
  alternativeLabel?: string;
  disabled?: boolean;
}

interface Drag { pointerId: number; lastAngle: number; accumulated: number; start: number; min: number; max: number; centerX: number; centerY: number }

export function Dial({ value, min, max, label, valueText, onChange, hero = false, decreaseLabel, increaseLabel, alternativeLabel, disabled = false }: DialProps) {
  const lower = hero ? 1 : min;
  const upper = hero ? 3 : max;
  const current = clampDialValue(value, lower, upper);
  const drag = useRef<Drag | null>(null);
  const prefix = hero ? 'hero' : 'work';
  const setValue = (next: number) => {
    const bounded = clampDialValue(next, lower, upper);
    if (!disabled && bounded !== current) onChange(bounded);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className={hero ? 'heroDialFrame' : 'dialControl'}>
    <div className={hero ? undefined : 'knobArea'}><div className={hero ? 'knobRing heroRing' : 'knobRing'}>
      <div className="knobNeedle" aria-hidden="true" style={{ '--angle': `${valueToAngle(current, lower, upper)}deg` } as CSSProperties} />
      <div className="knobClick" role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
        aria-label={label} aria-valuemin={lower} aria-valuemax={upper} aria-valuenow={current} aria-valuetext={valueText}
        data-testid={`${prefix}-dial`}
        onPointerDown={event => {
          if (disabled || drag.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          const bounds = event.currentTarget.getBoundingClientRect();
          const centerX = bounds.left + bounds.width / 2, centerY = bounds.top + bounds.height / 2;
          drag.current = { pointerId: event.pointerId, lastAngle: pointerAngle(event.clientX, event.clientY, centerX, centerY), accumulated: 0, start: current, min: lower, max: upper, centerX, centerY };
          event.preventDefault();
        }}
        onPointerMove={event => {
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          if (disabled || active.min !== lower || active.max !== upper) { endDrag(event); return; }
          // Evidence can expand above this control mid-drag. Retain the contact geometry.
          const angle = pointerAngle(event.clientX, event.clientY, active.centerX, active.centerY);
          active.accumulated += angularDelta(active.lastAngle, angle);
          active.lastAngle = angle;
          setValue(valueFromRotation(active.start, active.accumulated, lower, upper));
        }}
        onPointerUp={endDrag} onPointerCancel={endDrag}
        onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
        onKeyDown={event => {
          if (disabled) return;
          const next = keyboardDialValue(event.key, current, lower, upper);
          if (next !== undefined) { event.preventDefault(); setValue(next); }
        }} />
      <div className="knobShell" aria-hidden="true"><div className="knobGrip"><i /></div></div>
    </div></div>
    {!hero && <>
      <div className="dialInfo">
        <button type="button" className="miniBtn" aria-label={decreaseLabel ?? label} disabled={disabled || current <= lower}
          style={{ minWidth: 44, minHeight: 44 }} data-testid="work-minus" onClick={() => setValue(current - 1)}>−</button>
        <div className="dialValue" aria-hidden="true" style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1, height: 40 }}>{String(current).padStart(2, '0')}</div>
        <button type="button" className="miniBtn" aria-label={increaseLabel ?? label} disabled={disabled || current >= upper}
          style={{ minWidth: 44, minHeight: 44 }} data-testid="work-plus" onClick={() => setValue(current + 1)}>+</button>
      </div>
      <div className="dialSub">{valueText}</div>
      <input className="dialAlternative" type="range" min={lower} max={upper} step={1} value={current} disabled={disabled}
        aria-label={alternativeLabel ?? label} aria-valuetext={valueText} data-testid="work-range" style={{ minHeight: 44 }}
        onChange={event => setValue(Number(event.currentTarget.value))} />
    </>}
  </div>;
}
