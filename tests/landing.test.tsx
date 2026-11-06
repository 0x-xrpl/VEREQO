// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Landing } from '../apps/web/src/components/Landing';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const control = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

describe('Living Instrument entry', () => {
  it('offers real entry and three illustrative scenes without making API requests', async () => {
    const fetch = vi.fn(), start = vi.fn(); vi.stubGlobal('fetch', fetch);
    await act(async () => root.render(<Landing language="ja" onStart={start} />));
    expect(host.querySelector('h1')?.textContent).toContain('AIに任せる注文');
    expect(host.querySelector('[data-testid="live-hero"] img')).toBeNull();
    expect(control('hero-lcd').textContent).toBe('128');
    const bars = [...host.querySelectorAll('.heroMeter i')];
    expect(bars).toHaveLength(34);
    await act(async () => control('landing-scene-2').click());
    expect(control('hero-lcd').textContent).toBe('81');
    expect(host.textContent).toContain('71 / 10');
    await act(async () => control('landing-scene-3').click());
    expect(control('hero-lcd').textContent).toBe('A / B');
    expect([...host.querySelectorAll('.heroMeter i')]).toEqual(bars);
    expect(host.textContent).toContain('独立したB');
    expect(host.textContent).toContain('NOT EXECUTED');
    await act(async () => control('start-demo').click());
    expect(start).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });

  it('retains its scene through language and navigation while stopping hidden playback', async () => {
    vi.useFakeTimers();
    const start = vi.fn();
    await act(async () => root.render(<Landing language="ja" active onStart={start} />));
    await act(async () => control('landing-scene-2').click());
    await act(async () => root.render(<Landing language="en" active onStart={start} />));
    expect(control('landing-scene-2').getAttribute('aria-pressed')).toBe('true');
    await act(async () => control('landing-play').click());
    await act(async () => root.render(<Landing language="en" active={false} onStart={start} />));
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(control('landing-scene-2').getAttribute('aria-pressed')).toBe('true');
    expect(control('landing-play').getAttribute('aria-pressed')).toBe('false');
    expect(start).not.toHaveBeenCalled();
  });
});
