import type { DemoState, DisclosurePreflight, DisclosureRecord } from '../../../../packages/domain/src/demo';
import { experienceCopy } from '../experienceCopy';
import { selectedGraphEvidence } from '../graphPresentation';
import { nodeName, type Language } from '../i18n';
import type { DemoMode, DemoPreview } from '../useDemoController';

export function CausalEvidence({ language, mode, state, preview, selected, preflight, depth, onDepth, unknown, record=null }: {
  language: Language; mode: DemoMode; state: DemoState | null; preview: DemoPreview | null; selected: string;
  preflight: DisclosurePreflight | null; depth: number; onDepth: (depth: number) => void; unknown: boolean; record?: DisclosureRecord|null;
}) {
  const s = experienceCopy(language);
  const graph = preview?.snapshot ?? state?.graph;
  const view = graph ? selectedGraphEvidence(graph, preview?.changes ?? state?.lastChanges ?? [], selected) : null;
  const command = preview?.command ?? state?.graph.events.at(-1)?.command;
  const name = (id: string) => { const node = graph?.nodes.find(entry => entry.id === id); return node ? nodeName(language, node.type, node.id) : id; };
  const fact = (label: string, value: string | number, id: string) => <div data-testid={id}><dt>{label}</dt><dd>{value}</dd></div>;
  return <div className="evidenceExplorer">
    <div className="depthTabs" role="group" aria-label={language === 'ja' ? '調べる深さ' : 'Inspection depth'}>{[s.overview, s.cause, s.evidenceDepth].map((label, index) => <button type="button" key={index} data-testid={`detail-depth-${index + 1}`} aria-pressed={depth === index + 1} onClick={() => onDepth(index + 1)}><span>0{index + 1}</span>{label}</button>)}</div>
    <section className="evidencePanel" hidden={depth < 3} data-testid="evidence-panel" aria-label={s.evidence}>
      <div className="evidenceOrigin"><span className="eyebrow">LOCAL_REFERENCE / PUBLIC API SNAPSHOT</span><p>{unknown ? (language === 'ja' ? '保持したスナップショットです。サーバーでの最新結果は未確認です。' : 'Retained snapshot. The latest server outcome is unknown.') : (language === 'ja' ? '公開されたローカル記録。暗号学的証明ではありません。' : 'Public local records. Not a cryptographic proof.')}</p></div>
      <dl className="evidenceFacts">{mode === 'impact' ? <>
        {fact(s.committedSequence, state?.graph.sequence ?? '—', 'evidence-graph-sequence')}
        {preview && fact(s.hypotheticalSequence, preview.snapshot.sequence, 'evidence-preview-sequence')}
        {fact(s.nodeEpoch, view?.node?.epoch ?? '—', 'evidence-node-epoch')}
        {fact(preview ? (language === 'ja' ? '試算コマンド' : 'WHAT-IF COMMAND') : (language === 'ja' ? '最新グラフイベント' : 'LATEST GRAPH EVENT'), command?.type ?? '—', 'evidence-event-type')}
      </> : <>
        {fact(s.disclosureEpoch, record?.policyEpoch ?? state?.disclosure.policy.epoch ?? '—', 'evidence-disclosure-epoch')}
        {fact(s.historySequence, record?.sequence ?? state?.disclosure.history.length ?? '—', 'evidence-history-sequence')}
        {fact('PREDICATE', record?.query.predicateId ?? preflight?.query.predicateId ?? '—', 'evidence-predicate')}
        {fact('QUERY', record ? `x ≤ ${record.query.threshold}` : preflight ? `x ≤ ${preflight.query.threshold}` : '—', 'evidence-query')}
      </>}</dl>
      {mode === 'impact' ? <>
        {command ? <code className="eventIdentity">{command.eventId}</code> : <p>{s.noEvent}</p>}
        <h4>{s.graphEdges}</h4><ul className="relationshipList">{view?.relationships.map(edge => <li key={`${edge.from}|${edge.to}|${edge.type}`}><span>{name(edge.from)} → {name(edge.to)}</span><code>{edge.type}</code></li>)}</ul>
        {view?.path.length ? <p className="exactEvidencePath">{s.exactPath}<br/><code>{view.path.join(' → ')}</code></p> : <p>{s.noPath}</p>}
      </> : <p className="evidenceExplanation">{language === 'ja' ? '事前検査は公開履歴から両分岐を検査します。回答要求時に発行者が独立して再判定し、履歴の確定後にのみ回答を返します。' : 'Preflight inspects both partitions from public history. The issuer independently checks admission again and returns an answer only after the history commit.'}</p>}
      <div className="capabilityStrip" data-testid="capability-boundary">{[s.proof, s.authority, s.execution].map(label => <div key={label}><span>{label}</span><strong>{s.absent}</strong></div>)}</div>
    </section>
  </div>;
}
