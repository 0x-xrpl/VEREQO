import { useEffect, useRef, useState } from 'react';
import type { DemoState, DisclosurePreflight } from '../../../packages/domain/src/demo';
import type { GraphCommand, GraphSnapshot, NodeChange } from '../../../packages/consequence/src/index';

export type DemoMode = 'impact' | 'disclosure';
export interface DemoPreview { snapshot: GraphSnapshot; changes: NodeChange[]; command: GraphCommand }
type Mode = DemoMode;
type Preview = DemoPreview;
type Preflight = DisclosurePreflight;
class RequestError extends Error { constructor(public code: number) { super('REQUEST_FAILED'); } }

/** One persistent local-demo controller; presentation/navigation never own release state. */
export function useDemoController() {
 const [mode, setMode] = useState<Mode>('impact');
 const [state, setState] = useState<DemoState | null>(null);
 const stateRef = useRef(state); stateRef.current = state;
 const [depth, setDepth] = useState(1);
 const [threshold, setThreshold] = useState(100);
 const [selected, setSelected] = useState('credential_A');
 const [preview, setPreview] = useState<Preview | null>(null);
 const [updatedAt, setUpdatedAt] = useState<number | null>(null);
 function acceptState(next: DemoState) { setState(next); setUpdatedAt(Date.now()); }
 const [proposal, setProposal] = useState<Preflight | null>(null);
 const [pending, setPending] = useState(false);
 const [needsReload, setNeedsReload] = useState(false);
 const [refreshRevision, setRefreshRevision] = useState(0);
 const busy = useRef(false);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');
 const retry = useRef<{ scope: string; key: string } | null>(null);
 async function load(): Promise<boolean> {
  if (busy.current) return false;
  busy.current = true; setPending(true);
  try {
   const response = await fetch('/api/state', { cache: 'no-store' });
   if (!response.ok) throw new RequestError(response.status);
   const next = await response.json() as DemoState;
   const generationChanged = !!stateRef.current && stateRef.current.requestToken !== next.requestToken;
   if (generationChanged) retry.current = null;
   // Preview.expectedSequence is its committed BASE, not its hypothetical result sequence.
   setPreview(current => current && (generationChanged || current.command.expectedSequence !== next.graph.sequence) ? null : current);
   setProposal(null); acceptState(next); setNeedsReload(false); setError(''); setNotice('');
   setRefreshRevision(value => value + 1);
   return true;
  } catch { setError('unavailable'); return false; }
  finally { busy.current = false; setPending(false); }
 }
 useEffect(() => { void load(); }, []);
 useEffect(() => {
  const reconcileOnFocus = () => { if (document.visibilityState !== 'hidden') void load(); };
  window.addEventListener('focus', reconcileOnFocus);
  return () => window.removeEventListener('focus', reconcileOnFocus);
 }, []);
 async function post<T,>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const current = stateRef.current;
  if (!current) throw new RequestError(503);
  if (needsReload) throw new RequestError(403);
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VEREQO-Token': current.requestToken }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  if (!response.ok) throw new RequestError(response.status);
  return await response.json() as T;
 }
 const epoch = state?.disclosure.policy.epoch;
 const historySequence = state?.disclosure.history.at(-1)?.sequence ?? 0;
 const remaining = state?.disclosure.candidates.length;
 const token = state?.requestToken;
 useEffect(() => {
  setProposal(null);
  if (!stateRef.current || epoch === undefined || needsReload) return;
  const controller = new AbortController(); let active = true;
  const timer = window.setTimeout(() => {
   void post<{ preflight: Preflight }>('/api/preflight', { threshold, policyEpoch: epoch }, controller.signal).then(({ preflight }) => {
    if (active && preflight.query.threshold === threshold && preflight.policyEpoch === epoch && preflight.historySequence === historySequence && preflight.remainingBefore === remaining) setProposal(preflight);
   }).catch((cause: unknown) => { if (active) { setError(cause instanceof RequestError && cause.code === 403 ? 'staleSession' : 'failed'); if (cause instanceof RequestError && cause.code === 403) setNeedsReload(true); } });
  }, 180);
  return () => { active = false; window.clearTimeout(timer); controller.abort(); };
 }, [threshold, epoch, historySequence, remaining, token, needsReload, refreshRevision]);
 const preflight = !needsReload && proposal?.query.threshold === threshold && proposal.policyEpoch === epoch && proposal.historySequence === historySequence && proposal.remainingBefore === remaining ? proposal : null;
 async function perform(action: () => Promise<void>, reconcileOnFailure = false) {
  if (busy.current || needsReload) return; busy.current = true; setPending(true); setError(''); setNotice('');
  try { await action(); } catch (cause) {
   const stale = cause instanceof RequestError && cause.code === 403;
   setError(stale ? 'staleSession' : 'failed');
   if (stale || reconcileOnFailure) { setNeedsReload(true); setProposal(null); }
  } finally { busy.current = false; setPending(false); }
 }
 async function request() {
  const current = stateRef.current; if (!current || !preflight) return;
  const query = threshold;
  const scope = JSON.stringify([current.requestToken, current.disclosure.policy.epoch, query]);
  if (retry.current?.scope !== scope) retry.current = { scope, key: crypto.randomUUID() };
  const key = retry.current.key;
  await perform(async () => {
   const result = await post<{ state: DemoState }>('/api/query', { threshold: query, policyEpoch: current.disclosure.policy.epoch, idempotencyKey: key });
   acceptState(result.state); setPreview(null); retry.current = null;
   const record = result.state.disclosure.history.find(entry => entry.idempotencyKey === key);
   setNotice(record?.status === 'DENIED' ? 'deniedNotice' : 'allowedNotice');
   // Advance the guided proposal only from an actual committed YES against this history.
   if (record?.status === 'ALLOWED' && record.answer === true && record.remainingBefore === current.disclosure.candidates.length && record.query.threshold === query) {
    if (query === 100 && current.disclosure.history.length === 0) setThreshold(80);
    else if (query === 80 && current.disclosure.history.at(-1)?.query.threshold === 100 && current.disclosure.history.at(-1)?.answer === true) setThreshold(70);
   }
  });
 }
 async function previewImpact() {
  if (preview) { setPreview(null); setNotice('cancelNotice'); return; }
  const current = stateRef.current; if (!current) return;
  await perform(async () => {
   const command: GraphCommand = { type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', eventId: crypto.randomUUID(), expectedSequence: current.graph.sequence };
   const result = await post<{ snapshot: GraphSnapshot; changes: NodeChange[] }>('/api/preview', command);
   setPreview({ ...result, command }); setNotice('previewNotice');
  });
 }
 async function commit() {
  if (!preview) return; const command = preview.command;
  await perform(async () => { const result = await post<{ state: DemoState }>('/api/graph', command); acceptState(result.state); setPreview(null); setNotice('committed'); });
 }
 async function reset() {
  await perform(async () => { const result = await post<{ state: DemoState }>('/api/reset', {}); acceptState(result.state); setPreview(null); setProposal(null); retry.current = null; setSelected('credential_A'); setThreshold(100); setNotice('resetNotice'); }, true);
 }
 return { state, mode, setMode, depth, setDepth, threshold, setThreshold, selected, setSelected,
  preview, preflight, pending, needsReload, error, notice, load, request, previewImpact, commit, reset,
  // Client receipt time of the last committed-state snapshot; never a chain/event timestamp.
  updatedAt };
}

export type DemoController = ReturnType<typeof useDemoController>;
