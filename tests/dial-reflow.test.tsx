// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { Dial } from '../apps/web/src/components/Dial';

it('keeps the pointer origin fixed when evidence expansion moves the dial during a drag', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let value = 1, top = 0;
  function Harness() { const [current, setCurrent] = useState(1); value = current; return <Dial value={current} min={1} max={3} label="Depth" valueText={String(current)} onChange={setCurrent}/>; }
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<Harness/>));
    const dial = host.querySelector<HTMLElement>('[data-testid="work-dial"]')!;
    Object.assign(dial, { getBoundingClientRect: () => ({ left:0, top, width:200, height:200 }), setPointerCapture: () => {}, hasPointerCapture: () => false });
    const pointer = async (type: string, clientX: number, clientY: number) => act(async () => { dial.dispatchEvent(new PointerEvent(type, { pointerId:1, pointerType:'mouse', button:0, clientX, clientY, bubbles:true })); });
    await pointer('pointerdown', 170, 100); expect(value).toBe(1);
    await pointer('pointermove', 150, 150); expect(value).toBe(1);
    top = 400;
    await pointer('pointermove', 100, 170);
    expect(value).toBe(2);
    await pointer('pointerup', 100, 170);
  } finally { await act(async () => root.unmount()); delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT; }
});
