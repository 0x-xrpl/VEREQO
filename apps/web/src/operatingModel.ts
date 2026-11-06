import { downstreamNodeIds, type GraphEvent, type GraphSnapshot } from '../../../packages/consequence/src/index';
import type { DemoState, DisclosureRecord } from '../../../packages/domain/src/demo';
import type { Language } from './i18n';

export const LOCAL_PROJECT = 'northstar-execution';
export type ActivityStatus = 'PERMITTED' | 'RESTRICTED' | 'NEEDS_REVIEW' | 'PENDING_UNKNOWN';
export type ActivitySource = 'SIMULATED' | 'LOCAL_REFERENCE';
export interface Localized { ja: string; en: string }
export const words = (value: Localized, language: Language) => value[language];
export interface OperatingProject { id: string; name: Localized; rule: Localized; source: ActivitySource; draft?: boolean }
export interface OperatingAgent { id: string; projectId: string; label: string; nodeId: string | null }
export interface ActivityEvent {
  id: string; projectId: string; actorId: string | null; relatedAgentId: string | null; timestamp: string | null;
  source: ActivitySource; status: ActivityStatus; title: Localized; detail: Localized;
  financialAuthorization: 'NOT_IMPLEMENTED'; execution: 'NOT_IMPLEMENTED';
  data: { stream: 'scenario'; ordinal: number; reference: string } | { stream: 'graph'; generation: number; record: GraphEvent } | { stream: 'disclosure'; generation: number; record: DisclosureRecord };
}
export interface ActivityTile {
  id: string; projectId: string; actorId: string | null; label: Localized; summary: Localized;
  source: ActivitySource; status: ActivityStatus; phase: 'SIMULATED' | 'WHAT_IF' | 'COMMITTED_LOCAL_STATE' | 'HISTORICAL_LOCAL_STATE' | 'UNOBSERVED';
  recordCount: number | null; metric: 'GRAPH_NODES' | 'DISCLOSURE_RECORDS' | 'SCENARIO_EVENTS'; nodeId: string | null; eventIds: string[];
}
const text = (en: string, ja: string): Localized => ({ en, ja });
export const PROJECTS: readonly OperatingProject[] = [
  { id:LOCAL_PROJECT, name:text('Execution desk','執行デスク'), rule:text('Confidential single-order ceiling','非公開の一注文上限'), source:'LOCAL_REFERENCE' },
  { id:'northstar-quotes', name:text('Quote research','見積リサーチ'), rule:text('Bounded quote questions','見積質問の公開範囲'), source:'SIMULATED' },
  { id:'northstar-hedge', name:text('Hedge review','ヘッジ審査'), rule:text('Operator review before delegation','委任前の担当者レビュー'), source:'SIMULATED' },
];
export const AGENTS: readonly OperatingAgent[] = [
  {id:'broker-a',projectId:LOCAL_PROJECT,label:'Broker A',nodeId:'action_A'},
  {id:'broker-b',projectId:LOCAL_PROJECT,label:'Broker B',nodeId:'action_B'},
  {id:'broker-c',projectId:'northstar-quotes',label:'Broker C',nodeId:null},
  {id:'broker-d',projectId:'northstar-quotes',label:'Broker D',nodeId:null},
  {id:'broker-e',projectId:'northstar-hedge',label:'Broker E',nodeId:null},
];
const seed = (ordinal: number, actorId: string, status: ActivityStatus, title: Localized, detail: Localized): ActivityEvent => {
  const actor=AGENTS.find(agent=>agent.id===actorId)!;
  return { id:`sim:scenario-v1:${ordinal}`,projectId:actor.projectId,actorId,relatedAgentId:actorId,
    timestamp:`2026-11-06T00:${String(ordinal).padStart(2,'0')}:00.000Z`,source:'SIMULATED',status,title,detail,
    financialAuthorization:'NOT_IMPLEMENTED',execution:'NOT_IMPLEMENTED',data:{stream:'scenario',ordinal,reference:`scenario-v1/${ordinal}`} };
};
export const SCENARIO_EVENTS: readonly ActivityEvent[] = [
  seed(1,'broker-a','PENDING_UNKNOWN',text('A asks for a narrow answer','Aが限定された回答を要求'),text('Scenario narrator only. The live issuer does not authenticate Broker A.','シナリオ上の話者です。実ローカル発行者はBroker Aを認証しません。')),
  seed(2,'broker-b','PERMITTED',text('B has independent prerequisites','Bは独立した条件に依存'),text('The A/B graph can be checked in the connected local model. No financial grant exists.','A/Bグラフは接続されたローカルモデルで確認できます。金融認可はありません。')),
  seed(3,'broker-c','PENDING_UNKNOWN',text('Quote question received','見積質問を受信'),text('Seeded request awaiting operator review. No backend release was requested.','担当者レビュー待ちの合成依頼です。バックエンドへの開示要求はありません。')),
  seed(4,'broker-c','RESTRICTED',text('Broader disclosure restricted','広い情報公開を制限'),text('Simulated policy decision, not an API receipt or failed trade.','合成ポリシー判定です。API受領記録でも取引失敗でもありません。')),
  seed(5,'broker-c','NEEDS_REVIEW',text('Narrower request needs review','絞り込んだ依頼を要確認'),text('A human must choose a narrower question in this scenario.','このシナリオでは担当者が質問範囲を選びます。')),
  seed(6,'broker-d','PERMITTED',text('Read-only inspection is in scope','読み取り検査は範囲内'),text('Simulated local eligibility. No wallet authority or order execution.','合成のローカル適格性です。ウォレット権限・注文実行はありません。')),
  seed(7,'broker-d','PERMITTED',text('Evidence inspection completed','根拠の確認を完了'),text('A scenario note was inspected, not a cryptographic proof.','シナリオ注記を確認した状態です。暗号学的証明ではありません。')),
  seed(8,'broker-e','PENDING_UNKNOWN',text('Hedge proposal waiting','ヘッジ提案が待機中'),text('Synthetic proposal. Exact intent and issuer authorization are not implemented.','合成提案です。正確なIntentの金融認可は未実装です。')),
  seed(9,'broker-e','NEEDS_REVIEW',text('Credential renewal requires review','資格更新を要レビュー'),text('Simulated credential issue. It does not revoke the connected A/B fixture.','合成の資格課題です。接続されたA/Bモデルは失効しません。')),
];
export function graphStatus(value: string | undefined): ActivityStatus {
  return value==='VALID'?'PERMITTED':value==='BLOCKED'||value==='REVOKED'?'RESTRICTED':value==='STALE'?'NEEDS_REVIEW':'PENDING_UNKNOWN';
}
/** API actor/time metadata is absent. Never invent it or expose the request token as an ID. */
export function localEvents(state: DemoState | null, generation: number): ActivityEvent[] {
  if(!state) return [];
  const base={projectId:LOCAL_PROJECT,actorId:null,timestamp:null,source:'LOCAL_REFERENCE' as const,financialAuthorization:'NOT_IMPLEMENTED' as const,execution:'NOT_IMPLEMENTED' as const};
  return [
    ...state.graph.events.map(record=>({...base,id:`local:g${generation}:graph:${record.eventId}`,relatedAgentId:record.command.nodeId.endsWith('_A')?'broker-a':record.command.nodeId.endsWith('_B')?'broker-b':null,status:record.command.type==='REVOKE_CREDENTIAL'?'RESTRICTED' as const:'NEEDS_REVIEW' as const,
      title:text(`Graph event ${record.sequence}: ${record.command.type}`,`グラフイベント ${record.sequence}: ${record.command.type}`),detail:text('Immutable local graph record. Caller identity and event time were not recorded.','不変のローカルグラフ記録です。呼出者の認証情報・時刻は記録されていません。'),data:{stream:'graph' as const,generation,record}})),
    ...state.disclosure.history.map(record=>({...base,id:`local:g${generation}:disclosure:${record.sequence}`,relatedAgentId:null,status:record.status==='DENIED'?'RESTRICTED' as const:'PERMITTED' as const,
      title:text(`Disclosure ${record.sequence}: ${record.status}`,`開示 ${record.sequence}: ${record.status}`),detail:text(`${record.remainingBefore} → ${record.remainingAfter} public candidates. Broker attribution and event time are unknown.`,`${record.remainingBefore} → ${record.remainingAfter}公開候補。ブローカーの帰属・イベント時刻は不明です。`),data:{stream:'disclosure' as const,generation,record}})),
  ];
}
export function activityTiles(state: DemoState | null, graph: GraphSnapshot | undefined, generation: number, whatIf: boolean, scenarioEvents: readonly ActivityEvent[]=SCENARIO_EVENTS, inspectionStream?: 'graph'|'disclosure'|'scenario'): ActivityTile[] {
  if(inspectionStream==='disclosure'||inspectionStream==='scenario')graph=undefined;
  const disclosureKnown=!!state&&inspectionStream!=='graph'&&inspectionStream!=='scenario';
  const events=localEvents(state,generation);
  const local=AGENTS.filter(agent=>agent.projectId===LOCAL_PROJECT).map(agent=>({id:`tile:${agent.id}`,projectId:agent.projectId,actorId:agent.id,label:text(agent.label,`ブローカー ${agent.label.at(-1)}`),summary:graph?text('Credential-dependent pending operation','資格に依存する保留操作'):text('Graph state at this event is unobserved','このイベント時点のグラフは未観測'),source:'LOCAL_REFERENCE' as const,status:graphStatus(graph?.nodes.find(node=>node.id===agent.nodeId)?.state),phase:!graph?'UNOBSERVED' as const:whatIf?'WHAT_IF' as const:inspectionStream==='graph'?'HISTORICAL_LOCAL_STATE' as const:'COMMITTED_LOCAL_STATE' as const,recordCount:graph?downstreamNodeIds(graph,`credential_${agent.label.at(-1)}`).length:null,metric:'GRAPH_NODES' as const,nodeId:agent.nodeId,eventIds:events.filter(event=>event.relatedAgentId===agent.id).map(event=>event.id)}));
  const history=state?.disclosure.history??[];
  const ledger:ActivityTile={id:'tile:issuer-history',projectId:LOCAL_PROJECT,actorId:null,label:text('Issuer answer ledger','発行者の回答履歴'),summary:disclosureKnown?text('Broker attribution unknown','ブローカーの帰属は不明'):text('Disclosure stream at this event is unobserved','このイベント時点の開示ストリームは未観測'),source:'LOCAL_REFERENCE',status:!disclosureKnown?'PENDING_UNKNOWN':history.at(-1)?.status==='DENIED'?'RESTRICTED':history.length?'PERMITTED':'PENDING_UNKNOWN',phase:!disclosureKnown?'UNOBSERVED':inspectionStream==='disclosure'?'HISTORICAL_LOCAL_STATE':'COMMITTED_LOCAL_STATE',recordCount:disclosureKnown?history.length:null,metric:'DISCLOSURE_RECORDS',nodeId:null,eventIds:events.filter(event=>event.data.stream==='disclosure').map(event=>event.id)};
  const synthetic=AGENTS.filter(agent=>agent.projectId!==LOCAL_PROJECT).map(agent=>{const records=scenarioEvents.filter(event=>event.actorId===agent.id);return {id:`tile:${agent.id}`,projectId:agent.projectId,actorId:agent.id,label:text(agent.label,`ブローカー ${agent.label.at(-1)}`),summary:records.at(-1)?.title??text('No scenario event yet','合成イベントはまだありません'),source:'SIMULATED' as const,status:records.at(-1)?.status??'PENDING_UNKNOWN' as const,phase:'SIMULATED' as const,recordCount:records.length,metric:'SCENARIO_EVENTS' as const,nodeId:null,eventIds:records.map(event=>event.id)};});
  return [...local,ledger,...synthetic];
}
export const tileUnits=(count:number|null)=>Math.max(2,Math.min(6,count??0));
