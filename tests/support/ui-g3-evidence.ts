import type { AuthorizationEvidence } from '../../services/issuer/src/financial-authorization-store.js';
/** Synthetic UI contract fixture; not an operational authorization claim. */
export function uiG3Evidence(requestId:string,principal='0x'+'11'.repeat(20)):AuthorizationEvidence {
 const h=(byte:string)=>'0x'+byte.repeat(32);
 return {id:'21',requestId,principal,status:'PRE_GATE_VALIDATED',reason:null,intentDigest:h('12'),mandateDigest:h('23'),proofDigest:h('34'),requestDigest:h('45'),createdAt:'2026-11-10T00:00:00.000Z',previousRecordHash:h('00'),recordHash:h('56'),marketObservationDigest:h('67'),disclosureBindingDigest:h('78'),disclosureHistoryRoot:h('89'),disclosureHistorySequence:'0',disclosurePolicyEpoch:'1',disclosureCredentialEpoch:'2',disclosureIssuer:'0x'+'22'.repeat(20),disclosureCredentialId:h('9a')};
}
