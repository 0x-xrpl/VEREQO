// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {FinancialWorkflow} from '../apps/web/src/components/FinancialWorkflow';
import {uiG3Evidence} from './support/ui-g3-evidence';
import {readSavedRehearsal} from '../apps/web/src/components/ScenarioRehearsal';
import type {RehearsalResult,RehearsalView} from '../packages/domain/src/rehearsal';
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason?:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};}
function rehearsalScenario(scenarioId:string):RehearsalView{
 const hasIntent=scenarioId==='S01-eligible-request';
 return{scenarioId,title:'Synthetic rehearsal fixture',category:'TEST_FIXTURE',businessQuestion:'Does the UI preserve the exact rehearsal identity?',dataClass:'SYNTHETIC_REHEARSAL',source:'PORTABLE_KIT_V1',businessId:'fi_'+'a'.repeat(32),revision:1,intent:hasIntent?{intentId:'intent-A01',principalId:'principal-operator-01',agentId:'agent-external-A',issuerId:'issuer-demo-01',credentialId:'credential-A',mandateId:'mandate-order-A01',marketSymbol:'INJ/USDT',side:'BUY',orderType:'LIMIT',quantity:'40',limitPrice:'12',units:'INJ, USDT/INJ',notionalQuote:'480',source:'SYNTHETIC_FIXTURE'}:null,facts:{targetChainId:1439,verifiedOnChain:false,chainStatus:'NOT_EXECUTED',marketId:null,orderHash:null,agentAIntents:'intent-A01',agentBIntents:'intent-B01',openOrderState:'UNKNOWN_NOT_CHAIN_VERIFIED'},operatorActions:['LOAD_INTENT'],evidenceState:'NO_RECORD'};
}
function graphResult(scenario:RehearsalView):RehearsalResult{return{scenarioId:scenario.scenarioId,businessId:scenario.businessId,revision:scenario.revision,source:'LOCAL_VERIFIED_GRAPH',decision:'WHAT_IF_ONLY',reason:'PREVIEW_DID_NOT_COMMIT',authorized:false,execution:'NOT_IMPLEMENTED',proofStatus:'NOT_PROVIDED',evidenceState:'NO_RECORD',facts:{graphSequenceBefore:0,graphSequenceAfter:0,previewSequence:1,agentAIntent:'BLOCKED',agentAAction:'BLOCKED',agentBIntent:'VALID',agentBAction:'VALID',existingOrder:'UNKNOWN_NOT_CHAIN_VERIFIED'}};}
let host:HTMLDivElement,root:Root;
const testSession='a'.repeat(64);
beforeEach(()=>{sessionStorage.clear();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();sessionStorage.clear();vi.unstubAllGlobals();vi.useRealTimers();});
const click=async(selector:string)=>{await act(async()=>{host.querySelector<HTMLButtonElement>(selector)!.click();});};
const prepareAndSignWallet=async()=>{await click('[data-testid="wallet-auth-prepare"]');await click('[data-testid="wallet-auth-sign"]');};
function authChallenge(address:string,origin=window.location.origin,now=Math.floor(Date.now()/1000)){
 return{domain:{name:'VEREQO Authentication',version:'1',chainId:'1439'},types:{WalletAuthentication:[{name:'address',type:'address'},{name:'origin',type:'string'},{name:'nonce',type:'bytes32'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'}]},value:{address,origin,nonce:'0x'+'12'.repeat(32),issuedAt:String(now),expiresAt:String(now+120)}};
}
describe('truthful selected financial inspection',()=>{
 it('performs no network request or wallet action on mount',async()=>{const request=vi.fn(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);vi.stubGlobal('ethereum',{request});await act(async()=>root.render(<FinancialWorkflow language="en"/>));expect(fetch).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();expect(host.textContent).toContain('NOT_CONFIGURED');expect(host.textContent).toContain('OWNERSHIP NOT AUTHENTICATED');});
 it('previews the server EIP-712 challenge before signing and displays verified session origin and expiry',async()=>{
  const address='0x1111111111111111111111111111111111111111',now=Math.floor(Date.now()/1000),nonce='0x'+'12'.repeat(32),expiresAt=now+120,sessionExpiry=now+600;
  const challenge={domain:{name:'VEREQO Authentication',version:'1',chainId:'1439'},types:{WalletAuthentication:[{name:'address',type:'address'},{name:'origin',type:'string'},{name:'nonce',type:'bytes32'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'}]},value:{address,origin:window.location.origin,nonce,issuedAt:String(now),expiresAt:String(expiresAt)}};
  const providerMethods:string[]=[],provider={request:vi.fn(async({method,params}:{method:string;params?:unknown[]})=>{providerMethods.push(method);if(method==='eth_chainId')return '0x59f';if(method==='eth_requestAccounts'||method==='eth_accounts')return[address];if(method==='eth_signTypedData_v4'){const payload=JSON.parse(String(params?.[1]));expect(payload.primaryType).toBe('WalletAuthentication');expect(payload.message).toMatchObject({address,origin:window.location.origin,nonce});return '0x'+'ab'.repeat(65);}throw Error('UNEXPECTED_WALLET_METHOD');}),on:vi.fn(),removeListener:vi.fn()};
  const fetcher=vi.fn(async(url:string)=>{if(url==='/api/wallet/challenge')return Response.json({challenge});if(url==='/api/wallet/verify')return Response.json({session:'a'.repeat(64)});if(url==='/api/wallet/status')return Response.json({session:{address,origin:window.location.origin,expiresAt:sessionExpiry}});if(url==='/api/wallet/logout')return Response.json({status:'DISCONNECTED'});throw Error('UNEXPECTED_FETCH '+url);});
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');expect(fetcher).not.toHaveBeenCalled();
  await click('[data-testid="wallet-auth-prepare"]');
  expect(providerMethods).not.toContain('eth_signTypedData_v4');
  expect(host.querySelector('[data-testid="wallet-auth-challenge"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="wallet-challenge-chain"]')?.textContent).toBe('1439');
  expect(host.querySelector('[data-testid="wallet-challenge-address"]')?.textContent).toBe(address);
  expect(host.querySelector('[data-testid="wallet-challenge-origin"]')?.textContent).toBe(window.location.origin);
  expect(host.querySelector('[data-testid="wallet-challenge-nonce"]')?.textContent).toBe(nonce);
  expect(host.textContent).toContain('cannot move funds, approve, grant, or place an order');
  await click('[data-testid="wallet-auth-sign"]');
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/api/wallet/challenge','/api/wallet/verify','/api/wallet/status']);
  expect(providerMethods.filter(method=>method==='eth_signTypedData_v4')).toHaveLength(1);
  expect(host.querySelector('[data-testid="wallet-auth-challenge"]')).toBeNull();
  const serverSession=host.querySelector<HTMLElement>('[data-testid="wallet-server-session"]')!;
  expect(serverSession.dataset.origin).toBe(window.location.origin);expect(Number(serverSession.dataset.expiresAt)).toBe(sessionExpiry);
  expect(host.querySelector('[data-testid="wallet-session-origin"]')?.textContent).toBe(window.location.origin);
  expect(host.querySelector('[data-testid="wallet-session-expiry"]')?.getAttribute('dateTime')).toBe(new Date(sessionExpiry*1000).toISOString());
  expect(host.querySelector('[data-testid="financial-wallet-state"]')?.getAttribute('data-execution-authorized')).toBe('false');
  expect(providerMethods.some(method=>/sendTransaction|wallet_send|approve|grant/i.test(method))).toBe(false);
 });
 it('classifies a rejected challenge fetch and performs only a secret-free same-origin status probe',async()=>{
  const address='0x1111111111111111111111111111111111111111';
  const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x59f':[address]),on:vi.fn(),removeListener:vi.fn()};
  const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
   if(url==='/api/wallet/challenge')throw new TypeError('sensitive browser transport details');
   if(url==='/api/wallet/status'){
    const correlation=new Headers(init?.headers).get('x-vereqo-auth-correlation')??'';
    return Response.json({session:null},{headers:{'x-vereqo-auth-stage':'SESSION_STATUS_EMPTY','x-vereqo-auth-instance':'instance-redacted','x-vereqo-auth-correlation':correlation}});
   }
   throw Error('UNEXPECTED_FETCH');
  });
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');await click('[data-testid="wallet-auth-prepare"]');
  expect(host.querySelector('[data-testid="wallet-auth-error"]')?.getAttribute('data-code')).toBe('CHALLENGE_NETWORK_ERROR');
  expect(fetcher.mock.calls.map(([url])=>url)).toEqual(['/api/wallet/challenge','/api/wallet/status']);
  const trace=host.querySelector('[data-testid="wallet-auth-diagnostics"]')!.textContent!;
  expect(trace).toContain(`CHALLENGE_FETCH_REJECTED name=TypeError http=NONE url=${window.location.origin}/api/wallet/challenge`);
  expect(trace).toContain('CHALLENGE_DIAGNOSTIC_PROBE_HTTP_200');
  expect(trace).toContain('CHALLENGE_DIAGNOSTIC_PROBE_SERVER_STAGE_SESSION_STATUS_EMPTY');
  expect(trace).toContain('CHALLENGE_DIAGNOSTIC_PROBE_CORRELATION_MATCH');
  expect(trace).not.toContain('sensitive browser transport details');expect(trace).not.toContain(address);
  expect(provider.request.mock.calls.some(([args])=>args.method==='eth_signTypedData_v4')).toBe(false);
  expect(host.querySelector('[data-testid="execution-authorization-state"]')?.textContent).toContain('NOT APPROVED');
 });
 it('classifies MetaMask signature rejection without exposing provider error text or calling verify',async()=>{
  const address='0x1111111111111111111111111111111111111111',challenge=authChallenge(address);
  const provider={request:vi.fn(async({method}:{method:string})=>{if(method==='eth_chainId')return '0x59f';if(method==='eth_requestAccounts'||method==='eth_accounts')return[address];if(method==='eth_signTypedData_v4')throw Object.assign(Error('sensitive provider details'),{code:4001});throw Error('UNEXPECTED_WALLET_METHOD');}),on:vi.fn(),removeListener:vi.fn()};
  const fetcher=vi.fn(async(url:string)=>url==='/api/wallet/challenge'?Response.json({challenge}):new Response('{}',{status:404}));
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');await click('[data-testid="wallet-auth-prepare"]');await click('[data-testid="wallet-auth-sign"]');
  expect(host.querySelector('[data-testid="wallet-auth-error"]')?.getAttribute('data-code')).toBe('WALLET_SIGNATURE_REJECTED');
  expect(host.textContent).not.toContain('sensitive provider details');expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/api/wallet/challenge']);
  expect(host.querySelector('[data-testid="financial-wallet-state"]')?.getAttribute('data-execution-authorized')).toBe('false');
 });
 it('classifies server EIP-712 rejection at verify and never requests status',async()=>{
  const address='0x1111111111111111111111111111111111111111',challenge=authChallenge(address);
  const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x59f':method==='eth_signTypedData_v4'?'0x'+'ab'.repeat(65):[address]),on:vi.fn(),removeListener:vi.fn()};
  const fetcher=vi.fn(async(url:string)=>url==='/api/wallet/challenge'?Response.json({challenge}):url==='/api/wallet/verify'?Response.json({error:'SIGNATURE_INVALID'},{status:401}):new Response('{}',{status:404}));
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');await click('[data-testid="wallet-auth-prepare"]');await click('[data-testid="wallet-auth-sign"]');
  expect(host.querySelector('[data-testid="wallet-auth-error"]')?.getAttribute('data-code')).toBe('VERIFY_SIGNATURE_INVALID');
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/api/wallet/challenge','/api/wallet/verify']);
  expect(host.querySelector('[data-testid="wallet-ownership-state"]')?.textContent).toContain('NOT AUTHENTICATED');
  expect(host.querySelector('[data-testid="execution-authorization-state"]')?.textContent).toContain('NOT APPROVED');
 });
 it.each([['CHALLENGE_EXPIRED',410],['CHALLENGE_ALREADY_USED',409],['CHALLENGE_UNKNOWN',404],['ORIGIN_MISMATCH',403]] as const)('reports verify-stage server failure %s without a session',async(code,status)=>{
  const address='0x1111111111111111111111111111111111111111',challenge=authChallenge(address);
  const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x59f':method==='eth_signTypedData_v4'?'0x'+'ab'.repeat(65):[address]),on:vi.fn(),removeListener:vi.fn()};
  const fetcher=vi.fn(async(url:string)=>url==='/api/wallet/challenge'?Response.json({challenge}):url==='/api/wallet/verify'?Response.json({error:code},{status}):new Response('{}',{status:404}));
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');await click('[data-testid="wallet-auth-prepare"]');await click('[data-testid="wallet-auth-sign"]');
  expect(host.querySelector('[data-testid=\"wallet-auth-error\"]')?.getAttribute('data-code')).toBe('VERIFY_'+code);
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/api/wallet/challenge','/api/wallet/verify']);
  expect(host.querySelector('[data-testid=\"wallet-ownership-state\"]')?.textContent).toContain('NOT AUTHENTICATED');
  expect(host.querySelector('[data-testid=\"execution-authorization-state\"]')?.textContent).toContain('NOT APPROVED');
 });
 it.each(['origin','chain','domain','types'] as const)('classifies invalid challenge %s before opening MetaMask',async(kind)=>{
  const address='0x1111111111111111111111111111111111111111',challenge=authChallenge(address),signedMethods:string[]=[];
  if(kind==='origin')challenge.value.origin='http://localhost:5173';
  if(kind==='chain')challenge.domain.chainId='1';
  if(kind==='domain')challenge.domain.name='Other Authentication';
  if(kind==='types')challenge.types.WalletAuthentication[0]!.type='string';
  const provider={request:vi.fn(async({method}:{method:string})=>{if(method==='eth_chainId')return '0x59f';if(method==='eth_requestAccounts'||method==='eth_accounts')return[address];signedMethods.push(method);throw Error('SIGNATURE MUST NOT BE REQUESTED');}),on:vi.fn(),removeListener:vi.fn()};
  const fetcher=vi.fn(async()=>Response.json({challenge}));vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));await click('[data-testid="financial-connect"]');await click('[data-testid="wallet-auth-prepare"]');
  const expected={origin:'CHALLENGE_ORIGIN_MISMATCH',chain:'CHALLENGE_CHAIN_MISMATCH',domain:'CHALLENGE_DOMAIN_MISMATCH',types:'CHALLENGE_TYPES_MISMATCH'}[kind];
  expect(host.querySelector('[data-testid="wallet-auth-error"]')?.getAttribute('data-code')).toBe(expected);
  expect(signedMethods).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('classifies server session Origin mismatch and revokes the unusable session',async()=>{
  const address='0x1111111111111111111111111111111111111111',challenge=authChallenge(address);
  const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x59f':method==='eth_signTypedData_v4'?'0x'+'ab'.repeat(65):[address]),on:vi.fn(),removeListener:vi.fn()};
  const fetcher=vi.fn(async(url:string)=>url==='/api/wallet/challenge'?Response.json({challenge}):url==='/api/wallet/verify'?Response.json({session:testSession}):url==='/api/wallet/status'?Response.json({session:{address,origin:'http://localhost:5173',expiresAt:Math.floor(Date.now()/1000)+60}}):url==='/api/wallet/logout'?Response.json({status:'DISCONNECTED'}):new Response('{}',{status:404}));
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');await click('[data-testid="wallet-auth-prepare"]');await click('[data-testid="wallet-auth-sign"]');
  expect(host.querySelector('[data-testid="wallet-auth-error"]')?.getAttribute('data-code')).toBe('STATUS_ORIGIN_MISMATCH');
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/api/wallet/challenge','/api/wallet/verify','/api/wallet/status','/api/wallet/logout']);
  expect(host.querySelector('[data-testid="wallet-ownership-state"]')?.textContent).toContain('NOT AUTHENTICATED');
  expect(host.querySelector('[data-testid="execution-authorization-state"]')?.textContent).toContain('NOT APPROVED');
 });
 it('progressively inspects same unobserved target and labels intermediate gate honestly',async()=>{await act(async()=>root.render(<FinancialWorkflow language="en"/>));await click('#financial-tab-4');expect(host.querySelector('[data-testid="financial-panel"]')?.textContent).toContain('NO EXECUTION');expect(host.textContent).toContain('not an exchange execution receipt');expect(host.querySelector('.financialTarget')?.textContent).toContain('UNOBSERVED');await click('#financial-tab-3');expect(host.textContent).toContain('LOCAL SIMULATION');await click('input[type="checkbox"]');expect(host.textContent).toContain('Public market observation: unaffected');});
 it('loads and replays S01 from the local service under one stable Business ID; trace says rehearsal NO_RECORD',async()=>{
  const businessId='fi_'+'a'.repeat(32),onTraceSelect=vi.fn();
  const scenario={scenarioId:'S01-eligible-request',title:'Agent proposes a bounded spot buy',category:'POSITIVE_BOUNDARY',businessQuestion:'Can this exact 40 INJ order be authorized without exposing the private ceiling?',dataClass:'SYNTHETIC_REHEARSAL',source:'PORTABLE_KIT_V1',businessId,revision:1,intent:{intentId:'intent-A01',principalId:'principal-operator-01',agentId:'agent-external-A',issuerId:'issuer-demo-01',credentialId:'credential-A',mandateId:'mandate-order-A01',marketSymbol:'INJ/USDT',side:'BUY',orderType:'LIMIT',quantity:'40',limitPrice:'12',units:'INJ, USDT/INJ',notionalQuote:'480',source:'SYNTHETIC_FIXTURE'},facts:{targetChainId:1439,verifiedOnChain:false,chainStatus:'NOT_EXECUTED',marketId:null,orderHash:null},operatorActions:['LOAD_INTENT'],evidenceState:'NO_RECORD'};
  const result={scenarioId:scenario.scenarioId,businessId,revision:1,source:'SYNTHETIC_SERVER_POLICY',decision:'WITHIN_SYNTHETIC_POLICY',reason:'POLICY_CHECK_ONLY_NOT_AUTHORIZATION',authorized:false,execution:'NOT_IMPLEMENTED',proofStatus:'NOT_PROVIDED',evidenceState:'NO_RECORD',facts:{notionalQuote:'480 USDT',policyBoundReturned:false,authority:'NOT_CONFIGURED'}};
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith('/api/demo/load')?Response.json({scenario}):String(input).endsWith('/api/demo/replay')?Response.json({result}):Response.json({error:'unexpected'}, {status:404}));
  const request=vi.fn();vi.stubGlobal('fetch',fetcher);vi.stubGlobal('ethereum',{request});
  await act(async()=>root.render(<FinancialWorkflow language="en" onTraceSelect={onTraceSelect}/>));
  expect(fetcher).not.toHaveBeenCalled();
  await click('[data-testid="rehearsal-load"]');
  expect(host.querySelector('[data-testid="scenario-rehearsal"]')?.getAttribute('data-business-id')).toBe(businessId);
  expect(host.querySelector('[data-testid="rehearsal-result"]')).toBeNull();
  expect(host.textContent).toContain('40 INJ · SYNTHETIC_FIXTURE');expect(host.textContent).toContain('480 USDT · fixture arithmetic');
  await click('[data-testid="rehearsal-replay"]');
  expect(host.querySelector('[data-testid="rehearsal-result"]')?.getAttribute('data-decision')).toBe('WITHIN_SYNTHETIC_POLICY');
  expect(host.textContent).toContain('NOT AUTHORIZED');expect(host.textContent).toContain('NOT_PROVIDED');expect(host.textContent).not.toContain('600 USDT');
  expect(readSavedRehearsal()?.businessId).toBe(businessId);
  await click('[data-testid="rehearsal-open-trace"]');
  expect(onTraceSelect).toHaveBeenCalledWith(expect.objectContaining({requestId:businessId,revision:1,marketId:null,evidenceState:'NO_RECORD',requestSource:'SYNTHETIC_REHEARSAL',evidenceSource:'REHEARSAL_NAMESPACE'}));
  expect(request).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.map(call=>String(call[0]))).toEqual(['/api/demo/load','/api/demo/replay']);
 });
 it('ignores a pending live market response after a rehearsal is loaded',async()=>{
  const pending=deferred<Response>(),scenario=rehearsalScenario('S01-eligible-request'),onTraceSelect=vi.fn();
  const snapshot={status:'LIVE_READ_ONLY',chainId:'1439',market:{ticker:'INJ/USDT',marketId:'0x'+'12'.repeat(32),baseDecimals:18,quoteDecimals:6,priceTickChain:'1',quantityTickChain:'1',minimumNotionalChain:'1',takerFeeRate:'0',status:'Active'}};
  const fetcher=vi.fn((input:RequestInfo|URL)=>String(input).endsWith('/api/financial/market')?pending.promise:String(input).endsWith('/api/demo/load')?Promise.resolve(Response.json({scenario})):Promise.resolve(new Response('{}',{status:404})));
  vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en" onTraceSelect={onTraceSelect}/>));
  await click('[data-testid="financial-read"]');
  expect(fetcher).toHaveBeenCalledWith('/api/financial/market');
  await click('[data-testid="rehearsal-load"]');
  expect(host.querySelector('[data-testid="financial-workflow"]')?.getAttribute('data-version')).toBe('1');
  await act(async()=>{pending.resolve(Response.json({snapshot}));await pending.promise;await Promise.resolve();});
  await click('[data-testid="rehearsal-open-trace"]');
  expect(onTraceSelect).toHaveBeenCalledWith(expect.objectContaining({requestId:scenario.businessId,revision:1,marketStatus:'UNKNOWN',blockNumber:null,observedAt:null,requestSource:'SYNTHETIC_REHEARSAL'}));
  expect(host.querySelector('[data-testid="financial-workflow"]')?.getAttribute('data-version')).toBe('1');
 });
 it('cancels a pending wallet connection when entering rehearsal without issuing another provider request',async()=>{
  const accounts=deferred<unknown>(),scenario=rehearsalScenario('S01-eligible-request');
  const request=vi.fn(({method}:{method:string})=>method==='eth_requestAccounts'?accounts.promise:Promise.resolve('0x59f'));
  const fetcher=vi.fn((input:RequestInfo|URL)=>String(input).endsWith('/api/demo/load')?Promise.resolve(Response.json({scenario})):Promise.resolve(new Response('{}',{status:404})));
  vi.stubGlobal('ethereum',{request});vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0].method).toBe('eth_requestAccounts');
  await click('[data-testid="rehearsal-load"]');
  await act(async()=>{accounts.resolve(['0x'+'12'.repeat(20)]);await accounts.promise;await Promise.resolve();});
  expect(request.mock.calls.map(call=>call[0].method)).toEqual(['eth_requestAccounts']);
  expect(host.querySelector('[data-testid="financial-wallet-state"]')?.getAttribute('data-wallet-connected')).toBe('false');expect(host.querySelector('[data-testid="financial-wallet-state"]')?.getAttribute('data-ownership-authenticated')).toBe('false');expect(host.querySelector('[data-testid="financial-wallet-state"]')?.getAttribute('data-execution-authorized')).toBe('false');
  expect(host.querySelector('[data-testid="financial-workflow"]')?.getAttribute('data-version')).toBe('1');
 });
 it('ignores wallet invalidation events inside the rehearsal namespace',async()=>{
  const scenario=rehearsalScenario('S01-eligible-request'),listeners=new Map<string,()=>void>();
  const provider={request:vi.fn(),on:vi.fn((event:string,listener:()=>void)=>listeners.set(event,listener)),removeListener:vi.fn()};
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({scenario})));
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="rehearsal-load"]');
  await click('#financial-tab-5');
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain('NO_REHEARSAL_EVENT');
  await act(async()=>listeners.get('accountsChanged')?.());
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain('NO_REHEARSAL_EVENT');
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).not.toContain('AUTHENTICATION_REQUIRED');
 });
 it.each(['response','error'] as const)('ignores a stale wallet evidence %s after entering rehearsal',async outcome=>{
  const address='0x1111111111111111111111111111111111111111',scenario=rehearsalScenario('S01-eligible-request'),pending=deferred<Response>();
  const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x59f':method==='eth_signTypedData_v4'?'0x'+'ab'.repeat(65):[address]),on:vi.fn(),removeListener:vi.fn()};
  const issuedAt=String(Math.floor(Date.now()/1000));
  const challenge={domain:{name:'VEREQO Authentication',version:'1',chainId:'1439'},types:{WalletAuthentication:[{name:'address',type:'address'},{name:'origin',type:'string'},{name:'nonce',type:'bytes32'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'}]},value:{address,nonce:'0x'+'12'.repeat(32),origin:window.location.origin,issuedAt,expiresAt:String(Number(issuedAt)+120)}};
  const fetcher=vi.fn((url:string)=>url.endsWith('/challenge')?Promise.resolve(Response.json({challenge})):url.endsWith('/verify')?Promise.resolve(Response.json({session:testSession})):url.endsWith('/status')?Promise.resolve(Response.json({session:{address,origin:window.location.origin,expiresAt:Math.floor(Date.now()/1000)+60}})):url.startsWith('/api/agent/authorization/')?pending.promise:url.endsWith('/api/demo/load')?Promise.resolve(Response.json({scenario})):Promise.resolve(Response.json({ok:true})));
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');
  const walletState=host.querySelector<HTMLElement>('[data-testid="financial-wallet-state"]')!;
  expect(walletState.dataset.walletConnected).toBe('true');
  expect(walletState.dataset.ownershipAuthenticated).toBe('false');
  expect(walletState.dataset.executionAuthorized).toBe('false');
  expect(host.querySelector('[data-testid="wallet-ownership-state"]')?.textContent).toContain('NOT AUTHENTICATED');
  expect(host.querySelector('[data-testid="execution-authorization-state"]')?.textContent).toContain('NOT APPROVED');
  await prepareAndSignWallet();
  expect(walletState.dataset.walletConnected).toBe('true');
  expect(walletState.dataset.ownershipAuthenticated).toBe('true');
  expect(walletState.dataset.executionAuthorized).toBe('false');
  expect(host.querySelector('[data-testid="execution-authorization-state"]')?.textContent).toContain('NOT APPROVED');
  await click('#financial-tab-5');
  const evidenceButton=host.querySelector<HTMLButtonElement>('[data-testid="financial-read-evidence"]')!;
  expect(evidenceButton.disabled).toBe(false);
  await click('[data-testid="financial-read-evidence"]');
  expect(host.querySelector<HTMLButtonElement>('[data-testid="financial-read-evidence"]')?.textContent).toContain('READING EVIDENCE');
  await click('[data-testid="rehearsal-load"]');
  await click('#financial-tab-5');
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain('NO_REHEARSAL_EVENT');
  await act(async()=>{
   if(outcome==='response')pending.resolve(Response.json({evidence:{},events:[]}));
   else pending.reject(Error('stale evidence request failed'));
   await new Promise(resolve=>setTimeout(resolve,0));
  });
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain('NO_REHEARSAL_EVENT');
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).not.toContain('AUTHENTICATION_REQUIRED');
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).not.toContain('EVIDENCE_UNKNOWN');
 });
 it('clears the shared S03 result before a failed replay retry',async()=>{
  const scenario=rehearsalScenario('S03-revocation-causality'),result=graphResult(scenario),onTraceSelect=vi.fn();
  let replayCount=0;
  const fetcher=vi.fn((input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.endsWith('/api/demo/load'))return Promise.resolve(Response.json({scenario}));
   if(url.endsWith('/api/demo/replay')){replayCount++;return Promise.resolve(replayCount===1?Response.json({result}):new Response('{}',{status:503}));}
   return Promise.resolve(new Response('{}',{status:404}));
  });
  vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en" onTraceSelect={onTraceSelect}/>));
  await click('[data-testid="rehearsal-load"]');await click('[data-testid="rehearsal-replay"]');
  expect(host.querySelector('[data-testid="rehearsal-result"]')?.getAttribute('data-decision')).toBe('WHAT_IF_ONLY');
  await click('[data-testid="rehearsal-replay"]');
  expect(host.querySelector('[data-testid="rehearsal-result"]')).toBeNull();
  expect(host.textContent).toContain('Replay result could not be verified');
  await click('[data-testid="rehearsal-open-trace"]');
  expect(onTraceSelect).toHaveBeenLastCalledWith(expect.objectContaining({requestId:scenario.businessId,revision:1,rehearsalDecision:null,rehearsalFacts:null,hypotheticalCredentialRevocation:false}));
 });
 it('keeps a loaded fixture at its declared revision when generic what-if is opened',async()=>{
  const scenario=rehearsalScenario('S03-revocation-causality'),fetcher=vi.fn(async()=>Response.json({scenario}));
  vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="rehearsal-load"]');await click('[data-testid="financial-what-if"]');
  const whatIf=host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(whatIf.disabled).toBe(true);
  await act(async()=>whatIf.click());
  expect(host.querySelector('[data-testid="financial-workflow"]')?.getAttribute('data-version')).toBe('1');
  expect(host.querySelector('[data-testid="scenario-rehearsal"]')?.getAttribute('data-revision')).toBe('1');
 });
 it('shows the exact EIP-712 binding boundary and keeps signing disabled without a configured Gate and issuer',async()=>{
  const request=vi.fn(async()=>{throw Error('unexpected provider request');}),fetcher=vi.fn();
  vi.stubGlobal('ethereum',{request});vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  const review=host.querySelector('[data-testid="financial-intent-review"]')!,sign=host.querySelector<HTMLButtonElement>('[data-testid="financial-intent-sign"]')!;
  expect(review.textContent).toContain('Verifying contract / order sender');
  expect(review.textContent).toContain('Nonce / deadline / exposure and fee limits');
  expect(review.textContent).toContain('NOT_CONFIGURED');
  expect(sign.disabled).toBe(true);
  await click('[data-testid="financial-intent-sign"]');
  expect(request).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  await act(async()=>root.render(<FinancialWorkflow language="ja"/>));
  expect(host.textContent).toContain('Intent署名を要求・利用不可');
  expect(host.querySelector<HTMLButtonElement>('[data-testid="financial-intent-sign"]')?.disabled).toBe(true);
 });
 it('uses one per-draft Business ID for request/evidence lookup and requires owner auth to read',async()=>{
  const fetcher=vi.fn(),request=vi.fn();vi.stubGlobal('fetch',fetcher);vi.stubGlobal('ethereum',{request});
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  const rootPanel=host.querySelector('[data-testid="financial-workflow"]')!,businessId=rootPanel.getAttribute('data-business-id')!;
  expect(businessId).toMatch(/^fi_[a-f0-9]{32}$/);expect(rootPanel.getAttribute('data-object-id')).toBe(businessId);
  expect(host.querySelector('[data-testid="financial-panel"]')?.getAttribute('data-business-id')).toBe(businessId);
  await click('#financial-tab-5');
  const evidence=host.querySelector('[data-testid="financial-business-evidence"]')!;
  expect(evidence.getAttribute('data-business-id')).toBe(businessId);
  expect(host.querySelector('[data-testid="financial-business-id"]')?.textContent).toBe(businessId);
  expect(host.querySelector<HTMLButtonElement>('[data-testid="financial-read-evidence"]')?.disabled).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
 });
 it.each(['PRE_GATE_VALIDATED','REJECTED'] as const)('renders owner-scoped %s evidence without implying execution',async(status)=>{
  const address='0x1111111111111111111111111111111111111111';
  const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x59f':method==='eth_signTypedData_v4'?'0x'+'ab'.repeat(65):[address]),on:vi.fn(),removeListener:vi.fn()};
  const issuedAt=String(Math.floor(Date.now()/1000));
  const challenge={domain:{name:'VEREQO Authentication',version:'1',chainId:'1439'},types:{WalletAuthentication:[{name:'address',type:'address'},{name:'origin',type:'string'},{name:'nonce',type:'bytes32'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'}]},value:{address,nonce:'0x'+'12'.repeat(32),origin:window.location.origin,issuedAt,expiresAt:String(Number(issuedAt)+120)}};
  const record=(requestId:string)=>({id:'1',requestId,principal:address,status,reason:status==='REJECTED'?'EXPIRED_FUTURE_OR_REPLAY':null,intentDigest:status==='PRE_GATE_VALIDATED'?'0x'+'11'.repeat(32):null,mandateDigest:status==='PRE_GATE_VALIDATED'?'0x'+'22'.repeat(32):null,proofDigest:status==='PRE_GATE_VALIDATED'?'0x'+'33'.repeat(32):null,requestDigest:'0x'+'aa'.repeat(32),createdAt:new Date().toISOString(),previousRecordHash:'0x'+'00'.repeat(32),recordHash:'0x'+'bb'.repeat(32)});
  const fetcher=vi.fn(async(url:string)=>url.endsWith('/challenge')?Response.json({challenge}):url.endsWith('/verify')?Response.json({session:testSession}):url.endsWith('/status')?Response.json({session:{address,origin:window.location.origin,expiresAt:Math.floor(Date.now()/1000)+60}}):url.includes('/api/agent/authorization/')?Response.json({evidence:record(url.split('/').pop()!),events:[record(url.split('/').pop()!)],nextCursor:null}):Response.json({}));
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));await click('[data-testid="financial-connect"]');
  await prepareAndSignWallet();
  await click('#financial-tab-5');const businessId=host.querySelector('[data-testid="financial-business-id"]')?.textContent!;
  await click('[data-testid="financial-read-evidence"]');
  expect(fetcher.mock.calls.some(([url])=>url==='/api/agent/authorization/'+businessId)).toBe(true);
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain(status);
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain('EXECUTION NOT_IMPLEMENTED');
  expect(host.textContent).not.toContain('ORDER PLACED');
 });
 it('submits only an owner-authenticated unsigned draft under the displayed ID and reads its denial evidence',async()=>{
  const address='0x1111111111111111111111111111111111111111';
  const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x59f':method==='eth_signTypedData_v4'?'0x'+'ab'.repeat(65):[address]),on:vi.fn(),removeListener:vi.fn()};
  const issuedAt=String(Math.floor(Date.now()/1000));
  const challenge={domain:{name:'VEREQO Authentication',version:'1',chainId:'1439'},types:{WalletAuthentication:[{name:'address',type:'address'},{name:'origin',type:'string'},{name:'nonce',type:'bytes32'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'}]},value:{address,nonce:'0x'+'12'.repeat(32),origin:window.location.origin,issuedAt,expiresAt:String(Number(issuedAt)+120)}};
  const records=new Map<string,Record<string,unknown>>(),posts:Array<{url:string;init:RequestInit|undefined;body:Record<string,unknown>}>=[],historyReads:string[]=[];
  const makeRecord=(requestId:string)=>({id:'1',requestId,principal:address,status:'REJECTED',reason:'SIGNED_AUTHORIZATION_PACKAGE_REQUIRED',intentDigest:null,mandateDigest:null,proofDigest:null,requestDigest:'0x'+'aa'.repeat(32),createdAt:new Date().toISOString(),previousRecordHash:'0x'+'00'.repeat(32),recordHash:'0x'+'bb'.repeat(32)});
  const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
   if(url.endsWith('/challenge'))return Response.json({challenge});
   if(url.endsWith('/verify'))return Response.json({session:testSession});
   if(url.endsWith('/status'))return Response.json({session:{address,origin:window.location.origin,expiresAt:Math.floor(Date.now()/1000)+60}});
   if(url==='/api/agent/request-review'){
    const body=JSON.parse(String(init?.body)) as Record<string,unknown>;posts.push({url,init,body});
    const row=makeRecord(String(body.requestId));records.set(String(body.requestId),row);
    return Response.json({status:'REJECTED',reason:'SIGNED_AUTHORIZATION_PACKAGE_REQUIRED',authorized:false,execution:'NOT_IMPLEMENTED',evidence:row});
   }
   if(url.startsWith('/api/agent/authorization/')){
    const requestId=url.slice('/api/agent/authorization/'.length);historyReads.push(requestId);
    const row=records.get(requestId);return row?Response.json({evidence:row,events:[row],nextCursor:null}):new Response('{}',{status:404});
   }
   if(url.endsWith('/logout'))return Response.json({ok:true});
   throw Error('UNEXPECTED_FETCH '+url);
  });
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');
  const walletState=host.querySelector<HTMLElement>('[data-testid="financial-wallet-state"]')!;
  expect(walletState.dataset.walletConnected).toBe('true');
  expect(walletState.dataset.ownershipAuthenticated).toBe('false');
  expect(walletState.dataset.executionAuthorized).toBe('false');
  expect(host.querySelector('[data-testid="wallet-ownership-state"]')?.textContent).toContain('NOT AUTHENTICATED');
  expect(host.querySelector('[data-testid="execution-authorization-state"]')?.textContent).toContain('NOT APPROVED');
  await prepareAndSignWallet();
  expect(walletState.dataset.walletConnected).toBe('true');
  expect(walletState.dataset.ownershipAuthenticated).toBe('true');
  expect(walletState.dataset.executionAuthorized).toBe('false');
  expect(host.querySelector('[data-testid="execution-authorization-state"]')?.textContent).toContain('NOT APPROVED');
  const rootPanel=host.querySelector('[data-testid="financial-workflow"]')!;
  const displayedId=rootPanel.getAttribute('data-business-id')!;
  expect(host.querySelector<HTMLButtonElement>('[data-testid="financial-request-review"]')?.disabled).toBe(false);
  await act(async()=>{
   host.querySelector<HTMLButtonElement>('[data-testid="financial-request-review"]')!.click();
   await new Promise(resolve=>setTimeout(resolve,0));
  });
  expect(posts).toHaveLength(1);
  expect(posts[0]?.url).toBe('/api/agent/request-review');
  expect(posts[0]?.body).toMatchObject({requestId:displayedId,draft:{chainId:'1439',marketKind:'SPOT',marketId:null,side:'BUY',orderType:'LIMIT',price:'',quantity:''}});
  expect(JSON.stringify(posts[0]?.body)).not.toMatch(/proof|signature/i);
  expect(new Headers(posts[0]?.init?.headers).get('x-vereqo-session')).toBe(testSession);
  expect(historyReads).toContain(displayedId);
  expect(host.querySelector('[data-testid="financial-panel"]')?.getAttribute('data-business-id')).toBe(displayedId);
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain('REJECTED');
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain('EXECUTION NOT_IMPLEMENTED');
  expect(host.textContent).toContain('SIGNED_AUTHORIZATION_PACKAGE_REQUIRED');
  expect(host.textContent).not.toContain('ORDER PLACED');
  expect(provider.request.mock.calls.filter(([call])=>call.method==='eth_signTypedData_v4')).toHaveLength(1);

  await click('#financial-tab-0');
  await act(async()=>{
   const input=host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  const editedId=host.querySelector('[data-testid="financial-panel"]')?.getAttribute('data-business-id');
  expect(editedId).not.toBe(displayedId);
  expect(host.querySelector('[data-testid="financial-draft-review-status"]')?.textContent).toContain('NO LOCAL DRAFT REVIEW SUBMITTED');
 });
 it('fails unavailable live reads to UNKNOWN without fixture fallback',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));await act(async()=>root.render(<FinancialWorkflow language="en"/>));await click('[data-testid="financial-read"]');expect(host.querySelector('[role="alert"]')?.textContent).toContain('UNKNOWN');expect(host.textContent).toContain('No observed market');});
 it('has Japanese parity for actual controls and progressive views',async()=>{await act(async()=>root.render(<FinancialWorkflow language="ja"/>));expect(host.textContent).toContain('金融操作の境界を検査する');expect(host.querySelectorAll('[role="tab"]')).toHaveLength(6);await click('#financial-tab-4');expect(host.textContent).toContain('本番検証器も未設定');expect(host.querySelector('input[type="range"]')?.getAttribute('aria-valuetext')).toBe('実行');});
 it('hands a public Testnet observation to the Control Deck without wallet authentication or writes',async()=>{
  const marketId='0x'+'12'.repeat(32),observedAt='2026-11-08T00:00:00.000Z';
  const snapshot={status:'LIVE_READ_ONLY',chainId:'1439',blockNumber:'123',blockHash:'0x'+'ab'.repeat(32),observedAt,rpcSource:'https://rpc.injective.testnet.example',marketSource:'https://lcd.injective.testnet.example/spot',derivativeSource:'https://lcd.injective.testnet.example/derivative',marketConsistency:'UNPINNED_LCD_READ',market:{marketId,ticker:'INJ/USDT',baseDenom:'inj',quoteDenom:'usdt',baseDecimals:18,quoteDecimals:6,priceTickChain:'0.000000000000001',quantityTickChain:'1000000000000000',minimumNotionalChain:'1000000',takerFeeRate:'0.0005',status:'Active'},spotTopOfBook:{marketId,midPriceChain:'0.000000000005963000',bestBuyPriceChain:'0.000000000004704000',bestSellPriceChain:'0.000000000007222000'}};
  const fetcher=vi.fn(async(url:RequestInfo|URL)=>{expect(String(url)).toBe('/api/financial/market');return Response.json({snapshot});});
  const provider={request:vi.fn(),on:vi.fn(),removeListener:vi.fn()},onTraceSelect=vi.fn();
  vi.stubGlobal('fetch',fetcher);vi.stubGlobal('ethereum',provider);
  await act(async()=>root.render(<FinancialWorkflow language="en" onTraceSelect={onTraceSelect}/>));
  expect(host.querySelector('[data-testid="financial-open-market-trace"]')).toBeNull();
  await click('[data-testid="financial-read"]');
  expect(host.querySelector('[data-testid="financial-open-market-trace"]')).not.toBeNull();
  await click('[data-testid="financial-open-market-trace"]');
  expect(onTraceSelect).toHaveBeenCalledWith(expect.objectContaining({requestId:expect.stringMatching(/^fi_[a-f0-9]{32}$/),marketStatus:'LIVE_READ_ONLY',chainId:'1439',marketId,blockNumber:'123',blockHash:'0x'+'ab'.repeat(32),blockSource:'https://rpc.injective.testnet.example',marketSource:'https://lcd.injective.testnet.example/spot',marketConsistency:'UNPINNED_LCD_READ',observedAt,side:'BUY',price:null,quantity:null,draftStatus:'UNSIGNED_DRAFT',evidenceState:'AUTHENTICATION_REQUIRED',requestSource:'LOCAL_FINANCIAL_DRAFT'}));
  expect(fetcher.mock.calls.map(([url])=>String(url))).toEqual(['/api/financial/market']);
  expect(provider.request).not.toHaveBeenCalled();
 });
 it('does not label an unobserved selected Derivative market as a live market trace',async()=>{
  const snapshot={status:'LIVE_READ_ONLY',chainId:'1439',blockNumber:'123',observedAt:'2026-11-08T00:00:00.000Z',market:{marketId:'0x'+'12'.repeat(32),ticker:'INJ/USDT',baseDenom:'inj',quoteDenom:'usdt',baseDecimals:18,quoteDecimals:6,priceTickChain:'1',quantityTickChain:'1',minimumNotionalChain:'1',takerFeeRate:'0.0005',status:'Active'}};
  const fetcher=vi.fn(async()=>Response.json({snapshot})),onTraceSelect=vi.fn();vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en" onTraceSelect={onTraceSelect}/>));
  const market=host.querySelector<HTMLSelectElement>('[data-testid="financial-market-kind"]')!;
  await act(async()=>{market.value='DERIVATIVE';market.dispatchEvent(new Event('change',{bubbles:true}));});
  await click('[data-testid="financial-read"]');
  expect(host.querySelector('[data-testid="financial-open-market-trace"]')).toBeNull();
  expect(host.querySelector('.financialTarget')?.textContent).toContain('UNOBSERVED');
  expect(onTraceSelect).not.toHaveBeenCalled();
 });
 it('consumes the actual HTTP snapshot envelope and advances what-if version',async()=>{
 const snapshot={status:'LIVE_READ_ONLY',chainId:'1439',blockNumber:'123',blockHash:'0x'+'ab'.repeat(32),blockTimestamp:'123',observedAt:new Date().toISOString(),rpcSource:'https://example.org',marketSource:'https://example.org/market',spotTopOfBookSource:'https://example.org/spot-top',spotTopOfBook:{marketId:'0x'+'12'.repeat(32),midPriceChain:'0.000000000005963000',bestBuyPriceChain:'0.000000000004704000',bestSellPriceChain:'0.000000000007222000'},derivativeSource:'https://example.org/derivative',chainSource:'https://example.org/node_info',endpointSoftware:{evmClientVersion:'evm-gateway/v1.4.2-hotfix.4',tendermintNodeVersion:'1.0.1',injectiveAppName:'injective',injectiveAppVersion:'v1.20.4-bl.2',injectiveGitCommit:'1ffa252',cosmosSdkVersion:'v0.50.15-inj.1',consistency:'UNPINNED_ENDPOINT_REPORTS'},marketConsistency:'UNPINNED_LCD_READ',execution:'NOT_IMPLEMENTED',market:{marketId:'0x'+'12'.repeat(32),ticker:'INJ/USDT',baseDecimals:18,quoteDecimals:6,baseDenom:'inj',quoteDenom:'usdt',priceTickChain:'0.000000000000001',quantityTickChain:'1000000000000000',minimumNotionalChain:'1000000',takerFeeRate:'0.0005',status:'Active'},derivativeMarket:{marketId:'0x'+'56'.repeat(32),ticker:'ETH/USDC PERP',quoteDenom:'usdc',oracleType:'ChainlinkDataStreams',oracleBase:'0x'+'01'.repeat(32),oracleQuote:'0x'+'02'.repeat(32),oracleScaleFactor:6,initialMarginRatio:'0.019231',maintenanceMarginRatio:'0.01',markPrice:'2243377856.164794606867',priceTickChain:'100000',quantityTickChain:'0.0001',takerFeeRate:'0.0005',status:'Active'}};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({snapshot})));await act(async()=>root.render(<FinancialWorkflow language="en"/>));await click('[data-testid="financial-read"]');expect(host.textContent).toContain('LIVE READ-ONLY');expect(host.textContent).toContain('INJ/USDT');expect(host.querySelector('.financialTarget')?.textContent).toContain('V1');await click('#financial-tab-5');expect(host.textContent).toContain('v1.20.4-bl.2');expect(host.textContent).toContain('UNPINNED_ENDPOINT_REPORTS');await click('#financial-tab-3');await click('input[type="checkbox"]');expect(host.querySelector('.financialTarget')?.textContent).toContain('V2');await click('#financial-tab-5');expect(host.textContent).toContain('123');const englishLabels=[...host.querySelectorAll('dt')].map(node=>node.textContent);expect(englishLabels).toContain('Derivative mark (API value)');expect(englishLabels).toContain('Injective app (endpoint report)');expect(englishLabels).toContain('Market source consistency');expect(englishLabels).not.toContain('derivativeOracleScaleFactor');
  await act(async()=>root.render(<FinancialWorkflow language="ja"/>));await click('[data-testid="financial-read"]');await click('#financial-tab-5');const japaneseLabels=[...host.querySelectorAll('dt')].map(node=>node.textContent);expect(japaneseLabels).toContain('市場データ取得元の整合性');expect(japaneseLabels).toContain('Derivative mark（API値）');
 });
 it('switches between live Spot and Derivative drafts without creating an executable action',async()=>{
  const snapshot={status:'LIVE_READ_ONLY',chainId:'1439',blockNumber:'123',blockHash:'0x'+'ab'.repeat(32),blockTimestamp:'123',observedAt:new Date().toISOString(),rpcSource:'https://example.org',marketSource:'https://example.org/market',spotTopOfBookSource:'https://example.org/spot-top',spotTopOfBook:{marketId:'0x'+'12'.repeat(32),midPriceChain:'0.000000000005963000',bestBuyPriceChain:'0.000000000004704000',bestSellPriceChain:'0.000000000007222000'},derivativeSource:'https://example.org/derivative',chainSource:'https://example.org/node_info',endpointSoftware:{evmClientVersion:'evm-gateway/v1.4.2-hotfix.4',tendermintNodeVersion:'1.0.1',injectiveAppName:'injective',injectiveAppVersion:'v1.20.4-bl.2',injectiveGitCommit:'1ffa252',cosmosSdkVersion:'v0.50.15-inj.1',consistency:'UNPINNED_ENDPOINT_REPORTS'},marketConsistency:'UNPINNED_LCD_READ',execution:'NOT_IMPLEMENTED',market:{marketId:'0x'+'12'.repeat(32),ticker:'INJ/USDT',baseDecimals:18,quoteDecimals:6,baseDenom:'inj',quoteDenom:'usdt',priceTickChain:'0.000000000000001',quantityTickChain:'1000000000000000',minimumNotionalChain:'1000000',takerFeeRate:'0.0005',status:'Active'},derivativeMarket:{marketId:'0x'+'56'.repeat(32),ticker:'ETH/USDC PERP',quoteDenom:'usdc',oracleType:'ChainlinkDataStreams',oracleBase:'0x'+'01'.repeat(32),oracleQuote:'0x'+'02'.repeat(32),oracleScaleFactor:6,initialMarginRatio:'0.019231',maintenanceMarginRatio:'0.01',markPrice:'2243377856.164794606867',priceTickChain:'100000',quantityTickChain:'0.0001',takerFeeRate:'0.0005',status:'Active'}};
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({snapshot})));await act(async()=>root.render(<FinancialWorkflow language="en"/>));await click('[data-testid="financial-read"]');expect(host.querySelector('[data-testid="financial-spot-quote"]')?.textContent).toContain('5.963');
  const market=host.querySelector<HTMLSelectElement>('[data-testid="financial-market-kind"]')!;await act(async()=>{market.value='DERIVATIVE';market.dispatchEvent(new Event('change',{bubbles:true}));});expect(host.querySelector('.financialHierarchy')?.textContent).toContain('ETH/USDC PERP');expect(host.querySelector('.signalCard')?.textContent).toContain('ETH/USDC PERP');expect(host.textContent).toContain('2243377856.164794606867');expect(host.textContent).toContain('SELL inventory and derivative margin are not verified');
  const side=host.querySelector<HTMLSelectElement>('[data-testid="financial-order-side"]')!;await act(async()=>{side.value='SELL';side.dispatchEvent(new Event('change',{bubbles:true}));});expect(host.querySelector('.financialTarget')?.textContent).toContain('DERIVATIVE / SELL');expect(host.querySelector('.signalCard')?.textContent).toContain('SELL');await click('#financial-tab-4');expect(host.textContent).toContain('NO EXECUTION');expect(host.querySelector('[data-testid="financial-panel"]')?.querySelector('button')).toBeNull();
 });
 it('rechecks authenticated sessions and clears expired ownership after thirty seconds',async()=>{
 vi.useFakeTimers();const address='0x1111111111111111111111111111111111111111';let active=true;const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x59f':method==='eth_signTypedData_v4'?'0xsignature':[address]),on:vi.fn(),removeListener:vi.fn()};vi.stubGlobal('ethereum',provider);
 const issuedAt=String(Math.floor(Date.now()/1000));
 const challenge={domain:{name:'VEREQO Authentication',version:'1',chainId:'1439'},types:{WalletAuthentication:[{name:'address',type:'address'},{name:'origin',type:'string'},{name:'nonce',type:'bytes32'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'}]},value:{address,nonce:'0x'+'12'.repeat(32),origin:window.location.origin,issuedAt,expiresAt:String(Number(issuedAt)+120)}};
 const fetcher=vi.fn(async(url:string)=>{if(url.endsWith('challenge'))return Response.json({challenge});if(url.endsWith('verify'))return Response.json({session:testSession});return Response.json({session:active?{address,origin:window.location.origin,expiresAt:Math.floor(Date.now()/1000)+60}:null});});vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<FinancialWorkflow language="en"/>));await click('[data-testid="financial-connect"]');await prepareAndSignWallet();expect(host.querySelector('[data-testid="wallet-ownership-state"]')?.textContent).toContain('OWNERSHIP AUTHENTICATED');expect(host.querySelector('[data-testid="execution-authorization-state"]')?.textContent).toContain('EXECUTION NOT APPROVED');active=false;await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(host.textContent).toContain('OWNERSHIP NOT AUTHENTICATED');expect(fetcher.mock.calls.filter(c=>c[0].endsWith('status'))).toHaveLength(2);
 });
 it('passes the same owner-scoped draft and only returned evidence into the inspection handoff',async()=>{
  const address='0x1111111111111111111111111111111111111111';
  const provider={request:vi.fn(async({method,params}:{method:string;params?:unknown[]})=>{
   if(method==='eth_chainId')return '0x59f';
   if(method==='eth_signTypedData_v4'){
    if(typeof params?.[1]!=='string'||!params[1].includes('WalletAuthentication'))throw Error('UNEXPECTED_SIGNING_PAYLOAD');
    return '0x'+'ab'.repeat(65);
   }
   return [address];
  }),on:vi.fn(),removeListener:vi.fn()};
  const issuedAt=String(Math.floor(Date.now()/1000));
  const challenge={domain:{name:'VEREQO Authentication',version:'1',chainId:'1439'},types:{WalletAuthentication:[{name:'address',type:'address'},{name:'origin',type:'string'},{name:'nonce',type:'bytes32'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'}]},value:{address,nonce:'0x'+'12'.repeat(32),origin:window.location.origin,issuedAt,expiresAt:String(Number(issuedAt)+120)}};
  const record=(requestId:string)=>({id:'7',requestId,principal:address,status:'REJECTED',reason:'SIGNED_AUTHORIZATION_PACKAGE_REQUIRED',intentDigest:null,mandateDigest:null,proofDigest:null,requestDigest:'0x'+'aa'.repeat(32),createdAt:new Date().toISOString(),previousRecordHash:'0x'+'00'.repeat(32),recordHash:'0x'+'bb'.repeat(32)});
  const fetcher=vi.fn(async(url:string)=>url.endsWith('/challenge')?Response.json({challenge}):url.endsWith('/verify')?Response.json({session:testSession}):url.endsWith('/status')?Response.json({session:{address,origin:window.location.origin,expiresAt:Math.floor(Date.now()/1000)+60}}):url.includes('/api/agent/authorization/')?Response.json({evidence:record(url.split('/').pop()!),events:[record(url.split('/').pop()!)],nextCursor:null}):new Response('{}',{status:404}));
  const onTraceSelect=vi.fn();vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en" onTraceSelect={onTraceSelect}/>));
  await click('[data-testid="financial-connect"]');
  await prepareAndSignWallet();
  await click('#financial-tab-5');
  const requestId=host.querySelector('[data-testid="financial-business-id"]')?.textContent!;
  await click('[data-testid="financial-read-evidence"]');
  await click('[data-testid="financial-open-trace"]');
  expect(onTraceSelect).toHaveBeenCalledTimes(1);
  expect(onTraceSelect).toHaveBeenCalledWith(expect.objectContaining({requestId,revision:0,marketStatus:'UNKNOWN',marketId:null,side:'BUY',draftStatus:'UNSIGNED_DRAFT',evidenceState:'AVAILABLE',evidenceId:'7',evidenceStatus:'REJECTED',evidenceHash:'0x'+'bb'.repeat(32),evidenceEventCount:1}));
  expect(fetcher.mock.calls.map(([url])=>url)).toContain('/api/agent/authorization/'+requestId);
  expect(fetcher.mock.calls.map(([url])=>url)).not.toContain('/api/agent/request-review');
  expect(fetcher.mock.calls.map(([url])=>url)).not.toContain('/api/financial/order');
  expect(provider.request.mock.calls.some(([call])=>call.method==='eth_sendTransaction')).toBe(false);
  expect(provider.request.mock.calls.filter(([call])=>call.method==='eth_signTypedData_v4')).toHaveLength(1); // synthetic provider: ownership authentication only
  expect(provider.request.mock.calls.find(([call])=>call.method==='eth_signTypedData_v4')?.[0].params?.[1]).toContain('WalletAuthentication');
 });

 it('ignores evidence returned for an earlier draft revision',async()=>{
  const address='0x1111111111111111111111111111111111111111';
  const provider={request:vi.fn(async({method,params}:{method:string;params?:unknown[]})=>{
   if(method==='eth_chainId')return '0x59f';
   if(method==='eth_signTypedData_v4'){
    if(typeof params?.[1]!=='string'||!params[1].includes('WalletAuthentication'))throw Error('UNEXPECTED_SIGNING_PAYLOAD');
    return '0x'+'ab'.repeat(65);
   }
   return [address];
  }),on:vi.fn(),removeListener:vi.fn()};
  const issuedAt=String(Math.floor(Date.now()/1000));
  const challenge={domain:{name:'VEREQO Authentication',version:'1',chainId:'1439'},types:{WalletAuthentication:[{name:'address',type:'address'},{name:'origin',type:'string'},{name:'nonce',type:'bytes32'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'}]},value:{address,nonce:'0x'+'12'.repeat(32),origin:window.location.origin,issuedAt,expiresAt:String(Number(issuedAt)+120)}};
  const pending=deferred<Response>(),requested=deferred<void>();
  const record=(requestId:string)=>({id:'8',requestId,principal:address,status:'REJECTED',reason:'SIGNED_AUTHORIZATION_PACKAGE_REQUIRED',intentDigest:null,mandateDigest:null,proofDigest:null,requestDigest:'0x'+'aa'.repeat(32),createdAt:new Date().toISOString(),previousRecordHash:'0x'+'00'.repeat(32),recordHash:'0x'+'bb'.repeat(32)});
  const fetcher=vi.fn(async(url:string)=>{
   if(url.endsWith('/challenge'))return Response.json({challenge});
   if(url.endsWith('/verify'))return Response.json({session:testSession});
   if(url.endsWith('/status'))return Response.json({session:{address,origin:window.location.origin,expiresAt:Math.floor(Date.now()/1000)+60}});
   if(url.includes('/api/agent/authorization/')){requested.resolve();return pending.promise;}
   return new Response('{}',{status:404});
  });
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');
  await prepareAndSignWallet();
  await click('#financial-tab-5');
  const oldRequestId=host.querySelector('[data-testid="financial-business-id"]')?.textContent!;
  await click('[data-testid="financial-read-evidence"]');
  await requested.promise;

  await click('#financial-tab-0');
  const side=host.querySelector<HTMLSelectElement>('[data-testid="financial-order-side"]')!;
  await act(async()=>{
   side.value='SELL';
   side.dispatchEvent(new Event('change',{bubbles:true}));
  });
  const currentRequestId=host.querySelector('[data-testid="financial-workflow"]')?.getAttribute('data-business-id');
  expect(currentRequestId).not.toBe(oldRequestId);
  await click('#financial-tab-5');
  pending.resolve(Response.json({evidence:record(oldRequestId),events:[record(oldRequestId)],nextCursor:null}));
  await act(async()=>{await pending.promise;await new Promise(resolve=>setTimeout(resolve,0));});
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain('NOT_REQUESTED');
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).not.toContain('LOCAL ISSUER EVIDENCE');
  expect(host.querySelector('[data-testid="financial-open-trace"]')).toBeNull();
 });

 it('releases a pending evidence read when a WHAT-IF revision changes under the same Business ID',async()=>{
  const address='0x1111111111111111111111111111111111111111';
  const provider={request:vi.fn(async({method,params}:{method:string;params?:unknown[]})=>{
   if(method==='eth_chainId')return '0x59f';
   if(method==='eth_signTypedData_v4'){
    if(typeof params?.[1]!=='string'||!params[1].includes('WalletAuthentication'))throw Error('UNEXPECTED_SIGNING_PAYLOAD');
    return '0x'+'ab'.repeat(65);
   }
   return [address];
  }),on:vi.fn(),removeListener:vi.fn()};
  const issuedAt=String(Math.floor(Date.now()/1000));
  const challenge={domain:{name:'VEREQO Authentication',version:'1',chainId:'1439'},types:{WalletAuthentication:[{name:'address',type:'address'},{name:'origin',type:'string'},{name:'nonce',type:'bytes32'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'}]},value:{address,nonce:'0x'+'12'.repeat(32),origin:window.location.origin,issuedAt,expiresAt:String(Number(issuedAt)+120)}};
  const pending=deferred<Response>(),requested=deferred<void>();
  const record=(requestId:string)=>({id:'9',requestId,principal:address,status:'REJECTED',reason:'SIGNED_AUTHORIZATION_PACKAGE_REQUIRED',intentDigest:null,mandateDigest:null,proofDigest:null,requestDigest:'0x'+'aa'.repeat(32),createdAt:new Date().toISOString(),previousRecordHash:'0x'+'00'.repeat(32),recordHash:'0x'+'cc'.repeat(32)});
  let evidenceReads=0;
  const fetcher=vi.fn(async(url:string)=>{
   if(url.endsWith('/challenge'))return Response.json({challenge});
   if(url.endsWith('/verify'))return Response.json({session:testSession});
   if(url.endsWith('/status'))return Response.json({session:{address,origin:window.location.origin,expiresAt:Math.floor(Date.now()/1000)+60}});
   if(url.includes('/api/agent/authorization/')){
    evidenceReads+=1;
    if(evidenceReads===1){requested.resolve();return pending.promise;}
    return Response.json({evidence:record(url.split('/').pop()!),events:[record(url.split('/').pop()!)],nextCursor:null});
   }
   return new Response('{}',{status:404});
  });
  vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<FinancialWorkflow language="en"/>));
  await click('[data-testid="financial-connect"]');
  await prepareAndSignWallet();
  await click('#financial-tab-5');
  const businessId=host.querySelector('[data-testid="financial-business-id"]')?.textContent!;
  const initialRevision=host.querySelector('[data-testid="financial-workflow"]')?.getAttribute('data-version');
  await click('[data-testid="financial-read-evidence"]');
  await requested.promise;

  await click('#financial-tab-3');
  const checkbox=host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async()=>{checkbox.click();});
  expect(host.querySelector('[data-testid="financial-workflow"]')?.getAttribute('data-business-id')).toBe(businessId);
  expect(host.querySelector('[data-testid="financial-workflow"]')?.getAttribute('data-version')).not.toBe(initialRevision);
  await click('#financial-tab-5');
  const readEvidence=host.querySelector<HTMLButtonElement>('[data-testid="financial-read-evidence"]')!;
  expect(readEvidence.disabled).toBe(false);

  pending.resolve(Response.json({evidence:record(businessId),events:[record(businessId)],nextCursor:null}));
  await act(async()=>{await pending.promise;await new Promise(resolve=>setTimeout(resolve,0));});
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain('NOT_REQUESTED');
  await click('[data-testid="financial-read-evidence"]');
  expect(host.querySelector('[data-testid="financial-evidence-status"]')?.textContent).toContain('LOCAL ISSUER EVIDENCE');
  expect(evidenceReads).toBe(2);
 });

});

it('blocks duplicate signing and exposes only safe stages when server instance changes',async()=>{
 const address='0x1111111111111111111111111111111111111111',challenge=authChallenge(address),pending=deferred<string>();
 const request=vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x59f':method==='eth_signTypedData_v4'?pending.promise:[address]);
 vi.stubGlobal('ethereum',{request,on:vi.fn(),removeListener:vi.fn()});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/challenge')?Response.json({challenge},{headers:{'x-vereqo-auth-instance':'before'}}):Response.json({error:'CHALLENGE_UNKNOWN'},{status:404,headers:{'x-vereqo-auth-instance':'after'}})));
 await act(async()=>root.render(<FinancialWorkflow language="en"/>));
 await click('[data-testid="financial-connect"]');await click('[data-testid="wallet-auth-prepare"]');
 await click('[data-testid="wallet-auth-sign"]');await click('[data-testid="wallet-auth-sign"]');
 expect(request.mock.calls.filter(([args])=>args.method==='eth_signTypedData_v4')).toHaveLength(1);
 await act(async()=>pending.resolve('0x'+'ab'.repeat(65)));
 expect(host.textContent).toContain('AUTH_SERVER_RESTARTED');
 const trace=host.querySelector('[data-testid="wallet-auth-diagnostics"]')!.textContent!;
 expect(trace).toContain('PROVIDER_SIGNATURE_RETURNED');expect(trace).toContain('SERVER_INSTANCE_CHANGED');
 expect(trace).not.toContain(challenge.value.nonce);expect(trace).not.toContain(testSession);expect(trace).not.toContain('ab'.repeat(65));
 expect(host.textContent).toContain('OWNERSHIP NOT AUTHENTICATED');
});

it.each([false,true])('looks up enriched owner-scoped G3 evidence and rejects a foreign owner: %s',async foreign=>{
 const address='0x'+'11'.repeat(20),requestId='g3_existing_request',onTraceSelect=vi.fn();
 const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x59f':method==='eth_signTypedData_v4'?'0x'+'ab'.repeat(65):[address]),on:vi.fn(),removeListener:vi.fn()};
 const fetcher=vi.fn(async(url:string)=>url.endsWith('/challenge')?Response.json({challenge:authChallenge(address)}):url.endsWith('/verify')?Response.json({session:testSession}):url.endsWith('/status')?Response.json({session:{address,origin:window.location.origin,expiresAt:Math.floor(Date.now()/1000)+600}}):url.includes('/api/agent/authorization/')?Response.json({evidence:uiG3Evidence(requestId,foreign?'0x'+'33'.repeat(20):address),events:[uiG3Evidence(requestId,foreign?'0x'+'33'.repeat(20):address)]}):Response.json({}));
 vi.stubGlobal('ethereum',provider);vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<FinancialWorkflow language="en" onTraceSelect={onTraceSelect}/>));
 await click('[data-testid="financial-connect"]');await prepareAndSignWallet();await click('#financial-tab-5');
 const initialId=host.querySelector('[data-testid="financial-business-id"]')!.textContent;
 const input=host.querySelector<HTMLInputElement>('[data-testid="financial-request-id-input"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,requestId);input.dispatchEvent(new Event('input',{bubbles:true}));});
 const signatures=provider.request.mock.calls.filter(([args])=>args.method==='eth_signTypedData_v4').length;
 await click('[data-testid="financial-request-lookup"]');
 if(foreign){expect(host.querySelector('[data-testid="financial-request-lookup-error"]')?.textContent).toBe('EVIDENCE_UNKNOWN');expect(host.querySelector('[data-testid="financial-business-id"]')?.textContent).toBe(initialId);}
 else{
  expect(host.querySelector('[data-testid="financial-business-id"]')?.textContent).toBe(requestId);
  await click('[data-testid="financial-open-trace"]');
  expect(onTraceSelect).toHaveBeenLastCalledWith(expect.objectContaining({requestId,recordOnly:true,requestSource:'OWNER_SCOPED_AUTHORIZATION_RECORD',proofDigest:uiG3Evidence(requestId).proofDigest,disclosureHistorySequence:'0',price:null,quantity:null}));
 }
 expect(provider.request.mock.calls.filter(([args])=>args.method==='eth_signTypedData_v4')).toHaveLength(signatures);
 expect(fetcher.mock.calls.some(([url])=>url==='/api/agent/run'||url==='/api/agent/authorize')).toBe(false);
});
