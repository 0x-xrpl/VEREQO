import { applyGraphCommand, createDemoGraph } from '../../../packages/consequence/src/index';
import { applyAnswer, partition } from '../../../packages/disclosure/src/index';
import type { DemoState } from '../../../packages/domain/src/demo';
import type { ActivityEvent } from './operatingModel';

const canonical=(value:unknown):string=>JSON.stringify(value,(_,item:unknown)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export interface Inspection { event:ActivityEvent; state:DemoState|null; before:DemoState|null; error:boolean }
/** Reconstruct public records only. Never re-admit a query or combine separate stream clocks. */
export function inspectHistory(event:ActivityEvent, current:DemoState|null):Inspection {
  const frozen=structuredClone(event);
  const data=event.data;
  if(data.stream==='scenario')return {event:frozen,state:null,before:null,error:false};
  if(!current)return {event:frozen,state:null,before:null,error:true};
  const empty:DemoState={...structuredClone(current),graph:createDemoGraph(),lastChanges:[],disclosure:{candidates:[],history:[],policy:{epoch:0,minCandidates:0}}};
  try {
    if(data.stream==='graph'){
      let graph=createDemoGraph();let before=graph;
      const records=current.graph.events.filter(record=>record.sequence<=data.record.sequence);
      if(records.length!==data.record.sequence||canonical(records.at(-1))!==canonical(data.record))throw Error('MISSING_EVENT');
      for(const record of records){before=graph;const result=applyGraphCommand(graph,record.command);if(canonical(result.snapshot.events.at(-1))!==canonical(record))throw Error('FORGED_CAUSAL_RECORD');graph=result.snapshot;}
      return {event:frozen,state:{...empty,graph,lastChanges:structuredClone(data.record.changes)},before:{...empty,graph:before},error:false};
    }
    const records=current.disclosure.history.filter(record=>record.sequence<=data.record.sequence);
    if(records.length!==data.record.sequence||canonical(records.at(-1))!==canonical(data.record))throw Error('MISSING_EVENT');
    let candidates=Array.from({length:128},(_,i)=>i),beforeCandidates=candidates;
    for(let index=0;index<records.length;index++){
      const record=records[index]!;beforeCandidates=candidates;
      const {yes,no}=partition(candidates,record.query);
      if(record.sequence!==index+1||record.query.kind!=='LTE'||record.query.predicateId!=='x.lte.v1'||record.remainingBefore!==candidates.length||record.partitions.yes!==yes.length||record.partitions.no!==no.length)throw Error('INVALID_TRANSCRIPT');
      if(record.status==='ALLOWED'){if(typeof record.answer!=='boolean')throw Error('MISSING_ANSWER');candidates=applyAnswer(candidates,record.query,record.answer);}
      else if(record.status!=='DENIED'||Object.hasOwn(record,'answer'))throw Error('ANSWER_ON_DENIAL');
      if(record.remainingAfter!==candidates.length)throw Error('INVALID_TRANSCRIPT');
    }
    const policy={epoch:data.record.policyEpoch,minCandidates:0}; // Historical floor was not recorded: never display this sentinel.
    return {event:frozen,state:{...empty,disclosure:{candidates,history:structuredClone(records),policy}},before:{...empty,disclosure:{candidates:beforeCandidates,history:structuredClone(records.slice(0,-1)),policy}},error:false};
  }catch{return {event:frozen,state:null,before:null,error:true};}
}
