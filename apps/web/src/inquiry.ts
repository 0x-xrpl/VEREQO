import {downstreamNodeIds,type GraphSnapshot,type NodeChange} from '../../../packages/consequence/src/index';
import type {DisclosurePreflight,DisclosureRecord} from '../../../packages/domain/src/demo';
import type {ActivityTile} from './operatingModel';
import type {Language} from './i18n';
export interface InquiryContext{scope:string;tiles:readonly ActivityTile[];graph:GraphSnapshot|undefined;changes:readonly NodeChange[];preflight:DisclosurePreflight|null;record:DisclosureRecord|null;historical:boolean;local:boolean;unavailable?:boolean}
export interface InquiryAnswer{status:'SUPPORTED'|'UNKNOWN'|'UNSUPPORTED';summary:string;source:string;target:string|null;evidence:string[]}
/** Narrow deterministic read-only parser. No controller, token, API, eval or mutation capability. */
export function inquire(question:string,c:InquiryContext,language:Language):InquiryAnswer{
 const ja=language==='ja',q=question.normalize('NFKC').trim().toLowerCase(),text=(en:string,jp:string)=>ja?jp:en;
 const answer=(status:InquiryAnswer['status'],summary:string,target:string|null=null,evidence:string[]=[]):InquiryAnswer=>({status,summary,target,evidence,source:c.historical?'HISTORICAL / PUBLIC RECORDS':c.local?'LOCAL_REFERENCE / PUBLIC SNAPSHOT':'SIMULATED / READ-ONLY'});
 if(!q||q.length>160||/\b(execute|send|revoke|reset|buy|sell|grant|sign|trade now)\b|実行して|発注|送金|リセット|失効させ|署名して|権限を付与/.test(q))return answer('UNSUPPORTED',text('I only inspect public demo state. I cannot execute instructions or financial actions.','公開されたデモ状態の読み取り専用です。操作命令や金融取引は実行できません。'));
 if(c.unavailable&&!c.historical)return answer('UNKNOWN',text('The latest server state is unavailable. The retained snapshot does not confirm the current outcome; reconcile with GET before relying on it.','最新のサーバー状態を確認できません。保持したスナップショットだけでは現在の結果を確定できません。GETで再取得してください。'));
 const a=/broker\s*a|ブローカー\s*a/.test(q),b=/broker\s*b|ブローカー\s*b/.test(q);
 if(a&&/why|なぜ|理由/.test(q)){
  if(!c.graph)return answer('UNKNOWN',text('A’s graph state is not observed in this view. Return to the local graph before drawing a causal conclusion.','この表示ではAのグラフ状態は未観測です。ローカルのグラフに戻ってから因果を確認してください。'));
  const node=c.graph.nodes.find(n=>n.id==='action_A'),change=c.changes.find(n=>n.nodeId==='action_A');
  if(!node)return answer('UNKNOWN',text('No Action A exists in this source.','この出典にはAction Aがありません。'));
  return answer('SUPPORTED',change?text(`A is ${node.state} along the recorded directed path: ${change.path.join(' → ')}. This is local eligibility, not trade enforcement.`,`Aは記録された有向経路 ${change.path.join(' → ')} により${node.state}です。ローカル適格性であり、金融取引の強制ではありません。`):text(`A is currently ${node.state}. No change path is recorded for this transition; do not infer a revocation.`,`Aの現在状態は${node.state}です。この遷移の変更経路は記録されていません。失効を推測しません。`),'tile:broker-a',change?.path??[]);
 }
 if(b&&/impact|affect|影響/.test(q)){
  if(!c.graph)return answer('UNKNOWN',text('B’s graph state is not observed in this stream.','このストリームでBの状態は未観測です。'));
  const node=c.graph.nodes.find(n=>n.id==='action_B');if(!node)return answer('UNKNOWN',text('No Action B exists in this source.','この出典にはAction Bがありません。'));
  const fromA=c.graph.nodes.some(n=>n.id==='credential_A')&&downstreamNodeIds(c.graph,'credential_A').includes('action_B');
  return answer('SUPPORTED',text(`B is ${node.state}. ${fromA?'The declared graph includes a dependency from A; independence cannot be claimed.':'It is outside Credential A’s directed dependent set.'} No financial execution is established.`,`Bは${node.state}です。${fromA?'宣言されたグラフにAからの依存があり、独立とは言えません。':'資格Aの有向な依存先集合には含まれません。'}金融執行を確認した結果ではありません。`),'tile:broker-b',['action_B']);
 }
 if(/secret|which question|disclos|秘密|問い合わせ|明か/.test(q)){
  if(c.preflight&&c.local&&!c.historical){const p=c.preflight;return answer('SUPPORTED',text(`The current x ≤ ${p.query.threshold} proposal is ${p.status}. Its possible branches retain ${p.partitions.yes} / ${p.partitions.no} candidates; floor ${p.minCandidates}. Preflight releases no answer.`,`現在のx ≤ ${p.query.threshold}は${p.status}です。回答の分岐は候補${p.partitions.yes} / ${p.partitions.no}通り、下限は${p.minCandidates}です。事前検査だけでは回答は公開されません。`),'tile:issuer-history',[`preflight:${p.historySequence}:${p.query.threshold}`]);}
  if(c.record)return answer('SUPPORTED',text(`Recorded question x ≤ ${c.record.query.threshold}: ${c.record.status}, branches ${c.record.partitions.yes} / ${c.record.partitions.no}, ${c.record.remainingBefore} → ${c.record.remainingAfter} candidates. The historical floor was not recorded.`,`記録されたx ≤ ${c.record.query.threshold}は${c.record.status}、分岐${c.record.partitions.yes} / ${c.record.partitions.no}、候補${c.record.remainingBefore} → ${c.record.remainingAfter}通りです。当時の下限は未記録です。`),'tile:issuer-history',[`disclosure:${c.record.sequence}`]);
  return answer('UNKNOWN',text('No current proposal or selected public disclosure record is available.','現在の事前検査、または選択された公開開示記録がありません。'));
 }
 if(/what.*chang|preview|変更|試算/.test(q)){
  if(!c.graph||!c.changes.length)return answer('UNKNOWN',text('No supported change is loaded. Use the explicit WHAT-IF key to request a local preview; this inquiry never runs one.','変更の根拠はまだありません。明示的なWHAT-IFキーで試算を要求できます。この質問から試算は実行しません。'));
  return answer('SUPPORTED',text(`${c.changes.length} nodes change: ${c.changes.map(n=>`${n.nodeId} ${n.before}→${n.after}`).join(', ')}. Adjacency does not determine the effect.`,`${c.changes.length}ノードが変化：${c.changes.map(n=>`${n.nodeId} ${n.before}→${n.after}`).join('、')}。隣接配置が原因ではありません。`),'tile:broker-a',c.changes.map(n=>n.nodeId));
 }
 if(/which.*(stop|restrict|block)|どの.*(止ま|制限)|停止.*依頼/.test(q)){
  const stopped=c.tiles.filter(t=>t.status==='RESTRICTED');return answer('SUPPORTED',stopped.length?stopped.map(t=>`${ja?t.label.ja:t.label.en} (${t.source} / ${t.phase})`).join('、'):text('No restricted item is observed in this view. Unknown items are not assumed permitted.','この表示には制限済み項目がありません。未観測の項目を許可済みとは扱いません。'),stopped[0]?.id??null,stopped.flatMap(t=>t.eventIds));
 }
 return answer('UNSUPPORTED',text('This local parser supports only the listed public-state questions. Market prices, balances, files and real execution are unavailable.','このローカル定型パーサーは、例示した公開状態の質問だけに対応します。市場価格・残高・ファイル・実執行には対応しません。'));
}
