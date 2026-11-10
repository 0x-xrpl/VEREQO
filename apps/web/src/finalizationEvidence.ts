export interface FinancialFinalizationEvidence {
 readonly id:string;
 readonly requestId:string;
 readonly principal:string;
 readonly status:'OWNER_SIGNATURE_REQUIRED'|'REJECTED';
 readonly reason:string|null;
 readonly ownerSignatureStatus:'REQUIRED'|'NOT_REQUESTED';
 readonly execution:'NOT_IMPLEMENTED';
 readonly intentDigest:string|null;
 readonly mandateDigest:string|null;
 readonly proofDigest:string|null;
 readonly disclosureBindingDigest:string|null;
 readonly marketObservationDigest:string|null;
 readonly requestDigest:string;
 readonly previousRecordHash:string;
 readonly recordHash:string;
 readonly createdAt:string;
}
const hash=(value:unknown)=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const address=(value:unknown)=>typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value);
const request=/^[a-zA-Z0-9_-]{1,64}$/;
export function parseFinancialFinalizationHistory(value:unknown,requestId:string,principal?:string):{evidence:FinancialFinalizationEvidence;events:FinancialFinalizationEvidence[]} {
 if(!request.test(requestId)||!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_FINALIZATION_EVIDENCE_RESPONSE');
 const payload=value as Record<string,unknown>;
 const parseRecord=(item:unknown):FinancialFinalizationEvidence=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('INVALID_FINALIZATION_EVIDENCE_RECORD');
  const row=item as Record<string,unknown>;
  const required=['id','requestId','principal','status','reason','ownerSignatureStatus','execution','intentDigest','mandateDigest','proofDigest','disclosureBindingDigest','marketObservationDigest','requestDigest','previousRecordHash','recordHash','createdAt'];
  if(Object.keys(row).sort().join(',')!==required.sort().join(','))throw Error('INVALID_FINALIZATION_EVIDENCE_RECORD');
  if(typeof row.id!=='string'||!/^([1-9][0-9]{0,18})$/.test(row.id)||row.requestId!==requestId||typeof row.principal!=='string'||!address(row.principal)||principal&&row.principal.toLowerCase()!==principal.toLowerCase())throw Error('INVALID_FINALIZATION_EVIDENCE_RECORD');
  if(row.execution!=='NOT_IMPLEMENTED'||(row.status!=='OWNER_SIGNATURE_REQUIRED'&&row.status!=='REJECTED')||(row.reason!==null&&typeof row.reason!=='string'))throw Error('INVALID_FINALIZATION_EVIDENCE_RECORD');
  if(row.status==='OWNER_SIGNATURE_REQUIRED'&&(row.ownerSignatureStatus!=='REQUIRED'||row.reason!==null||['intentDigest','mandateDigest','proofDigest','disclosureBindingDigest'].some(key=>!hash(row[key]))))throw Error('INVALID_FINALIZATION_EVIDENCE_RECORD');
  if(row.status==='REJECTED'&&(row.ownerSignatureStatus!=='NOT_REQUESTED'||typeof row.reason!=='string'))throw Error('INVALID_FINALIZATION_EVIDENCE_RECORD');
  for(const key of ['intentDigest','mandateDigest','proofDigest','disclosureBindingDigest','marketObservationDigest'])if(row[key]!==null&&!hash(row[key]))throw Error('INVALID_FINALIZATION_EVIDENCE_RECORD');
  if(!hash(row.requestDigest)||!hash(row.previousRecordHash)||!hash(row.recordHash)||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw Error('INVALID_FINALIZATION_EVIDENCE_RECORD');
  return row as unknown as FinancialFinalizationEvidence;
 };
 const evidence=parseRecord(payload.evidence);
 if(!Array.isArray(payload.events)||payload.events.length<1||payload.events.length>20)throw Error('INVALID_FINALIZATION_EVIDENCE_HISTORY');
 const events=payload.events.map(parseRecord);
 if(events[0]!.id!==evidence.id||events[0]!.recordHash!==evidence.recordHash)throw Error('INVALID_FINALIZATION_EVIDENCE_HISTORY');
 return {evidence,events};
}
