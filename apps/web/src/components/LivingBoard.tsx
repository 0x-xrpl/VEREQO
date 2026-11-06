import type { CSSProperties } from 'react';
import { downstreamNodeIds, type GraphNode, type GraphSnapshot, type NodeChange } from '../../../../packages/consequence/src/index';
import { experienceCopy } from '../experienceCopy';
import type { Language } from '../i18n';

type Translator = (key: string, args?: Record<string, string | number>) => string;
export function LivingBoard({ graph, changes, selected, depth, language, preview, animate, onSelect, name, status, t }: {
  graph: GraphSnapshot | undefined; changes: readonly NodeChange[]; selected: string; depth: number; language: Language; preview: boolean; animate: boolean;
  onSelect: (id: string) => void; name: (node: GraphNode) => string; status: (state: string | undefined) => string; t: Translator;
}) {
  const s = experienceCopy(language);
  if (!graph) return <p className="boardLoading">{t('loading')}</p>;
  return <section className="livingBoard" aria-label={s.board} data-testid="living-board" data-phase={preview ? 'what-if' : 'committed'} data-causal-motion={animate ? 'new-event' : 'static'}>
    <div className="boardHeading"><div><span className="eyebrow">LIVING BOARD / LOCAL ELIGIBILITY</span><h3>{language==='ja'?'依存する操作と、独立した操作。':'Dependent and independent operations.'}</h3></div><p>{s.boardSub}</p></div>
    <div className="outcomeGrid boardLanes">{(['A', 'B'] as const).map(lane => {
      const credential = graph.nodes.find(node => node.id === `credential_${lane}`);
      const action = graph.nodes.find(node => node.id === `action_${lane}`);
      if (!credential || !action) return null;
      const related = downstreamNodeIds(graph, credential.id);
      const actionChange = changes.find(entry => entry.nodeId === action.id);
      const credentialChanged = changes.some(entry => entry.nodeId === credential.id);
      const affected = !!actionChange;
      return <div className={`brokerLane ${affected ? 'laneChanged' : ''}`} key={lane} data-testid={`broker-${lane}`}>
        <div className="laneHeading"><strong>{s.broker} {lane}</strong><span>{lane === 'A' ? '01' : '02'}</span></div>
        <button type="button" className={`credentialTile ${credentialChanged && animate ? 'nodeChanged' : ''}`} aria-pressed={selected === credential.id} onClick={() => onSelect(credential.id)} data-node-id={credential.id}>
          <span className="eyebrow">{s.credential}</span><span className="credentialName">{name(credential)}</span><span className={`nodeState state-${credential.state.toLowerCase()}`}>{status(credential.state)}</span>
        </button>
        {related.includes(action.id) && <div className="boardConnector"><span aria-hidden="true"/><small>{s.depends} · {related.length - 1}{s.dependencyCount}</small></div>}
        <button type="button" className={`outcomeCard ${lane === 'B' ? 'quiet' : ''} ${affected ? 'affected' : ''} ${affected && animate ? 'nodeChanged' : ''}`} style={{ '--cause-delay': `${Math.min(3, (actionChange?.path.length ?? 1) - 1) * 60}ms` } as CSSProperties} aria-pressed={selected === action.id} aria-label={t('inspect', { name: name(action) })} onClick={() => onSelect(action.id)} data-node-id={action.id}>
          <div className="outhead"><span>{s.operation}</span><span>{s.localEligibility}</span></div>
          <div className="actionLine"><div className="actionStat"><i className="dotStatus"/><span>{status(action.state)}</span></div><h4>{name(action)}</h4><p>{t(lane === 'B' ? 'actionBDetail' : 'aCurrentDetail')}</p><p className="beforeAfter">{t('beforeAfter', { before: status(actionChange?.before ?? action.state), after: status(actionChange?.after ?? action.state) })}</p><span className="boardInspect">{s.inspect} ↗</span></div>
        </button>
      </div>;
    })}</div>
    {changes.length > 0 && <details className="affectedGroup" hidden={depth < 2}><summary>{language==='ja'?`変更された全${changes.length}ノードを開く`:`Inspect all ${changes.length} changed nodes`}</summary><div className="pathTitle"><span>{s.affected}</span><span>{changes.length} / LOCAL</span></div><div className="affectedNodes" data-testid="affected-nodes">{changes.map(change => { const node = graph.nodes.find(entry => entry.id === change.nodeId); return node && <button type="button" key={node.id} className="affectedNode" aria-pressed={selected === node.id} onClick={() => onSelect(node.id)}>{name(node)}<span>{status(change.before)} → {status(change.after)}</span></button>; })}</div></details>}
  </section>;
}
