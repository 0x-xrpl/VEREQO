import {describe,expect,it} from 'vitest';
import {disclosureDecision} from '../apps/web/src/decisionPresentation';
import type {DisclosureRecord} from '../packages/domain/src/demo';
const record:DisclosureRecord={sequence:1,query:{kind:'LTE',threshold:100,predicateId:'x.lte.v1'},policyEpoch:1,status:'ALLOWED',reason:'ALL_POSSIBLE_OUTCOMES_MEET_FLOOR',partitions:{yes:101,no:27},remainingBefore:128,remainingAfter:101,answer:true,idempotencyKey:'test'};
describe('one disclosure result has one record, independent of the next proposal',()=>{
 it('binds question, answer, counts and policy to the selected record after the dial advances',()=>{
  const result=disclosureDecision(null,{query:{kind:'LTE',threshold:80,predicateId:'x.lte.v1'},policyEpoch:9,minCandidates:20,status:'ALLOWED',reason:'different',partitions:{yes:81,no:20},remainingBefore:101,historySequence:1},80,record);
  expect(result).toMatchObject({kind:'record',threshold:100,sequence:1,epoch:1,answer:true,before:128,after:101,partitions:{yes:101,no:27},reason:record.reason});
 });
 it('never presents an allowed preflight as a released answer or committed after count',()=>{
  const result=disclosureDecision(null,{query:record.query,policyEpoch:1,minCandidates:16,status:'ALLOWED',reason:record.reason,partitions:record.partitions,remainingBefore:128,historySequence:0},100,null);
  expect(result).toMatchObject({kind:'proposal',answer:null,after:null,sequence:null});
 });
});
