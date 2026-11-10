import {getAddress, keccak256, toUtf8Bytes} from 'ethers';
import {canonicalBusinessRequestId,nativeOrderDigest,parseNativeOrderIntent,prepareNativeOrder} from './native-order.js';
import {marketApiTicks,type LiveSnapshot} from './live-injective.js';
import {assessSpotBuyLimitRisk} from './injective-indexer.js';
export interface AgentPolicy {
 readonly principal:string; readonly agent:string; readonly issuer:string; readonly gate:string;
 readonly credentialId:string; readonly credentialEpoch:string; readonly policyEpoch:string;
 readonly marketId:string; readonly subaccountId:string; readonly maxNotional:string; readonly maxFeeRate:string; readonly maxTotalExposure:string;
}
export interface AgentRequestContext {
 readonly sessionPrincipal:string|null; readonly policy:AgentPolicy; readonly snapshot:LiveSnapshot;
 readonly now:string; readonly usedNonces:ReadonlySet<string>;
 /** Server-verified issuer disclosure binding; caller input cannot set this context field. */ readonly expectedDisclosureRequestId?:string;
 /** Server configuration only, never set from the request. */
 readonly provider:{readonly configured:boolean;readonly id:string};
}
export function marketConfigurationHash(snapshot:LiveSnapshot):string {
 return keccak256(toUtf8Bytes(JSON.stringify(snapshot.market)));
}
function exact(input:unknown,keys:string[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw Error('INVALID_REQUEST');
 const d=Object.getOwnPropertyDescriptors(input);if(Reflect.ownKeys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(d,k)||!Object.hasOwn(d[k]!,'value')))throw Error('INVALID_REQUEST_FIELDS');return input as Record<string,unknown>;
}
/** An authenticated ingress validates proposals; it cannot grant execution authority. */
export function acceptAgentProposal(input:unknown,c:AgentRequestContext){
 const r=exact(input,['requestId','intent','source']);
 if(typeof r.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(r.requestId))throw Error('INVALID_REQUEST_ID');
 if(r.source!=='LIVE_PROVIDER'&&r.source!=='FIXTURE')throw Error('INVALID_PROVENANCE');
 if(r.source==='LIVE_PROVIDER'&&!c.provider.configured)throw Error('PROVIDER_NOT_CONFIGURED');
 if(!c.sessionPrincipal||getAddress(c.sessionPrincipal)!==getAddress(c.policy.principal))throw Error('UNAUTHENTICATED_PRINCIPAL');
 if(!/^(0|[1-9][0-9]{0,19})$/.test(c.now))throw Error('INVALID_TIME');
 const now=BigInt(c.now),observed=Date.parse(c.snapshot.observedAt);
 if(!Number.isFinite(observed)||BigInt(Math.floor(observed/1000))>now+30n||BigInt(Math.floor(observed/1000))+60n<now||c.snapshot.status!=='LIVE_READ_ONLY'||c.snapshot.chainId!=='1439')throw Error('STALE_OR_UNTRUSTED_SNAPSHOT');
 const i=parseNativeOrderIntent(r.intent),p=c.policy;
 if(i.disclosureRequestId!==(c.expectedDisclosureRequestId??canonicalBusinessRequestId(r.requestId)))throw Error('REQUEST_ID_INTENT_MISMATCH');
 for(const key of ['principal','agent','issuer'] as const)if(i[key]!==getAddress(p[key]))throw Error(`POLICY_${key}`);
 if(i.verifyingContract!==getAddress(p.gate))throw Error('POLICY_GATE');
 for(const key of ['credentialId','credentialEpoch','policyEpoch','marketId','subaccountId'] as const)if(i[key]!==p[key])throw Error(`POLICY_${key}`);
 if(i.marketId!==c.snapshot.market.marketId||i.marketConfigHash!==marketConfigurationHash(c.snapshot))throw Error('MARKET_CONFIGURATION');
 const ticks=marketApiTicks(c.snapshot.market);
 if(i.priceTick!==ticks.priceTick||i.quantityTick!==ticks.quantityTick)throw Error('MARKET_PRECISION');
 if(BigInt(i.maxFeeRate)<BigInt(ticks.feeRate))throw Error('MARKET_FEE_EXCEEDS_POLICY');
 // The Gate cannot pass a fee cap to the Exchange precompile. Keep proposal
 // accounting identical to the issuer ceiling that the Gate reserves against.
 if(i.maxFeeRate!==p.maxFeeRate)throw Error('POLICY_maxFeeRate');
 for(const key of ['maxNotional','maxTotalExposure'] as const)if(BigInt(i[key])>BigInt(p[key]))throw Error(`POLICY_${key}`);
 if(BigInt(i.deadline)<=now||BigInt(i.deadline)>now+300n||c.usedNonces.has(i.nonce))throw Error('EXPIRED_FUTURE_OR_REPLAY');
 const preview=prepareNativeOrder(i);if(BigInt(preview.exposure.notional)<BigInt(ticks.minimumNotional))throw Error('MINIMUM_NOTIONAL');
 const marketRisk=assessSpotBuyLimitRisk({marketId:i.marketId,market:{marketId:c.snapshot.market.marketId,priceTick:ticks.priceTick,quantityTick:ticks.quantityTick,baseDecimals:c.snapshot.market.baseDecimals,quoteDecimals:c.snapshot.market.quoteDecimals},orderbook:c.snapshot.spotOrderbook,intent:i,intentDigest:nativeOrderDigest(i),nowMs:Number(now)*1000,maxAgeMs:10_000,maxSlippageBps:100});
 return Object.freeze({requestId:r.requestId,source:r.source,providerId:r.source==='LIVE_PROVIDER'?c.provider.id:null,provenance:r.source==='LIVE_PROVIDER'?'PROVIDER_DECLARED_NOT_AUTONOMY_VERIFIED':'IMPORTED_FIXTURE',intent:i,preview,marketRisk,authorized:false as const,execution:'NOT_IMPLEMENTED' as const});
}
