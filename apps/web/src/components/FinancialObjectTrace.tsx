import type { Language } from '../i18n';

export interface FinancialObjectTrace {
 readonly requestId: string;
 readonly revision: number;
 readonly marketKind: 'SPOT' | 'DERIVATIVE';
 readonly marketId: string | null;
 readonly marketStatus: 'LIVE_READ_ONLY' | 'UNKNOWN';
 readonly chainId?: string | null;
 readonly blockNumber: string | null;
 readonly blockHash?: string | null;
 readonly blockSource?: string | null;
 readonly observedAt: string | null;
 readonly marketSource?: string | null;
 readonly marketConsistency?: string | null;
 readonly side: 'BUY' | 'SELL';
 readonly price: string | null;
 readonly quantity: string | null;
 readonly draftStatus: 'UNSIGNED_DRAFT' | 'REVIEW_IN_PROGRESS' | 'REJECTED' | 'UNKNOWN';
 readonly evidenceState: 'NOT_REQUESTED' | 'AUTHENTICATION_REQUIRED' | 'NO_RECORD' | 'AVAILABLE' | 'UNKNOWN';
 readonly evidenceId: string | null;
 readonly evidenceStatus: 'REJECTED' | 'PRE_GATE_VALIDATED' | null;
 readonly evidenceReason: string | null;
 readonly intentDigest: string | null;
 readonly evidenceHash: string | null;
 readonly evidenceEventCount: number;
 readonly finalizationEvidenceState?: 'NOT_REQUESTED' | 'AUTHENTICATION_REQUIRED' | 'NO_RECORD' | 'AVAILABLE' | 'UNKNOWN';
 readonly finalizationEvidenceId?: string | null;
 readonly finalizationEvidenceStatus?: 'OWNER_SIGNATURE_REQUIRED' | 'REJECTED' | null;
 readonly finalizationOwnerSignatureStatus?: 'REQUIRED' | 'NOT_REQUESTED' | null;
 readonly finalizationEvidenceReason?: string | null;
 readonly finalizationEvidenceHash?: string | null;
 readonly finalizationProofDigest?: string | null;
 readonly recordOnly?: boolean;
 readonly proofDigest?: string | null;
 readonly mandateDigest?: string | null;
 readonly requestDigest?: string | null;
 readonly disclosureBindingDigest?: string | null;
 readonly disclosureHistoryRoot?: string | null;
 readonly disclosureHistorySequence?: string | null;
 readonly disclosurePolicyEpoch?: string | null;
 readonly disclosureCredentialEpoch?: string | null;
 readonly hypotheticalCredentialRevocation: boolean;
 readonly requestSource?: 'LOCAL_FINANCIAL_DRAFT' | 'SYNTHETIC_REHEARSAL' | 'OWNER_SCOPED_AUTHORIZATION_RECORD';
 readonly evidenceSource?: 'OWNER_SCOPED_AUTHORIZATION' | 'REHEARSAL_NAMESPACE';
 readonly rehearsalScenarioId?: string | null;
 readonly rehearsalDecision?: string | null;
 readonly rehearsalSource?: string | null;
 readonly rehearsalProofStatus?: string | null;
 readonly rehearsalFacts?: Readonly<Record<string, string | number | boolean | null>> | null;
}

export function FinancialObjectTracePanel({
 trace, language, surface,
}: {
 trace: FinancialObjectTrace | null;
 language: Language;
 surface: 'INSTRUMENT' | 'CONSEQUENCE' | 'EVIDENCE';
}) {
 if (!trace) return null;
 const ja = language === 'ja';
 const label = (en: string, jp: string) => ja ? jp : en;
 const localGroth16Verified = trace.rehearsalScenarioId === 'S08-proof-is-not-authority' &&
  trace.rehearsalSource === 'LOCAL_GROTH16_TEST_VECTOR' &&
  trace.rehearsalProofStatus === 'GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP' &&
  typeof trace.rehearsalFacts?.proofDigest === 'string' && /^0x[0-9a-f]{64}$/i.test(trace.rehearsalFacts.proofDigest);
 const draft = trace.draftStatus === 'UNSIGNED_DRAFT'
  ? label('UNSIGNED DRAFT', '未署名の下書き')
  : trace.draftStatus === 'REVIEW_IN_PROGRESS'
   ? label('REVIEW IN PROGRESS', '審査中')
   : trace.draftStatus === 'REJECTED'
    ? label('LOCAL DRAFT REJECTED', 'ローカル下書き拒否') : 'UNKNOWN';
 const evidence = trace.evidenceState === 'AVAILABLE'
  ? `LOCAL ISSUER / ${trace.evidenceStatus ?? 'UNKNOWN'}`
  : trace.evidenceState === 'NO_RECORD' ? 'NO RECORD'
   : trace.evidenceState === 'AUTHENTICATION_REQUIRED' ? 'AUTHENTICATION REQUIRED'
    : trace.evidenceState === 'UNKNOWN' ? 'UNKNOWN / NO FALLBACK' : 'NOT REQUESTED';
 const finalization = trace.finalizationEvidenceState === 'AVAILABLE'
  ? `${trace.finalizationEvidenceStatus ?? 'UNKNOWN'} · ${trace.finalizationOwnerSignatureStatus ?? 'UNKNOWN'}`
  : trace.finalizationEvidenceState === 'NO_RECORD' ? 'NO PRE-SIGNATURE REVIEW RECORD'
   : trace.finalizationEvidenceState === 'AUTHENTICATION_REQUIRED' ? 'AUTHENTICATION REQUIRED'
    : trace.finalizationEvidenceState === 'UNKNOWN' ? 'UNKNOWN / NO FALLBACK' : 'NOT REQUESTED';
 const rehearsal = trace.requestSource === 'SYNTHETIC_REHEARSAL';
 const journey = [
  [label('Proposal', '提案'), rehearsal ? 'SYNTHETIC REHEARSAL' : trace.recordOnly ? label('RECORD ONLY · proposal details unavailable', '記録のみ・提案の詳細は未取得') : draft],
  [label('Proof', '証明'), localGroth16Verified ? 'LOCAL TEST VECTOR VERIFIED' : trace.proofDigest ? label('DIGEST RECORDED · not reverified here', 'digest記録あり・この画面での再検証なし') : 'NOT PROVIDED / NOT VERIFIED'],
  [label('Decision', '判定'), rehearsal ? trace.rehearsalDecision ?? 'NOT REPLAYED' : trace.finalizationEvidenceStatus === 'OWNER_SIGNATURE_REQUIRED' ? 'OWNER SIGNATURE REQUIRED · NOT APPROVED' : trace.evidenceStatus ? `${trace.evidenceStatus} · ${trace.evidenceReason ?? 'PRE-GATE ONLY'}` : 'UNKNOWN'],
  [label('Consequence', '影響'), trace.hypotheticalCredentialRevocation || trace.rehearsalFacts?.agentAAction ? 'LOCAL WHAT-IF ONLY' : label('Financial graph not configured', '金融グラフ未設定')],
  [label('Evidence', '証拠'), trace.finalizationEvidenceState === 'AVAILABLE' ? `PRE-SIGNATURE REVIEW / ${finalization}` : `${evidence} · ${trace.evidenceEventCount} ${label('records', '件')}`],
 ];

 return <section
  className="financialObjectTrace"
  tabIndex={-1}
  data-testid={`financial-trace-${surface.toLowerCase()}`}
  data-object-id={trace.requestId}
  data-revision={trace.revision}
  data-surface={surface}
  aria-label={label('Selected financial request trace', '選択中の金融依頼トレース')}
 >
  <header>
   <div>
    <span className="eyebrow">{surface} / {label('FINANCIAL REQUEST CONTEXT', '金融依頼コンテキスト')}</span>
    <h3>{trace.recordOnly ? label('One Business Request · recorded evidence', '一つのBusiness Request・記録済みの証拠') : label('One selected draft · local evidence only', '選択中の下書き・ローカル根拠のみ')}</h3>
   </div>
   <span className="badge">{trace.finalizationEvidenceStatus === 'OWNER_SIGNATURE_REQUIRED' ? 'OWNER SIGNATURE REQUIRED' : trace.recordOnly ? trace.evidenceStatus ?? 'UNKNOWN' : draft}</span>
  </header>
  <ol className="financialRequestJourney" data-testid="financial-request-journey" aria-label={label('This Business Request, from proposal to evidence', 'このBusiness Requestの提案から証拠まで')}>
   {journey.map(([name,status],index)=><li key={name}><span>{String(index+1).padStart(2,'0')} / {name}</span><strong>{status}</strong></li>)}
  </ol>
  <p className="financialRequestBoundary">{label('Recorded validation and local proof tests do not establish a live Agent, independent issuer history, or financial execution. Execution remains NOT_APPROVED.', '記録済み検証やローカル証明テストは、実Agent稼働・独立Issuer履歴・金融実行の成功を示しません。実行権限はNOT_APPROVEDのままです。')}</p>
  <dl className="financialTraceIdentity">
   <div><dt>BUSINESS ID</dt><dd><code>{trace.requestId}</code></dd></div>
   <div><dt>{label('OBJECT REVISION', '対象リビジョン')}</dt><dd>V{trace.revision}</dd></div>
   <div><dt>{label('MARKET / SIDE', '市場 / 方向')}</dt><dd>{trace.recordOnly ? 'NOT IN EVIDENCE RECORD' : `${trace.marketKind} / ${trace.side}`}</dd></div>
   <div><dt>{label('PRICE / QUANTITY', '価格 / 数量')}</dt><dd>{trace.recordOnly ? 'NOT IN EVIDENCE RECORD' : `${trace.price ?? 'NOT SET'} / ${trace.quantity ?? 'NOT SET'}`}</dd></div>
   <div><dt>{label('REQUEST SOURCE', '依頼のsource')}</dt><dd>{trace.requestSource ?? 'LOCAL_FINANCIAL_DRAFT'}</dd></div>
   <div><dt>{label('PUBLIC MARKET READ', '公開市場読取')}</dt><dd>{trace.marketStatus} · {trace.marketId ?? 'UNKNOWN'}</dd></div>
   <div data-testid="financial-trace-market-provenance"><dt>{label('MARKET SOURCE / CONSISTENCY', '市場取得元 / 整合性')}</dt><dd><code>{trace.marketConsistency ?? 'UNKNOWN'}</code> · {trace.marketSource ? <a data-testid="financial-trace-market-source" href={trace.marketSource} target="_blank" rel="noreferrer">{label('market source','市場取得元')}</a> : 'UNKNOWN'}<small>{label('Market data is not pinned to the EVM block below.','市場データは下記EVM blockに固定されていません。')}</small></dd></div>
   <div data-testid="financial-trace-evm-provenance"><dt>{label('INJECTIVE EVM BLOCK / TIME', 'Injective EVM block / 時刻')}</dt><dd>{trace.chainId ? `CHAIN ${trace.chainId}` : 'CHAIN UNKNOWN'} · {trace.blockNumber ?? 'UNKNOWN'} · {trace.observedAt ?? 'UNKNOWN'}<br/><code>{trace.blockHash ?? 'BLOCK HASH UNKNOWN'}</code><br/>{trace.blockSource ? <a data-testid="financial-trace-block-source" href={trace.blockSource} target="_blank" rel="noreferrer">{label('EVM RPC source','EVM RPC取得元')}</a> : label('EVM RPC source UNKNOWN','EVM RPC取得元 UNKNOWN')}</dd></div>
  </dl>
  {surface === 'CONSEQUENCE' && <div className="financialTraceRules" data-testid="financial-trace-rules">
   <p>{label('REQUIRED PRECONDITIONS · NO CONFIGURED FINANCIAL GRAPH', '必要条件・金融グラフ未設定')}</p>
   <ol aria-label={label('Directed authorization prerequisites', '認可の有向前提条件')}>
    <li><strong>{label('Observed market', '観測市場')}</strong><span>{trace.marketStatus}</span></li>
    <li><strong>{trace.recordOnly?label('Recorded Request', '記録済みRequest'):label('Unsigned Intent draft', '未署名Intent下書き')}</strong><span>{trace.recordOnly?trace.evidenceStatus:draft}</span></li>
    <li><strong>{label('Issuer mandate', 'Issuer mandate')}</strong><span>{trace.mandateDigest?'DIGEST RECORDED / CURRENT STATE UNKNOWN':'NOT_CONFIGURED'}</span></li>
    <li><strong>{label('Credential / policy', '資格 / policy')}</strong><span>{trace.disclosureBindingDigest?'EPOCHS RECORDED / CURRENT STATE UNKNOWN':'NOT_CONFIGURED'}</span></li>
    <li><strong>{label('Proof / Gate', '証明 / Gate')}</strong><span>{localGroth16Verified ? label('LOCAL TEST VECTOR VERIFIED / LIVE GATE NOT CONFIGURED', 'LOCAL TEST VECTOR確認済み / live Gate未設定') : trace.proofDigest?'PROOF DIGEST RECORDED / LIVE GATE UNKNOWN':'NOT_VERIFIED / NOT_CONFIGURED'}</span></li>
    <li><strong>{label('Owner signature', 'Owner署名')}</strong><span>{trace.finalizationEvidenceStatus === 'OWNER_SIGNATURE_REQUIRED' ? 'REQUIRED · NOT REQUESTED' : 'NOT REQUESTED / UNKNOWN'}</span></li>
    <li><strong>{label('Execution / receipt', '実行 / receipt')}</strong><span>NOT_IMPLEMENTED / NONE</span></li>
   </ol>
   <small>{label('These are required checks for this request. They are not committed graph events, and no causal action is inferred from the synthetic project map.', '依頼に必要な検査項目です。確定済みグラフイベントではなく、合成Project mapから金融上の因果関係を推測しません。')}</small>
   {(trace.rehearsalScenarioId === 'S03-revocation-causality' || trace.rehearsalScenarioId === 'S08-proof-is-not-authority') && trace.rehearsalFacts && <div className="financialTraceRehearsal" data-testid="financial-trace-rehearsal-preview"><p>{label(trace.rehearsalScenarioId === 'S08-proof-is-not-authority' ? 'LOCAL PROOF + GRAPH REPLAY · WHAT-IF ONLY' : 'LOCAL VERIFIED GRAPH PREVIEW · WHAT-IF ONLY', trace.rehearsalScenarioId === 'S08-proof-is-not-authority' ? 'LOCAL proof + graph再生・WHAT-IFのみ' : 'LOCAL VERIFIED GRAPH preview・WHAT-IFのみ')}</p><dl>
    <div><dt>Agent A intent</dt><dd>{String(trace.rehearsalFacts.agentAIntent ?? 'UNKNOWN')}</dd></div><div><dt>Agent A action</dt><dd>{String(trace.rehearsalFacts.agentAAction ?? 'UNKNOWN')}</dd></div><div><dt>Independent Agent B intent</dt><dd>{String(trace.rehearsalFacts.agentBIntent ?? 'UNKNOWN')}</dd></div><div><dt>Independent Agent B action</dt><dd>{String(trace.rehearsalFacts.agentBAction ?? 'UNKNOWN')}</dd></div><div><dt>Graph sequence</dt><dd>{String(trace.rehearsalFacts.graphSequenceBefore ?? 'UNKNOWN')} → {String(trace.rehearsalFacts.graphSequenceAfter ?? 'UNKNOWN')}</dd></div><div><dt>Existing order</dt><dd>{String(trace.rehearsalFacts.existingOrder ?? 'UNKNOWN')}</dd></div>
    {trace.rehearsalScenarioId === 'S08-proof-is-not-authority' && <><div><dt>Canonical Request ID</dt><dd>{String(trace.rehearsalFacts.requestId ?? trace.requestId)}</dd></div><div><dt>Intent digest</dt><dd><code>{String(trace.rehearsalFacts.intentDigest ?? 'UNKNOWN')}</code></dd></div><div><dt>Proof digest</dt><dd><code>{String(trace.rehearsalFacts.proofDigest ?? 'UNKNOWN')}</code></dd></div><div><dt>Proof scope</dt><dd>{String(trace.rehearsalFacts.proofArtifact ?? 'UNKNOWN')}</dd></div><div><dt>Issuer signature in replay</dt><dd>{String(trace.rehearsalFacts.issuerSignatureStatus ?? 'UNKNOWN')}</dd></div><div><dt>ActionGate test reference</dt><dd>{String(trace.rehearsalFacts.gateTestForThisScenario ?? 'UNKNOWN')}</dd></div></>}
   </dl><small>{label('This preview runs on the local synthetic graph. It does not revoke a real credential or cancel an order.', 'ローカル合成graphのpreviewです。実credentialの失効やorder取消は行いません。')}</small></div>}
   {trace.hypotheticalCredentialRevocation && <p role="status">{trace.requestSource === 'SYNTHETIC_REHEARSAL' ? label('LOCAL WHAT-IF: synthetic graph only; the real credential and any order are unchanged.', 'LOCAL WHAT-IF：合成graphのみ。実credentialとorderは変更されません。') : label('LOCAL WHAT-IF: no credential is configured, so no financial action is changed.', 'LOCAL WHAT-IF：資格未設定のため金融操作に変化はありません。')}</p>}
  </div>}
  {surface === 'EVIDENCE' && <div className="financialTraceEvidence" data-testid="financial-trace-evidence-state">
   <p>{trace.evidenceSource === 'REHEARSAL_NAMESPACE' ? label('Synthetic rehearsal namespace read', '合成rehearsal namespace読取') : label('Owner-scoped evidence read', '所有者限定の根拠読取')} · {evidence} · {trace.evidenceEventCount} {label('records', '件')}</p>
   {trace.evidenceId && <><dl>
    <div><dt>{label('Local evidence record', 'ローカル根拠ID')}</dt><dd><code>{trace.evidenceId}</code></dd></div>
    <div><dt>{label('Intent digest', 'Intent digest')}</dt><dd><code>{trace.intentDigest ?? 'UNKNOWN'}</code></dd></div>
    <div><dt>{label('Record hash', '記録hash')}</dt><dd><code>{trace.evidenceHash ?? 'UNKNOWN'}</code></dd></div>
    <div><dt>{label('Recorded decision', '記録済み判定')}</dt><dd>{trace.evidenceStatus ?? 'UNKNOWN'} · {trace.evidenceReason ?? 'NONE'}</dd></div>
   </dl><details className="financialTraceBindings" data-testid="financial-trace-bindings"><summary>{label('Inspect Request / Proof / Disclosure bindings','Request / Proof / Disclosureの拘束を検査')}</summary><dl>
    <div><dt>Request / Mandate / Proof digests</dt><dd><code>{trace.requestDigest ?? 'NOT RECORDED'}</code><br/><code>{trace.mandateDigest ?? 'NOT RECORDED'}</code><br/><code>{trace.proofDigest ?? 'NOT RECORDED'}</code></dd></div>
    <div><dt>{label('Disclosure binding / history', 'Disclosure拘束 / 履歴')}</dt><dd><code>{trace.disclosureBindingDigest ?? 'NOT RECORDED'}</code><br/><code>{trace.disclosureHistoryRoot ?? 'NOT RECORDED'}</code><br/>{label('Sequence / policy epoch / credential epoch', 'Sequence / policy epoch / credential epoch')}: {trace.disclosureHistorySequence ?? 'UNKNOWN'} / {trace.disclosurePolicyEpoch ?? 'UNKNOWN'} / {trace.disclosureCredentialEpoch ?? 'UNKNOWN'}</dd></div>
   </dl><small>{label('Digests correlate recorded artifacts. This view does not reverify signatures or Groth16, and does not prove live market state or independent history.','digestは記録済み成果物の照合値です。この画面では署名・Groth16を再検証せず、実市場の状態や独立履歴を証明しません。')}</small></details></>}
   <p>{label('Chain transaction / order receipt: NONE. No broadcast was made.', 'Chain transaction / order receipt：NONE。送信は行われていません。')}</p>
   {trace.finalizationEvidenceState === 'AVAILABLE' && trace.finalizationEvidenceId && <section data-testid="financial-trace-finalization-evidence"><h4>{label('Pre-signature review evidence', '署名前レビュー根拠')}</h4><p>{finalization} · EXECUTION NOT_IMPLEMENTED</p><dl>
    <div><dt>{label('Finalization evidence record', 'Finalization evidence record')}</dt><dd><code>{trace.finalizationEvidenceId}</code></dd></div>
    <div><dt>{label('Proof digest', 'Proof digest')}</dt><dd><code>{trace.finalizationProofDigest ?? 'NOT RECORDED'}</code></dd></div>
    <div><dt>{label('Record hash', 'Record hash')}</dt><dd><code>{trace.finalizationEvidenceHash ?? 'UNKNOWN'}</code></dd></div>
    <div><dt>{label('Decision', '判定')}</dt><dd>{trace.finalizationEvidenceStatus} · {trace.finalizationEvidenceReason ?? 'NONE'}</dd></div>
   </dl><small>{label('Stored evidence contains digests only. It does not establish owner approval, trusted proving setup, independent Anchor, or execution.', '保存根拠はdigestのみです。Owner承認・信頼済み証明設定・独立Anchor・金融実行を意味しません。')}</small></section>}
  </div>}
 </section>;
}
