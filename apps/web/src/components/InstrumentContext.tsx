import { useState } from 'react';
import type { Language } from '../i18n';
import { FinancialObjectTracePanel, type FinancialObjectTrace } from './FinancialObjectTrace';
import { words } from '../operatingModel';
import type { useOperatingExperience } from '../useOperatingExperience';

export function InstrumentContext({language,operating:o,depth,onDepth,financialTrace=null}:{language:Language;operating:ReturnType<typeof useOperatingExperience>;depth:number;onDepth:(depth:number)=>void;financialTrace?:FinancialObjectTrace|null}){
  const [dimension,setDimension]=useState<'PROJECT'|'AGENTS'|'TIME'|'TRACE'>('AGENTS');
  const ja=language==='ja';
  const related=o.events.filter(event=>o.tile?.eventIds.includes(event.id));
  return <div className="instrumentContext" data-testid="instrument-context"><FinancialObjectTracePanel trace={financialTrace} language={language} surface="INSTRUMENT" />
    <div className="contextTarget"><span className="eyebrow">{ja?'検査対象':'INSPECTION TARGET'}</span><strong>{o.tile?words(o.tile.label,language):words(o.project.name,language)}</strong><span>{o.historical?'HISTORICAL / READ-ONLY':o.tile?.phase??o.project.source}</span></div>
    <div className="contextDimensions" role="group" aria-label={ja?'検査コンテキスト':'Inspection context'}>{(['PROJECT','AGENTS','TIME','TRACE'] as const).map(value=><button type="button" key={value} data-testid={`context-${value.toLowerCase()}`} aria-pressed={dimension===value} onClick={()=>setDimension(value)}>{value}</button>)}</div>
    <div className="contextOptions" data-testid="context-options">
      {dimension==='PROJECT'&&<>{o.projects.slice(0,8).map(project=><button type="button" key={project.id} disabled={o.historical} aria-pressed={o.projectId===project.id} onClick={()=>o.chooseProject(project.id)}>{words(project.name,language)}<small>{project.source}</small></button>)}{o.projects.length>8&&<button type="button" onClick={()=>{document.querySelector('details.projectIndex')?.setAttribute('open','');document.querySelector<HTMLElement>('.projectMenu input')?.focus();}}>{ja?'全Projectを検索':'Search all projects'} ↗</button>}</>}
      {dimension==='AGENTS'&&<>{o.tiles.filter(tile=>tile.projectId===o.projectId).map(tile=><button type="button" key={tile.id} aria-pressed={o.tileId===tile.id} onClick={()=>o.chooseTile(tile)}>{words(tile.label,language)}</button>)}</>}
      {dimension==='TIME'&&<>{related.map(event=><button type="button" key={event.id} aria-pressed={o.inspection?.event.id===event.id} onClick={()=>o.selectEvent(event)}>{words(event.title,language)}<small>{event.source}</small></button>)}{!related.length&&<p>{ja?'この対象の実APIイベントはまだありません。合成の物語は下の履歴で確認できます。':'No API events for this target yet. Inspect the seeded story in the timeline below.'}</p>}</>}
      {dimension==='TRACE'&&<>{[1,2,3].map(value=><button key={value} type="button" aria-pressed={depth===value} onClick={()=>onDepth(value)}>{value===1?(ja?'概要':'Overview'):value===2?(ja?'因果経路':'Causal path'):(ja?'公開記録':'Public evidence')}</button>)}<button type="button" className="inspectJump" data-testid="inspect-explanation" onClick={()=>document.getElementById('decision-evidence')?.scrollIntoView({block:'start',behavior:'instant'})}>{ja?'説明を開く':'Open explanation'} ↘</button></>}
    </div>
    <p className="contextMapping">{ja?'TARGETはMapの対象、DEPTHは検査の深さ。中央押下は表示の確定のみです。':'TARGET selects a Map item. DEPTH inspects it. Center press confirms the display only.'}</p>
  </div>;
}
