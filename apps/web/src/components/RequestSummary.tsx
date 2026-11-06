import type { DisclosurePreflight, DisclosureRecord, DisclosureView } from '../../../../packages/domain/src/demo';
import { disclosureDecision } from '../decisionPresentation';
import { experienceCopy } from '../experienceCopy';
import type { Language } from '../i18n';

export function RequestSummary({language,view,preflight,threshold,record,historical,unknown=false}:{language:Language;view:DisclosureView|null;preflight:DisclosurePreflight|null;threshold:number;record:DisclosureRecord|null;historical:boolean;unknown?:boolean}){
 const ja=language==='ja',d=disclosureDecision(view,preflight,threshold,record);
 return <section className="requestSummary" data-testid="selected-request" data-kind={d.kind} data-sequence={d.sequence??'proposal'}>
  <span className="eyebrow">{historical?'HISTORICAL / READ-ONLY':unknown?'RETAINED SNAPSHOT / CURRENT UNKNOWN':d.kind==='record'?`LOCAL API RECORD / ${d.sequence}`:'PROPOSED QUESTION / NO ANSWER'}</span>
  <h3 data-testid="selected-question">{ja?`非公開のサンプル値は${d.threshold}以下ですか？`:`Is the hidden sample value at most ${d.threshold}?`}</h3>
  <p className="questionPredicate">x ≤ {d.threshold} <span>{ja?'教育用のしきい値。注文量・金額ではありません。':'Educational threshold. Not an order quantity or money.'}</span></p>
  <div className="requestOutcome" data-testid="selected-outcome"><strong>{unknown&&!historical?(ja?'最新の公開結果は未確認です。GETで再取得してください。':'Current release outcome is UNKNOWN. Reconcile with GET.') : d.kind==='record'?(d.status==='DENIED'?(ja?'回答を出す前に拒否':'Refused before an answer'):d.answer?(ja?'YESを公開済み':'YES was released'):(ja?'NOを公開済み':'NO was released')):(d.status==='ALLOWED'?(ja?'回答可能。ただし、まだ未公開。':'An answer may be requested. None released yet.'):d.status==='DENIED'?(ja?'この質問には回答できません。':'This question cannot be answered.'):(ja?'判定を確認中':'Decision unavailable'))}</strong><span>{d.kind==='record'?`${d.before} → ${d.after}`:`${d.before??'—'}`}</span><small>{ja?'公開済みの回答と両立するサンプル値の候補数':'Possible sample values consistent with released answers'}</small></div>
  <p>{experienceCopy(language).sampleIntro}</p>
  {d.kind==='record'&&<p className="recordBoundary">{ja?`根拠：開示履歴${d.sequence}。この結果はx ≤ ${d.threshold}への判定です。次の未送信質問とは別の記録です。`:`Source: disclosure record ${d.sequence}, for x ≤ ${d.threshold}. This result is separate from the next unsent question.`}</p>}
 </section>;
}
