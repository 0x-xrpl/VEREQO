import type { DisclosurePreflight, DisclosureRecord, DisclosureView } from '../../../packages/domain/src/demo';

/** Public presentation only: never evaluates a witness or decides admission. */
export function disclosureDecision(view:DisclosureView|null, preflight:DisclosurePreflight|null, threshold:number, record:DisclosureRecord|null){
  if(record)return {kind:'record' as const,threshold:record.query.threshold,sequence:record.sequence,epoch:record.policyEpoch,status:record.status,reason:record.reason,before:record.remainingBefore,after:record.remainingAfter,answer:record.status==='ALLOWED'&&typeof record.answer==='boolean'?record.answer:null,partitions:record.partitions};
  return {kind:'proposal' as const,threshold:preflight?.query.threshold??threshold,sequence:null,epoch:preflight?.policyEpoch??null,status:preflight?.status??'UNKNOWN',reason:preflight?.reason??'UNKNOWN',before:view?.candidates.length??null,after:null,answer:null,partitions:preflight?.partitions??null};
}
