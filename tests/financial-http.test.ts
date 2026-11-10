import {afterEach,describe,it,expect} from 'vitest';
import {Wallet} from 'ethers';
import {createLocalApp} from '../services/issuer/src/http';
import {InjectiveReadAdapter} from '../packages/domain/src/live-injective';
import {WalletConnection,type WalletChallenge} from '../packages/domain/src/wallet';
const close:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of close.splice(0))await f();});
async function open(adapter=new InjectiveReadAdapter(async()=>{throw Error('offline');})){
 const app=createLocalApp({databasePath:':memory:',injective:adapter});close.push(app.close);await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));
 const address=app.server.address();if(!address||typeof address==='string')throw Error('LISTENER');const base=`http://127.0.0.1:${address.port}`;
 const post=(path:string,body:unknown,origin=base,headers:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{}),...headers},body:JSON.stringify(body)});
 const status=(token:string,origin=base)=>fetch(base+'/api/wallet/status',{headers:{origin,'x-vereqo-session':token}}).then(r=>r.json());
 const challenge=async(address:string)=>{const r=await post('/api/wallet/challenge',{address});expect(r.status).toBe(200);return (await r.json() as {challenge:WalletChallenge}).challenge;};
 return {base,post,status,challenge};
}
describe('actual financial HTTP boundaries (ephemeral local test keys only)',()=>{
 it('verifies real EIP712 recovery, single-use challenge, session and logout',async()=>{
  const a=await open(),w=Wallet.createRandom(),c=await a.challenge(w.address);expect(c.domain.chainId).toBe('1439');expect(c.value.origin).toBe(a.base);
  const signature=await w.signTypedData(c.domain,c.types,c.value),body={nonce:c.value.nonce,signature};
  const response=await a.post('/api/wallet/verify',body);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');const {session}=await response.json();
  expect((await a.status(session)).session.address).toBe(w.address);const replay=await a.post('/api/wallet/verify',body);expect(replay.status).toBe(409);expect(await replay.json()).toEqual({error:'CHALLENGE_ALREADY_USED'});
  expect((await a.status(session,'http://localhost:5173')).session).toBeNull();
  expect((await a.post('/api/wallet/logout',{},a.base,{'x-vereqo-session':session})).status).toBe(200);expect((await a.status(session)).session).toBeNull();
 });
 it('rejects wrong signer and consumes invalid-attempt challenge',async()=>{
  const a=await open(),w=Wallet.createRandom(),c=await a.challenge(w.address),other=Wallet.createRandom();
  const wrongSigner=await a.post('/api/wallet/verify',{nonce:c.value.nonce,signature:await other.signTypedData(c.domain,c.types,c.value)});expect(wrongSigner.status).toBe(401);expect(await wrongSigner.json()).toEqual({error:'SIGNATURE_INVALID'});
  const replay=await a.post('/api/wallet/verify',{nonce:c.value.nonce,signature:await w.signTypedData(c.domain,c.types,c.value)});expect(replay.status).toBe(409);expect(await replay.json()).toEqual({error:'CHALLENGE_ALREADY_USED'});
 });
 it('rejects wrong signature domain and cross-origin challenge verification',async()=>{
  const a=await open(),w=Wallet.createRandom(),c=await a.challenge(w.address);
  const wrongDomain=await a.post('/api/wallet/verify',{nonce:c.value.nonce,signature:await w.signTypedData({...c.domain,chainId:'1'},c.types,c.value)});expect(wrongDomain.status).toBe(401);expect(await wrongDomain.json()).toEqual({error:'SIGNATURE_INVALID'});
  const d=await a.challenge(w.address),wrongOrigin=await a.post('/api/wallet/verify',{nonce:d.value.nonce,signature:await w.signTypedData(d.domain,d.types,d.value)},'http://localhost:5173');expect(wrongOrigin.status).toBe(403);expect(await wrongOrigin.json()).toEqual({error:'ORIGIN_MISMATCH'});
  const unknown=await a.post('/api/wallet/verify',{nonce:'0x'+'99'.repeat(32),signature:'0x'+'00'.repeat(65)});expect(unknown.status).toBe(404);expect(await unknown.json()).toEqual({error:'CHALLENGE_UNKNOWN'});
 });
 it('rejects missing/foreign Origin and unknown auth fields',async()=>{
  const a=await open(),address=Wallet.createRandom().address;
  expect((await a.post('/api/wallet/challenge',{address},'')).status).toBe(403);expect((await a.post('/api/wallet/challenge',{address},'https://attacker.invalid')).status).toBe(403);
  expect((await a.post('/api/wallet/challenge',{address,authorized:true})).status).toBe(400);expect((await a.post('/api/wallet/challenge',{address:'invalid'})).status).toBe(400);
 });
 it('Agent ingress requires real session and remains truthfully unconfigured',async()=>{
  const a=await open();const status=await(await fetch(a.base+'/api/agent/status')).json();expect(status.status).toBe('NOT_CONFIGURED');expect(status.autonomousRuntime).toBe('NOT_IMPLEMENTED');
  expect((await a.post('/api/agent/propose',{})).status).toBe(401);
  const w=Wallet.createRandom(),c=await a.challenge(w.address);const response=await a.post('/api/wallet/verify',{nonce:c.value.nonce,signature:await w.signTypedData(c.domain,c.types,c.value)});const {session}=await response.json();
  const r=await a.post('/api/agent/propose',{},a.base,{'x-vereqo-session':session});expect(r.status).toBe(503);expect((await r.json()).status).toBe('NOT_CONFIGURED');
 });
 it('never authenticates using public fixture CSRF token',async()=>{
  const a=await open(),state=await(await fetch(a.base+'/api/state')).json();expect((await a.status(state.requestToken)).session).toBeNull();
 });
 it('client emits standard EIP1193 message payload accepted by actual server recovery',async()=>{
  const a=await open(),w=Wallet.createRandom();let signatures=0;
  const connection=new WalletConnection({request:async({method,params})=>{
   if(method==='eth_chainId')return '0x59f';if(method==='eth_accounts'||method==='eth_requestAccounts')return [w.address];
   if(method==='eth_signTypedData_v4'){signatures++;const payload=JSON.parse(String(params?.[1]));expect(payload).toHaveProperty('message');expect(payload).not.toHaveProperty('value');expect(payload.primaryType).toBe('WalletAuthentication');delete payload.types.EIP712Domain;return w.signTypedData(payload.domain,payload.types,payload.message);}throw Error('UNEXPECTED_WALLET_METHOD');
  }});await connection.connect();expect(signatures).toBe(0);const challenge=await a.challenge(w.address);
  await connection.authenticate(challenge,async(signature)=>{const r=await a.post('/api/wallet/verify',{nonce:challenge.value.nonce,signature});expect(r.status).toBe(200);return (await r.json()).session;},async token=>{await a.post('/api/wallet/logout',{},a.base,{'x-vereqo-session':token});});
  const verified=(await a.status(connection.session!)).session;expect(signatures).toBe(1);expect(verified).toMatchObject({address:w.address,origin:a.base});expect(verified.expiresAt).toBeGreaterThan(Math.floor(Date.now()/1000));connection.dispose();
 });
 it('returns truthful 503 UNKNOWN without fictional fallback market',async()=>{
  const a=await open(),r=await fetch(a.base+'/api/financial/market');expect(r.status).toBe(503);expect(await r.json()).toEqual({status:'UNKNOWN',reason:'TESTNET_READ_UNAVAILABLE',execution:'NOT_IMPLEMENTED'});
 });
 it('passes an actual validated read adapter snapshot through HTTP',async()=>{
  const stamp=Math.floor(Date.now()/1000);const adapter=new InjectiveReadAdapter(async(url,init)=>{
   if(!init?.body){if(url.includes('/node_info'))return Response.json({default_node_info:{network:'injective-888',version:'1.0.1'},application_version:{app_name:'injectived',version:'v1.20.4-bl.2',git_commit:'fixture-1',cosmos_sdk_version:'v0.50.15-inj.1'}});if(url.includes('/derivative/markets'))return Response.json({markets:[]});if(url.includes('/spot/mid_price_and_tob/'))return Response.json({mid_price:'0.000000000005963000',best_buy_price:'0.000000000004704000',best_sell_price:'0.000000000007222000'});return Response.json({markets:[{market_id:'0x'+'12'.repeat(32),ticker:'INJ/USDT',status:'Active',base_denom:'inj',quote_denom:'usdt',base_decimals:18,quote_decimals:6,min_price_tick_size:'0.000000000000001',min_quantity_tick_size:'1000000000000000',min_notional:'1000000',taker_fee_rate:'0.0005'}]});}
   const {method}=JSON.parse(String(init.body));const result=method==='eth_chainId'?'0x59f':method==='web3_clientVersion'?'fixture-rpc/1':{number:'0x123',hash:'0x'+'34'.repeat(32),timestamp:'0x'+stamp.toString(16)};return Response.json({jsonrpc:'2.0',id:1,result});
  });const a=await open(adapter),r=await fetch(a.base+'/api/financial/market');expect(r.status).toBe(200);const {snapshot}=await r.json();expect(snapshot.market.ticker).toBe('INJ/USDT');expect(snapshot.execution).toBe('NOT_IMPLEMENTED');expect(snapshot.marketConsistency).toBe('UNPINNED_LCD_READ');
 });
});

it('identifies server-instance loss and distinguishes signature recovery without exposing secret values',async()=>{
 const a=await open(),b=await open(),w=Wallet.createRandom();
 const response=await a.post('/api/wallet/challenge',{address:w.address});
 const instance=response.headers.get('x-vereqo-auth-instance');
 const {challenge}=await response.json();
 expect(instance).toMatch(/^[a-f0-9-]{36}$/);
 const invalid=await a.post('/api/wallet/verify',{nonce:challenge.value.nonce,signature:'0x'});
 expect(invalid.headers.get('x-vereqo-auth-instance')).toBe(instance);
 expect(invalid.headers.get('x-vereqo-auth-diagnostic')).toBe('SIGNATURE_RECOVERY_FAILED');
 const restarted=await b.post('/api/wallet/verify',{nonce:challenge.value.nonce,signature:'0x'});
 expect(restarted.status).toBe(404);expect(restarted.headers.get('x-vereqo-auth-instance')).not.toBe(instance);
 const {challenge:c}=await(await a.post('/api/wallet/challenge',{address:w.address})).json();
 const signature=await Wallet.createRandom().signTypedData(c.domain,c.types,c.value);
 const mismatch=await a.post('/api/wallet/verify',{nonce:c.value.nonce,signature});
 expect(mismatch.headers.get('x-vereqo-auth-diagnostic')).toBe('SIGNER_MISMATCH');
 const output=JSON.stringify([...mismatch.headers])+await mismatch.text();
 for(const secret of [c.value.nonce,signature])expect(output).not.toContain(secret);
});

it('correlates server challenge, signer recovery, session issue and status without secret diagnostics',async()=>{
 const a=await open(),w=Wallet.createRandom(),correlation='11111111-1111-4111-8111-111111111111';
 const issued=await a.post('/api/wallet/challenge',{address:w.address},a.base,{'x-vereqo-auth-correlation':correlation});
 expect(issued.status).toBe(200);
 expect(issued.headers.get('x-vereqo-auth-correlation')).toBe(correlation);
 expect(issued.headers.get('x-vereqo-auth-instance')).toMatch(/^[a-f0-9-]{36}$/);
 expect(issued.headers.get('x-vereqo-auth-stage')).toBe('CHALLENGE_CREATED');
 const {challenge}=await issued.json() as {challenge:WalletChallenge};
 const signature=await w.signTypedData(challenge.domain,challenge.types,challenge.value);
 const verified=await a.post('/api/wallet/verify',{nonce:challenge.value.nonce,signature},a.base,{'x-vereqo-auth-correlation':correlation});
 expect(verified.status).toBe(200);
 expect(verified.headers.get('x-vereqo-auth-correlation')).toBe(correlation);
 expect(verified.headers.get('x-vereqo-auth-stage')).toBe('SESSION_ISSUED');
 expect(verified.headers.get('x-vereqo-auth-stages')?.split(',')).toEqual(['CHALLENGE_VALIDATED','SIGNATURE_RECOVERY_REQUESTED','SIGNER_VERIFIED','SESSION_ISSUED']);
 const {session}=await verified.json() as {session:string};
 const status=await fetch(a.base+'/api/wallet/status',{headers:{origin:a.base,'x-vereqo-session':session,'x-vereqo-auth-correlation':correlation}});
 expect(status.status).toBe(200);
 expect(status.headers.get('x-vereqo-auth-correlation')).toBe(correlation);
 expect(status.headers.get('x-vereqo-auth-stage')).toBe('SESSION_STATUS_CONFIRMED');
 expect((await status.json()).session).toMatchObject({address:w.address,origin:a.base});
 const safeHeaders=JSON.stringify([...verified.headers.entries()]);
 expect(safeHeaders).not.toContain(challenge.value.nonce);
 expect(safeHeaders).not.toContain(signature);
 expect(safeHeaders).not.toContain(session);
});
