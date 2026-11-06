import { useEffect, useState } from 'react';
import type { Language } from '../i18n';
import type { DemoController } from '../useDemoController';
import type { useOperatingExperience } from '../useOperatingExperience';

export function GuidedDemo({language,controller:c,operating:o,onFree}:{language:Language;controller:DemoController;operating:ReturnType<typeof useOperatingExperience>;onFree:()=>void}){
 const ja=language==='ja',history=c.state?.disclosure.history??[];
 const prefix=history.every((record,i)=>i<3&&record.query.threshold===[100,80,70][i]&&(i<2?record.status==='ALLOWED'&&record.answer===true:record.status==='DENIED'&&!Object.hasOwn(record,'answer')));
 const step=prefix?Math.min(3,history.length):-1;
 const [checked,setChecked]=useState<string|null>(null);
 useEffect(()=>{if(o.historical)return;if(step>=0&&step<3){c.setMode('disclosure');c.setThreshold([100,80,70][step]!);}else if(step===3){c.setMode('impact');c.setSelected('action_A');c.setDepth(2);}},[step,o.historical,o.projectId,o.observationRevision]);
 const target=step>=0&&step<3?[100,80,70][step]:null;
 const ready=o.canMutate&&!c.pending&&!c.needsReload;
 const recheck=async()=>{const id=c.preview?.command.eventId;if(await c.load())setChecked(id??null);};
 const titles=ja?['非公開のサンプル値が100以下か、質問する。','もう一度答える。残る候補は81通り。','第三の質問。答える前に止める。','別モデルで、Aだけに起きる影響を見る。']:['Ask whether the hidden sample value is at most 100.','Answer once more. Retain 81 possible values.','The third question stops before an answer.','Inspect A’s consequence in the separate graph model.'];
 return <section className="guidedDemo" data-testid="guided-demo"><div><span className="eyebrow">GUIDED DEMO / ACTUAL LOCAL API</span><h2>{step<0?(ja?'既存の履歴を保持しています。':'Existing history is retained.'):titles[step]}</h2><p>{ja?'取引担当者は、外部ブローカーに必要な情報だけを渡したい。合成の依頼を使い、開示と依存関係という独立した二つの保護モデルを検査します。':'A trading operator wants to share only what an external broker needs. Synthetic requests lead through two separate local models: cumulative disclosure and directed dependencies.'}</p></div><ol className="guideProgress" aria-label={ja?'ガイドの流れ':'Demo sequence'}>{(ja?['課題・依頼','回答の範囲','制限','影響','再確認','根拠']:['Problem / request','Disclosure','Restriction','Consequence','Recheck','Evidence']).map((label,i)=><li key={label} data-complete={step>=0&&(i<Math.min(step+1,4)||i===4&&checked===c.preview?.command.eventId)}><span>0{i+1}</span>{label}</li>)}</ol><div className="guideActions">
 {step>=0&&step<3&&<button className="outlineBtn" type="button" data-testid="guide-action" disabled={!ready||c.threshold!==target||!c.preflight} onClick={()=>void o.run('request')}>{ja?(step===2?'第三問を要求 / 拒否を確認':'限定した回答を要求'):(step===2?'Request third question / verify refusal':'Request the bounded answer')}</button>}
 {step===3&&!c.preview&&c.state?.graph.nodes.find(node=>node.id==='credential_A')?.state==='VALID'&&<button className="outlineBtn" type="button" data-testid="guide-action" disabled={!ready} onClick={()=>void o.run('previewImpact')}>{ja?'資格Aの失効を試算':'Preview credential A revocation'}</button>}
 {step===3&&c.preview&&<><button className="outlineBtn" type="button" data-testid="guide-recheck" disabled={!ready} onClick={()=>void recheck()}>{ja?'現在のAPIを再取得 / 確定しない':'Recheck current API / no commit'}</button><button className="subtleBtn" type="button" data-testid="guide-evidence" disabled={checked!==c.preview.command.eventId} onClick={()=>{c.setDepth(3);document.getElementById('decision-evidence')?.scrollIntoView({block:'start',behavior:'instant'});}}>{ja?'公開根拠を開く':'Open public evidence'} ↘</button></>}
 {(step<0||step===3&&c.state?.graph.nodes.find(node=>node.id==='credential_A')?.state==='REVOKED')&&<button type="button" className="subtleBtn" disabled={!ready} onClick={()=>void o.run('reset')}>{ja?'ローカルの合成デモを明示的にリセット':'Explicitly reset the synthetic local demo'}</button>}
 <button type="button" className="subtleBtn" onClick={onFree}>{ja?'自由探索へ':'Explore freely'} ↗</button></div><p className="guideState" data-testid="guide-state">{prefix?'SCENARIO / 128 → 101 → 81 / ':'RETAINED RECORDS / '}{history.at(-1)?.status==='DENIED'?`${history.at(-1)!.partitions.yes} / ${history.at(-1)!.partitions.no} · DENIED · NO ANSWER`:ja?'進行は確定したAPI記録から更新':'Progress follows committed API records'} · {ja?'金融認可・執行：未実装':'Financial authority / execution: NOT_IMPLEMENTED'}</p></section>;
}
