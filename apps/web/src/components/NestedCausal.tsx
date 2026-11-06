import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {Language} from '../i18n';

/** Inspection trail is navigation history, never a fabricated dependency path. */
export function NestedCausal({scope,selected,depth,onSelect,onDepth,name,language,children,inspector}:{scope:string;selected:string;depth:number;onSelect:(id:string)=>void;onDepth:(n:number)=>void;name:(id:string)=>string;language:Language;children:(inspect:(id:string)=>void)=>ReactNode;inspector?:ReactNode}){
 const [trail,setTrail]=useState([selected]),ref=useRef<HTMLDivElement>(null),ja=language==='ja';
 useEffect(()=>setTrail([selected]),[scope]);
 useEffect(()=>setTrail(current=>current.at(-1)===selected?current:[selected]),[selected]);
 const inspect=(id:string)=>{setTrail(current=>current.at(-1)===id?current:[...current.slice(-7),id]);onSelect(id);};
 const back=()=>{const focusId=depth>2?selected:trail.length>1?trail.at(-2)!:selected;if(depth>2)onDepth(depth-1);else if(trail.length>1){const next=trail.slice(0,-1);setTrail(next);onSelect(next.at(-1)!);onDepth(2);}else onDepth(Math.max(1,depth-1));requestAnimationFrame(()=>ref.current?.querySelector<HTMLElement>(`[data-node-id="${focusId}"]`)?.focus({preventScroll:true}));};
 return <div ref={ref} className="nestedCausal" data-testid="nested-causal" data-scope={scope} data-depth={depth} onKeyDown={event=>{if(event.key==='Escape'&&(depth>1||trail.length>1)&&!(event.target as HTMLElement).closest('input,textarea,[role="dialog"]')){event.preventDefault();event.stopPropagation();back();}}}>
  <div className="nestedNav"><button type="button" data-testid="nested-back" disabled={depth===1&&trail.length===1} onClick={back}>← {ja?'戻る':'Back'}</button><div aria-label={ja?'検査の足跡（因果経路とは別）':'Inspection trail (not a dependency path)'} className="inspectionTrail"><button type="button" onClick={()=>onDepth(1)}>{ja?'全体':'Overview'}</button>{trail.map((id,index)=><button key={`${index}:${id}`} type="button" aria-current={index===trail.length-1?'location':undefined} onClick={()=>{setTrail(trail.slice(0,index+1));onSelect(id);}}>{name(id)}</button>)}</div><span>{depth}/3</span></div>
  <div className="nestedLevels" role="group" aria-label={ja?'この場で調べる':'Inspect in place'}>{[ja?'結果':'Result',ja?'理由・依存関係':'Cause / dependencies',ja?'公開根拠':'Evidence'].map((label,index)=><button type="button" key={index} aria-pressed={depth===index+1} data-testid={`nested-level-${index+1}`} onClick={()=>onDepth(index+1)}>{String(index+1).padStart(2,'0')} / {label}</button>)}</div>
  {depth>1&&inspector}
  {children(inspect)}
 </div>;
}
