import { useEffect, useRef, useState } from 'react';
import type { DemoController } from './useDemoController';
import { activityTiles, localEvents, LOCAL_PROJECT, PROJECTS, SCENARIO_EVENTS, type ActivityEvent, type ActivityTile, type OperatingProject } from './operatingModel';
import { inspectHistory, type Inspection } from './historyInspection';

export type DemoAction='request'|'previewImpact'|'commit'|'reset';
/** Shared presentation context only. No identity, policy, cohort or admission decisions live here. */
export function useOperatingExperience(controller:DemoController) {
  const [projectId,setProjectId]=useState(LOCAL_PROJECT);
  const [drafts,setDrafts]=useState<OperatingProject[]>([]);
  const projects=[...PROJECTS,...drafts];
  const [tileId,setTileId]=useState('tile:broker-a');
  const [readOnlyNotice,setReadOnlyNotice]=useState(false);
  const [inspection,setInspection]=useState<Inspection|null>(null);
  const [reconciling,setReconciling]=useState(false);
  const reconcilingRef=useRef(false);
  const [reconcileFailed,setReconcileFailed]=useState(false);
  const [playing,setPlaying]=useState(false);
  const [cursor,setCursor]=useState<number|null>(null);
  const [observationRevision,setObservationRevision]=useState(0);
  const generations=useRef(new Map<string,number>());
  const token=controller.state?.requestToken;
  if(token&&!generations.current.has(token))generations.current.set(token,generations.current.size);
  const generation=token?generations.current.get(token)!:0;
  const historical=!!inspection;
  const localContext=projectId===LOCAL_PROJECT&&(!inspection||inspection.event.source==='LOCAL_REFERENCE');
  const viewState=inspection?inspection.state:controller.state;
  const viewPreview=inspection?null:controller.preview;
  const visibleSeeds=cursor===null?SCENARIO_EVENTS:SCENARIO_EVENTS.slice(0,cursor+1);
  const viewGeneration=inspection&&inspection.event.data.stream!=='scenario'?inspection.event.data.generation:generation;
  const tiles=activityTiles(viewState,viewPreview?.snapshot??viewState?.graph,viewGeneration,!!viewPreview,visibleSeeds,inspection?.event.data.stream);
  const events=[...SCENARIO_EVENTS,...localEvents(controller.state,generation)];
  const canMutate=localContext&&!historical&&!reconciling&&!reconcileFailed;
  const allowed=useRef(canMutate);allowed.current=canMutate;
  const inspectionRef=useRef(inspection);inspectionRef.current=inspection;
  useEffect(()=>{if(inspectionRef.current||projectId!==LOCAL_PROJECT)return;if(controller.mode==='disclosure')setTileId('tile:issuer-history');else setTileId(current=>current==='tile:issuer-history'?'tile:broker-a':current);},[controller.mode,projectId]);
  const chooseTile=(tile:ActivityTile)=>{
    if(reconcilingRef.current)return;
    if(inspectionRef.current&&tile.projectId!==inspectionRef.current.event.projectId)return;
    allowed.current=tile.projectId===LOCAL_PROJECT&&!inspectionRef.current&&!reconcileFailed;setProjectId(tile.projectId);setTileId(tile.id);setReadOnlyNotice(false);
    if(tile.nodeId){controller.setSelected(tile.nodeId);if(!inspectionRef.current)controller.setMode('impact');controller.setDepth(value=>Math.max(2,value));}
    else if(tile.source==='LOCAL_REFERENCE'&&!inspectionRef.current)controller.setMode('disclosure');
  };
  const chooseProject=(id:string)=>{
    if(reconcilingRef.current||inspectionRef.current||!projects.some(project=>project.id===id))return;
    allowed.current=id===LOCAL_PROJECT&&!inspectionRef.current&&!reconcileFailed;setProjectId(id);setTileId(tiles.find(tile=>tile.projectId===id)?.id??'');if(id===LOCAL_PROJECT){controller.setSelected('action_A');controller.setMode('impact');}setReadOnlyNotice(false);
  };
  const selectEvent=(event:ActivityEvent)=>{
    if(reconcilingRef.current)return;
    allowed.current=false;setPlaying(false);setReadOnlyNotice(false);setReconcileFailed(false);
    const snapshot=inspectHistory(event,controller.state);inspectionRef.current=snapshot;setInspection(snapshot);setProjectId(event.projectId);
    setTileId(event.relatedAgentId?`tile:${event.relatedAgentId}`:event.data.stream==='disclosure'?'tile:issuer-history':'tile:broker-a');
    if(event.data.stream==='graph'){controller.setSelected(event.data.record.changes.at(-1)?.nodeId??event.data.record.command.nodeId);controller.setMode('impact');controller.setDepth(3);}
    else if(event.data.stream==='disclosure'){controller.setMode('disclosure');controller.setDepth(3);}
  };
  const returnCurrent=async()=>{
    if(reconcilingRef.current)return false;reconcilingRef.current=true;
    allowed.current=false;setPlaying(false);setReconciling(true);setReconcileFailed(false);
    const ok=await controller.load();
    if(ok){setObservationRevision(value=>value+1);inspectionRef.current=null;setInspection(null);setCursor(null);setProjectId(LOCAL_PROJECT);setTileId('tile:broker-a');controller.setSelected('action_A');controller.setMode('impact');}
    else setReconcileFailed(true);
    reconcilingRef.current=false;setReconciling(false);return ok;
  };
  const start=()=>{if(reconcilingRef.current)return;setCursor(0);selectEvent(SCENARIO_EVENTS[0]!);setPlaying(true);};
  const resume=()=>{if(reconcilingRef.current)return;if(cursor===null||cursor>=SCENARIO_EVENTS.length-1)start();else setPlaying(true);};
  useEffect(()=>{
    if(!playing||cursor===null)return;
    if(cursor>=SCENARIO_EVENTS.length-1){setPlaying(false);return;}
    const timer=window.setTimeout(()=>{const next=cursor+1;setCursor(next);selectEvent(SCENARIO_EVENTS[next]!);setPlaying(true);},1800);
    return()=>window.clearTimeout(timer);
  },[playing,cursor]);
  const createProject=(name:string)=>{
    const value=name.trim();if(!value||value.length>48||projects.length>=1000||inspectionRef.current||reconciling)return false;
    const project:OperatingProject={id:`draft:${crypto.randomUUID()}`,name:{ja:value,en:value},rule:{ja:'ルール未設定 / 表示用ドラフト',en:'No rule configured / presentation draft'},source:'SIMULATED',draft:true};
    allowed.current=false;setDrafts(current=>[...current,project]);setProjectId(project.id);setTileId('');return true;
  };
  const chooseNode=(id:string)=>{if(reconcilingRef.current)return;controller.setSelected(id);controller.setDepth(value=>Math.max(2,value));if(id.endsWith('_A'))setTileId('tile:broker-a');else if(id.endsWith('_B'))setTileId('tile:broker-b');};
  const run=async(action:DemoAction)=>{if(!allowed.current){setReadOnlyNotice(true);return false;}await controller[action]();return true;};
  return {projectId,project:projects.find(project=>project.id===projectId)!,projects,tiles,events,generation,tile:tiles.find(tile=>tile.id===tileId)??null,tileId,localContext,canMutate,readOnlyNotice,chooseTile,chooseProject,chooseNode,createProject,observationRevision,run,inspection,historical,viewState,viewPreview,reconciling,reconcileFailed,selectEvent,returnCurrent,playing,cursor,start,resume,pause:()=>setPlaying(false)};
}
