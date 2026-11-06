import { describe, expect, it } from 'vitest';
import { applyGraphCommand, createDemoGraph } from '../packages/consequence/src/index';
import type { DemoState } from '../packages/domain/src/demo';
import { activityTiles, localEvents, SCENARIO_EVENTS } from '../apps/web/src/operatingModel';
import { inspectHistory } from '../apps/web/src/historyInspection';

export function initialState(): DemoState {
  return { environment:'LOCAL_REFERENCE',requestToken:'private-client-csrf-token',graph:createDemoGraph(),lastChanges:[],disclosure:{candidates:Array.from({length:128},(_,i)=>i),history:[],policy:{epoch:1,minCandidates:16}},capabilities:{proof:'NOT_IMPLEMENTED',authorization:'NOT_IMPLEMENTED',execution:'NOT_IMPLEMENTED'} };
}
describe('operating presentation has grounded provenance and independent consequences',()=>{
  it('keeps ordering stable and counts actual public graph records',()=>{
    const state=initialState();
    const before=activityTiles(state,state.graph,0,false);
    const result=applyGraphCommand(state.graph,{type:'REVOKE_CREDENTIAL',nodeId:'credential_A',eventId:'test-revoke',expectedSequence:0});
    const after=activityTiles(state,result.snapshot,0,true);
    expect(after.map(tile=>tile.id)).toEqual(before.map(tile=>tile.id));
    expect(after[0]).toMatchObject({status:'RESTRICTED',phase:'WHAT_IF',recordCount:6});
    expect(after[1]).toMatchObject({status:'PERMITTED',phase:'WHAT_IF',recordCount:6});
    expect(state.graph.nodes.find(node=>node.id==='action_A')?.state).toBe('VALID');
    expect(SCENARIO_EVENTS.every(event=>event.source==='SIMULATED'&&event.execution==='NOT_IMPLEMENTED')).toBe(true);
  });
  it('never invents API actor/time, exposes CSRF IDs, or merges reset streams',()=>{
    const state=initialState();
    const result=applyGraphCommand(state.graph,{type:'REVOKE_CREDENTIAL',nodeId:'credential_A',eventId:'same-event',expectedSequence:0});
    state.graph=result.snapshot;
    const first=localEvents(state,0),reset=localEvents(state,1);
    expect(first[0]).toMatchObject({actorId:null,timestamp:null,source:'LOCAL_REFERENCE',financialAuthorization:'NOT_IMPLEMENTED'});
    expect(first[0]?.id).not.toBe(reset[0]?.id);
    expect(JSON.stringify(first)).not.toContain(state.requestToken);
  });
  it('reconstructs the exact directed graph and rejects a forged explanation',()=>{
    const state=initialState();
    state.graph=applyGraphCommand(state.graph,{type:'REVOKE_CREDENTIAL',nodeId:'credential_A',eventId:'revoke',expectedSequence:0}).snapshot;
    const event=localEvents(state,0)[0]!;
    const view=inspectHistory(event,state);
    expect(view.error).toBe(false);
    expect(view.before?.graph.nodes.find(node=>node.id==='action_A')?.state).toBe('VALID');
    expect(view.state?.graph.nodes.find(node=>node.id==='action_A')?.state).toBe('BLOCKED');
    expect(view.state?.graph.nodes.find(node=>node.id==='action_B')?.state).toBe('VALID');
    const graphTiles=activityTiles(view.state,view.state?.graph,0,false,SCENARIO_EVENTS,'graph');
    expect(graphTiles.find(tile=>tile.id==='tile:issuer-history')).toMatchObject({status:'PENDING_UNKNOWN',phase:'UNOBSERVED',recordCount:null});
    const forged=structuredClone(state);forged.graph.events[0]!.changes.find(change=>change.nodeId==='action_A')!.path=['credential_A','action_A'];
    expect(inspectHistory(localEvents(forged,0)[0]!,forged).error).toBe(true);
    state.graph=createDemoGraph();
    expect(view.state?.graph.sequence).toBe(1); // Frozen, independent of a later reset.
  });
  it('reconstructs disclosure without importing another clock or inventing historical policy',()=>{
    const state=initialState();
    state.disclosure.history=[
      {sequence:1,query:{kind:'LTE',threshold:100,predicateId:'x.lte.v1'},policyEpoch:1,status:'ALLOWED',reason:'ALL_POSSIBLE_OUTCOMES_MEET_FLOOR',partitions:{yes:101,no:27},remainingBefore:128,remainingAfter:101,answer:true,idempotencyKey:'q1'},
      {sequence:2,query:{kind:'LTE',threshold:80,predicateId:'x.lte.v1'},policyEpoch:1,status:'ALLOWED',reason:'ALL_POSSIBLE_OUTCOMES_MEET_FLOOR',partitions:{yes:81,no:20},remainingBefore:101,remainingAfter:81,answer:true,idempotencyKey:'q2'},
      {sequence:3,query:{kind:'LTE',threshold:70,predicateId:'x.lte.v1'},policyEpoch:1,status:'DENIED',reason:'CANDIDATE_FLOOR',partitions:{yes:71,no:10},remainingBefore:81,remainingAfter:81,idempotencyKey:'q3'},
    ];
    state.graph=applyGraphCommand(state.graph,{type:'REVOKE_CREDENTIAL',nodeId:'credential_A',eventId:'before-disclosure',expectedSequence:0}).snapshot;
    const event=localEvents(state,0).at(-1)!;
    const view=inspectHistory(event,state);
    expect(view.error).toBe(false);expect(view.state?.disclosure.candidates).toHaveLength(81);
    expect(view.before?.disclosure.candidates).toHaveLength(81);
    expect(state.graph.nodes.find(node=>node.id==='action_A')?.state).toBe('BLOCKED');
    const disclosureTiles=activityTiles(view.state,view.state?.graph,0,false,SCENARIO_EVENTS,'disclosure');
    expect(disclosureTiles.find(tile=>tile.id==='tile:broker-a')).toMatchObject({status:'PENDING_UNKNOWN',phase:'UNOBSERVED',recordCount:null});
    state.disclosure.history[2]!.answer=false;
    expect(inspectHistory(localEvents(state,0).at(-1)!,state).error).toBe(true);
  });
  it('rejects non-canonical thresholds and contradictory public answers',()=>{
    for(const threshold of [1.5,128,-2]){
      const state=initialState();
      state.disclosure.history=[{sequence:1,query:{kind:'LTE',threshold,predicateId:'x.lte.v1'},policyEpoch:1,status:'ALLOWED',reason:'x',partitions:{yes:0,no:128},remainingBefore:128,remainingAfter:0,answer:true,idempotencyKey:'invalid'}];
      expect(inspectHistory(localEvents(state,0)[0]!,state).error).toBe(true);
    }
    const state=initialState();state.disclosure.history=[{sequence:1,query:{kind:'LTE',threshold:127,predicateId:'x.lte.v1'},policyEpoch:1,status:'ALLOWED',reason:'x',partitions:{yes:128,no:0},remainingBefore:128,remainingAfter:0,answer:false,idempotencyKey:'contradiction'}];
    expect(inspectHistory(localEvents(state,0)[0]!,state).error).toBe(true);
  });
});
