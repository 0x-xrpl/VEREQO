import { getAddress } from 'ethers';

/** A permission observation is evidence, never a regulatory certification or execution grant. */
export interface PermissionedAsset {
 readonly assetId: string;
 readonly issuer: string;
 readonly assetClass: 'TOKENIZED_SECURITY' | 'TOKENIZED_COMMODITY' | 'OTHER_PERMISSIONED';
 readonly holder: string;
 readonly credentialId: string;
 readonly credentialEpoch: string;
 readonly policyId: string;
 readonly policyEpoch: string;
 readonly delegatedAgent: string;
 readonly operation: 'TRANSFER' | 'SPOT_ORDER';
 readonly revocationDependency: string;
}
export interface PermissionObservation {
 readonly source: string;
 readonly chainId: string;
 readonly blockHeight: string;
 readonly observedAt: string;
 readonly expiresAt: string;
 readonly assetId: string;
 readonly issuer: string;
 readonly holder: string;
 readonly agent: string;
 readonly credentialId: string;
 readonly credentialEpoch: string;
 readonly policyId: string;
 readonly policyEpoch: string;
 readonly operation: 'TRANSFER' | 'SPOT_ORDER';
 readonly eligibility: 'ELIGIBLE' | 'INELIGIBLE' | 'UNKNOWN';
 readonly credentialState: 'ACTIVE' | 'REVOKED' | 'UNKNOWN';
}
export interface PermissionContext {
 /** Trusted adapter configuration. Must never be populated directly from an Agent request. */
 readonly source: string;
 readonly chainId: string;
 readonly now: string;
 readonly minimumBlock: string;
 readonly maxAgeSeconds: string;
 readonly allowedPrincipals: ReadonlySet<string>;
}
export interface PermissionAssessment {
 readonly status: 'OBSERVED' | 'PENDING' | 'UNKNOWN';
 readonly eligible: boolean;
 readonly reason: string;
 readonly authorized: false;
 readonly regulatoryCompliance: 'NOT_CERTIFIED';
}
const assetKeys = ['assetId','issuer','assetClass','holder','credentialId','credentialEpoch','policyId','policyEpoch','delegatedAgent','operation','revocationDependency'];
const observationKeys = ['source','chainId','blockHeight','observedAt','expiresAt','assetId','issuer','holder','agent','credentialId','credentialEpoch','policyId','policyEpoch','operation','eligibility','credentialState'];
function object(input: unknown, keys: string[]): Record<string, unknown> {
 if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) throw Error('INVALID_OBJECT');
 const descriptors = Object.getOwnPropertyDescriptors(input);
 if (Reflect.ownKeys(input).length !== keys.length || keys.some(k => !descriptors[k] || !Object.hasOwn(descriptors[k]!, 'value'))) throw Error('INVALID_FIELDS');
 return input as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_:.\/-]{1,160}$/.test(value)) throw Error('INVALID_IDENTIFIER'); return value; }
function uint(value: unknown): string { if(typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 1n<<256n) throw Error('INVALID_UINT'); return value; }
function address(value: unknown): string { if(typeof value !== 'string') throw Error('INVALID_ADDRESS'); const a=getAddress(value); if(/^0x0{40}$/.test(a)) throw Error('ZERO_ADDRESS'); return a; }
function choice<T extends string>(value: unknown, choices: readonly T[]): T { if(!choices.includes(value as T)) throw Error('INVALID_ENUM'); return value as T; }
export function parsePermissionedAsset(input: unknown): PermissionedAsset {
 const a=object(input, assetKeys);
 return Object.freeze({assetId:text(a.assetId),issuer:address(a.issuer),assetClass:choice(a.assetClass,['TOKENIZED_SECURITY','TOKENIZED_COMMODITY','OTHER_PERMISSIONED']),holder:address(a.holder),credentialId:text(a.credentialId),credentialEpoch:uint(a.credentialEpoch),policyId:text(a.policyId),policyEpoch:uint(a.policyEpoch),delegatedAgent:address(a.delegatedAgent),operation:choice(a.operation,['TRANSFER','SPOT_ORDER']),revocationDependency:text(a.revocationDependency)});
}
export function assessPermission(input: unknown, evidence: unknown, context: PermissionContext): PermissionAssessment {
 const result=(status:PermissionAssessment['status'],eligible:boolean,reason:string):PermissionAssessment=>({status,eligible,reason,authorized:false,regulatoryCompliance:'NOT_CERTIFIED'});
 try {
  const asset=parsePermissionedAsset(input);
  if(evidence === null || evidence === undefined) return result('PENDING',false,'PERMISSION_ADAPTER_PENDING');
  const e=object(evidence,observationKeys);
  for(const k of ['source','assetId','credentialId','policyId']) text(e[k]);
  for(const k of ['chainId','blockHeight','observedAt','expiresAt','credentialEpoch','policyEpoch']) uint(e[k]);
  for(const k of ['issuer','holder','agent']) address(e[k]);
  choice(e.operation,['TRANSFER','SPOT_ORDER']); choice(e.eligibility,['ELIGIBLE','INELIGIBLE','UNKNOWN']); choice(e.credentialState,['ACTIVE','REVOKED','UNKNOWN']);
  const now=BigInt(uint(context.now));
  if(e.source!==context.source || e.chainId!==uint(context.chainId)) return result('UNKNOWN',false,'UNTRUSTED_PROVENANCE');
  if(BigInt(e.blockHeight as string)<BigInt(uint(context.minimumBlock)) || BigInt(e.observedAt as string)>now || now-BigInt(e.observedAt as string)>BigInt(uint(context.maxAgeSeconds)) || BigInt(e.expiresAt as string)<=now) return result('UNKNOWN',false,'STALE_EVIDENCE');
  if(e.assetId!==asset.assetId || address(e.issuer)!==asset.issuer || address(e.holder)!==asset.holder || address(e.agent)!==asset.delegatedAgent || e.credentialId!==asset.credentialId || e.credentialEpoch!==asset.credentialEpoch || e.policyId!==asset.policyId || e.policyEpoch!==asset.policyEpoch || e.operation!==asset.operation) return result('UNKNOWN',false,'SCOPE_MISMATCH');
  if(!context.allowedPrincipals.has(asset.holder)) return result('OBSERVED',false,'PRINCIPAL_NOT_ALLOWED');
  if(e.credentialState==='UNKNOWN' || e.eligibility==='UNKNOWN') return result('UNKNOWN',false,'UNOBSERVED_PERMISSION');
  if(e.credentialState==='REVOKED') return result('OBSERVED',false,'CREDENTIAL_REVOKED');
  return result('OBSERVED',e.eligibility==='ELIGIBLE',e.eligibility==='ELIGIBLE'?'ELIGIBILITY_OBSERVED':'HOLDER_INELIGIBLE');
 } catch { return result('UNKNOWN',false,'MALFORMED_PERMISSION'); }
}
