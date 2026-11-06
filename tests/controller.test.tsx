// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import { useDemoController } from '../apps/web/src/useDemoController';
import { useOperatingExperience } from '../apps/web/src/useOperatingExperience';
import type { DemoState } from '../packages/domain/src/demo';
import type { GraphCommand } from '../packages/consequence/src/index';

const nativeFetch = globalThis.fetch.bind(globalThis);
let root: Root;
let host: HTMLDivElement;
let base: string;
let close: () => Promise<void>;
let controller: ReturnType<typeof useDemoController>;
let operating: ReturnType<typeof useOperatingExperience>;
let failNextState:boolean;
let holdNextState:Promise<void>|null;
let queries: { threshold: number; idempotencyKey: string }[];
let loseNextQueryResponse: boolean;
let loseNextGraphResponse: boolean;
let graphCommands: GraphCommand[];
function Harness() {
  controller = useDemoController();
  operating = useOperatingExperience(controller);
  return <output>{controller.state?.graph.sequence ?? 'loading'} / {controller.pending ? 'pending' : 'ready'}</output>;
}
async function waitFor(predicate: () => boolean, message = 'Controller did not settle') {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
  throw new Error(message);
}
const backend = async () => await (await nativeFetch(`${base}/api/state`)).json() as DemoState;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const child = fork(join(process.cwd(), 'tests/fixtures/ui-server.ts'), [], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.send('stop'); });
  };
  const port = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Real test service exited before listening (${code})`)));
    child.once('message', message => {
      if (typeof message === 'object' && message && 'port' in message) resolve(Number(message.port));
      else reject(new Error('Invalid real test service startup'));
    });
  });
  base = `http://127.0.0.1:${port}`;
  queries = []; graphCommands = []; loseNextQueryResponse = false; loseNextGraphResponse = false;
  failNextState=false;holdNextState=null;
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(base);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, base);
    if(url.pathname==='/api/state'&&failNextState){failNextState=false;return new Response('',{status:503});}
    if(url.pathname==='/api/state'&&holdNextState){const hold=holdNextState;holdNextState=null;await hold;}
    if (url.pathname === '/api/query' && typeof init?.body === 'string') queries.push(JSON.parse(init.body));
    if (url.pathname === '/api/graph' && typeof init?.body === 'string') graphCommands.push(JSON.parse(init.body));
    const response = await nativeFetch(url, init);
    if (url.pathname === '/api/query' && loseNextQueryResponse) {
      loseNextQueryResponse = false;
      await response.arrayBuffer();
      throw new TypeError('Test-only delivery loss after real COMMIT');
    }
    if (url.pathname === '/api/graph' && loseNextGraphResponse) {
      loseNextGraphResponse = false;
      await response.arrayBuffer();
      throw new TypeError('Test-only graph delivery loss after real COMMIT');
    }
    return response;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await waitFor(() => !!controller.state && !!controller.preflight && !controller.pending);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); await close?.(); vi.unstubAllGlobals();
});

describe('persistent Product local-demo controller with real issuer HTTP/SQLite', () => {
  it('does not latch the mutation guard when the same current tile or project is reselected',async()=>{
    await act(async()=>operating.chooseTile(operating.tiles[0]!));
    await act(async()=>operating.chooseTile(operating.tiles[0]!));
    await act(async()=>operating.chooseProject('northstar-execution'));
    await act(async()=>{expect(await operating.run('previewImpact')).toBe(true);});
    expect(controller.preview?.changes).toHaveLength(6);
    expect((await backend()).graph.sequence).toBe(0);
  });
  it('keeps a newer selection from replacing an in-flight return-current operation',async()=>{
    await act(async()=>operating.selectEvent(operating.events[0]!));
    let release!:()=>void;holdNextState=new Promise(resolve=>{release=resolve;});
    let returning!:Promise<boolean>;
    await act(async()=>{returning=operating.returnCurrent();});
    const oldId=operating.inspection?.event.id;
    await act(async()=>{operating.selectEvent(operating.events[3]!);operating.start();operating.chooseProject('northstar-quotes');});
    expect(operating.inspection?.event.id).toBe(oldId);expect(operating.playing).toBe(false);expect(operating.canMutate).toBe(false);
    await act(async()=>{release();expect(await returning).toBe(true);});
    expect(operating.historical).toBe(false);expect(controller.selected).toBe('action_A');expect(controller.mode).toBe('impact');
  });
  it('synchronizes A target, selected node and dimension after project/current navigation',async()=>{
    await act(async()=>operating.chooseTile(operating.tiles.find(tile=>tile.id==='tile:broker-b')!));
    expect(controller.selected).toBe('action_B');
    await act(async()=>operating.chooseProject('northstar-quotes'));
    await act(async()=>operating.chooseProject('northstar-execution'));
    expect(operating.tileId).toBe('tile:broker-a');expect(controller.selected).toBe('action_A');expect(controller.mode).toBe('impact');
    await act(async()=>operating.run('request'));await waitFor(()=>!!controller.preflight&&controller.state?.disclosure.history.length===1);
    await act(async()=>operating.selectEvent(operating.events.find(event=>event.data.stream==='disclosure')!));
    expect(controller.mode).toBe('disclosure');
    await act(async()=>operating.returnCurrent());
    expect(operating.tileId).toBe('tile:broker-a');expect(controller.selected).toBe('action_A');expect(controller.mode).toBe('impact');
  });
  it('locks synthetic and frozen historical views through reset, failed GET and retry',async()=>{
    await act(async()=>operating.run('request'));
    await waitFor(()=>controller.state?.disclosure.candidates.length===101&&!!controller.preflight);
    const record=operating.events.find(event=>event.data.stream==='disclosure')!;
    await act(async()=>operating.selectEvent(record));
    expect(operating.canMutate).toBe(false);
    expect(operating.viewState?.disclosure.candidates).toHaveLength(101);
    const old=await backend();
    await nativeFetch(`${base}/api/reset`,{method:'POST',headers:{'Content-Type':'application/json','X-VEREQO-Token':old.requestToken},body:'{}'});
    await act(async()=>controller.load());
    expect(controller.state?.disclosure.candidates).toHaveLength(128);
    expect(operating.viewState?.disclosure.candidates).toHaveLength(101);
    for(const action of ['request','previewImpact','commit','reset'] as const)await act(async()=>{expect(await operating.run(action)).toBe(false);});
    expect((await backend()).disclosure.history).toHaveLength(0);
    failNextState=true;
    await act(async()=>{expect(await operating.returnCurrent()).toBe(false);});
    expect(operating.historical).toBe(true);expect(operating.canMutate).toBe(false);expect(operating.reconcileFailed).toBe(true);
    await act(async()=>{expect(await operating.returnCurrent()).toBe(true);});
    expect(operating.historical).toBe(false);expect(operating.canMutate).toBe(true);
    await act(async()=>operating.chooseProject('northstar-quotes'));
    await act(async()=>{expect(await operating.run('reset')).toBe(false);});
    expect((await backend()).requestToken).toBe(controller.state?.requestToken);
  });

  it('does not unlock return-current when an overlapping GET is skipped as busy',async()=>{
    let release!:()=>void;holdNextState=new Promise(resolve=>{release=resolve;});
    let loading!:Promise<boolean>;
    await act(async()=>{loading=controller.load();});
    expect(controller.pending).toBe(true);
    await act(async()=>operating.selectEvent(operating.events[0]!));
    await act(async()=>{expect(await operating.returnCurrent()).toBe(false);});
    expect(operating.historical).toBe(true);expect(operating.canMutate).toBe(false);
    await act(async()=>{release();expect(await loading).toBe(true);});
    expect(operating.historical).toBe(true);
    await act(async()=>{expect(await operating.returnCurrent()).toBe(true);});
    expect(operating.historical).toBe(false);
  });
  it('invalidates an obsolete graph preview when focus returns after a same-token external commit', async () => {
    await act(async () => controller.previewImpact());
    expect(controller.preview?.command.expectedSequence).toBe(0);
    const preview = controller.preview!;
    const before = await backend();
    const response = await nativeFetch(`${base}/api/graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VEREQO-Token': before.requestToken },
      body: JSON.stringify(preview.command),
    });
    expect(response.status).toBe(200);
    const committed = (await response.json() as { state: DemoState }).state;
    expect(committed.requestToken).toBe(before.requestToken);
    expect(committed.graph.sequence).toBe(1);
    // The preview's result sequence equals the new committed sequence; its BASE is stale.
    expect(preview.snapshot.sequence).toBe(committed.graph.sequence);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => !controller.pending && !!controller.preflight);
    expect(controller.preview).toBeNull();
    expect(controller.state?.graph).toEqual(committed.graph);
    expect(controller.state?.graph.nodes.find(node => node.id === 'action_A')?.state).toBe('BLOCKED');
    expect(controller.state?.graph.nodes.find(node => node.id === 'action_B')?.state).toBe('VALID');
    expect(controller.state?.disclosure).toEqual(before.disclosure);
    expect(controller.updatedAt).not.toBeNull();
  });

  it('preserves an unchanged preview and its event identity across explicit GET reconciliation', async () => {
    await act(async () => controller.previewImpact());
    const preview = controller.preview;
    const before = await backend();
    expect(preview).not.toBeNull();
    await act(async () => controller.load());
    await waitFor(() => !controller.pending && !!controller.preflight);
    expect(controller.preview).toBe(preview);
    expect(controller.preview?.command.eventId).toBe(preview?.command.eventId);
    expect((await backend()).graph).toEqual(before.graph);
    expect((await backend()).disclosure).toEqual(before.disclosure);
    expect(controller.state?.graph.sequence).toBe(0);
  });

  it('retries the same canonical key after committed-response loss without duplicating disclosure', async () => {
    loseNextQueryResponse = true;
    const initialReceipt = controller.updatedAt;
    await act(async () => controller.request());
    expect(controller.error).toBe('failed');
    expect(controller.state?.disclosure.candidates).toHaveLength(128);
    expect(controller.updatedAt).toBe(initialReceipt);
    expect((await backend()).disclosure.history).toHaveLength(1);
    await act(async () => controller.request());
    await waitFor(() => controller.state?.disclosure.candidates.length === 101 && !!controller.preflight);
    expect(queries).toHaveLength(2);
    expect(queries[0]?.idempotencyKey).toBe(queries[1]?.idempotencyKey);
    expect(queries.map(query => query.threshold)).toEqual([100, 100]);
    expect((await backend()).disclosure.history).toHaveLength(1);
    expect(controller.threshold).toBe(80);
  });

  it('retains the exact preview event on graph COMMIT response loss and retries it idempotently', async () => {
    await act(async () => controller.previewImpact());
    const preview = controller.preview!;
    expect(preview).not.toBeNull();
    loseNextGraphResponse = true;
    await act(async () => controller.commit());
    expect(controller.error).toBe('failed');
    expect(controller.preview).toBe(preview);
    expect(controller.state?.graph.sequence).toBe(0);
    const committed = await backend();
    expect(committed.graph.sequence).toBe(1);
    expect(committed.graph.events).toHaveLength(1);
    await act(async () => controller.commit());
    expect(controller.preview).toBeNull();
    expect(controller.error).toBe('');
    expect(controller.state?.graph).toEqual(committed.graph);
    expect(graphCommands).toEqual([preview.command, preview.command]);
    expect(graphCommands[0]?.eventId).toBe(graphCommands[1]?.eventId);
    expect((await backend()).graph.events).toHaveLength(1);
  });

});
