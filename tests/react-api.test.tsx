// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import App from '../apps/web/src/App';
import type { DemoState } from '../packages/domain/src/demo';

const nativeFetch = globalThis.fetch.bind(globalThis);
let root: Root;
let host: HTMLDivElement;
let base: string;
let close: () => Promise<void>;
let calls: { path: string; body: string; method: string }[];
let loseNextQueryResponse = false;
let loseNextResetResponse = false;
let failNextPreflightResponse = false;
const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const found = host.querySelector<T>(`[data-testid="${id}"]`);
  if (!found) throw new Error(`Missing UI control: ${id}`);
  return found;
};
async function waitFor(predicate: () => boolean, message = 'UI did not settle') {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
  throw new Error(message);
}
const click = async (id: string) => { await act(async () => { el(id).click(); }); };
const backend = async () => await (await nativeFetch(`${base}/api/state`)).json() as DemoState;
const mutations = () => calls.filter(call => ['/api/query', '/api/graph', '/api/reset'].includes(call.path));

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const child = fork(join(process.cwd(), 'tests/fixtures/ui-server.ts'), [], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  close = async () => { if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.send('stop'); }); };
  const port = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('message', message => {
    if (typeof message === 'object' && message && 'port' in message) resolve(Number(message.port));
    else reject(new Error('Invalid test server startup')); }); });
  base = `http://127.0.0.1:${port}`; calls = []; loseNextQueryResponse = false; loseNextResetResponse = false; failNextPreflightResponse = false;
  window.localStorage.clear();
  // The real app is same-origin. Configure the DOM document accordingly;
  // cross-origin rejection remains tested separately by the security suite.
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${base}/?lang=ja`);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, base);
    calls.push({ path: url.pathname, body: typeof init?.body === 'string' ? init.body : '', method: init?.method ?? 'GET' });
    const response = await nativeFetch(url, init);
    if (url.pathname === '/api/preflight' && failNextPreflightResponse) {
      failNextPreflightResponse = false;
      await response.arrayBuffer(); return new Response('{"error":"TEMPORARY_FAILURE"}', { status: 503 });
    }
    if (url.pathname === '/api/query' && loseNextQueryResponse) {
      loseNextQueryResponse = false;
      // The real service committed. Only delivery fails; policy is never mocked.
      await response.arrayBuffer(); throw new TypeError('Simulated response delivery loss');
    }
    if (url.pathname === '/api/reset' && loseNextResetResponse) {
      loseNextResetResponse = false;
      await response.arrayBuffer(); throw new TypeError('Simulated reset response delivery loss');
    }
    return response;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<App />));
  await click('start-demo'); await click('journey-free'); await click('mode-impact');
  await waitFor(() => !el<HTMLButtonElement>('key-primary').disabled);
  // Allow the initial read-only proposal to settle before counting language requests.
  await waitFor(() => calls.some(call => call.path === '/api/preflight'));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); await close?.(); vi.unstubAllGlobals();
});

describe('Instrument React + real local issuer integration', () => {
  it('synchronizes Impact Map targets and dial, and confirms inspection without security writes',async()=>{
    await click('dial-target');await click('tile:broker-b');
    expect(el('work-dial').getAttribute('aria-valuenow')).toBe('2');
    const before=await backend(),count=mutations().length,previews=calls.filter(call=>call.path==='/api/preview').length;
    await act(async()=>el('work-dial').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})));
    expect(el('tile:broker-a').getAttribute('aria-pressed')).toBe('true');
    await click('work-confirm');
    expect(el('inspection-confirmation').getAttribute('data-confirmed')).toBe('true');
    expect(el('work-dial').getAttribute('aria-valuenow')).toBe('1');
    await click('tile:broker-b');
    expect(el('inspection-confirmation').getAttribute('data-confirmed')).toBe('false');
    await act(async()=>el('work-dial').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    expect(el('inspection-confirmation').getAttribute('data-confirmed')).toBe('true');
    expect(mutations()).toHaveLength(count);expect(calls.filter(call=>call.path==='/api/preview')).toHaveLength(previews);
    const after=await backend();expect(after.graph.sequence).toBe(before.graph.sequence);expect(after.disclosure.history).toEqual(before.disclosure.history);
  });
  it('shows UNKNOWN with no stale LCD count when preflight observation fails',async()=>{
    await click('mode-disclosure');await waitFor(()=>!el<HTMLButtonElement>('submit-query').disabled);
    expect(el('working-lcd').textContent).toBe('128');
    failNextPreflightResponse=true;await click('work-plus');
    await waitFor(()=>el('deck-display').getAttribute('data-decision')==='unknown');
    expect(el('working-lcd').textContent).toBe('—');
    expect(el('lcd-meter').querySelectorAll('i')).toHaveLength(34);
    expect(el('lcd-meter').querySelectorAll('i.on')).toHaveLength(0);
    expect(el<HTMLButtonElement>('work-confirm').disabled).toBe(true);
    expect(mutations()).toHaveLength(0);
  });

  it('inspects natural questions and nested Back/Esc without another preview or security write',async()=>{
    await click('key-primary');await waitFor(()=>el('working-lcd').textContent==='06');
    const count=mutations().length,previews=calls.filter(call=>call.path==='/api/preview').length;
    await act(async()=>host.querySelectorAll<HTMLButtonElement>('.inquiryExamples button')[1]!.click());
    expect(el('inquiry-answer').textContent).toContain('credential_A');
    await act(async()=>el('broker-A').querySelector<HTMLButtonElement>('[data-node-id="action_A"]')!.click());
    await click('nested-level-3');
    await act(async()=>el('nested-causal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(el('work-dial').getAttribute('aria-valuenow')).toBe('2');
    expect(mutations()).toHaveLength(count);expect(calls.filter(call=>call.path==='/api/preview')).toHaveLength(previews);
    expect((await backend()).graph.sequence).toBe(0);expect((await backend()).disclosure.history).toHaveLength(0);
  });
  it('keeps the released100 record separate from the next80 proposal and records no preflight answer',async()=>{
    await click('mode-disclosure');await waitFor(()=>!el<HTMLButtonElement>('submit-query').disabled);
    expect(el('selected-request').getAttribute('data-kind')).toBe('proposal');
    expect(el('selected-outcome').textContent).toContain('未公開');expect((await backend()).disclosure.history).toHaveLength(0);
    await click('submit-query');await waitFor(()=>el('work-dial').getAttribute('aria-valuenow')==='80'&&el('selected-request').getAttribute('data-kind')==='record');
    expect(el('selected-question').textContent).toContain('100');expect(el('next-question').textContent).toContain('80');
    expect(el('selected-outcome').textContent).toContain('128 → 101');
    await click('detail-depth-3');expect(el('evidence-query').textContent).toContain('100');
    await click('language-en');expect(el('selected-question').textContent).toContain('100');expect(el('next-question').textContent).toContain('80');
    expect(host.textContent).not.toMatch(/27 abstract units|47 abstract units|27単位|47単位/);
    expect((await backend()).disclosure.history).toHaveLength(1);
  });
  it('rechecks an unchanged proposal after a transient preflight failure and explicit GET reload', async () => {
    await click('mode-disclosure');
    failNextPreflightResponse = true; await click('work-plus');
    await waitFor(() => !!host.querySelector('[role="alert"]'));
    expect(el('work-dial').getAttribute('aria-valuenow')).toBe('101');
    const before = await backend(), proposals = calls.filter(call => call.path === '/api/preflight').length;
    expect(el<HTMLButtonElement>('submit-query').disabled).toBe(true);
    await click('reload-state');
    await waitFor(() => !el<HTMLButtonElement>('submit-query').disabled, 'Unchanged proposal was not checked after reload');
    expect(calls.filter(call => call.path === '/api/preflight')).toHaveLength(proposals + 1);
    expect(el('partition-yes').textContent).toBe('102');
    expect(el('work-dial').getAttribute('aria-valuenow')).toBe('101');
    expect((await backend()).disclosure).toEqual(before.disclosure);
    expect(mutations()).toHaveLength(0);
  });
  it('preserves preview, focus context, exact paths, fixed bars and data through the working demo across JP/EN; cancel does not commit', async () => {
    const before = await backend();
    expect((await backend()).capabilities.execution).toBe('NOT_IMPLEMENTED');
    await click('key-primary');
    await waitFor(() => el('working-lcd').textContent === '06');
    expect(el('preview-state').textContent).toContain('試算');
    expect(el('decision-result').textContent).toContain('停止');
    expect(el('living-board').querySelectorAll('.nodeChanged').length).toBeGreaterThan(0);
    await click('mode-disclosure'); await click('mode-impact');
    expect(el('living-board').querySelectorAll('.nodeChanged')).toHaveLength(0);
    expect(el('preview-state').textContent).toContain('試算');
    const bars = [...el('lcd-meter').children]; expect(bars).toHaveLength(34);
    await click('key-secondary');
    expect(el('affected-nodes').querySelectorAll('button')).toHaveLength(6);
    const changed = [...el('affected-nodes').querySelectorAll('button')];
    await act(async () => changed.find(node => node.textContent?.includes('取引 A'))?.click());
    expect([...el('causal-path').querySelectorAll('button')].map(node => node.textContent?.includes('申告 A'))).not.toContain(true);
    expect(el('causal-path').querySelectorAll('button')).toHaveLength(4);
    const selected = el('causal-path').querySelector('[aria-pressed="true"]');
    expect(selected?.textContent).toContain('取引 A');
    const dial = el('work-dial').getAttribute('aria-valuenow'), count = calls.length;
    el('language-en').focus(); await click('language-en');
    expect(document.documentElement.lang).toBe('en');
    expect(el('decision-result').textContent).toContain('blocked');
    expect(el('decision-result').textContent).toContain('eligible locally');
    expect(el('preview-state').textContent).toContain('PREVIEW');
    expect(el('work-dial').getAttribute('aria-valuenow')).toBe(dial);
    expect(el('causal-path').querySelector('[aria-pressed="true"]')?.textContent).toContain('Action A');
    expect(document.activeElement).toBe(el('language-en'));
    expect([...el('lcd-meter').children]).toEqual(bars);
    expect(calls.length).toBe(count);
    expect((await backend()).graph).toEqual(before.graph);
    expect((await backend()).disclosure).toEqual(before.disclosure);
    await click('key-primary');
    expect(el('preview-state').textContent).toContain('COMMITTED');
    expect((await backend()).graph).toEqual(before.graph);
    expect(mutations()).toHaveLength(0);
  });

  it('shows API-backed 128→101→81 and 71/10 denial without a third answer; language and mode keep history', async () => {
    await click('mode-disclosure');
    await waitFor(() => !el<HTMLButtonElement>('submit-query').disabled);
    expect(el('partition-yes').textContent).toBe('101'); expect(el('partition-no').textContent).toBe('27');
    const bars = [...el('lcd-meter').children];
    await click('submit-query');
    await waitFor(() => el('working-lcd').textContent === '101' && el('work-dial').getAttribute('aria-valuenow') === '80');
    await waitFor(() => el('partition-no').textContent === '20');
    await click('submit-query');
    await waitFor(() => el('working-lcd').textContent === '81' && el('partition-no').textContent === '10');
    expect(el('partition-yes').textContent).toBe('71');
    expect((await backend()).disclosure.history).toHaveLength(2);
    const requests = calls.length;
    await click('language-en');
    expect(el('work-dial').getAttribute('aria-valuenow')).toBe('70');
    expect(el('working-lcd').textContent).toBe('81');
    expect((await backend()).capabilities.execution).toBe('NOT_IMPLEMENTED');
    expect(calls.length).toBe(requests);
    expect([...el('lcd-meter').children]).toEqual(bars);
    await click('submit-query');
    await waitFor(() => el('disclosure-history').textContent?.includes('NO ANSWER') ?? false);
    const final = await backend();
    expect(final.disclosure.history).toHaveLength(3);
    expect(final.disclosure.history.at(-1)).toMatchObject({ status: 'DENIED', partitions: { yes: 71, no: 10 }, remainingAfter: 81 });
    expect(final.disclosure.history.at(-1)).not.toHaveProperty('answer');
    expect(el('working-lcd').textContent).toBe('81');
    await click('mode-impact'); await click('mode-disclosure'); await click('language-ja');
    expect(el('disclosure-history').textContent).toContain('回答なし');
    expect(el('working-lcd').textContent).toBe('81');
    expect((await backend()).disclosure).toEqual(final.disclosure);
  });

  it('reuses the committed request key after response loss, then resets with the fresh server token', async () => {
    await click('mode-disclosure'); await waitFor(() => !el<HTMLButtonElement>('submit-query').disabled);
    loseNextQueryResponse = true; await click('submit-query');
    await waitFor(() => !!host.querySelector('[role="alert"]'));
    expect((await backend()).disclosure.history).toHaveLength(1);
    expect(el('working-lcd').textContent).toBe('—');
    expect(el('deck-display').getAttribute('data-decision')).toBe('unknown');
    expect(el('selected-outcome').textContent).toContain('未確認');
    await click('submit-query'); await waitFor(() => el('working-lcd').textContent === '101');
    const bodies = mutations().filter(call => call.path === '/api/query').map(call => JSON.parse(call.body) as { idempotencyKey: string });
    expect(bodies).toHaveLength(2); expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);
    expect((await backend()).disclosure.history).toHaveLength(1);
    const token = (await backend()).requestToken;
    await click('key-reset'); await waitFor(() => el('working-lcd').textContent === '128');
    expect((await backend()).requestToken).not.toBe(token);
    await waitFor(() => !el<HTMLButtonElement>('submit-query').disabled);
    await click('submit-query'); await waitFor(() => el('working-lcd').textContent === '101');
    expect((await backend()).disclosure.history).toHaveLength(1);
  });

  it('reconciles a lost reset response through explicit GET and uses the fresh token and request key', async () => {
    await click('mode-disclosure'); await waitFor(() => !el<HTMLButtonElement>('submit-query').disabled);
    await click('submit-query'); await waitFor(() => el('working-lcd').textContent === '101');
    const priorToken = (await backend()).requestToken;
    const firstQuery = JSON.parse(mutations().find(call => call.path === '/api/query')!.body) as { idempotencyKey: string };
    loseNextResetResponse = true;
    await click('key-reset'); await waitFor(() => !!host.querySelector('[role="alert"]'));
    const resetState = await backend();
    expect(resetState.requestToken).not.toBe(priorToken);
    expect(resetState.disclosure.history).toHaveLength(0);
    expect(el('working-lcd').textContent).toBe('—');
    expect(el('deck-display').getAttribute('data-decision')).toBe('unknown');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('未確認');
    expect(el<HTMLButtonElement>('submit-query').disabled).toBe(true);
    const mutationCount = mutations().length;
    const reads = calls.filter(call => call.path === '/api/state').length;
    await click('reload-state');
    await waitFor(() => el('working-lcd').textContent === '128' && !el<HTMLButtonElement>('submit-query').disabled);
    expect(calls.filter(call => call.path === '/api/state')).toHaveLength(reads + 1);
    expect(mutations()).toHaveLength(mutationCount);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await click('submit-query'); await waitFor(() => el('working-lcd').textContent === '81');
    const final = await backend();
    expect(final.disclosure.history).toHaveLength(1);
    expect(final.disclosure.history[0]?.idempotencyKey).not.toBe(firstQuery.idempotencyKey);
    expect(final.requestToken).toBe(resetState.requestToken);
    // A separate real reset makes this browser token stale: a 403 must stop POST loops.
    await waitFor(() => !el<HTMLButtonElement>('submit-query').disabled);
    await act(async () => {
      const response = await nativeFetch(`${base}/api/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VEREQO-Token': final.requestToken }, body: '{}' });
      expect(response.status).toBe(200); await response.arrayBuffer();
    });
    await click('submit-query'); await waitFor(() => !!host.querySelector('[role="alert"]'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('トークンが古く');
    expect(el<HTMLButtonElement>('submit-query').disabled).toBe(true);
    expect(el<HTMLButtonElement>('key-reset').disabled).toBe(true);
    const after403 = calls.length;
    await click('work-plus');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    expect(calls).toHaveLength(after403);
    const after403Mutations = mutations().length;
    await click('reload-state'); await waitFor(() => el('working-lcd').textContent === '128');
    expect(mutations()).toHaveLength(after403Mutations);
  });

  it('counts affected Claim A descendants from directed edges rather than shortest explanation paths', async () => {
    await click('key-primary'); await waitFor(() => el('working-lcd').textContent === '06');
    await click('key-secondary');
    const claim = [...el('affected-nodes').querySelectorAll('button')].find(button => button.textContent?.includes('申告 A'));
    expect(claim).toBeDefined();
    await act(async () => claim!.click());
    const affected = [...host.querySelectorAll('.reasonLine')].find(row => row.querySelector('dt')?.textContent === '影響範囲');
    expect(affected?.querySelector('dd')?.textContent).toContain('5ノード');
    await click('language-en');
    expect(affected?.querySelector('dd')?.textContent).toContain('5 nodes');
  });

  it('retains actual before/after transition evidence after committing revocation and keeps B unchanged', async () => {
    await click('language-en');
    await click('key-primary'); await waitFor(() => el('working-lcd').textContent === '06');
    await click('commit-preview'); await waitFor(() => el('preview-state').textContent?.includes('COMMITTED') ?? false);
    const cards = host.querySelectorAll('#impactContent .outcomeCard');
    expect(cards[0]?.querySelector('.beforeAfter')?.textContent).toBe('BEFORE: eligible locally → AFTER: blocked');
    expect(cards[1]?.querySelector('.beforeAfter')?.textContent).toBe('BEFORE: eligible locally → AFTER: eligible locally');
    let committed: DemoState | undefined;
    await act(async () => { committed = await backend(); });
    expect(committed?.graph.nodes.find(node => node.id === 'action_A')?.state).toBe('BLOCKED');
    expect(committed?.graph.nodes.find(node => node.id === 'action_B')?.state).toBe('VALID');
  });

  it('does not replay a graph event first received while inspecting disclosure', async () => {
    await click('mode-disclosure');
    const before = await backend();
    const response = await nativeFetch(`${base}/api/graph`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VEREQO-Token': before.requestToken }, body: JSON.stringify({ type:'REVOKE_CREDENTIAL', nodeId:'credential_A', eventId:'external-during-disclosure', expectedSequence:0 }) });
    expect(response.status).toBe(200);
    const proposals = calls.filter(call => call.path === '/api/preflight').length;
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => calls.filter(call => call.path === '/api/preflight').length > proposals && !el<HTMLButtonElement>('key-primary').disabled);
    await click('mode-impact');
    expect(el('decision-result').textContent).toContain('停止');
    expect(el('living-board').getAttribute('data-causal-motion')).toBe('static');
    expect(el('living-board').querySelectorAll('.nodeChanged')).toHaveLength(0);
    expect((await backend()).disclosure).toEqual(before.disclosure);
  });

  it('keyboard and alternate controls change only the proposal, never authorization or history', async () => {
    await click('mode-disclosure');
    const dial = el('work-dial'); dial.focus();
    const key = async (value: string) => act(async () => dial.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })));
    await key('End'); expect(dial.getAttribute('aria-valuenow')).toBe('127');
    await key('Home'); expect(dial.getAttribute('aria-valuenow')).toBe('0');
    await key('ArrowRight'); expect(dial.getAttribute('aria-valuenow')).toBe('1');
    await click('work-plus'); expect(dial.getAttribute('aria-valuenow')).toBe('2');
    await click('work-minus'); expect(dial.getAttribute('aria-valuenow')).toBe('1');
    expect(el<HTMLInputElement>('work-range').value).toBe('1');
    expect((await backend()).disclosure.history).toHaveLength(0);
    expect(mutations()).toHaveLength(0);
    expect((await backend()).capabilities.execution).toBe('NOT_IMPLEMENTED');
    expect((await backend()).graph.sequence).toBe(0);
  });
});
