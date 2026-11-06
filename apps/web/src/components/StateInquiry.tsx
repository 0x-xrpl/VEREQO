import {useState,type FormEvent} from 'react';
import {inquire,type InquiryContext} from '../inquiry';
import type {Language} from '../i18n';
export function StateInquiry({language,context,onInspect}:{language:Language;context:InquiryContext;onInspect:(id:string)=>void}){
 const [question,setQuestion]=useState(''),[submitted,setSubmitted]=useState<{query:string;scope:string}|null>(null),ja=language==='ja';
 const current=submitted?.scope===context.scope,answer=current?inquire(submitted.query,context,language):null;
 const examples=ja?['今、どのAIの依頼が止まっていますか？','なぜBroker Aが制限されるのですか？','Broker Bに影響はありますか？','どの問い合わせが秘密を明かしすぎますか？','この変更を試したら何が変わりますか？']:['Which AI requests are restricted?','Why is Broker A restricted?','Is Broker B affected?','Which question reveals too much?','What would this change affect?'];
 const ask=(event:FormEvent)=>{event.preventDefault();setSubmitted({query:question,scope:context.scope});};
 return <section className="stateInquiry" aria-label={ja?'状態について質問':'Ask about this state'} data-testid="state-inquiry"><form onSubmit={ask}><label htmlFor="state-question">{ja?'いまの状態について聞く':'Ask about this state'}<small>{ja?'定型パーサー / 読み取り専用 / AI推論ではありません':'LOCAL PARSER / READ-ONLY / NO MODEL INFERENCE'}</small></label><div className="inquiryInput"><input id="state-question" data-testid="inquiry-input" maxLength={160} value={question} onChange={event=>setQuestion(event.target.value)} placeholder={examples[1]}/><button type="submit" data-testid="inquiry-submit" disabled={!question.trim()}>{ja?'確認':'Ask'} ↗</button></div></form><details className="inquiryExamples"><summary>{ja?'対応する質問を見る':'Supported questions'}</summary>{examples.map(example=><button type="button" key={example} onClick={()=>{setQuestion(example);setSubmitted({query:example,scope:context.scope});}}>{example}</button>)}</details>
 {answer&&<div className="inquiryAnswer" role="status" data-testid="inquiry-answer" data-status={answer.status}><span className="eyebrow">{answer.status} / {answer.source}</span><p>{answer.summary}</p>{answer.target&&<button type="button" data-testid="inquiry-inspect" onClick={()=>onInspect(answer.target!)}>{ja?'同じ出典の理由を確認':'Inspect this source'} ↗</button>}{answer.evidence.length>0&&<small>{ja?'根拠':'Evidence'}: {answer.evidence.join(' / ')}</small>}</div>}
 {submitted&&!current&&<p role="status" className="inquiryStale">{ja?'表示対象が更新されました。同じ質問をもう一度確認してください。':'The inspected state changed. Ask again against this source.'}</p>}
 </section>;
}
