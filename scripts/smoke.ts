import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApp } from '../services/issuer/src/http';
import type { DemoState, DisclosurePreflight } from '../packages/domain/src/demo';
import type { GraphResult } from '../packages/consequence/src/index';

const dir = mkdtempSync(join(tmpdir(), 'vereqo-instrument-smoke-'));
const app = createLocalApp({ databasePath: join(dir, 'issuer.sqlite') });
try {
  await new Promise<void>((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
  const base = `http://127.0.0.1:${address.port}`;
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  let state = await (await fetch(base + '/api/state')).json() as DemoState;
  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VEREQO-Token': state.requestToken }, body: JSON.stringify(body) });
    assert(response.ok, `${path}: ${response.status}`); return await response.json() as T;
  }
  const htmlResponse = await fetch(base), html = await htmlResponse.text(); assert(htmlResponse.ok && html.includes('VEREQO'), 'Built HTML unavailable');
  const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]!);
  for (const path of assetPaths) assert((await fetch(base + path)).ok, `Missing built asset ${path}`);
  const fonts = JSON.parse(readFileSync('apps/web/public/fonts/SOURCES.json', 'utf8')) as { files: { path: string }[] };
  for (const font of fonts.files) {
    const response = await fetch(base + '/fonts/' + font.path);
    assert(response.status === 200 && response.headers.get('content-type')?.startsWith('font/woff2'), 'Font MIME/delivery failed');
    const bytes = new Uint8Array(await response.arrayBuffer()); assert(String.fromCharCode(...bytes.slice(0, 4)) === 'wOF2', 'Font binary failed');
  }
  assert((await fetch(base + '/fonts/instrumentsans-OFL.txt')).status === 200, 'Font notice unavailable');
  const initial = state.disclosure.candidates.length;
  for (const threshold of [100, 80]) state = (await post<{ state: DemoState }>('/api/query', { threshold, policyEpoch: 1, idempotencyKey: `smoke-${threshold}` })).state;
  const before = JSON.stringify(state.disclosure);
  const proposal = (await post<{ preflight: DisclosurePreflight }>('/api/preflight', { threshold: 70, policyEpoch: 1 })).preflight;
  assert(proposal.status === 'DENIED' && proposal.partitions.yes === 71 && proposal.partitions.no === 10, 'Wrong preflight partition');
  assert(JSON.stringify((await (await fetch(base + '/api/state')).json() as DemoState).disclosure) === before, 'Preflight mutated history');
  state = (await post<{ state: DemoState }>('/api/query', { threshold: 70, policyEpoch: 1, idempotencyKey: 'smoke-deny' })).state;
  const denied = state.disclosure.history.at(-1)!;
  assert(denied.status === 'DENIED' && !('answer' in denied) && state.disclosure.candidates.length === 81, 'Unsafe answer release');
  const command = { type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', eventId: 'smoke-revoke', expectedSequence: 0 };
  const preview = await post<GraphResult>('/api/preview', command);
  assert((await (await fetch(base + '/api/state')).json() as DemoState).graph.sequence === 0, 'Preview committed');
  state = (await post<{ state: DemoState }>('/api/graph', command)).state;
  assert(JSON.stringify(state.graph) === JSON.stringify(preview.snapshot), 'Preview/commit divergence');
  assert(state.graph.nodes.find(node => node.id === 'action_A')?.state === 'BLOCKED' && state.graph.nodes.find(node => node.id === 'action_B')?.state === 'VALID', 'Wrong directed effect');
  const result = { environment: state.environment, initialCandidates: initial, history: state.disclosure.history, proposal,
    changedNodes: state.lastChanges.map(change => change.nodeId), actionB: state.graph.nodes.find(node => node.id === 'action_B')?.state,
    builtAssets: assetPaths, fontsDelivered: fonts.files.length, capabilities: state.capabilities, browserVisualQA: 'NOT_VERIFIED' };
  const oldToken = state.requestToken;
  state = (await post<{ state: DemoState }>('/api/reset', {})).state;
  assert(state.requestToken !== oldToken && state.disclosure.candidates.length === 128 && state.graph.sequence === 0, 'Reset failed');
  const stale = await fetch(base + '/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VEREQO-Token': oldToken }, body: '{}' });
  assert(stale.status === 403, 'Old generation token accepted'); await stale.arrayBuffer();
  const output = process.env.VEREQO_EVIDENCE_DIR ?? 'docs/evidence/instrument-integration';
  mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'http-smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS: built assets/fonts, API 128→101→81→DENIED, read-only preflight/preview, A-only cascade, reset/token rejection. Browser visuals NOT_VERIFIED.');
} finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
