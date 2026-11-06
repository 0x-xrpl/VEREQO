import { useState } from 'react';
import { words, type OperatingProject } from '../operatingModel';
import type { Language } from '../i18n';
export function projectPage(projects:readonly OperatingProject[],query:string,page:number){
  const found=projects.filter(project=>`${project.name.ja} ${project.name.en}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages=Math.max(1,Math.ceil(found.length/8)),index=Math.max(0,Math.min(page,pages-1));return {items:found.slice(index*8,index*8+8),total:found.length,pages,index};
}
export function ProjectCatalog({projects,selected,language,onProject,readOnly}:{projects:readonly OperatingProject[];selected:string;language:Language;onProject:((id:string)=>void)|undefined;readOnly:boolean}){
 const [query,setQuery]=useState(''),[page,setPage]=useState(0),view=projectPage(projects,query,page);const ja=language==='ja';
 return <div className="projectMenu"><label>{ja?'Projectを検索':'Find a project'}<input value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}} /></label><span className="eyebrow">{view.total} PROJECTS / {view.index+1} OF {view.pages}</span>{view.items.map(item=><button type="button" key={item.id} data-testid={`project:${item.id}`} disabled={readOnly} aria-pressed={selected===item.id} onClick={event=>{onProject?.(item.id);event.currentTarget.closest('details')?.removeAttribute('open');}}><span>{words(item.name,language)}<small>{item.draft?'SESSION DRAFT / ':''}{item.source}</small></span><span aria-hidden="true">{selected===item.id?'✓':''}</span></button>)}{view.pages>1&&<div className="catalogPages"><button type="button" disabled={view.index===0} onClick={()=>setPage(view.index-1)}>{ja?'前へ':'Previous'}</button><button type="button" disabled={view.index===view.pages-1} onClick={()=>setPage(view.index+1)}>{ja?'次へ':'Next'}</button></div>}{readOnly&&<p>{ja?'Project変更は「現在へ戻る」の後に行えます。':'Return to current before switching projects.'}</p>}</div>;
}
