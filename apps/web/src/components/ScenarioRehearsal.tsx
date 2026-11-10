import { useEffect, useState } from 'react';
import type { RehearsalResult, RehearsalView } from '../../../../packages/domain/src/rehearsal';

const STORAGE_KEY = 'vereqo.demo-kit.v1.selected-rehearsal';
const SCENARIOS = [
  ['S01-eligible-request', 'S01 · Bounded BUY LIMIT'],
  ['S02-exceeds-private-mandate', 'S02 · Private limit denial'],
  ['S03-revocation-causality', 'S03 · Revoke A, preserve B'],
  ['S04-unverified-market', 'S04 · Market risk unverified'],
  ['S05-cancel-vs-fill', 'S05 · Cancel versus partial fill'],
  ['S06-wrong-chain', 'S06 · Wrong chain'],
  ['S07-disclosure-sequence', 'S07 · Cumulative disclosure'],
  ['S08-proof-is-not-authority', 'S08 · Proof is not authority'],
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every(key => allowed.some(name => name === key));
}

const VIEW_KEYS = ['scenarioId', 'title', 'category', 'businessQuestion', 'dataClass', 'source', 'businessId', 'revision', 'intent', 'facts', 'operatorActions', 'evidenceState'] as const;
const INTENT_KEYS = ['intentId', 'principalId', 'agentId', 'issuerId', 'credentialId', 'mandateId', 'marketSymbol', 'side', 'orderType', 'quantity', 'limitPrice', 'units', 'notionalQuote', 'source'] as const;
const VIEW_FACT_KEYS = ['targetChainId', 'verifiedOnChain', 'chainStatus', 'marketId', 'orderHash', 'agentAIntents', 'agentBIntents', 'openOrderState', 'marketConsistency', 'marketRisk', 'syntheticOrderId', 'requestedQuantity', 'simulatedFilledQuantity', 'simulatedRemainingQuantity', 'cancelConfirmed', 'providerChainId', 'requiredChainId', 'requestCount', 'disclosureAdapter', 'credentialEpochAtIntent', 'credentialEpochNow', 'proofArtifact'] as const;
const RESULT_KEYS = ['scenarioId', 'businessId', 'revision', 'source', 'decision', 'reason', 'authorized', 'execution', 'proofStatus', 'evidenceState', 'facts'] as const;
const RESULT_FACT_KEYS = ['notionalQuote', 'policyBoundReturned', 'authority', 'graphSequenceBefore', 'graphSequenceAfter', 'previewSequence', 'agentAIntent', 'agentAAction', 'agentBIntent', 'agentBAction', 'existingOrder', 'nonceConsumed', 'budgetReserved', 'precompileCalled', 'requestedQuantity', 'simulatedFilledQuantity', 'simulatedRemainingQuantity', 'orderStatus', 'providerChainId', 'requiredChainId', 'walletProviderCalled', 'requestCount', 'disclosureRequestsSent', 'credentialEpochAtIntent', 'credentialEpochNow', 'proofArtifact', 'gateTestForThisScenario', 'requestId', 'intentDigest', 'proofDigest', 'issuerSignatureStatus'] as const;

function validView(value: unknown): value is RehearsalView {
  if (!record(value) || !exactKeys(value, VIEW_KEYS) || value.dataClass !== 'SYNTHETIC_REHEARSAL' || value.source !== 'PORTABLE_KIT_V1' ||
      typeof value.scenarioId !== 'string' || !SCENARIOS.some(([id]) => id === value.scenarioId) ||
      typeof value.businessId !== 'string' || !/^fi_[a-f0-9]{32}$/.test(value.businessId) || value.revision !== 1 ||
      typeof value.title !== 'string' || typeof value.category !== 'string' || typeof value.businessQuestion !== 'string' ||
      !Array.isArray(value.operatorActions) || value.operatorActions.some(item => typeof item !== 'string') ||
      value.evidenceState !== 'NO_RECORD' || !record(value.facts) || Object.keys(value.facts).some(key => !VIEW_FACT_KEYS.includes(key as typeof VIEW_FACT_KEYS[number]))) return false;
  const intent = value.intent;
  if (intent !== null) {
    if (!record(intent) || !exactKeys(intent, INTENT_KEYS) || intent.source !== 'SYNTHETIC_FIXTURE' || intent.orderType !== 'LIMIT' ||
        (intent.side !== 'BUY' && intent.side !== 'SELL') ||
        ['intentId', 'principalId', 'agentId', 'issuerId', 'credentialId', 'mandateId', 'marketSymbol', 'quantity', 'limitPrice', 'units', 'notionalQuote'].some(key => typeof intent[key] !== 'string')) return false;
  }
  if (value.scenarioId === 'S08-proof-is-not-authority' &&
      (!record(value.intent) || value.intent.marketSymbol !== 'INJ/USDT' || value.intent.side !== 'BUY' ||
       value.intent.orderType !== 'LIMIT' || value.intent.quantity !== '2' || value.intent.limitPrice !== '1' ||
       value.intent.notionalQuote !== '2' || value.facts.targetChainId !== 1439 ||
       value.facts.credentialEpochAtIntent !== 1 || value.facts.credentialEpochNow !== 2)) return false;
  return true;
}

function validResult(value: unknown, scenario: RehearsalView): value is RehearsalResult {
  if (!(record(value) && exactKeys(value, RESULT_KEYS) && value.scenarioId === scenario.scenarioId &&
    value.businessId === scenario.businessId && value.revision === scenario.revision && value.authorized === false &&
    value.evidenceState === 'NO_RECORD' && typeof value.source === 'string' && typeof value.decision === 'string' &&
    typeof value.reason === 'string' && typeof value.execution === 'string' && typeof value.proofStatus === 'string' &&
    record(value.facts) && Object.keys(value.facts).every(key => RESULT_FACT_KEYS.includes(key as typeof RESULT_FACT_KEYS[number])))) return false;
  if (scenario.scenarioId === 'S08-proof-is-not-authority') {
    const facts = value.facts as Record<string, unknown>;
    if (value.source !== 'LOCAL_GROTH16_TEST_VECTOR' || value.decision !== 'BLOCKED' ||
        value.reason !== 'LOCAL_REPLAY_ONLY_MANDATE_EPOCH_ADVANCED; LIVE_GATE_NOT_CALLED' ||
        value.proofStatus !== 'GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP' || value.execution !== 'NOT_IMPLEMENTED' ||
        facts.requestId !== scenario.businessId || !/^0x[0-9a-f]{64}$/i.test(String(facts.intentDigest)) ||
        !/^0x[0-9a-f]{64}$/i.test(String(facts.proofDigest)) || facts.credentialEpochAtIntent !== 1 ||
        facts.credentialEpochNow !== 2 || facts.issuerSignatureStatus !== 'NOT_VERIFIED_IN_REHEARSAL' ||
        facts.walletProviderCalled !== false || facts.precompileCalled !== false || facts.orderStatus !== 'NOT_SUBMITTED') return false;
  }
  return true;
}

export function readSavedRehearsal(): RehearsalView | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return validView(value) ? value : null;
  } catch { return null; }
}

export function saveRehearsal(value: RehearsalView): void {
  try { globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(value)); }
  catch { /* The in-memory rehearsal remains usable when storage is unavailable. */ }
}

export function clearSavedRehearsal(): void {
  try { globalThis.sessionStorage?.removeItem(STORAGE_KEY); }
  catch { /* Reset still clears current UI state. */ }
}

function decisionLabel(decision: string, language: 'ja' | 'en'): string {
  const labels: Record<string, [string, string]> = {
    WITHIN_SYNTHETIC_POLICY: ['WITHIN SYNTHETIC POLICY · NOT AUTHORIZED', '合成ポリシー内・認可ではありません'],
    DENIED: ['DENIED · PRIVATE LIMIT NOT DISCLOSED', '拒否・非公開上限は開示しません'],
    WHAT_IF_ONLY: ['WHAT-IF ONLY · GRAPH UNCHANGED', 'WHAT-IFのみ・グラフ未変更'],
    BLOCKED: ['BLOCKED · CAPABILITY NOT VERIFIED', 'ブロック・機能未検証'],
    CANCEL_REQUESTED_NOT_CONFIRMED: ['CANCEL REQUESTED · NOT CONFIRMED', '取消要求済み・未確認'],
    DENIED_WRONG_CHAIN: ['DENIED · WRONG CHAIN', '拒否・誤ったchain'],
  };
  const value = labels[decision];
  return value ? value[language === 'ja' ? 1 : 0] : decision;
}

function resultFacts(result: RehearsalResult, language: 'ja' | 'en'): [string, string][] {
  const labels: Record<string, [string, string]> = {
    notionalQuote: ['Fixture notional', 'Fixture notional'],
    policyBoundReturned: ['Private limit returned', '非公開上限の返却'],
    authority: ['Authority', '権限'],
    graphSequenceBefore: ['Graph sequence before', '実行前graph sequence'],
    graphSequenceAfter: ['Graph sequence after', '実行後graph sequence'],
    previewSequence: ['Preview sequence', 'preview sequence'],
    agentAIntent: ['Agent A intent branch', 'Agent A intent経路'],
    agentAAction: ['Agent A action', 'Agent A action'],
    agentBIntent: ['Independent Agent B intent', '独立したAgent B intent'],
    agentBAction: ['Independent Agent B action', '独立したAgent B action'],
    existingOrder: ['Existing order', '既存order'],
    nonceConsumed: ['Nonce consumed', 'nonce消費'],
    budgetReserved: ['Exposure reserved', 'exposure予約'],
    precompileCalled: ['Exchange precompile called', 'Exchange precompile呼出'],
    requestedQuantity: ['Requested', '要求数量'],
    simulatedFilledQuantity: ['Synthetic partial fill', '合成partial fill'],
    simulatedRemainingQuantity: ['Synthetic remaining', '合成残数量'],
    orderStatus: ['Chain order status', 'chain order状態'],
    providerChainId: ['Synthetic provider chain ID', '合成provider chain ID'],
    requiredChainId: ['Required chain ID', '必要chain ID'],
    walletProviderCalled: ['Wallet provider called', 'Wallet provider呼出'],
    requestCount: ['Requests in fixture', 'fixture内request数'],
    disclosureRequestsSent: ['Disclosure requests sent', '開示request送信'],
    credentialEpochAtIntent: ['Credential epoch at intent', 'intent作成時credential epoch'],
    credentialEpochNow: ['Current fixture epoch', 'fixture現在epoch'],
    proofArtifact: ['Proof artifact', 'proof artifact'],
    gateTestForThisScenario: ['Gate test for this exact scenario', 'このscenarioのGate test'],
    requestId: ['Canonical request ID', '正準Request ID'],
    intentDigest: ['Exact Intent digest', '正確なIntent digest'],
    proofDigest: ['Verified proof digest', '検証済みproof digest'],
    issuerSignatureStatus: ['Issuer signature in this replay', 'この再生でのIssuer署名'],
  };
  return Object.entries(result.facts).map(([key, value]) => [labels[key]?.[language === 'ja' ? 1 : 0] ?? key, String(value)]);
}

function scenarioFacts(scenario: RehearsalView): [string, string][] {
  const labels: Record<string, string> = {
    targetChainId: 'Fixture target chain ID', verifiedOnChain: 'Chain verified', chainStatus: 'Fixture chain status',
    marketId: 'Live market ID', orderHash: 'Order hash', agentAIntents: 'Agent A fixture intents',
    agentBIntents: 'Independent Agent B fixture intents', openOrderState: 'Existing order state',
    marketConsistency: 'Market consistency', marketRisk: 'Market risk', syntheticOrderId: 'Synthetic order ID',
    requestedQuantity: 'Requested quantity', simulatedFilledQuantity: 'Synthetic partial fill',
    simulatedRemainingQuantity: 'Synthetic remaining quantity', cancelConfirmed: 'Cancel confirmed',
    providerChainId: 'Synthetic provider chain ID', requiredChainId: 'Required chain ID',
    requestCount: 'Requests in fixture', disclosureAdapter: 'Disclosure adapter',
    credentialEpochAtIntent: 'Credential epoch at intent', credentialEpochNow: 'Current fixture epoch', proofArtifact: 'Proof artifact',
  };
  return Object.entries(scenario.facts).map(([key, value]) => [labels[key] ?? key, value === null ? 'NONE' : String(value)]);
}

export function ScenarioRehearsal({
  language, scenario, result, onLoaded, onReset, onResult, onOpenTrace,
}: {
  language: 'ja' | 'en';
  scenario: RehearsalView | null;
  result: RehearsalResult | null;
  onLoaded: (view: RehearsalView) => void;
  onReset: () => void;
  onResult: (result: RehearsalResult | null) => void;
  onOpenTrace: () => void;
}) {
  const ja = language === 'ja';
  const [selectedId, setSelectedId] = useState(scenario?.scenarioId ?? SCENARIOS[0][0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelectedId(scenario?.scenarioId ?? SCENARIOS[0][0]);
  }, [scenario?.scenarioId, scenario?.businessId]);

  async function loadScenario() {
    setBusy(true); setError(''); onResult(null);
    try {
      const response = await fetch('/api/demo/load', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: selectedId }) });
      if (!response.ok) throw new Error('SCENARIO_LOAD_UNAVAILABLE');
      const body: unknown = await response.json();
      const view = record(body) ? body.scenario : null;
      if (!validView(view)) throw new Error('INVALID_SCENARIO_RESPONSE');
      saveRehearsal(view); onLoaded(view);
    } catch { setError(ja ? 'Scenarioを読めません。状態はUNKNOWNです。' : 'Scenario could not be loaded. State is UNKNOWN.'); }
    finally { setBusy(false); }
  }

  async function replay() {
    if (!scenario) return;
    setBusy(true); setError(''); onResult(null);
    try {
      const response = await fetch('/api/demo/replay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: scenario.scenarioId, businessId: scenario.businessId, revision: scenario.revision }) });
      if (!response.ok) throw new Error('SCENARIO_REPLAY_UNAVAILABLE');
      const body: unknown = await response.json();
      const value = record(body) ? body.result : null;
      if (!validResult(value, scenario)) throw new Error('INVALID_REHEARSAL_RESULT');
      const next = value as unknown as RehearsalResult;
      onResult(next);
    } catch { onResult(null); setError(ja ? '再生結果を検証できません。状態はUNKNOWNです。' : 'Replay result could not be verified. State is UNKNOWN.'); }
    finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true); setError('');
    try {
      if (scenario) {
        const response = await fetch('/api/demo/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: scenario.scenarioId, businessId: scenario.businessId, revision: scenario.revision }) });
        if (!response.ok) throw new Error('SCENARIO_RESET_UNAVAILABLE');
        const body: unknown = await response.json();
        if (!record(body) || body.status !== 'RESET' || body.dataMutation !== false || body.businessId !== scenario.businessId) throw new Error('INVALID_SCENARIO_RESET');
      }
      clearSavedRehearsal(); onReset();
    } catch { clearSavedRehearsal(); onReset(); setError(ja ? 'ローカル画面は初期化しました。serviceのreset応答は確認できませんでした。' : 'Local UI reset; service reset response was not confirmed.'); }
    finally { setBusy(false); }
  }

  const intent = scenario?.intent ?? null;
  const summary: [string, string][] = intent ? [
    [ja ? 'AGENT' : 'AGENT', `${intent.agentId} · SYNTHETIC`],
    [ja ? 'PRINCIPAL' : 'PRINCIPAL', `${intent.principalId} · SYNTHETIC / no wallet`],
    [ja ? 'MARKET' : 'MARKET', `${intent.marketSymbol} Spot · synthetic reference · no live market ID`],
    [ja ? 'SIDE / TYPE' : 'SIDE / TYPE', `${intent.side} ${intent.orderType}`],
    [ja ? 'QUANTITY' : 'QUANTITY', `${intent.quantity} INJ · SYNTHETIC_FIXTURE`],
    [ja ? 'LIMIT PRICE' : 'LIMIT PRICE', `${intent.limitPrice} USDT/INJ · SYNTHETIC_FIXTURE`],
    [ja ? 'NOTIONAL' : 'NOTIONAL', `${intent.notionalQuote} USDT · fixture arithmetic`],
    [ja ? 'DECISION' : 'DECISION', result ? decisionLabel(result.decision, language) : 'NOT EVALUATED'],
  ] : scenario ? [
    ['AGENT', scenario.scenarioId.includes('S03') ? 'Agent A / Agent B · synthetic branches' : 'Synthetic scenario actor'],
    ['PRINCIPAL', 'principal-operator-01 · SYNTHETIC / no wallet'],
    ['MARKET', 'No live market observation or market ID in this scenario'],
    ['SIDE / TYPE', 'NOT PROVIDED'], ['QUANTITY', 'NOT PROVIDED'], ['LIMIT PRICE', 'NOT PROVIDED'],
    ['NOTIONAL', 'NOT PROVIDED'], ['DECISION', result ? decisionLabel(result.decision, language) : 'NOT EVALUATED'],
  ] : [];

  const description = scenario?.scenarioId === 'S08-proof-is-not-authority'
    ? ja
      ? 'このlocal Requestを、固定確認済みのpublic Groth16 test vectorと合成consequence previewに照合します。Wallet provider、Issuer署名検証、live Gate、Testnet書込、order実行は呼び出しません。'
      : 'Replay this exact local Request against a pinned public Groth16 test vector and a synthetic consequence preview. No wallet provider, issuer signature verification, live Gate, Testnet write, or order execution is called.'
    : ja
      ? '実際のIntentと既存のdomain/serviceを再生します。Wallet・proof・Testnet・order実行は呼び出しません。'
      : 'Replay the fixture through VEREQO domain/service logic. No wallet, proof, Testnet write, or order execution is requested.';

  return <section className="scenarioRehearsal" aria-labelledby="rehearsal-heading" data-testid="scenario-rehearsal" data-business-id={scenario?.businessId ?? ''} data-revision={scenario?.revision ?? ''}>
    <header className="rehearsalHeader">
      <div><span className="eyebrow">LOCAL / SYNTHETIC REHEARSAL</span><h3 id="rehearsal-heading">{ja ? 'Operator rehearsal' : 'Operator rehearsal'}</h3>
        <p>{description}</p></div>
      <span className="badge">{scenario ? 'SYNTHETIC_REHEARSAL' : 'NOT LOADED'}</span>
    </header>
    <div className="rehearsalControls">
      <label htmlFor="rehearsal-scenario">{ja ? 'Scenarioを選択' : 'Choose a scenario'}</label>
      <select id="rehearsal-scenario" data-testid="rehearsal-scenario-select" value={selectedId} disabled={busy} onChange={event => setSelectedId(event.target.value)}>
        {SCENARIOS.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
      </select>
      <button type="button" data-testid="rehearsal-load" disabled={busy} onClick={() => void loadScenario()}>{busy ? '…' : ja ? 'LOAD SCENARIO' : 'LOAD SCENARIO'}</button>
      <button type="button" data-testid="rehearsal-replay" disabled={busy || !scenario} onClick={() => void replay()}>{ja ? 'REPLAY CHECK' : 'REPLAY CHECK'}</button>
      <button type="button" data-testid="rehearsal-reset" disabled={busy} onClick={() => void reset()}>{ja ? 'RESET' : 'RESET'}</button>
    </div>
    {error && <p className="rehearsalError" role="alert">{error}</p>}
    {scenario ? <>
      <div className="rehearsalIdentity"><div><span>SCENARIO / SOURCE</span><strong>{scenario.scenarioId} · PORTABLE_KIT_V1</strong></div><div><span>BUSINESS ID / REVISION</span><strong data-testid="rehearsal-business-id">{scenario.businessId} / V{scenario.revision}</strong></div></div>
      <h4>{scenario.title}</h4><p className="rehearsalQuestion">{scenario.businessQuestion}</p>
      <dl className="rehearsalFacts">{summary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {Object.keys(scenario.facts).length > 0 && <dl className="rehearsalContextFacts" aria-label={ja ? 'Scenario fixture context' : 'Scenario fixture context'}>{scenarioFacts(scenario).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      <dl className="rehearsalProofBoundary">
        <div><dt>PROOF</dt><dd>{result?.proofStatus ?? (scenario.scenarioId === 'S08-proof-is-not-authority' ? 'AVAILABLE IN LOCAL TEST VECTOR · NOT VERIFIED UNTIL REPLAY' : 'NOT REQUESTED')}</dd></div>
        <div><dt>AUTHORITY</dt><dd>{result?.facts.authority ? String(result.facts.authority) : scenario.scenarioId === 'S08-proof-is-not-authority' ? 'NO LIVE MANDATE · LOCAL TEST VECTOR ONLY' : 'NOT CONFIGURED'}</dd></div>
        <div><dt>EXECUTION</dt><dd>{result?.execution ?? 'NOT IMPLEMENTED'}</dd></div>
        <div><dt>DEMO EVIDENCE</dt><dd>NO_RECORD · no rehearsal event is persisted</dd></div>
      </dl>
      {result && <section className="rehearsalResult" role="status" aria-live="polite" data-testid="rehearsal-result" data-decision={result.decision}>
        <span className="eyebrow">{result.source} · LOCAL CHECK ONLY</span><h4>{decisionLabel(result.decision, language)}</h4><p>{result.reason}</p>
        <dl>{resultFacts(result, language).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </section>}
      <div className="rehearsalNext"><p>{ja ? '次の安全な操作：根拠を確認し、未設定のIssuer・Proof・Gateは未設定のままにします。' : 'Next safe action: inspect the evidence boundary; keep unconfigured Issuer, proof, and Gate states explicit.'}</p>
        <button type="button" data-testid="rehearsal-open-trace" onClick={onOpenTrace}>{ja ? '既存のInstrument / Consequence / Evidenceで開く' : 'Open in existing Instrument / Consequence / Evidence'} ↗</button></div>
    </> : <p className="rehearsalEmpty">{ja ? 'Scenarioを読み込むと、Intentと根拠のsourceを表示します。' : 'Load a scenario to inspect its Intent and evidence source.'}</p>}
  </section>;
}
