import { describe, it, expect } from 'vitest';
import { Wallet } from 'ethers';
import { WalletConnection, walletChallengeIssue, type EthereumProvider } from '../packages/domain/src/wallet.js';
import { WalletAuthRegistry } from '../services/issuer/src/wallet-auth.js';
const wallet = Wallet.createRandom();
const origin = 'http://127.0.0.1:4317';
describe('wallet ownership authentication', () => {
 it('recovers ownership and consumes challenge; sessions expire and revoke', async () => {
  let now=100; const registry = new WalletAuthRegistry(origin,()=>now);
  const c=registry.issue(wallet.address), signature=await wallet.signTypedData(c.domain,c.types,c.value);
  const token=registry.verify(c.value.nonce,signature,origin); expect(registry.authenticate(token)).toMatchObject({address:wallet.address,origin});
  expect(()=>registry.verify(c.value.nonce,signature,origin)).toThrow(); registry.revoke(token);expect(registry.authenticate(token)).toBeNull();
  const c2=registry.issue(wallet.address), token2=registry.verify(c2.value.nonce,await wallet.signTypedData(c2.domain,c2.types,c2.value),origin);
  now=701; expect(registry.authenticate(token2)).toBeNull();
 });
 it('rejects expired, wrong domain, chain, origin and signer', async()=>{
  let now=100;const r=new WalletAuthRegistry(origin,()=>now);
  const expired=r.issue(wallet.address);now=220;expect(()=>r.verify(expired.value.nonce,'0x',origin)).toThrow('CHALLENGE_EXPIRED');
  for(const domain of [{name:'OTHER'},{chainId:'1'}]){const c=r.issue(wallet.address);const s=await wallet.signTypedData({...c.domain,...domain},c.types,c.value);expect(()=>r.verify(c.value.nonce,s,origin)).toThrow('SIGNATURE_INVALID');}
  const c=r.issue(wallet.address);expect(()=>r.verify(c.value.nonce,'0x','https://evil.example')).toThrow('ORIGIN_MISMATCH');
  const other=Wallet.createRandom();expect(()=>r.verify(c.value.nonce,other.signingKey.sign('0x'+'11'.repeat(32)).serialized,origin)).toThrow('SIGNATURE_INVALID');
 });
 it('distinguishes expired, consumed, and unknown challenges with bounded hashed tombstones',()=>{
  let now=100;const r=new WalletAuthRegistry(origin,()=>now);const expired=r.issue(wallet.address);now=220;expect(()=>r.verify(expired.value.nonce,'0x',origin)).toThrow('CHALLENGE_EXPIRED');
  const used=r.issue(wallet.address);expect(()=>r.verify(used.value.nonce,'0x',origin)).toThrow('SIGNATURE_INVALID');expect(()=>r.verify(used.value.nonce,'0x',origin)).toThrow('CHALLENGE_ALREADY_USED');expect(r.knowsChallenge(used.value.nonce)).toBe(true);
  expect(()=>r.verify('0x'+'99'.repeat(32),'0x',origin)).toThrow('CHALLENGE_UNKNOWN');
 });
 it('does not let caller mutate registered challenge',async()=>{const r=new WalletAuthRegistry(origin);const c=r.issue(wallet.address);c.value.origin='https://evil.example';expect(()=>r.verify(c.value.nonce,'0x',origin)).toThrow();});
 it('bounds challenge memory',()=>{const r=new WalletAuthRegistry(origin);for(let i=0;i<256;i++)r.issue(wallet.address);expect(()=>r.issue(wallet.address)).toThrow('AUTH_CAPACITY');});
 it('bounds session memory and prunes expired sessions before admitting another', async () => {
  let now = 100; const r = new WalletAuthRegistry(origin, () => now);
  for (let i = 0; i < 256; i++) {const c = r.issue(wallet.address); r.verify(c.value.nonce, await wallet.signTypedData(c.domain, c.types, c.value), origin);}
  const rejected = r.issue(wallet.address), signature = await wallet.signTypedData(rejected.domain, rejected.types, rejected.value);
  expect(() => r.verify(rejected.value.nonce, signature, origin)).toThrow('SESSION_CAPACITY');
  now = 700; const c = r.issue(wallet.address); const token = r.verify(c.value.nonce, await wallet.signTypedData(c.domain, c.types, c.value), origin);
  const session = r.authenticate(token)!; session.address = Wallet.createRandom().address;
  expect(r.authenticate(token)?.address).toBe(wallet.address);
 });
});
function provider(){const listeners=new Map<string,(...args:unknown[])=>void>();let chain='0x59f';let cancel=false;const p:EthereumProvider={on:(e,l)=>{listeners.set(e,l);},removeListener:e=>{listeners.delete(e);},request:async({method})=>{if(cancel)throw Error('USER_REJECTED');if(method==='eth_chainId')return chain;if(method==='eth_requestAccounts'||method==='eth_accounts')return [wallet.address];if(method==='eth_signTypedData_v4'){listeners.get('accountsChanged')?.();return '0x';}throw Error('FORBIDDEN_METHOD');}};return{p,listeners,setChain:(c:string)=>{chain=c;},cancel:()=>{cancel=true;}};}
describe('explicit EIP1193 connection',()=>{
 it('connects only correct network and propagates cancellation',async()=>{const p=provider(),c=new WalletConnection(p.p);p.setChain('0x1');await expect(c.connect()).rejects.toThrow('WRONG_NETWORK');expect(c.address).toBeNull();p.cancel();await expect(c.connect()).rejects.toThrow('USER_REJECTED');});
 for(const event of ['accountsChanged','chainChanged','disconnect'])it(`invalidates on ${event}`,async()=>{const p=provider(),c=new WalletConnection(p.p);await c.connect();c.session='token';p.listeners.get(event)?.();expect(c.address).toBeNull();expect(c.session).toBeNull();});
 it('rejects account switch during authentication and supports disconnect',async()=>{const p=provider(),c=new WalletConnection(p.p);await c.connect();const challenge=new WalletAuthRegistry(origin).issue(wallet.address);let called=false;await expect(c.authenticate(challenge,async()=>{called=true;return'token';},async()=>{})).rejects.toThrow('WALLET_CHANGED');expect(called).toBe(false);expect(c.session).toBeNull();await c.connect();c.disconnect();expect(c.address).toBeNull();c.dispose();expect(p.listeners.size).toBe(0);});
});

describe('post-verification session cleanup',()=>{
 function setup(){
  const listeners=new Map<string,(...args:unknown[])=>void>(); let chain='0x59f', account=wallet.address, fail=false;
  const p:EthereumProvider={on:(e,l)=>{listeners.set(e,l);}, request:async({method})=>{
   if(fail)throw Error('PROVIDER_FAILED');
   if(method==='eth_chainId')return chain;
   if(method==='eth_accounts'||method==='eth_requestAccounts')return [account];
   if(method==='eth_signTypedData_v4')return '0xsignature';
   throw Error('UNEXPECTED');
  }};
  return {c:new WalletConnection(p),listeners,setChain:(value:string)=>{chain=value;},setAccount:(value:string)=>{account=value;},fail:()=>{fail=true;}};
 }
 for(const event of ['accountsChanged','disconnect'])it(`revokes issued token after ${event} during pending verify`,async()=>{
  const {c,listeners}=setup();await c.connect();let release!:(token:string)=>void, started!:()=>void;
  const pending=new Promise<string>(resolve=>{release=resolve;}), entered=new Promise<void>(resolve=>{started=resolve;});
  const registry=new WalletAuthRegistry(origin), challenge=registry.issue(wallet.address);
  const token=registry.verify(challenge.value.nonce,await wallet.signTypedData(challenge.domain,challenge.types,challenge.value),origin);
  const revoked:string[]=[];
  const result=c.authenticate(challenge,async()=>{started();return pending;},async value=>{revoked.push(value);registry.revoke(value);});
  await entered;listeners.get(event)?.();release(token);
  await expect(result).rejects.toThrow('WALLET_CHANGED');expect(revoked).toEqual([token]);expect(registry.authenticate(token)).toBeNull();expect(c.session).toBeNull();
 });
 for(const scenario of ['chain','account','provider'])it(`revokes token after final ${scenario} recheck fails without events`,async()=>{
  const p=setup();await p.c.connect();const revoked:string[]=[];
  await expect(p.c.authenticate(new WalletAuthRegistry(origin).issue(wallet.address),async()=>{
   if(scenario==='chain')p.setChain('0x1');else if(scenario==='account')p.setAccount(Wallet.createRandom().address);else p.fail();return 'issued-token';
  },async token=>{revoked.push(token);})).rejects.toThrow();
  expect(revoked).toEqual(['issued-token']);expect(p.c.session).toBeNull();expect(p.c.address).toBeNull();
 });
 it('surfaces cleanup failure and retains no local session',async()=>{
  const p=setup();await p.c.connect();await expect(p.c.authenticate(new WalletAuthRegistry(origin).issue(wallet.address),async()=>{p.setChain('0x1');return 'token';},async()=>{throw Error('NETWORK_FAILED');})).rejects.toThrow('AUTH_SESSION_REVOCATION_FAILED');expect(p.c.session).toBeNull();
 });
 it('retains successful session without revoking it',async()=>{
  const {c}=setup();await c.connect();let revoked=false;await c.authenticate(new WalletAuthRegistry(origin).issue(wallet.address),async()=> 'token',async()=>{revoked=true;});expect(c.session).toBe('token');expect(revoked).toBe(false);
 });
});


describe('strict signable challenge and concurrent authentication', () => {
 function setup(now = Math.floor(Date.now() / 1000)) {
  let signatures = 0;
  const c = new WalletConnection({request: async ({method}) => {
   if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet.address];
   if (method === 'eth_chainId') return '0x59f';
   if (method === 'eth_signTypedData_v4') { signatures++; return '0xsignature'; }
   throw Error('UNEXPECTED');
  }}, origin, () => now);
  return {c, challenge: () => new WalletAuthRegistry(origin, () => now).issue(wallet.address), signatures: () => signatures};
 }
 const mutations:[string,string][]=[['origin','ORIGIN_MISMATCH'],['expiry','EXPIRED'],['future','NOT_YET_VALID'],['lifetime','TTL_INVALID'],['nonce','NONCE_INVALID'],['extraDomain','MALFORMED_CHALLENGE'],['extraValue','MALFORMED_CHALLENGE'],['extraType','MALFORMED_CHALLENGE'],['retypedField','TYPES_MISMATCH']];
 for (const [mutation,expectedIssue] of mutations) it(`rejects ${mutation} before asking for a signature`, async () => {
  const p = setup(1000); await p.c.connect(); const challenge = p.challenge();
  if (mutation === 'origin') challenge.value.origin = 'https://other.example';
  if (mutation === 'expiry') challenge.value.expiresAt = '1000';
  if (mutation === 'future') challenge.value.issuedAt = '1001';
  if (mutation === 'lifetime') challenge.value.expiresAt = '1121';
  if (mutation === 'nonce') challenge.value.nonce = '0x01';
  if (mutation === 'extraDomain') challenge.domain.verifyingContract = wallet.address;
  if (mutation === 'extraValue') Object.assign(challenge.value, {executionApproval: true});
  if (mutation === 'extraType') challenge.types.Execution = [{name: 'amount', type: 'uint256'}];
  if (mutation === 'retypedField') challenge.types.WalletAuthentication![0]!.type = 'string';
  expect(walletChallengeIssue(challenge,wallet.address,origin,1000)).toBe(expectedIssue);
  await expect(p.c.authenticate(challenge, async () => 'token', async () => {})).rejects.toThrow(`CHALLENGE_${expectedIssue}`);
  expect(p.signatures()).toBe(0); expect(p.c.session).toBeNull();
 });
 it('supersedes an older pending verification and revokes its late token', async () => {
  const p = setup(); await p.c.connect();
  let release!: (token: string) => void, entered!: () => void;
  const pending = new Promise<string>(resolve => {release = resolve;});
  const started = new Promise<void>(resolve => {entered = resolve;}); const revoked: string[] = [];
  const older = p.c.authenticate(p.challenge(), async () => {entered(); return pending;}, async token => {revoked.push(token);});
  // Attach rejection handling before a later attempt invalidates this operation.
  const rejected = expect(older).rejects.toThrow('WALLET_CHANGED');
  await started;
  await p.c.authenticate(p.challenge(), async () => 'newer-token', async token => {revoked.push(token);});
  release('older-token'); await rejected;
  expect(p.c.session).toBe('newer-token'); expect(revoked).toEqual(['older-token']);
 });
 it('revokes an existing session before asking for another signature', async () => {
  const p = setup(); await p.c.connect(); p.c.session = 'previous-token'; const revoked: string[] = [];
  await p.c.authenticate(p.challenge(), async () => 'new-token', async token => {expect(p.signatures()).toBe(0); revoked.push(token);});
  expect(revoked).toEqual(['previous-token']); expect(p.c.session).toBe('new-token');
 });
 it('refuses another signature when previous session revocation fails', async () => {
  const p = setup(); await p.c.connect(); p.c.session = 'previous-token';
  await expect(p.c.authenticate(p.challenge(), async () => 'new-token', async () => {throw Error('NETWORK_FAILED');})).rejects.toThrow('AUTH_SESSION_REVOCATION_FAILED');
  expect(p.signatures()).toBe(0); expect(p.c.session).toBeNull();
 });
 it('does not restore a connection after disconnect during pending requestAccounts', async () => {
  let release!: (accounts: string[]) => void;
  const pending = new Promise<string[]>(resolve => {release = resolve;});
  const c = new WalletConnection({request: async ({method}) => method === 'eth_requestAccounts' ? pending : '0x59f'});
  const connecting = c.connect(); c.disconnect(); release([wallet.address]);
  await expect(connecting).rejects.toThrow('WALLET_CHANGED'); expect(c.address).toBeNull();
 });
});
