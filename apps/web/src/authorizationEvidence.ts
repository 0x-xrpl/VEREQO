export interface AuthorizationEvidence {
 readonly id:string; readonly requestId:string; readonly principal:string;
 readonly status:'PRE_GATE_VALIDATED'|'REJECTED'; readonly reason:string|null;
 readonly intentDigest:string|null; readonly mandateDigest:string|null; readonly proofDigest:string|null; readonly requestDigest:string|null;
 readonly createdAt:string; readonly previousRecordHash:string; readonly recordHash:string;
 readonly marketObservationDigest?:string|null; readonly disclosureBindingDigest?:string|null;
 readonly disclosureHistorySequence?:string|null; readonly disclosurePolicyEpoch?:string|null; readonly disclosureCredentialEpoch?:string|null;
 readonly disclosureHistoryRoot?:string|null; readonly disclosureIssuer?:string|null; readonly disclosureCredentialId?:string|null;
}
const required=['id','requestId','principal','status','reason','intentDigest','mandateDigest','proofDigest','requestDigest','createdAt','previousRecordHash','recordHash'];
const disclosure=['disclosureBindingDigest','disclosureHistorySequence','disclosurePolicyEpoch','disclosureCredentialEpoch','disclosureHistoryRoot','disclosureIssuer','disclosureCredentialId'];
const optional=['marketObservationDigest',...disclosure];
const hash=(value:unknown)=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value);
const address=(value:unknown)=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value);
export function parseAuthorizationHistory(value:unknown,requestId:string,principal?:string):{evidence:AuthorizationEvidence;events:AuthorizationEvidence[]} {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_EVIDENCE_RESPONSE');
 const payload=value as Record<string,unknown>;
 const parseRecord=(item:unknown):AuthorizationEvidence=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('INVALID_EVIDENCE_RECORD');
  const row=item as Record<string,unknown>;
  const invalid=()=>{throw Error('INVALID_EVIDENCE_RECORD');};
  if(required.some(key=>!Object.hasOwn(row,key))||Object.keys(row).some(key=>!required.includes(key)&&!optional.includes(key)))invalid();
  if(typeof row.id!=='string'||!/^([1-9][0-9]{0,18})$/.test(row.id)||row.requestId!==requestId||!address(row.principal)||principal&&String(row.principal).toLowerCase()!==principal.toLowerCase())invalid();
  if((row.status!=='PRE_GATE_VALIDATED'&&row.status!=='REJECTED')||(row.reason!==null&&typeof row.reason!=='string'))invalid();
  for(const key of ['intentDigest','mandateDigest','proofDigest','requestDigest'])if(row[key]!==null&&!hash(row[key]))invalid();
  if(row.status==='PRE_GATE_VALIDATED'&&['intentDigest','mandateDigest','proofDigest','requestDigest'].some(key=>!hash(row[key])))invalid();
  if(typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||!hash(row.previousRecordHash)||!hash(row.recordHash))invalid();
  for(const key of ['marketObservationDigest','disclosureBindingDigest','disclosureHistoryRoot','disclosureCredentialId'])if(row[key]!==undefined&&row[key]!==null&&!hash(row[key]))invalid();
  for(const key of ['disclosureHistorySequence','disclosurePolicyEpoch','disclosureCredentialEpoch'])if(row[key]!==undefined&&row[key]!==null&&(typeof row[key]!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(row[key] as string)||BigInt(row[key] as string)>=(1n<<256n)||(key!=='disclosureHistorySequence'&&row[key]==='0')))invalid();
  if(row.disclosureIssuer!==undefined&&row.disclosureIssuer!==null&&!address(row.disclosureIssuer))invalid();
  if(disclosure.some(key=>row[key]!==undefined&&row[key]!==null)&&disclosure.some(key=>row[key]===undefined||row[key]===null))invalid();
  return row as unknown as AuthorizationEvidence;
 };
 const evidence=parseRecord(payload.evidence);
 if(!Array.isArray(payload.events)||payload.events.length<1||payload.events.length>20)throw Error('INVALID_EVIDENCE_HISTORY');
 const events=payload.events.map(parseRecord);
 if(events[0]!.id!==evidence.id||events[0]!.recordHash!==evidence.recordHash)throw Error('INVALID_EVIDENCE_HISTORY');
 return {evidence,events};
}
