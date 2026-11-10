import {describe,it,expect} from 'vitest';
import {AbiCoder} from 'ethers';
import {EXCHANGE_PRECOMPILE,InjectiveReadAdapter,TESTNET_LCD,TESTNET_RPC,formatSpotPrice,marketApiTicks,parseDerivativeMarket,parseSpotMarket,parseSpotTopOfBook,scaleChainDecimal,type Fetcher} from '../packages/domain/src/live-injective';
const raw={market_id:'0x'+'12'.repeat(32),ticker:'INJ/USDT',status:'Active',base_denom:'inj',quote_denom:'test-usdt',base_decimals:18,quote_decimals:6,min_price_tick_size:'0.000000000000001',min_quantity_tick_size:'1000000000000000',min_notional:'1000000',taker_fee_rate:'0.0005'};
const derivativeRaw={market:{market_id:'0x'+'56'.repeat(32),ticker:'ETH/USDC PERP',status:'Active',quote_denom:'usdc',oracle_type:'ChainlinkDataStreams',oracle_base:'0x'+'01'.repeat(32),oracle_quote:'0x'+'02'.repeat(32),oracle_scale_factor:6,min_price_tick_size:'100000',min_quantity_tick_size:'0.0001',initial_margin_ratio:'0.019231',maintenance_margin_ratio:'0.01',taker_fee_rate:'0.0005'},mark_price:'2243377856.164794606867'};
const now=1800000000000;
const stub=(change:Record<string,unknown>={}):Fetcher=>async(input,init)=>{
 if(!init?.body){if(input.includes('node_info'))return Response.json({default_node_info:{network:'injective-888',version:'0.38.0'},application_version:{app_name:'injectived',version:'v1.20.4-bl.2',git_commit:'1ffa252',cosmos_sdk_version:'v0.50.15-inj.1'}});if(input.includes('derivative/markets'))return Response.json({markets:[derivativeRaw]});if(input.includes('spot/mid_price_and_tob'))return Response.json({mid_price:'0.000000000005963000',best_buy_price:'0.000000000004704000',best_sell_price:'0.000000000007222000'});return Response.json({markets:[raw]});}
 const {method}=JSON.parse(String(init.body));const results:Record<string,unknown>={eth_chainId:'0x59f',web3_clientVersion:'evm-gateway/v1.4.2-hotfix.4',eth_getBlockByNumber:{number:'0x123',hash:'0x'+'34'.repeat(32),timestamp:'0x'+(now/1000).toString(16)},...change};return Response.json({jsonrpc:'2.0',id:1,result:results[method]});
};
describe('authoritative read-only testnet adapter',()=>{
 it('uses the official published Injective Testnet EVM and LCD endpoints',()=>{expect(TESTNET_RPC).toBe('https://k8s.testnet.json-rpc.injective.network/');expect(TESTNET_LCD).toBe('https://testnet.sentry.lcd.injective.network');});
 it('converts native ticks without floating point and no rounding',()=>{expect(marketApiTicks(parseSpotMarket(raw))).toEqual({priceTick:'1000000000000000',quantityTick:'1000000000000000',minimumNotional:'1000000000000000000',feeRate:'500000000000000'});expect(()=>scaleChainDecimal('0.1',0)).toThrow('UNREPRESENTABLE');});
 it('parses and displays live spot mid and best prices without float rounding',()=>{const top=parseSpotTopOfBook({mid_price:'0.000000000005963000',best_buy_price:'0.000000000004704000',best_sell_price:'0.000000000007222000'},raw.market_id);expect(formatSpotPrice(top.midPriceChain,parseSpotMarket(raw))).toBe('5.963');expect(formatSpotPrice(top.bestBuyPriceChain,parseSpotMarket(raw))).toBe('4.704');expect(formatSpotPrice(top.bestSellPriceChain,parseSpotMarket(raw))).toBe('7.222');expect(()=>parseSpotTopOfBook({mid_price:'NaN',best_buy_price:'1',best_sell_price:'2'},raw.market_id)).toThrow('INVALID_SPOT_PRICE');});
 it('parses active derivative market metadata and rejects malformed risk fields',()=>{expect(parseDerivativeMarket(derivativeRaw)).toMatchObject({ticker:'ETH/USDC PERP',status:'Active',markPrice:'2243377856.164794606867',initialMarginRatio:'0.019231',oracleScaleFactor:6});expect(()=>parseDerivativeMarket({...derivativeRaw,mark_price:'NaN'})).toThrow('INVALID_DERIVATIVE_MARKET_DECIMAL');expect(()=>parseDerivativeMarket({market:{...derivativeRaw.market,maintenance_margin_ratio:'1e2'},mark_price:'2'})).toThrow('INVALID_DERIVATIVE_MARKET_DECIMAL');});
 it('returns independently sourced spot and derivative observations with honest consistency limits',async()=>{const s=await new InjectiveReadAdapter(stub(),()=>now).snapshot();expect(s.chainId).toBe('1439');expect(s.cosmosChainId).toBe('injective-888');expect(s.execution).toBe('NOT_IMPLEMENTED');expect(s.marketConsistency).toBe('UNPINNED_LCD_READ');expect(s.endpointSoftware).toMatchObject({evmClientVersion:'evm-gateway/v1.4.2-hotfix.4',tendermintNodeVersion:'0.38.0',injectiveAppVersion:'v1.20.4-bl.2',injectiveGitCommit:'1ffa252',consistency:'UNPINNED_ENDPOINT_REPORTS'});expect(s.blockNumber).toBe('291');expect(s.market.ticker).toBe('INJ/USDT');expect(s.spotTopOfBook?.midPriceChain).toBe('0.000000000005963000');expect(s.derivativeMarket?.ticker).toBe('ETH/USDC PERP');expect(s.chainSource).toContain('node_info');});
 it('selects only the server-pinned active market ID instead of silently substituting INJ/USDT',async()=>{
  const usdc={...raw,market_id:'0x'+'99'.repeat(32),ticker:'INJ/USDC',quote_denom:'factory/inj1example/usdc'};
  const base=stub(),fetcher:Fetcher=async(input,init)=>{
   if(!init?.body&&input.endsWith('/injective/exchange/v1beta1/spot/markets'))return Response.json({markets:[raw,usdc]});
   return base(input,init);
  };
  const selected=await new InjectiveReadAdapter(fetcher,()=>now).snapshot(usdc.market_id);
  expect(selected.market).toMatchObject({marketId:usdc.market_id,ticker:'INJ/USDC',quoteDenom:usdc.quote_denom,status:'Active'});
  await expect(new InjectiveReadAdapter(fetcher,()=>now).snapshot('0x'+'88'.repeat(32))).rejects.toThrow('AMBIGUOUS_OR_MISSING_MARKET');
  await expect(new InjectiveReadAdapter(fetcher,()=>now).snapshot('bad-market')).rejects.toThrow('INVALID_MARKET_ID');
 });
 it('keeps quote data UNKNOWN if the public top-of-book endpoint is unavailable',async()=>{const base=stub(),fetcher:Fetcher=async(input,init)=>input.includes('spot/mid_price_and_tob')?new Response('',{status:503}):base(input,init);const s=await new InjectiveReadAdapter(fetcher,()=>now).snapshot();expect(s.market.ticker).toBe('INJ/USDT');expect(s.spotTopOfBook).toBeNull();});
 it('refuses a mismatched Cosmos chain even when the EVM chain id matches',async()=>{const fetcher:Fetcher=async(input,init)=>{if(!init?.body)return Response.json(input.includes('node_info')?{default_node_info:{network:'injective-1'}}:input.includes('derivative')?{markets:[derivativeRaw]}:{markets:[raw]});return stub()(input,init);};await expect(new InjectiveReadAdapter(fetcher,()=>now).snapshot()).rejects.toThrow('WRONG_COSMOS_NETWORK');});
 it('fails closed if endpoint software versions are unavailable or malformed',async()=>{await expect(new InjectiveReadAdapter(stub({web3_clientVersion:null}),()=>now).snapshot()).rejects.toThrow('INVALID_EVM_CLIENT_VERSION');await expect(new InjectiveReadAdapter(stub({web3_clientVersion:'   '}),()=>now).snapshot()).rejects.toThrow('INVALID_EVM_CLIENT_VERSION');const base=stub(),emptyNode:Fetcher=async(input,init)=>input.includes('node_info')?Response.json({default_node_info:{network:'injective-888',version:'  '},application_version:{app_name:'injectived',version:'v1',git_commit:'abc',cosmos_sdk_version:'sdk'}}):base(input,init);await expect(new InjectiveReadAdapter(emptyNode,()=>now).snapshot()).rejects.toThrow('INVALID_TENDERMINT_NODE_VERSION');const emptyApp:Fetcher=async(input,init)=>input.includes('node_info')?Response.json({default_node_info:{network:'injective-888',version:'1.0.1'},application_version:{app_name:'injectived',version:'',git_commit:'abc',cosmos_sdk_version:'sdk'}}):base(input,init);await expect(new InjectiveReadAdapter(emptyApp,()=>now).snapshot()).rejects.toThrow('INVALID_APPLICATION_VERSION_version');});
 it('refuses wrong network',async()=>{await expect(new InjectiveReadAdapter(stub({eth_chainId:'0x1'}),()=>now).snapshot()).rejects.toThrow('WRONG_NETWORK');});
 it('refuses stale blocks',async()=>{await expect(new InjectiveReadAdapter(stub({eth_getBlockByNumber:{number:'0x1',hash:'0x'+'34'.repeat(32),timestamp:'0x1'}}),()=>now).snapshot()).rejects.toThrow('STALE');});
 it.each(['NaN','1e3','-1','+2','0x12','1.','01.0'])('rejects malformed decimal %s',v=>{expect(()=>parseSpotMarket({...raw,min_price_tick_size:v})).toThrow();});
 it('rejects inactive, zero ticks and unsupported precision',()=>{for(const patch of [{status:'Paused'},{min_price_tick_size:'0'},{base_decimals:19}])expect(()=>parseSpotMarket({...raw,...patch})).toThrow();});
 it('propagates unavailable upstream without fallback fixture',async()=>{await expect(new InjectiveReadAdapter(async()=>new Response('',{status:503})).snapshot()).rejects.toThrow('503');});
 it('reads pinned Direct subaccount deposit at a fixed Testnet EVM block without authorizing actions',async()=>{
  const calls:Array<{method:string;params:unknown[]}> = [];
  const fetcher:Fetcher=async(_input,init)=>{
   const request=JSON.parse(String(init?.body)) as {method:string;params:unknown[]};calls.push(request);
   const result=request.method==='eth_chainId'?'0x59f':request.method==='eth_getBlockByNumber'?{number:'0x123',hash:'0x'+'34'.repeat(32),timestamp:'0x'+(now/1000).toString(16)}:request.method==='eth_call'?AbiCoder.defaultAbiCoder().encode(['uint256','uint256'],[123n,456n]):null;
   return Response.json({jsonrpc:'2.0',id:1,result});
  };
  const view=await new InjectiveReadAdapter(fetcher,()=>now).exchangeSubaccountDeposit('0x'+'11'.repeat(20)+'0'.repeat(24),'usdt');
  expect(view).toMatchObject({status:'LIVE_READ_ONLY',authorized:false,execution:'NOT_IMPLEMENTED',denom:'usdt',availableBalanceChain:'123',totalBalanceChain:'456',lockedBalanceChain:'333',blockNumber:'291',blockHash:'0x'+'34'.repeat(32),consistency:'UNPINNED_PRECOMPILE_VIEW'});
  expect(calls[2]?.method).toBe('eth_call');
  expect(calls[2]?.params[0]).toMatchObject({to:EXCHANGE_PRECOMPILE});
  expect(calls[2]?.params[1]).toBe('0x123');
 });
 it('rejects malformed Exchange balance state and wrong network',async()=>{
  const wrong=stub({eth_chainId:'0x1'});await expect(new InjectiveReadAdapter(wrong,()=>now).exchangeSubaccountDeposit('0x'+'11'.repeat(20)+'0'.repeat(24),'usdt')).rejects.toThrow('WRONG_NETWORK');
  const malformed:Fetcher=async(_input,init)=>{const {method}=JSON.parse(String(init?.body));const result=method==='eth_chainId'?'0x59f':method==='eth_getBlockByNumber'?{number:'0x123',hash:'0x'+'34'.repeat(32),timestamp:'0x'+(now/1000).toString(16)}:'0x'+'00'.repeat(32);return Response.json({jsonrpc:'2.0',id:1,result});};
  await expect(new InjectiveReadAdapter(malformed,()=>now).exchangeSubaccountDeposit('0x'+'11'.repeat(20)+'0'.repeat(24),'usdt')).rejects.toThrow('INVALID_EXCHANGE_BALANCE_RESPONSE');
 });
});
