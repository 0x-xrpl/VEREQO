import { Interface } from 'ethers';
import { fetchSpotOrderbookV2, TESTNET_INDEXER_GRPC_WEB, SPOT_ORDERBOOKS_V2_METHOD, type SpotOrderbookObservation } from './injective-indexer.js';

/** Authoritative public TESTNET reads only; no signing or broadcast method exists. */
export const TESTNET_RPC = 'https://k8s.testnet.json-rpc.injective.network/';
export const TESTNET_LCD = 'https://testnet.sentry.lcd.injective.network';
export const EXCHANGE_PRECOMPILE = '0x0000000000000000000000000000000000000065';
const exchangeReadAbi = new Interface(['function subaccountDeposit(string subaccountID,string denom) view returns (uint256 availableBalance,uint256 totalBalance)']);
export interface SpotMarketObservation {
 readonly marketId: string; readonly ticker: string; readonly baseDenom: string; readonly quoteDenom: string;
 readonly baseDecimals: number; readonly quoteDecimals: number; readonly priceTickChain: string;
 readonly quantityTickChain: string; readonly minimumNotionalChain: string; readonly takerFeeRate: string;
 readonly status: 'Active';
}
export interface DerivativeMarketObservation {
 readonly marketId: string; readonly ticker: string; readonly quoteDenom: string;
 readonly oracleType: string; readonly oracleBase: string; readonly oracleQuote: string;
 readonly oracleScaleFactor: number; readonly initialMarginRatio: string; readonly maintenanceMarginRatio: string;
 readonly markPrice: string; readonly priceTickChain: string; readonly quantityTickChain: string;
 readonly takerFeeRate: string; readonly status: 'Active';
}
export interface SpotTopOfBookObservation {
 readonly marketId: string; readonly midPriceChain: string;
 readonly bestBuyPriceChain: string; readonly bestSellPriceChain: string;
}
export interface EndpointSoftwareObservation {
 readonly evmClientVersion: string; readonly tendermintNodeVersion: string;
 readonly injectiveAppName: string; readonly injectiveAppVersion: string; readonly injectiveGitCommit: string;
 readonly cosmosSdkVersion: string; readonly consistency: 'UNPINNED_ENDPOINT_REPORTS';
}
export interface LiveSnapshot {
 readonly status: 'LIVE_READ_ONLY'; readonly chainId: '1439'; readonly cosmosChainId: 'injective-888'; readonly blockNumber: string;
 readonly blockHash: string; readonly blockTimestamp: string; readonly observedAt: string;
 readonly marketSource: string; readonly rpcSource: string; readonly market: SpotMarketObservation;
 readonly derivativeSource: string; readonly chainSource: string; readonly derivativeMarket: DerivativeMarketObservation | null;
 readonly spotTopOfBookSource: string; readonly spotTopOfBook: SpotTopOfBookObservation | null;
 readonly spotOrderbookSource: string; readonly spotOrderbook: SpotOrderbookObservation | null;
 readonly endpointSoftware: EndpointSoftwareObservation;
 readonly marketConsistency: 'UNPINNED_LCD_READ'; readonly execution: 'NOT_IMPLEMENTED';
}
const hex = /^0x[0-9a-fA-F]+$/;
const bytes32 = /^0x[0-9a-fA-F]{64}$/;
const decimal = /^(0|[1-9][0-9]*)(\.[0-9]{1,36})?$/;
function string(o: Record<string, unknown>, k: string): string { const v=o[k]; if(typeof v!=='string'||v.length>256)throw Error(`INVALID_MARKET_${k}`); return v; }
export function parseSpotMarket(value: unknown): SpotMarketObservation {
 if (!value || typeof value!=='object'||Array.isArray(value)) throw Error('INVALID_MARKET');
 const o=value as Record<string,unknown>;
 const marketId=string(o,'market_id'), ticker=string(o,'ticker');
 if(!bytes32.test(marketId)||/^0x0{64}$/.test(marketId)||o.status!=='Active')throw Error('INACTIVE_OR_INVALID_MARKET');
 const priceTickChain=string(o,'min_price_tick_size'), quantityTickChain=string(o,'min_quantity_tick_size'), minimumNotionalChain=string(o,'min_notional'), takerFeeRate=string(o,'taker_fee_rate');
 for(const v of [priceTickChain,quantityTickChain,minimumNotionalChain,takerFeeRate])if(!decimal.test(v))throw Error('INVALID_MARKET_DECIMAL');
 if(!/[1-9]/.test(priceTickChain)||!/[1-9]/.test(quantityTickChain))throw Error('ZERO_TICK');
 for(const d of [o.base_decimals,o.quote_decimals])if(typeof d!=='number'||!Number.isSafeInteger(d)||d<0||d>18)throw Error('UNSUPPORTED_TOKEN_DECIMALS');
 return Object.freeze({marketId:marketId.toLowerCase(),ticker,baseDenom:string(o,'base_denom'),quoteDenom:string(o,'quote_denom'),baseDecimals:o.base_decimals as number,quoteDecimals:o.quote_decimals as number,priceTickChain,quantityTickChain,minimumNotionalChain,takerFeeRate,status:'Active'});
}
export function parseSpotTopOfBook(value: unknown, marketId: string): SpotTopOfBookObservation {
 if(!bytes32.test(marketId))throw Error('INVALID_MARKET_ID');
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_SPOT_TOP_OF_BOOK');
 const o=value as Record<string,unknown>, midPriceChain=string(o,'mid_price'), bestBuyPriceChain=string(o,'best_buy_price'), bestSellPriceChain=string(o,'best_sell_price');
 for(const v of [midPriceChain,bestBuyPriceChain,bestSellPriceChain])if(!decimal.test(v))throw Error('INVALID_SPOT_PRICE');
 return Object.freeze({marketId:marketId.toLowerCase(),midPriceChain,bestBuyPriceChain,bestSellPriceChain});
}
export function parseDerivativeMarket(value: unknown): DerivativeMarketObservation {
 if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('INVALID_DERIVATIVE_MARKET');
 const wrapper=value as Record<string,unknown>, market=wrapper.market;
 if (!market || typeof market!=='object' || Array.isArray(market)) throw Error('INVALID_DERIVATIVE_MARKET');
 const o=market as Record<string,unknown>;
 const marketId=string(o,'market_id'), ticker=string(o,'ticker');
 if (!bytes32.test(marketId) || /^0x0{64}$/.test(marketId) || o.status!=='Active') throw Error('INACTIVE_OR_INVALID_DERIVATIVE_MARKET');
 const priceTickChain=string(o,'min_price_tick_size'), quantityTickChain=string(o,'min_quantity_tick_size');
 const initialMarginRatio=string(o,'initial_margin_ratio'), maintenanceMarginRatio=string(o,'maintenance_margin_ratio');
 const takerFeeRate=string(o,'taker_fee_rate'), markPrice=string(wrapper,'mark_price');
 for(const v of [priceTickChain,quantityTickChain,initialMarginRatio,maintenanceMarginRatio,takerFeeRate,markPrice]) if(!decimal.test(v)) throw Error('INVALID_DERIVATIVE_MARKET_DECIMAL');
 for(const v of [priceTickChain,quantityTickChain,markPrice]) if(!/[1-9]/.test(v)) throw Error('ZERO_DERIVATIVE_MARKET_VALUE');
 const oracleScaleFactor=o.oracle_scale_factor;
 if(typeof oracleScaleFactor!=='number' || !Number.isSafeInteger(oracleScaleFactor) || oracleScaleFactor<0 || oracleScaleFactor>18) throw Error('INVALID_ORACLE_SCALE');
 return Object.freeze({marketId:marketId.toLowerCase(),ticker,quoteDenom:string(o,'quote_denom'),oracleType:string(o,'oracle_type'),oracleBase:string(o,'oracle_base'),oracleQuote:string(o,'oracle_quote'),oracleScaleFactor,initialMarginRatio,maintenanceMarginRatio,markPrice,priceTickChain,quantityTickChain,takerFeeRate,status:'Active'});
}
/** Decimal rational scaling; rejects loss, never rounds a market tick. */
export function scaleChainDecimal(value: string, power: number): string {
 if(!decimal.test(value)||!Number.isSafeInteger(power)||power < -36||power>36)throw Error('INVALID_SCALING');
 const [whole,fraction='']=value.split('.'); const n=BigInt(whole!+fraction); const exponent=power-fraction.length;
 if(exponent>=0)return (n*10n**BigInt(exponent)).toString();
 const divisor=10n**BigInt(-exponent); if(n%divisor!==0n)throw Error('UNREPRESENTABLE_PRECISION'); return (n/divisor).toString();
}
export function marketApiTicks(m: SpotMarketObservation): {priceTick:string;quantityTick:string;minimumNotional:string;feeRate:string} {
 // LCD exchange values are native chain units, precompile values human-readable x 1e18.
 return {priceTick:scaleChainDecimal(m.priceTickChain,18+m.baseDecimals-m.quoteDecimals),quantityTick:scaleChainDecimal(m.quantityTickChain,18-m.baseDecimals),minimumNotional:scaleChainDecimal(m.minimumNotionalChain,18-m.quoteDecimals),feeRate:scaleChainDecimal(m.takerFeeRate,18)};
}
/** Convert chain price ticks to a human decimal without float math or rounding. */
export function formatSpotPrice(chainPrice: string, market: Pick<SpotMarketObservation,'baseDecimals'|'quoteDecimals'>): string {
 const scaled=BigInt(scaleChainDecimal(chainPrice,18+market.baseDecimals-market.quoteDecimals));
 const whole=scaled/10n**18n, fraction=(scaled%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');
 return fraction?`${whole}.${fraction}`:whole.toString();
}
export type Fetcher = (input:string,init?:RequestInit)=>Promise<Response>;
export class InjectiveReadAdapter {
 constructor(private readonly fetcher:Fetcher=fetch,private readonly now:()=>number=Date.now){}
 private async json(url:string,init?:RequestInit):Promise<unknown>{
  const response=await this.fetcher(url,{...init,signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error(`UPSTREAM_HTTP_${response.status}`);
  const body=await response.text();if(body.length>4_000_000)throw Error('UPSTREAM_TOO_LARGE');return JSON.parse(body) as unknown;
 }
 private async rpc(method:string,params:unknown[]):Promise<unknown>{
  const value=await this.json(TESTNET_RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}) as Record<string,unknown>;
  if(value?.jsonrpc!=='2.0'||value.id!==1||value.error||!Object.hasOwn(value,'result'))throw Error('INVALID_RPC_RESPONSE');return value.result;
 }
 async snapshot(requestedMarketId?:string):Promise<LiveSnapshot>{
  if(requestedMarketId!==undefined&&(!bytes32.test(requestedMarketId)||/^0x0{64}$/i.test(requestedMarketId)))throw Error('INVALID_MARKET_ID');
  const chain=await this.rpc('eth_chainId',[]);if(typeof chain!=='string'||!hex.test(chain)||BigInt(chain)!==1439n)throw Error('WRONG_NETWORK');
  const block=await this.rpc('eth_getBlockByNumber',['latest',false]) as Record<string,unknown>;
  if(!block||typeof block.number!=='string'||!hex.test(block.number)||typeof block.hash!=='string'||!bytes32.test(block.hash)||typeof block.timestamp!=='string'||!hex.test(block.timestamp))throw Error('INVALID_BLOCK');
  const timestamp=BigInt(block.timestamp), now=BigInt(Math.floor(this.now()/1000));if(timestamp>now+30n||timestamp+120n<now)throw Error('STALE_NETWORK');
  const marketSource=`${TESTNET_LCD}/injective/exchange/v1beta1/spot/markets`;
  const spotTopOfBookSource=`${TESTNET_LCD}/injective/exchange/v1beta1/spot/mid_price_and_tob`;
  const spotOrderbookSource=`${TESTNET_INDEXER_GRPC_WEB}${SPOT_ORDERBOOKS_V2_METHOD}`;
  const derivativeSource=`${TESTNET_LCD}/injective/exchange/v1beta1/derivative/markets`;
  const chainSource=`${TESTNET_LCD}/cosmos/base/tendermint/v1beta1/node_info`;
  const [evmClientVersion,chainInfo,spotResponse,derivativeResponse]=await Promise.all([
   this.rpc('web3_clientVersion',[]),
   this.json(chainSource) as Promise<Record<string,unknown>>,
   this.json(marketSource) as Promise<Record<string,unknown>>,
   this.json(derivativeSource) as Promise<Record<string,unknown>>
  ]);
  const nodeInfo=chainInfo?.default_node_info;
  if(!nodeInfo||typeof nodeInfo!=='object'||(nodeInfo as Record<string,unknown>).network!=='injective-888')throw Error('WRONG_COSMOS_NETWORK');
  if(typeof evmClientVersion!=='string'||evmClientVersion.trim().length===0||evmClientVersion.length>256)throw Error('INVALID_EVM_CLIENT_VERSION');
  const appInfo=chainInfo.application_version;
  if(!appInfo||typeof appInfo!=='object'||Array.isArray(appInfo))throw Error('INVALID_APPLICATION_VERSION');
  const app=appInfo as Record<string,unknown>;
  const appString=(key:string)=>{const value=string(app,key);if(!value.trim())throw Error(`INVALID_APPLICATION_VERSION_${key}`);return value;};
  const tendermintNodeVersion=string(nodeInfo as Record<string,unknown>,'version');
  if(tendermintNodeVersion.trim().length===0)throw Error('INVALID_TENDERMINT_NODE_VERSION');
  const software:EndpointSoftwareObservation=Object.freeze({
   evmClientVersion,
   tendermintNodeVersion,
   injectiveAppName:appString('app_name'),
   injectiveAppVersion:appString('version'),
   injectiveGitCommit:appString('git_commit'),
   cosmosSdkVersion:appString('cosmos_sdk_version'),
   consistency:'UNPINNED_ENDPOINT_REPORTS'
  });
  if(!Array.isArray(spotResponse?.markets))throw Error('INVALID_MARKETS_RESPONSE');
  const candidates=spotResponse.markets.filter((m:Record<string,unknown>)=>m?.status==='Active'&&(requestedMarketId?typeof m.market_id==='string'&&m.market_id.toLowerCase()===requestedMarketId.toLowerCase():m?.ticker==='INJ/USDT'));if(candidates.length!==1)throw Error('AMBIGUOUS_OR_MISSING_MARKET');
  const market=parseSpotMarket(candidates[0]);marketApiTicks(market);
  let spotTopOfBook:SpotTopOfBookObservation|null=null;
  try{const rawTopOfBook=await this.json(`${spotTopOfBookSource}/${market.marketId}`);spotTopOfBook=parseSpotTopOfBook(rawTopOfBook,market.marketId);}catch{/* Market metadata remains true; unavailable quote data remains UNKNOWN. */}
  let spotOrderbook:SpotOrderbookObservation|null=null;
  try{spotOrderbook=await fetchSpotOrderbookV2(this.fetcher,market.marketId,this.now,50);}catch{/* Indexer failure must not substitute for depth or market-risk evidence. */}
  if(!Array.isArray(derivativeResponse?.markets))throw Error('INVALID_DERIVATIVE_MARKETS_RESPONSE');
  const derivativeCandidates=derivativeResponse.markets.filter((m:Record<string,unknown>)=>{
   const nested=m?.market;
   return nested&&typeof nested==='object'&&(nested as Record<string,unknown>).ticker==='ETH/USDC PERP'&&(nested as Record<string,unknown>).status==='Active';
  });
  if(derivativeCandidates.length>1)throw Error('AMBIGUOUS_DERIVATIVE_MARKET');
  const derivativeMarket=derivativeCandidates.length===1?parseDerivativeMarket(derivativeCandidates[0]):null;
  return Object.freeze({status:'LIVE_READ_ONLY',chainId:'1439',cosmosChainId:'injective-888',blockNumber:BigInt(block.number).toString(),blockHash:block.hash.toLowerCase(),blockTimestamp:timestamp.toString(),observedAt:new Date(this.now()).toISOString(),marketSource,spotTopOfBookSource,spotTopOfBook,spotOrderbookSource,spotOrderbook,derivativeSource,chainSource,rpcSource:TESTNET_RPC,market,derivativeMarket,endpointSoftware:software,marketConsistency:'UNPINNED_LCD_READ',execution:'NOT_IMPLEMENTED'});
 }
 /** Exact read-only Exchange precompile query from pinned Operation 50 ABI evidence. */
 async exchangeSubaccountDeposit(subaccountId:string,denom:string):Promise<{
  readonly status:'LIVE_READ_ONLY'; readonly authorized:false; readonly execution:'NOT_IMPLEMENTED';
  readonly subaccountId:string; readonly denom:string; readonly availableBalanceChain:string; readonly totalBalanceChain:string; readonly lockedBalanceChain:string;
  readonly blockNumber:string; readonly blockHash:string; readonly observedAt:string;
  readonly source:string; readonly consistency:'UNPINNED_PRECOMPILE_VIEW';
 }>{
  if(!/^0x[0-9a-fA-F]{64}$/.test(subaccountId)||/^0x0{64}$/i.test(subaccountId))throw Error('INVALID_SUBACCOUNT_ID');
  if(typeof denom!=='string'||denom.length<1||denom.length>128||!/^[a-zA-Z][a-zA-Z0-9/:._-]*$/.test(denom))throw Error('INVALID_DENOM');
  const chain=await this.rpc('eth_chainId',[]);if(chain!=='0x59f')throw Error('WRONG_NETWORK');
  const block=await this.rpc('eth_getBlockByNumber',['latest',false]) as Record<string,unknown>;
  if(!block||typeof block.number!=='string'||!hex.test(block.number)||typeof block.hash!=='string'||!bytes32.test(block.hash)||typeof block.timestamp!=='string'||!hex.test(block.timestamp))throw Error('INVALID_BLOCK');
  const blockTimestamp=BigInt(block.timestamp),now=BigInt(Math.floor(this.now()/1000));if(blockTimestamp>now+30n||blockTimestamp+120n<now)throw Error('STALE_NETWORK');
  const data=exchangeReadAbi.encodeFunctionData('subaccountDeposit',[subaccountId.toLowerCase(),denom]);
  const result=await this.rpc('eth_call',[{to:EXCHANGE_PRECOMPILE,data},block.number]);
  if(typeof result!=='string'||!/^0x[0-9a-fA-F]{128}$/.test(result))throw Error('INVALID_EXCHANGE_BALANCE_RESPONSE');
  const [available,total]=exchangeReadAbi.decodeFunctionResult('subaccountDeposit',result);
  const availableBalance=available as bigint,totalBalance=total as bigint;if(availableBalance>totalBalance)throw Error('INVALID_EXCHANGE_BALANCE');
  return Object.freeze({status:'LIVE_READ_ONLY',authorized:false,execution:'NOT_IMPLEMENTED',subaccountId:subaccountId.toLowerCase(),denom,availableBalanceChain:availableBalance.toString(),totalBalanceChain:totalBalance.toString(),lockedBalanceChain:(totalBalance-availableBalance).toString(),blockNumber:BigInt(block.number).toString(),blockHash:block.hash.toLowerCase(),observedAt:new Date(this.now()).toISOString(),source:TESTNET_RPC,consistency:'UNPINNED_PRECOMPILE_VIEW'});
 }
 async account(address:string):Promise<{balanceWei:string;source:string;scope:'TESTNET_EVM_NATIVE_BALANCE_ONLY'}>{
  if(!/^0x[0-9a-fA-F]{40}$/.test(address))throw Error('INVALID_ADDRESS');
  const chain=await this.rpc('eth_chainId',[]);if(chain!=='0x59f')throw Error('WRONG_NETWORK');
  const balance=await this.rpc('eth_getBalance',[address,'latest']);if(typeof balance!=='string'||!hex.test(balance))throw Error('INVALID_BALANCE');
  return {balanceWei:BigInt(balance).toString(),source:TESTNET_RPC,scope:'TESTNET_EVM_NATIVE_BALANCE_ONLY'};
 }
}
