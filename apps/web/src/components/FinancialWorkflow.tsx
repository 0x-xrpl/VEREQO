import {useEffect,useRef,useState} from 'react';
import {WalletConnection,walletChallengeIssue,type EthereumProvider,type WalletChallenge,type WalletAuthStage} from '../../../../packages/domain/src/wallet';
import {formatSpotPrice,marketApiTicks,type LiveSnapshot} from '../../../../packages/domain/src/live-injective';
import {Dial} from './Dial';
import {LcdMeter} from './LcdMeter';
import type {FinancialObjectTrace} from './FinancialObjectTrace';
import {ScenarioRehearsal,clearSavedRehearsal,readSavedRehearsal,saveRehearsal} from './ScenarioRehearsal';
import type {RehearsalResult,RehearsalView} from '../../../../packages/domain/src/rehearsal';
import {parseAuthorizationHistory,type AuthorizationEvidence} from '../authorizationEvidence';
import {parseFinancialFinalizationHistory,type FinancialFinalizationEvidence} from '../finalizationEvidence';
import '../financial.css';
type WalletSessionInfo = {address:string;origin:string;expiresAt:number};
class WalletAuthFlowError extends Error { constructor(readonly code:string){super(code);this.name='WalletAuthFlowError';} }
const SAFE_WALLET_AUTH_CODES=new Set(['MALFORMED_CHALLENGE','DOMAIN_MISMATCH','CHAIN_MISMATCH','ADDRESS_MISMATCH','TYPES_MISMATCH','ORIGIN_MISMATCH','NONCE_INVALID','TIMESTAMP_INVALID','NOT_YET_VALID','EXPIRED','TTL_INVALID','WALLET_NOT_CONNECTED','WALLET_WRONG_CHAIN','WALLET_ACCOUNT_CHANGED','WALLET_CHANGED','WALLET_SIGNATURE_REJECTED','WALLET_REQUEST_PENDING','WALLET_SIGNATURE_FAILED','AUTH_SESSION_REVOCATION_FAILED','CHALLENGE_EXPIRED','CHALLENGE_ALREADY_USED','CHALLENGE_UNKNOWN','CHALLENGE_CAPACITY','SIGNATURE_INVALID','SESSION_CAPACITY','AUTHENTICATION_FAILED','AUTH_ORIGIN_REQUIRED','INVALID_ORIGIN','INVALID_HOST','INVALID_ADDRESS','INVALID_AUTH_REQUEST','INVALID_FIELDS','INVALID_JSON']);
const SAFE_WALLET_SERVER_CODES=new Set(['CHALLENGE_EXPIRED','CHALLENGE_ALREADY_USED','CHALLENGE_UNKNOWN','CHALLENGE_CAPACITY','ORIGIN_MISMATCH','SIGNATURE_INVALID','SESSION_CAPACITY','AUTHENTICATION_FAILED','AUTH_ORIGIN_REQUIRED','INVALID_ORIGIN','INVALID_HOST','INVALID_ADDRESS','INVALID_AUTH_REQUEST','INVALID_FIELDS','INVALID_JSON']);
function safeWalletErrorCode(error:unknown,fallback:string):string{
 if(error instanceof WalletAuthFlowError)return error.code;
 if(error instanceof Error&&(SAFE_WALLET_AUTH_CODES.has(error.message)||error.message.startsWith('CHALLENGE_')&&SAFE_WALLET_AUTH_CODES.has(error.message.slice('CHALLENGE_'.length))))return error.message;
 const providerCode=error&&typeof error==='object'?(error as {code?:unknown}).code:undefined;
 if(providerCode===4001||providerCode==='ACTION_REJECTED')return 'WALLET_SIGNATURE_REJECTED';
 if(providerCode===-32002)return 'WALLET_REQUEST_PENDING';
 return fallback;
}
async function serverAuthFailure(response:Response,prefix:'CHALLENGE_SERVER'|'VERIFY'):Promise<string>{
 let code:string|undefined;
 try{const body=await response.clone().json() as {error?:unknown};if(typeof body.error==='string'&&SAFE_WALLET_SERVER_CODES.has(body.error))code=body.error;}catch{}
 return code?`${prefix}_${code}`:`${prefix}_HTTP_${response.status}`;
}
function safeTransportErrorName(error:unknown):string{
 const name=error&&typeof error==='object'?(error as {name?:unknown}).name:undefined;
 return name==='TypeError'||name==='AbortError'||name==='SecurityError'||name==='NetworkError'?name:'UNKNOWN';
}
function walletAuthFailureText(code:string,language:'ja'|'en'):string{
 const japanese=language==='ja';
 const messages:Record<string,[string,string]>={
  AUTH_SERVER_RESTARTED:['認証サーバーが途中で再起動・切替されました。新しいChallengeが必要です。','Authentication server restarted or changed. Prepare a fresh challenge.'],
  AUTH_CORRELATION_MISMATCH:['認証診断の相関IDが応答と一致しません。新しいChallengeから再試行してください。','Authentication diagnostic correlation did not match the response. Prepare a fresh challenge.'],
  CHALLENGE_EXPIRED:['Challengeの期限が切れています。新しいChallengeを準備してください。','Challenge expired. Prepare a fresh challenge.'],
  CHALLENGE_ALREADY_USED:['Challengeは既に使用済みです。新しいChallengeを準備してください。','Challenge was already consumed. Prepare a fresh challenge.'],
  CHALLENGE_UNKNOWN:['Challengeがサーバーで見つかりません。新しいChallengeを準備してください。','Challenge was not found on the server. Prepare a fresh challenge.'],
  CHALLENGE_ORIGIN_MISMATCH:['ChallengeのOriginがこの画面と一致しません。','Challenge Origin does not match this page.'],
  CHALLENGE_CHAIN_MISMATCH:['ChallengeのChain IDが1439ではありません。','Challenge Chain ID is not 1439.'],
  CHALLENGE_DOMAIN_MISMATCH:['EIP-712 DomainがVEREQO認証用と一致しません。','EIP-712 domain does not match VEREQO authentication.'],
  CHALLENGE_TYPES_MISMATCH:['EIP-712型定義が期待値と一致しません。','EIP-712 type definitions do not match the expected schema.'],
  WALLET_SIGNATURE_REJECTED:['MetaMaskで署名が拒否またはキャンセルされました。','MetaMask rejected or cancelled the signature request.'],
  WALLET_REQUEST_PENDING:['MetaMaskに未処理の要求があります。Wallet内の保留要求を確認してください。','MetaMask already has a pending request. Check the wallet.'],
  WALLET_WRONG_CHAIN:['署名前のWallet Chain IDが1439ではありません。','Wallet Chain ID is not 1439 before signing.'],
  WALLET_ACCOUNT_CHANGED:['署名前後でWalletアカウントが変わりました。','Wallet account changed during authentication.'],
  WALLET_CHANGED:['認証中にWallet接続が変更されました。','Wallet connection changed during authentication.'],
  CHALLENGE_SERVER_AUTH_ORIGIN_REQUIRED:['Challenge要求のOriginをサーバーが受理しませんでした。','Server rejected the Origin on the challenge request.'],
  CHALLENGE_SERVER_INVALID_ORIGIN:['Challenge要求のOriginは許可されていません。','Challenge request Origin is not allowed.'],
  CHALLENGE_SERVER_CHALLENGE_CAPACITY:['認証Challengeの一時容量上限です。時間を置いて再試行してください。','Authentication challenge capacity is temporarily full. Retry later.'],
  CHALLENGE_SERVER_INVALID_ADDRESS:['WalletアドレスをChallenge APIが受理しませんでした。','Challenge API rejected the Wallet address.'],
  CHALLENGE_SERVER_INVALID_AUTH_REQUEST:['Challenge要求の形式がサーバーで拒否されました。','The server rejected the challenge request format.'],
  CHALLENGE_SERVER_SESSION_CAPACITY:['認証Sessionの一時容量上限に達しました。','Authentication session capacity is temporarily full.'],
  VERIFY_SIGNATURE_INVALID:['サーバーがEIP-712署名を検証できませんでした。','Server rejected the EIP-712 signature.'],
  VERIFY_CHALLENGE_EXPIRED:['サーバーChallengeの期限が切れています。新しいChallengeを準備してください。','Server challenge expired. Prepare a fresh challenge.'],
  VERIFY_CHALLENGE_ALREADY_USED:['サーバーChallengeは既に使用済みです。新しいChallengeを準備してください。','Server challenge was already used. Prepare a fresh challenge.'],
  VERIFY_CHALLENGE_UNKNOWN:['サーバーにChallengeが見つかりません。新しいChallengeを準備してください。','Server could not find the challenge. Prepare a fresh one.'],
  VERIFY_ORIGIN_MISMATCH:['サーバー側のChallenge Originが一致しません。','Server-side challenge Origin does not match.'],
  STATUS_NO_SESSION:['署名後のstatus応答に認証Sessionがありません。','The post-sign status response has no authenticated session.'],
  STATUS_ADDRESS_MISMATCH:['サーバーSessionのWalletが接続Walletと一致しません。','Server session Wallet does not match the connected Wallet.'],
  STATUS_ORIGIN_MISMATCH:['サーバーSessionのOriginがこの画面と一致しません。','Server session Origin does not match this page.'],
  STATUS_SESSION_EXPIRED:['サーバーSessionの有効期限が切れています。','Server session has expired.'],
  VERIFY_NETWORK_ERROR:['/api/wallet/verifyへ到達できませんでした。','Could not reach /api/wallet/verify.'],
  STATUS_NETWORK_ERROR:['/api/wallet/statusへ到達できませんでした。','Could not reach /api/wallet/status.'],
 };
 const message=messages[code]?.[japanese?0:1]??(japanese?'認証処理がこの段階で停止しました。':'Authentication stopped at this stage.');
 return `${message} [${code}] ${japanese?'金融実行の承認はありません。':'No financial approval granted.'}`;
}
function authTime(seconds:string):string{const n=Number(seconds);return Number.isSafeInteger(n)&&n>=0?new Date(n*1000).toISOString():'INVALID_TIMESTAMP';}
const modes=['OVERVIEW','CAUSE','PROOF','WHAT-IF','EXECUTION','EVIDENCE'];
const jp=['概要','原因','証明','仮定を検査','実行','根拠'];
const decimal=(v:string)=>{if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(v))throw Error();const[a,b='']=v.split('.');const n=BigInt(a!+b.padEnd(18,'0'));if(n<=0n||n>=1n<<256n)throw Error();return n;};
export function FinancialWorkflow({language,onTraceSelect}:{language:'ja'|'en';onTraceSelect?:(trace:FinancialObjectTrace)=>void}){
 const ja=language==='ja',t=(en:string,j:string)=>ja?j:en;
 const [activeScenario,setActiveScenario]=useState<RehearsalView|null>(()=>readSavedRehearsal());
 const activeScenarioRef=useRef(activeScenario);activeScenarioRef.current=activeScenario;
 const [rehearsalResult,setRehearsalResult]=useState<RehearsalResult|null>(null);
 const [businessId,setBusinessId]=useState(()=>activeScenario?.businessId??'fi_'+globalThis.crypto.randomUUID().replaceAll('-',''));
 const [observation,setObservation]=useState<LiveSnapshot|null>(null),[mode,setMode]=useState(0),[version,setVersion]=useState(activeScenario?.revision??0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[authFailureCode,setAuthFailureCode]=useState(''),[address,setAddress]=useState(''),[verified,setVerified]=useState(false),[walletSession,setWalletSession]=useState<WalletSessionInfo|null>(null),[walletChallenge,setWalletChallenge]=useState<WalletChallenge|null>(null),[challengeNow,setChallengeNow]=useState(()=>Math.floor(Date.now()/1000)),[price,setPrice]=useState(activeScenario?.intent?.limitPrice??''),[quantity,setQuantity]=useState(activeScenario?.intent?.quantity??''),[revoked,setRevoked]=useState(false),[marketKind,setMarketKind]=useState<'SPOT'|'DERIVATIVE'>('SPOT'),[side,setSide]=useState<'BUY'|'SELL'>(activeScenario?.intent?.side??'BUY'),[evidenceState,setEvidenceState]=useState<'NOT_REQUESTED'|'AUTHENTICATION_REQUIRED'|'LOADING'|'NO_RECORD'|'AVAILABLE'|'UNKNOWN'>(activeScenario?.evidenceState??'NOT_REQUESTED'),[authorizationEvidence,setAuthorizationEvidence]=useState<AuthorizationEvidence|null>(null),[evidenceEventCount,setEvidenceEventCount]=useState(0);
 const [finalizationEvidenceState,setFinalizationEvidenceState]=useState<'NOT_REQUESTED'|'AUTHENTICATION_REQUIRED'|'LOADING'|'NO_RECORD'|'AVAILABLE'|'UNKNOWN'>('NOT_REQUESTED'),[finalizationEvidence,setFinalizationEvidence]=useState<FinancialFinalizationEvidence|null>(null);
 const [draftReviewState,setDraftReviewState]=useState<'NOT_SUBMITTED'|'SUBMITTING'|'REJECTED'|'AUTHENTICATION_REQUIRED'|'UNKNOWN'>('NOT_SUBMITTED'),[draftReviewReason,setDraftReviewReason]=useState('');
 const [recordOnly,setRecordOnly]=useState(false),[requestLookup,setRequestLookup]=useState(''),[lookupBusy,setLookupBusy]=useState(false),[lookupError,setLookupError]=useState('');
 const businessIdRef=useRef(businessId);businessIdRef.current=businessId;
 const revisionRef=useRef(version);revisionRef.current=version;
 const wallet=useRef<WalletConnection|null>(null);
 const authLock=useRef(false),challengeInstance=useRef<string|null>(null),authCorrelation=useRef<string|null>(null);
 const [authRunning,setAuthRunning]=useState(false),[authTrace,setAuthTrace]=useState<string[]>([]);
 const traceAuth=(stage:WalletAuthStage|string)=>setAuthTrace(rows=>[...rows.slice(-23),new Date().toISOString()+' '+stage+' cid='+(authCorrelation.current??'none')+(challengeInstance.current?' instance='+challengeInstance.current:'')]);
 function authRequestHeaders(extra:Record<string,string>={}):Record<string,string>{return {...extra,...(authCorrelation.current?{'x-vereqo-auth-correlation':authCorrelation.current}:{})};}
 function observeAuthResponse(response:Response){
  const instance=response.headers.get('x-vereqo-auth-instance');
  if(instance&&challengeInstance.current&&instance!==challengeInstance.current){traceAuth('SERVER_INSTANCE_CHANGED');throw new WalletAuthFlowError('AUTH_SERVER_RESTARTED');}
  if(instance&&!challengeInstance.current){challengeInstance.current=instance;traceAuth('SERVER_INSTANCE_CONFIRMED');}
  const responseCorrelation=response.headers.get('x-vereqo-auth-correlation');
  if(authCorrelation.current&&responseCorrelation&&responseCorrelation!==authCorrelation.current){traceAuth('AUTH_CORRELATION_MISMATCH');throw new WalletAuthFlowError('AUTH_CORRELATION_MISMATCH');}
  if(authCorrelation.current&&!responseCorrelation)traceAuth('AUTH_CORRELATION_UNCONFIRMED');
  const reported=[...(response.headers.get('x-vereqo-auth-stages')??'').split(','),response.headers.get('x-vereqo-auth-stage')??''].filter(stage=>/^[A-Z][A-Z0-9_]*$/.test(stage));
  for(const stage of reported)traceAuth('SERVER_STAGE_'+stage);
 }
 async function diagnoseChallengeTransportFailure(error:unknown):Promise<never>{
  const origin=window.location.origin;
  traceAuth(`CHALLENGE_FETCH_REJECTED name=${safeTransportErrorName(error)} http=NONE url=${origin}/api/wallet/challenge online=${navigator.onLine?'YES':'NO'}`);
  // Same-origin read only: checks whether the page can still reach the API
  // without sending an address, challenge, signature or session token.
  try{
   const response=await fetch('/api/wallet/status',{method:'GET',headers:authRequestHeaders()});
   traceAuth(`CHALLENGE_DIAGNOSTIC_PROBE_HTTP_${response.status}`);
   const stage=response.headers.get('x-vereqo-auth-stage');
   if(stage&&/^[A-Z][A-Z0-9_]*$/.test(stage))traceAuth('CHALLENGE_DIAGNOSTIC_PROBE_SERVER_STAGE_'+stage);
   const instance=response.headers.get('x-vereqo-auth-instance');
   traceAuth(`CHALLENGE_DIAGNOSTIC_PROBE_SERVER_INSTANCE_${instance?'PRESENT':'MISSING'}`);
   const correlation=response.headers.get('x-vereqo-auth-correlation');
   traceAuth(`CHALLENGE_DIAGNOSTIC_PROBE_CORRELATION_${correlation===authCorrelation.current?'MATCH':correlation?'MISMATCH':'MISSING'}`);
  }catch(probeError){
   traceAuth(`CHALLENGE_DIAGNOSTIC_PROBE_NETWORK_${safeTransportErrorName(probeError)}`);
  }
  throw new WalletAuthFlowError('CHALLENGE_NETWORK_ERROR');
 }
 const marketReadGeneration=useRef(0),walletGeneration=useRef(0),evidenceReadGeneration=useRef(0),finalizationReadGeneration=useRef(0);
 function resetDraftReview(){
  evidenceReadGeneration.current++;finalizationReadGeneration.current++;
  if(recordOnly||draftReviewState==='REJECTED'||draftReviewState==='UNKNOWN'||draftReviewState==='SUBMITTING'||evidenceState==='LOADING'||authorizationEvidence)setBusinessId('fi_'+globalThis.crypto.randomUUID().replaceAll('-',''));
  setRecordOnly(false);
  setDraftReviewState(verified?'NOT_SUBMITTED':'AUTHENTICATION_REQUIRED');setDraftReviewReason('');
  setAuthorizationEvidence(null);setEvidenceEventCount(0);setEvidenceState(verified?'NOT_REQUESTED':'AUTHENTICATION_REQUIRED');
  setFinalizationEvidence(null);setFinalizationEvidenceState(verified?'NOT_REQUESTED':'AUTHENTICATION_REQUIRED');
 }
 function invalidateEvidenceRead(){
  evidenceReadGeneration.current++;finalizationReadGeneration.current++;
  setAuthorizationEvidence(null);setEvidenceEventCount(0);
  setEvidenceState(verified?'NOT_REQUESTED':'AUTHENTICATION_REQUIRED');
  setFinalizationEvidence(null);setFinalizationEvidenceState(verified?'NOT_REQUESTED':'AUTHENTICATION_REQUIRED');
 }
 useEffect(()=>{
  const provider=(window as Window&{ethereum?:EthereumProvider}).ethereum;
  const invalidate=()=>{
   if(activeScenarioRef.current)return;
   const connection=wallet.current,token=connection?.session;
   if(token)void fetch('/api/wallet/logout',{method:'POST',headers:authRequestHeaders({'content-type':'application/json','x-vereqo-session':token}),body:'{}'}).catch(()=>{});
   walletGeneration.current++;wallet.current=null;connection?.dispose();
   resetDraftReview();setAddress('');setVerified(false);setWalletSession(null);setWalletChallenge(null);setAuthFailureCode('');setEvidenceState('AUTHENTICATION_REQUIRED');setDraftReviewState('AUTHENTICATION_REQUIRED');
  };
  for(const e of ['accountsChanged','chainChanged','disconnect'])provider?.on?.(e,invalidate);
  return()=>{
   marketReadGeneration.current++;walletGeneration.current++;evidenceReadGeneration.current++;
   wallet.current?.dispose();wallet.current=null;
   for(const e of ['accountsChanged','chainChanged','disconnect'])provider?.removeListener?.(e,invalidate);
  };
 },[]);
 useEffect(()=>{
  if(!walletChallenge)return;
  const tick=()=>setChallengeNow(Math.floor(Date.now()/1000));tick();
  const timer=window.setInterval(tick,1000);
  return()=>window.clearInterval(timer);
 },[walletChallenge]);
 async function read(){
  const generation=++marketReadGeneration.current;
  setBusy(true);setError('');
  try{
   const r=await fetch('/api/financial/market');
   if(generation!==marketReadGeneration.current)return;
   if(!r.ok)throw Error();
   const {snapshot:s}=await r.json() as {snapshot:LiveSnapshot};
   if(generation!==marketReadGeneration.current)return;
   if(s.status!=='LIVE_READ_ONLY'||s.chainId!=='1439')throw Error();
   marketApiTicks(s.market);resetDraftReview();setObservation(s);setVersion(v=>v+1);
  }catch{
   if(generation!==marketReadGeneration.current)return;
   resetDraftReview();setObservation(null);setVersion(v=>v+1);
   setError(t('Testnet observation unavailable. State is UNKNOWN.','Testnet観測を取得できません。状態はUNKNOWNです。'));
  }finally{if(generation===marketReadGeneration.current)setBusy(false);}
 }
 async function connect(){
  disconnect();setError('');setAuthFailureCode('');setVerified(false);
  const generation=walletGeneration.current;
  let connection:WalletConnection|null=null;
  try{
   const p=(window as Window&{ethereum?:EthereumProvider}).ethereum;
   if(!p)throw Error();
   connection=new WalletConnection(p);wallet.current=connection;
   const nextAddress=await connection.connect();
   if(generation!==walletGeneration.current||wallet.current!==connection){connection.dispose();return;}
   setAddress(nextAddress);
  }catch{
   if(generation!==walletGeneration.current||(connection&&wallet.current!==connection))return;
   if(connection&&wallet.current===connection){connection.dispose();wallet.current=null;}
   setAddress('');setError(t('Connect a supported EVM wallet on Injective Testnet (1439).','Injective Testnet（1439）の対応EVMウォレットを接続してください。'));
  }
 }
 async function prepareAuthentication(){
  const c=wallet.current;if(!c?.address||authLock.current)return;
  authCorrelation.current=globalThis.crypto.randomUUID();challengeInstance.current=null;
  authLock.current=true;setAuthRunning(true);setAuthTrace([]);traceAuth('CHALLENGE_REQUESTED');
  const generation=walletGeneration.current;
  setWalletChallenge(null);setError('');setAuthFailureCode('');
  try{
   let response:Response;
   try{response=await fetch('/api/wallet/challenge',{method:'POST',headers:authRequestHeaders({'content-type':'application/json'}),body:JSON.stringify({address:c.address})});}
   catch(error){if(generation!==walletGeneration.current||wallet.current!==c)return;await diagnoseChallengeTransportFailure(error);throw new WalletAuthFlowError('CHALLENGE_NETWORK_ERROR');}
   if(generation!==walletGeneration.current||wallet.current!==c)return;
   traceAuth('CHALLENGE_HTTP_RESULT_'+response.status);observeAuthResponse(response);
   if(!response.ok)throw new WalletAuthFlowError(await serverAuthFailure(response,'CHALLENGE_SERVER'));
   let payload:{challenge?:unknown};
   try{payload=await response.json() as {challenge?:unknown};}catch{throw new WalletAuthFlowError('CHALLENGE_RESPONSE_INVALID');}
   if(generation!==walletGeneration.current||wallet.current!==c)return;
   const challenge=payload.challenge as WalletChallenge,issue=walletChallengeIssue(challenge,c.address,window.location.origin,Math.floor(Date.now()/1000));
   if(issue)throw new WalletAuthFlowError(`CHALLENGE_${issue}`);
   traceAuth('CHALLENGE_VALIDATED');setChallengeNow(Math.floor(Date.now()/1000));setWalletChallenge(challenge);
  }catch(error){
   if(generation!==walletGeneration.current||wallet.current!==c)return;
   const code=safeWalletErrorCode(error,'CHALLENGE_UNAVAILABLE');traceAuth('AUTH_FAILED_'+code);setAuthFailureCode(code);setError('');
  }finally{authLock.current=false;setAuthRunning(false);}
 }
 async function authenticate(){
  const c=wallet.current,challenge=walletChallenge;if(!c?.address||!challenge||authLock.current)return;
  const generation=walletGeneration.current;setError('');setAuthFailureCode('');
  const issue=walletChallengeIssue(challenge,c.address,window.location.origin,Math.floor(Date.now()/1000));
  if(issue){const code=`CHALLENGE_${issue}`;traceAuth('AUTH_FAILED_'+code);setWalletChallenge(null);setAuthFailureCode(code);return;}
  authLock.current=true;setAuthRunning(true);
  setVerified(false);setWalletSession(null);
  try{
   await c.authenticate(challenge,async signature=>{
    let response:Response;
    try{response=await fetch('/api/wallet/verify',{method:'POST',headers:authRequestHeaders({'content-type':'application/json'}),body:JSON.stringify({nonce:challenge.value.nonce,signature})});}
    catch{throw new WalletAuthFlowError('VERIFY_NETWORK_ERROR');}
    traceAuth('VERIFY_HTTP_RESULT_'+response.status);observeAuthResponse(response);
    const recovery=response.headers.get('x-vereqo-auth-diagnostic');
    if(recovery&&/^[A-Z][A-Z0-9_]*$/.test(recovery))traceAuth('SERVER_DIAGNOSTIC_'+recovery);
    if(!response.ok)throw new WalletAuthFlowError(await serverAuthFailure(response,'VERIFY'));
    let payload:{session?:unknown};
    try{payload=await response.json() as {session?:unknown};}catch{throw new WalletAuthFlowError('VERIFY_RESPONSE_INVALID');}
    if(typeof payload.session!=='string'||!/^[0-9a-f]{64}$/i.test(payload.session))throw new WalletAuthFlowError('VERIFY_SESSION_TOKEN_INVALID');
    return payload.session;
   },async session=>{
    const response=await fetch('/api/wallet/logout',{method:'POST',headers:authRequestHeaders({'content-type':'application/json','x-vereqo-session':session}),body:'{}'});
    if(!response.ok)throw Error('AUTH_SESSION_REVOCATION_FAILED');
   },traceAuth);
   if(generation!==walletGeneration.current||wallet.current!==c)return;
   const statusFailure=await inspectWalletSession(c);
   if(statusFailure)throw new WalletAuthFlowError(statusFailure);
   setWalletChallenge(null);
  }catch(error){
   if(generation!==walletGeneration.current||wallet.current!==c)return;
   setAddress(c.address??'');setVerified(false);setWalletSession(null);setWalletChallenge(null);
   const code=safeWalletErrorCode(error,'WALLET_AUTHENTICATION_INTERNAL_ERROR');traceAuth('AUTH_FAILED_'+code);setAuthFailureCode(code);setError('');
  }finally{authLock.current=false;setAuthRunning(false);}
 }
 async function readAuthorizationEvidence(){
  if(activeScenarioRef.current){setEvidenceState('NO_RECORD');return;}
  const c=wallet.current,token=c?.session;
  if(!verified||!c||!token){setEvidenceState('AUTHENTICATION_REQUIRED');return;}
  void readFinalizationEvidence();
  const walletRead=walletGeneration.current,requestId=businessId,revision=version,readGeneration=++evidenceReadGeneration.current;
  const isCurrent=()=>readGeneration===evidenceReadGeneration.current&&walletRead===walletGeneration.current&&wallet.current===c&&c.session===token&&businessIdRef.current===requestId&&revisionRef.current===revision&&!activeScenarioRef.current;
  setEvidenceState('LOADING');setAuthorizationEvidence(null);setEvidenceEventCount(0);
  try{
   const response=await fetch('/api/agent/authorization/'+businessId,{headers:{'x-vereqo-session':token}});
   if(!isCurrent())return;
   if(response.status===404){setEvidenceState('NO_RECORD');return;}
   if(response.status===401){setEvidenceState('AUTHENTICATION_REQUIRED');return;}
   if(!response.ok)throw Error('EVIDENCE_UNAVAILABLE');
   const history=parseAuthorizationHistory(await response.json(),businessId,c.address??undefined);
   if(!isCurrent())return;
   setAuthorizationEvidence(history.evidence);setEvidenceEventCount(history.events.length);setEvidenceState('AVAILABLE');
  }catch{if(!isCurrent())return;setEvidenceState('UNKNOWN');}
 }
 async function readFinalizationEvidence(){
  if(activeScenarioRef.current){setFinalizationEvidenceState('NO_RECORD');setFinalizationEvidence(null);return;}
  const c=wallet.current,token=c?.session,requestId=businessId;
  if(!verified||!c||!token){setFinalizationEvidenceState('AUTHENTICATION_REQUIRED');setFinalizationEvidence(null);return;}
  const walletRead=walletGeneration.current,revision=version,readGeneration=++finalizationReadGeneration.current;
  const isCurrent=()=>readGeneration===finalizationReadGeneration.current&&walletRead===walletGeneration.current&&wallet.current===c&&c.session===token&&businessIdRef.current===requestId&&revisionRef.current===revision&&!activeScenarioRef.current;
  setFinalizationEvidenceState('LOADING');setFinalizationEvidence(null);
  try{
   const response=await fetch('/api/agent/finalization/'+requestId,{headers:{'x-vereqo-session':token}});
   if(!isCurrent())return;
   if(response.status===404){setFinalizationEvidenceState('NO_RECORD');return;}
   if(response.status===401){setFinalizationEvidenceState('AUTHENTICATION_REQUIRED');return;}
   if(!response.ok)throw Error('FINALIZATION_EVIDENCE_UNAVAILABLE');
   const history=parseFinancialFinalizationHistory(await response.json(),requestId,c.address??undefined);
   if(!isCurrent())return;
   setFinalizationEvidence(history.evidence);setFinalizationEvidenceState('AVAILABLE');
   onTraceSelect?.({
    ...traceForSelection,finalizationEvidenceState:'AVAILABLE',finalizationEvidenceId:history.evidence.id,
    finalizationEvidenceStatus:history.evidence.status,finalizationOwnerSignatureStatus:history.evidence.ownerSignatureStatus,
    finalizationEvidenceReason:history.evidence.reason,finalizationEvidenceHash:history.evidence.recordHash,
    finalizationProofDigest:history.evidence.proofDigest,
   });
  }catch{if(!isCurrent())return;setFinalizationEvidenceState('UNKNOWN');}
 }
 async function inspectStoredRequest(){
  const requestId=requestLookup.trim(),c=wallet.current,token=c?.session;
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(requestId)){setLookupError('INVALID_REQUEST_ID');return;}
  if(!verified||!c||!token||activeScenarioRef.current){setLookupError('WALLET_AUTHENTICATION_REQUIRED');return;}
  const generation=++evidenceReadGeneration.current,walletRead=walletGeneration.current,selectedId=businessId,revision=version;
  const current=()=>generation===evidenceReadGeneration.current&&walletRead===walletGeneration.current&&wallet.current===c&&c.session===token&&businessIdRef.current===selectedId&&revisionRef.current===revision&&!activeScenarioRef.current;
  setLookupBusy(true);setLookupError('');
  try{
   const response=await fetch('/api/agent/authorization/'+requestId,{headers:{'x-vereqo-session':token}});
   if(!current())return;
   if(response.status===404){setLookupError('NO_AUTHORIZATION_EVIDENCE_FOR_THIS_ID');return;}
   if(response.status===401){setLookupError('WALLET_AUTHENTICATION_REQUIRED');return;}
   if(!response.ok)throw Error();
   const history=parseAuthorizationHistory(await response.json(),requestId,c.address??undefined);
   if(!current())return;
   marketReadGeneration.current++;setBusy(false);
   setBusinessId(requestId);setVersion(0);setRecordOnly(true);setObservation(null);setPrice('');setQuantity('');setRevoked(false);
   setDraftReviewState('NOT_SUBMITTED');setDraftReviewReason('');
   setAuthorizationEvidence(history.evidence);setEvidenceEventCount(history.events.length);setEvidenceState('AVAILABLE');
   setFinalizationEvidence(null);setFinalizationEvidenceState('NOT_REQUESTED');
  }catch{if(current())setLookupError('EVIDENCE_UNKNOWN');}
  finally{setLookupBusy(false);}
 }
 async function submitDraftReview(){
  if(recordOnly)return;
  const c=wallet.current,token=c?.session,requestId=businessId;
  if(!verified||!c||!token){setDraftReviewState('AUTHENTICATION_REQUIRED');return;}
  setDraftReviewState('SUBMITTING');setDraftReviewReason('');
  const draft={chainId:'1439',marketKind,marketId:marketKind==='SPOT'?observation?.market?.marketId??null:observation?.derivativeMarket?.marketId??null,side,orderType:'LIMIT',price,quantity};
  try{
   if(!await checkSession(c)||wallet.current!==c||c.session!==token||businessIdRef.current!==requestId){setDraftReviewState('AUTHENTICATION_REQUIRED');return;}
   const response=await fetch('/api/agent/request-review',{method:'POST',headers:{'content-type':'application/json','x-vereqo-session':token},body:JSON.stringify({requestId,draft})});
   if(wallet.current!==c||c.session!==token||businessIdRef.current!==requestId){setDraftReviewState('AUTHENTICATION_REQUIRED');return;}
   if(response.status===401){setDraftReviewState('AUTHENTICATION_REQUIRED');await checkSession(c);return;}
   if(!response.ok)throw Error('DRAFT_REVIEW_UNAVAILABLE');
   const payload=await response.json() as Record<string,unknown>;
   const history=parseAuthorizationHistory({evidence:payload.evidence,events:[payload.evidence]},requestId,c.address??undefined);
   if(payload.status!=='REJECTED'||payload.authorized!==false||payload.execution!=='NOT_IMPLEMENTED'||typeof payload.reason!=='string'||history.evidence.status!=='REJECTED'||history.evidence.reason!==payload.reason)throw Error('INVALID_DRAFT_REVIEW_RESPONSE');
   if(wallet.current!==c||c.session!==token||businessIdRef.current!==requestId){setDraftReviewState('AUTHENTICATION_REQUIRED');return;}
   setDraftReviewState('REJECTED');setDraftReviewReason(payload.reason);setAuthorizationEvidence(history.evidence);setEvidenceEventCount(history.events.length);setMode(5);
   await readAuthorizationEvidence();
  }catch{
   if(wallet.current===c&&c.session===token&&businessIdRef.current===requestId){setDraftReviewState('UNKNOWN');setDraftReviewReason('UNKNOWN');setEvidenceState('UNKNOWN');setMode(5);}
  }
 }
 async function inspectWalletSession(c:WalletConnection):Promise<string|null>{
  const token=c.session;
  if(!token){setVerified(false);setWalletSession(null);return 'STATUS_NO_SESSION';}
  const sessionToken=token;
  const fail=(code:string)=>{if(wallet.current===c&&c.session===sessionToken){void fetch('/api/wallet/logout',{method:'POST',headers:authRequestHeaders({'content-type':'application/json','x-vereqo-session':sessionToken}),body:'{}'}).catch(()=>{});c.session=null;setVerified(false);setWalletSession(null);setDraftReviewState('AUTHENTICATION_REQUIRED');}return code;};
  let response:Response;
  traceAuth('STATUS_REQUESTED');
  try{response=await fetch('/api/wallet/status',{headers:authRequestHeaders({'x-vereqo-session':sessionToken})});}catch{return fail('STATUS_NETWORK_ERROR');}
  if(wallet.current!==c||c.session!==sessionToken)return 'WALLET_CHANGED';
  traceAuth('SESSION_STATUS_HTTP_RESULT_'+response.status);
  try{observeAuthResponse(response);}catch{return fail('AUTH_SERVER_RESTARTED');}
  if(!response.ok)return fail(`STATUS_HTTP_${response.status}`);
  let payload:{session?:unknown};
  try{payload=await response.json() as {session?:unknown};}catch{return fail('STATUS_RESPONSE_INVALID');}
  if(wallet.current!==c||c.session!==sessionToken)return 'WALLET_CHANGED';
  const raw=payload.session;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail('STATUS_NO_SESSION');
  const session=raw as Record<string,unknown>,expectedAddress=c.address?.toLowerCase();
  if(typeof session.address!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(session.address))return fail('STATUS_ADDRESS_INVALID');
  if(session.address.toLowerCase()!==expectedAddress)return fail('STATUS_ADDRESS_MISMATCH');
  if(typeof session.origin!=='string'||session.origin!==window.location.origin)return fail('STATUS_ORIGIN_MISMATCH');
  if(!Number.isSafeInteger(session.expiresAt))return fail('STATUS_EXPIRY_INVALID');
  const now=Math.floor(Date.now()/1000),expiresAt=session.expiresAt as number;
  if(expiresAt<=now)return fail('STATUS_SESSION_EXPIRED');
  if(expiresAt>now+600)return fail('STATUS_EXPIRY_OUT_OF_RANGE');
  const verifiedSession={address:session.address,origin:session.origin,expiresAt};
  traceAuth('STATUS_VERIFIED');setWalletSession(verifiedSession);setVerified(true);setDraftReviewState(state=>state==='AUTHENTICATION_REQUIRED'?'NOT_SUBMITTED':state);return null;
 }
 async function checkSession(c:WalletConnection):Promise<boolean>{return await inspectWalletSession(c)===null;}
 useEffect(()=>{if(!verified){setAuthorizationEvidence(null);setEvidenceEventCount(0);setEvidenceState(activeScenario?'NO_RECORD':'AUTHENTICATION_REQUIRED');setDraftReviewState(activeScenario?'NOT_SUBMITTED':'AUTHENTICATION_REQUIRED');return;}const id=setInterval(()=>{const c=wallet.current;if(c)void checkSession(c);},30000);return()=>clearInterval(id);},[verified,activeScenario?.businessId]);
 function disconnect(){
  const connection=wallet.current,session=connection?.session;
  if(session)void fetch('/api/wallet/logout',{method:'POST',headers:authRequestHeaders({'content-type':'application/json','x-vereqo-session':session}),body:'{}'}).catch(()=>{});
  walletGeneration.current++;wallet.current=null;connection?.dispose();
  resetDraftReview();setAddress('');setVerified(false);setWalletSession(null);setWalletChallenge(null);setAuthFailureCode('');setEvidenceState('AUTHENTICATION_REQUIRED');setDraftReviewState('AUTHENTICATION_REQUIRED');
 }
 function applyScenario(view:RehearsalView){
  activeScenarioRef.current=view;
  marketReadGeneration.current++;setBusy(false);disconnect();
  setActiveScenario(view);saveRehearsal(view);setRehearsalResult(null);setBusinessId(view.businessId);setVersion(view.revision);
  setObservation(null);setMarketKind('SPOT');setSide(view.intent?.side??'BUY');setPrice(view.intent?.limitPrice??'');setQuantity(view.intent?.quantity??'');
  setMode(0);setRevoked(false);setError('');setDraftReviewState('NOT_SUBMITTED');setDraftReviewReason('');
  setAuthorizationEvidence(null);setEvidenceEventCount(0);setEvidenceState(view.evidenceState);
 }
 function resetScenario(){
  activeScenarioRef.current=null;
  marketReadGeneration.current++;setBusy(false);disconnect();clearSavedRehearsal();
  setActiveScenario(null);setRehearsalResult(null);setBusinessId('fi_'+globalThis.crypto.randomUUID().replaceAll('-',''));setVersion(0);
  setObservation(null);setMarketKind('SPOT');setSide('BUY');setPrice('');setQuantity('');setMode(0);setRevoked(false);setError('');
  setDraftReviewState('AUTHENTICATION_REQUIRED');setDraftReviewReason('');setAuthorizationEvidence(null);setEvidenceEventCount(0);setEvidenceState('AUTHENTICATION_REQUIRED');
 }
 function applyRehearsalResult(result:RehearsalResult|null){
  setRehearsalResult(result);
  if(!result){setRevoked(false);setEvidenceState(activeScenario?'NO_RECORD':'NOT_REQUESTED');return;}
  setEvidenceState('NO_RECORD');setRevoked((result.scenarioId==='S03-revocation-causality'&&result.decision==='WHAT_IF_ONLY')||(result.scenarioId==='S08-proof-is-not-authority'&&result.decision==='BLOCKED'));
  if(result.scenarioId==='S03-revocation-causality'||result.scenarioId==='S08-proof-is-not-authority')setMode(3);
 }
 let preview='';try{const p=decimal(price),q=decimal(quantity);if(marketKind==='SPOT'&&observation){const ticks=marketApiTicks(observation.market);if(p*q>=1n<<256n)throw Error();const notional=(p*q+10n**18n-1n)/10n**18n,fee=(notional*BigInt(ticks.feeRate)+10n**18n-1n)/10n**18n;if(p%BigInt(ticks.priceTick)===0n&&q%BigInt(ticks.quantityTick)===0n&&notional>=BigInt(ticks.minimumNotional))preview=`${side} / ${notional} + ${fee} (fee ceiling) / 10^18 ${observation.market.quoteDenom}`;}else if(marketKind==='DERIVATIVE'&&observation?.derivativeMarket){preview=`LOCAL DRAFT ONLY / ${side} / ${price} × ${quantity}`;}}catch{/* Incomplete values cannot create an order. */}
 const selectedMarket=marketKind==='SPOT'?observation?.market??null:observation?.derivativeMarket??null;
 const spotPrice=(value:string|undefined)=>{if(!value||!observation)return 'UNKNOWN';try{return formatSpotPrice(value,observation.market);}catch{return 'UNKNOWN';}};
 const target=selectedMarket?.marketId??'UNOBSERVED';
 const context=businessId+' / '+marketKind+' '+side+' / V'+version;
 const localGroth16Verified=activeScenario?.scenarioId==='S08-proof-is-not-authority'&&rehearsalResult?.source==='LOCAL_GROTH16_TEST_VECTOR'&&rehearsalResult.proofStatus==='GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP'&&typeof rehearsalResult.facts.proofDigest==='string'&&/^0x[0-9a-f]{64}$/i.test(rehearsalResult.facts.proofDigest);
 const intentReviewFields=[
  {label:t('Business ID / request ID','Business ID / request ID'),value:businessId},
  {label:t('EIP-712 chain ID','EIP-712 chain ID'),value:'1439'},
  {label:t('Verifying contract / order sender','検証コントラクト / 注文送信元'),value:'NOT_CONFIGURED'},
  {label:t('Principal wallet address · authentication is separate','Principal Walletアドレス・所有認証とは別'),value:address||t('NOT_CONNECTED','未接続')},
  {label:t('Issuer / Agent / credential and policy epochs','Issuer / Agent / credential・policy epoch'),value:'NOT_CONFIGURED'},
  {label:t('Market ID','Market ID'),value:selectedMarket?.marketId??'UNOBSERVED'},
  {label:t('Subaccount / market configuration hash','Subaccount / market設定hash'),value:'NOT_CONFIGURED'},
  {label:t('Side / order type','売買方向 / 注文種別'),value:side+' / LIMIT'},
  {label:t('Draft price / quantity · human units','下書き価格 / 数量・表示単位'),value:(price||'NOT_SET')+' / '+(quantity||'NOT_SET')},
  {label:t('Observed ticks · not an authorization source','観測tick・認可根拠ではありません'),value:selectedMarket?selectedMarket.priceTickChain+' / '+selectedMarket.quantityTickChain:'UNOBSERVED'},
  {label:t('Nonce / deadline / exposure and fee limits','Nonce / deadline / exposure・fee上限'),value:'NOT_CONFIGURED'},
  {label:t('Issuer mandate / ZK binding / digest','Issuer mandate / ZK拘束 / digest'),value:'NOT_CONFIGURED'},
  {label:t('Execution / receipt','実行 / receipt'),value:'NOT_IMPLEMENTED'}
 ];
 const traceEvidence=authorizationEvidence?.requestId===businessId?authorizationEvidence:null;
 const traceEvidenceState=evidenceState==='AVAILABLE'&&!traceEvidence?'UNKNOWN':evidenceState;
 const traceFinalizationEvidence=finalizationEvidence?.requestId===businessId?finalizationEvidence:null;
 const traceFinalizationState=finalizationEvidenceState==='AVAILABLE'&&!traceFinalizationEvidence?'UNKNOWN':finalizationEvidenceState;
 const traceForSelection:FinancialObjectTrace={
  requestId:businessId,revision:version,marketKind,
  marketId:selectedMarket?.marketId??null,
  marketStatus:observation?.status==='LIVE_READ_ONLY'&&!!selectedMarket?.marketId?'LIVE_READ_ONLY':'UNKNOWN',
  chainId:observation?.chainId??null,
  blockNumber:observation?.blockNumber??null,blockHash:observation?.blockHash??null,
  blockSource:observation?.rpcSource??null,observedAt:observation?.observedAt??null,
  marketSource:selectedMarket?(marketKind==='SPOT'?observation?.marketSource??null:observation?.derivativeSource??null):null,
  marketConsistency:selectedMarket?observation?.marketConsistency??null:null,
  side,price:recordOnly?null:price||null,quantity:recordOnly?null:quantity||null,
  draftStatus:recordOnly?'UNKNOWN':draftReviewState==='REJECTED'?'REJECTED':draftReviewState==='SUBMITTING'?'REVIEW_IN_PROGRESS':draftReviewState==='UNKNOWN'?'UNKNOWN':'UNSIGNED_DRAFT',
  evidenceState:traceEvidenceState==='LOADING'?'UNKNOWN':traceEvidenceState,
  evidenceId:traceEvidenceState==='AVAILABLE'?traceEvidence?.id??null:null,
  evidenceStatus:traceEvidenceState==='AVAILABLE'?traceEvidence?.status??null:null,
  evidenceReason:traceEvidenceState==='AVAILABLE'?traceEvidence?.reason??null:null,
  intentDigest:traceEvidenceState==='AVAILABLE'?traceEvidence?.intentDigest??null:null,
  evidenceHash:traceEvidenceState==='AVAILABLE'?traceEvidence?.recordHash??null:null,
  evidenceEventCount:traceEvidenceState==='AVAILABLE'?evidenceEventCount:0,
  finalizationEvidenceState:traceFinalizationState==='AVAILABLE'?'AVAILABLE':traceFinalizationState==='NO_RECORD'?'NO_RECORD':traceFinalizationState==='AUTHENTICATION_REQUIRED'?'AUTHENTICATION_REQUIRED':traceFinalizationState==='UNKNOWN'?'UNKNOWN':'NOT_REQUESTED',
  finalizationEvidenceId:traceFinalizationState==='AVAILABLE'?traceFinalizationEvidence?.id??null:null,
  finalizationEvidenceStatus:traceFinalizationState==='AVAILABLE'?traceFinalizationEvidence?.status??null:null,
  finalizationOwnerSignatureStatus:traceFinalizationState==='AVAILABLE'?traceFinalizationEvidence?.ownerSignatureStatus??null:null,
  finalizationEvidenceReason:traceFinalizationState==='AVAILABLE'?traceFinalizationEvidence?.reason??null:null,
  finalizationEvidenceHash:traceFinalizationState==='AVAILABLE'?traceFinalizationEvidence?.recordHash??null:null,
  finalizationProofDigest:traceFinalizationState==='AVAILABLE'?traceFinalizationEvidence?.proofDigest??null:null,
  recordOnly,
  proofDigest:traceEvidence?.proofDigest??null,mandateDigest:traceEvidence?.mandateDigest??null,requestDigest:traceEvidence?.requestDigest??null,
  disclosureBindingDigest:traceEvidence?.disclosureBindingDigest??null,disclosureHistoryRoot:traceEvidence?.disclosureHistoryRoot??null,
  disclosureHistorySequence:traceEvidence?.disclosureHistorySequence??null,disclosurePolicyEpoch:traceEvidence?.disclosurePolicyEpoch??null,disclosureCredentialEpoch:traceEvidence?.disclosureCredentialEpoch??null,
  hypotheticalCredentialRevocation:revoked,
  requestSource:activeScenario?'SYNTHETIC_REHEARSAL':recordOnly?'OWNER_SCOPED_AUTHORIZATION_RECORD':'LOCAL_FINANCIAL_DRAFT',
  evidenceSource:activeScenario?'REHEARSAL_NAMESPACE':'OWNER_SCOPED_AUTHORIZATION',
  rehearsalScenarioId:activeScenario?.scenarioId??null,
  rehearsalDecision:rehearsalResult?.decision??null,
  rehearsalSource:rehearsalResult?.source??null,
  rehearsalProofStatus:rehearsalResult?.proofStatus??null,
  rehearsalFacts:rehearsalResult?.facts??null,
 };
 const challengeExpired=!!walletChallenge&&Number(walletChallenge.value.expiresAt)<=challengeNow;
 const viewName=ja?jp[mode]:modes[mode];
 return <section id="financial" tabIndex={-1} className="financialWorkflow" data-object-id={businessId} data-business-id={businessId} data-version={version} data-view={modes[mode]} data-hypothetical={revoked} data-testid="financial-workflow" aria-label={t('Injective financial inspection','Injective金融検査')}><header className="financialHeading"><div><span className="eyebrow">INJECTIVE / TESTNET 1439</span><h2>{t('Inspect the financial boundary.','金融操作の境界を検査する。')}</h2><p>{t('A live market observation can inform a proposal. Mandate, proof and protected execution require their own verified evidence.','実市場の観測から提案を検査します。Mandate・証明・保護された実行には、それぞれ検証済みの根拠が必要です。')}</p></div><span className="badge">{observation?'LIVE READ-ONLY':'UNKNOWN'}</span></header>
 <ScenarioRehearsal language={language} scenario={activeScenario} result={rehearsalResult} onLoaded={applyScenario} onReset={resetScenario} onResult={applyRehearsalResult} onOpenTrace={()=>onTraceSelect?.(traceForSelection)} />
 <div className="financialActions"><button className="subtleBtn" data-testid="financial-connect" disabled={!!activeScenario} onClick={()=>void connect()}>{t('Connect wallet','ウォレット接続')}</button><button className="subtleBtn" data-testid="wallet-auth-prepare" disabled={!address||!!activeScenario} onClick={()=>void prepareAuthentication()}>{t('Prepare EIP-712 challenge','EIP-712 challengeを準備')}</button>{address&&<button className="subtleBtn" onClick={disconnect}>{t('Disconnect','切断')}</button>}</div>
 <div role="status" className="financialWallet" data-testid="financial-wallet-state" data-wallet-connected={String(Boolean(address))} data-ownership-authenticated={String(verified)} data-execution-authorized="false"><span data-testid="wallet-connection-state" data-state={address?'connected':'disconnected'}>{address?t('WALLET CONNECTED · '+address,'ウォレット接続済み · '+address):t('WALLET NOT CONNECTED','ウォレット未接続')}</span><span data-testid="wallet-ownership-state" data-state={verified?'authenticated':'unauthenticated'}>{verified?t('OWNERSHIP AUTHENTICATED','所有者認証済み'):t('OWNERSHIP NOT AUTHENTICATED','所有者未認証')}</span><span data-testid="execution-authorization-state" data-state="not-authorized">{t('EXECUTION NOT APPROVED · NOT_IMPLEMENTED','実行承認なし・NOT_IMPLEMENTED')}</span></div>
 {verified&&walletSession&&<div className="financialWalletDetails" data-testid="wallet-server-session" data-origin={walletSession.origin} data-expires-at={walletSession.expiresAt}><strong>{t('SERVER VERIFIED OWNERSHIP SESSION','サーバー検証済み所有者セッション')}</strong><span>{t('Wallet','Wallet')}: <code>{walletSession.address}</code></span><span>{t('Origin','Origin')}: <code data-testid="wallet-session-origin">{walletSession.origin}</code></span><span>{t('Expires','有効期限')}: <time data-testid="wallet-session-expiry" dateTime={new Date(walletSession.expiresAt*1000).toISOString()}>{new Date(walletSession.expiresAt*1000).toISOString()}</time></span><small>{t('Authentication only. Execution remains NOT_APPROVED.','本人認証のみです。実行権限はNOT_APPROVEDのままです。')}</small></div>}
 {authTrace.length>0&&<details data-testid="wallet-auth-diagnostics"><summary>{t('Authentication diagnostics · no secret values','認証の段階別診断・秘密値なし')}</summary><pre>{authTrace.join('\n')}</pre></details>}
 {walletChallenge&&<section className="financialAuthChallenge" data-testid="wallet-auth-challenge" aria-live="polite"><h3>{t('Server-issued EIP-712 ownership challenge','サーバー発行EIP-712所有者認証challenge')}</h3><dl><div><dt>Domain</dt><dd data-testid="wallet-challenge-domain"><code>{String(walletChallenge.domain.name)} · v{String(walletChallenge.domain.version)}</code></dd></div><div><dt>Primary type</dt><dd><code>WalletAuthentication</code></dd></div><div><dt>Chain ID</dt><dd data-testid="wallet-challenge-chain"><code>{String(walletChallenge.domain.chainId)}</code></dd></div><div><dt>Wallet</dt><dd data-testid="wallet-challenge-address"><code>{walletChallenge.value.address}</code></dd></div><div><dt>Origin</dt><dd data-testid="wallet-challenge-origin"><code>{walletChallenge.value.origin}</code></dd></div><div><dt>Nonce</dt><dd data-testid="wallet-challenge-nonce"><code>{walletChallenge.value.nonce}</code></dd></div><div><dt>Issued / expires</dt><dd><time data-testid="wallet-challenge-issued" dateTime={authTime(walletChallenge.value.issuedAt)}>{authTime(walletChallenge.value.issuedAt)}</time> / <time data-testid="wallet-challenge-expires" dateTime={authTime(walletChallenge.value.expiresAt)}>{authTime(walletChallenge.value.expiresAt)}</time></dd></div></dl><p>{challengeExpired?t('CHALLENGE EXPIRED · prepare a fresh challenge.','CHALLENGE期限切れ・新しいchallengeを準備してください。'):t('Review the Wallet, Origin, Chain ID and Nonce before signing. This signature proves wallet ownership only; it cannot move funds, approve, grant, or place an order.','署名前にWallet・Origin・Chain ID・Nonceを確認してください。この署名はWallet所有の確認のみで、送金・Approve・Grant・発注はできません。')}</p><div className="financialActions"><button type="button" data-testid="wallet-auth-sign" disabled={challengeExpired||authRunning} onClick={()=>void authenticate()}>{t('Sign authentication only','認証だけを署名')}</button><button type="button" className="subtleBtn" data-testid="wallet-auth-refresh" disabled={authRunning} onClick={()=>void prepareAuthentication()}>{t('Prepare a fresh challenge','新しいchallengeを準備')}</button></div></section>}
 {authFailureCode&&<p role="alert" data-testid="wallet-auth-error" data-code={authFailureCode}>{walletAuthFailureText(authFailureCode,language)}</p>}{error&&<p role="alert">{error}</p>}
 <div className="financialHierarchy" aria-label={t('Financial dependency hierarchy','金融依存階層')}>{['ASSET','MANDATE','AGENT','INTENT','CREDENTIAL','POLICY','PROOF','RECEIPT'].map((label,i)=><div key={label}><span>{ja?['市場','委任条件','エージェント','注文提案','資格','方針','証明','記録'][i]:label}</span><strong>{i===0?selectedMarket?.ticker??'UNKNOWN':i===3?(preview?'DRAFT / NOT AUTHORIZED':'INCOMPLETE'):i===6?(localGroth16Verified?'LOCAL TEST VECTOR VERIFIED':'NOT_VERIFIED'):i===7?'NONE':'NOT_CONFIGURED'}</strong></div>)}</div>
 <div className="device financialInstrument"><div className="deviceHeader"><span className="idMark">VQ–01 <span className="unit">/ FINANCIAL INSPECTION</span></span><span className="unitMode">{context}</span></div><div className="deck financialDeck"><div className="deckZone financialEncoder" data-testid="financial-dial"><div className="zoneTop"><span>{t('Inspection view','検査ビュー')}</span><span>0–5</span></div><Dial value={mode} min={0} max={5} label={t('Inspection depth','検査の深さ')} valueText={viewName??''} onChange={setMode} decreaseLabel={t('Previous view','前のビュー')} increaseLabel={t('Next view','次のビュー')} alternativeLabel={t('Inspection view alternative','検査ビューの代替操作')}/></div><div className="deckZone"><div className="zoneTop"><span>{t('Public inspection position','公開の検査位置')}</span><span>0–5</span></div><div className="display financialLcd" aria-label={t('Inspection position, not financial exposure','検査位置・金融リスク量ではありません')}><span className="label">{t('INSPECTION POSITION / 0–5','検査位置 / 0–5')}</span><div className="displayValue" data-testid="financial-lcd">{String(mode).padStart(2,'0')}</div><div className="displayCaption">{viewName} · V{version}</div><LcdMeter mode="impact" candidates={[]} changes={[]} totalNodes={0} publicMetric={{value:mode,total:5}} label={t('Public inspection position '+mode+' of 5; no private risk values','公開の検査位置 '+mode+' / 5・非公開リスク量は表示しません')}/><div className="lcdFoot"><span>PUBLIC VIEW INDEX</span><span>{revoked?'WHAT-IF':'INSPECTION'}</span></div></div></div><div className="deckZone deckRight"><div className="signalCard"><div className="signalTitle">{t('Selected object','選択対象')}</div><strong>{marketKind==='SPOT'?t('Spot order draft','現物注文の下書き'):t('Derivative order draft','デリバティブ注文の下書き')}</strong><small>{selectedMarket?.ticker??'UNOBSERVED'} · {side} · V{version}</small></div><div className="physicalKeys"><button className="key keyPrimary" data-testid="financial-read" type="button" disabled={busy||draftReviewState==='SUBMITTING'||!!activeScenario} onClick={()=>void read()}><strong>{busy?t('READING…','取得中…'):t('READ MARKET','市場読取')}</strong><span aria-hidden="true">↗</span></button><button className="key" data-testid="financial-inspect" onClick={()=>setMode(m=>(m+1)%6)}><strong>{t('INSPECT','検査')}</strong><span aria-hidden="true">↗</span></button><button className="key" data-testid="financial-what-if" onClick={()=>setMode(3)}><strong>{t('WHAT-IF','仮定')}</strong><span aria-hidden="true">↗</span></button><button className="key" data-testid="financial-evidence" onClick={()=>setMode(5)}><strong>{t('EVIDENCE','根拠')}</strong><span aria-hidden="true">↗</span></button></div></div></div><div className="financialInspection"><div className="financialModes" role="tablist" aria-label={t('Inspect selected object','選択対象を検査')}>{modes.map((m,i)=><button id={`financial-tab-${i}`} key={m} role="tab" aria-controls="financial-panel" aria-selected={i===mode} tabIndex={i===mode?0:-1} onClick={()=>setMode(i)} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const n=(i+(e.key==='ArrowRight'?1:5))%6;setMode(n);document.getElementById(`financial-tab-${n}`)?.focus();}}}>{ja?jp[i]:m}</button>)}</div><div className="financialPanel" id="financial-panel" role="tabpanel" aria-labelledby={`financial-tab-${mode}`} data-testid="financial-panel" data-object-id={businessId} data-business-id={businessId} data-version={version} data-view={modes[mode]} data-hypothetical={revoked}>
 {mode===0&&<><h3>{selectedMarket?.ticker??activeScenario?.intent?.marketSymbol??t('No observed market','市場未観測')}</h3><p>{t('WHO: Agent provider is not configured. No autonomous request exists.','依頼者：Agentプロバイダー未設定。自律的な依頼はありません。')}</p><div className="financialInputs"><label>{t('Market type','市場種別')}<select aria-label={t('Market type','市場種別')} data-testid="financial-market-kind" value={marketKind} disabled={draftReviewState==='SUBMITTING'||!!activeScenario} onChange={e=>{resetDraftReview();setMarketKind(e.target.value as 'SPOT'|'DERIVATIVE');setVersion(v=>v+1);}}><option value="SPOT">SPOT / INJ-USDT</option><option value="DERIVATIVE">DERIVATIVE / ETH-USDC PERP</option></select></label><label>{t('Order side','注文方向')}<select aria-label={t('Order side','注文方向')} data-testid="financial-order-side" value={side} disabled={draftReviewState==='SUBMITTING'||!!activeScenario} onChange={e=>{resetDraftReview();setSide(e.target.value as 'BUY'|'SELL');setVersion(v=>v+1);}}><option value="BUY">BUY</option><option value="SELL">SELL</option></select></label><label>{t('Limit price','指値価格')}<input inputMode="decimal" value={price} disabled={draftReviewState==='SUBMITTING'||!!activeScenario} onChange={e=>{resetDraftReview();setPrice(e.target.value);setVersion(v=>v+1);}} placeholder="0.00"/></label><label>{t('Quantity','数量')}<input inputMode="decimal" value={quantity} disabled={draftReviewState==='SUBMITTING'||!!activeScenario} onChange={e=>{resetDraftReview();setQuantity(e.target.value);setVersion(v=>v+1);}} placeholder="0.000"/></label></div><p>{selectedMarket?t('ACTIVE TESTNET MARKET · '+selectedMarket.status+' · LIMIT DRAFT ONLY','有効なTestnet市場 · '+selectedMarket.status+' · 指値下書きのみ'):activeScenario?.intent?t('SYNTHETIC INTENT · no live market ID or executable order','合成Intent・実market IDや実行可能orderはありません'):t('Market unavailable. No order intent can be formed.','市場情報なし。注文Intentは作成できません。')}</p>{selectedMarket&&<dl><div><dt>{t('Market ID','Market ID')}</dt><dd><code>{selectedMarket.marketId}</code></dd></div><div><dt>{t('Price / quantity tick · API value','価格 / 数量tick・API値')}</dt><dd><code>{selectedMarket.priceTickChain} / {selectedMarket.quantityTickChain}</code></dd></div>{marketKind==='DERIVATIVE'&&observation?.derivativeMarket&&<><div><dt>{t('Mark price · API value','Mark価格・API値')}</dt><dd><code>{observation.derivativeMarket.markPrice}</code></dd></div><div><dt>{t('Initial / maintenance margin ratio','初期 / 維持証拠金率')}</dt><dd><code>{observation.derivativeMarket.initialMarginRatio} / {observation.derivativeMarket.maintenanceMarginRatio}</code></dd></div><div><dt>{t('Oracle','オラクル')}</dt><dd><code>{observation.derivativeMarket.oracleType} · {observation.derivativeMarket.oracleScaleFactor}</code></dd></div></>}</dl>}<p>{t('Local draft only. Issuer, contract deployment, mandate and authority are not configured; this is not an executable Intent. SELL inventory and derivative margin are not verified.','ローカル下書きのみ。発行者・契約配置・Mandate・権限は未設定で、実行可能なIntentではありません。SELL在庫とDerivative証拠金は未検証です。')}</p><div className="financialDraftReview" data-testid="financial-draft-review"><p>{t('Owner-authenticated local review of this unsigned draft only. No Agent provider, wallet signing request, proof check, market read or transaction is invoked. Expect a fail-closed rejection until the complete signed authorization package is configured.','署名なし下書きだけをWallet所有認証付きでローカル審査します。Agent provider、Wallet署名要求、証明検査、市場読み取り、取引は実行しません。署名済み認可パッケージが設定されるまではfail-closed拒否になります。')}</p><button type="button" data-testid="financial-request-review" disabled={!verified||recordOnly||draftReviewState==='SUBMITTING'||!!activeScenario} onClick={()=>void submitDraftReview()}>{draftReviewState==='SUBMITTING'?t('REVIEWING UNSIGNED DRAFT…','署名なし下書きを審査中…'):t('Request fail-closed draft review','fail-closed下書き審査を依頼')}</button><p role="status" data-testid="financial-draft-review-status">{draftReviewState==='REJECTED'?t('LOCAL DRAFT REJECTED · '+draftReviewReason+' · EXECUTION NOT_IMPLEMENTED','ローカル下書き拒否・'+draftReviewReason+'・EXECUTION NOT_IMPLEMENTED'):draftReviewState==='AUTHENTICATION_REQUIRED'?t('WALLET AUTHENTICATION REQUIRED · NO REVIEW SUBMITTED','Wallet所有認証が必要・審査未送信'):draftReviewState==='UNKNOWN'?t('REVIEW UNKNOWN · check owner-scoped evidence; no execution asserted','審査結果UNKNOWN・所有者限定の根拠を確認してください。実行成功は示しません'):draftReviewState==='SUBMITTING'?t('REVIEW REQUEST IN PROGRESS','審査依頼を処理中'):t('NO LOCAL DRAFT REVIEW SUBMITTED','ローカル下書き審査は未送信')}</p></div><details className="financialIntentReview" data-testid="financial-intent-review"><summary>{t('Review exact EIP-712 Intent fields · INCOMPLETE','EIP-712 Intentの正確な項目を確認・未完成')}</summary><p>{t('The sign request stays disabled until the deployed Gate, issuer mandate, nonce, expiry and proof binding are verified. This panel does not request a wallet signature.','Deployed Gate、Issuer Mandate、nonce、期限、証明の拘束を検証するまで署名要求は無効です。この表示ではWallet署名を要求しません。')}</p><dl>{intentReviewFields.map(field=><div key={field.label}><dt>{field.label}</dt><dd><code>{field.value}</code></dd></div>)}</dl><button type="button" data-testid="financial-intent-sign" disabled aria-describedby="financial-intent-sign-reason">{t('Request Intent signature · unavailable','Intent署名を要求・利用不可')}</button><small id="financial-intent-sign-reason">{t('No signing provider call is made; execution remains NOT_IMPLEMENTED.','署名providerは呼び出されません。実行状態はNOT_IMPLEMENTEDです。')}</small></details><code>{preview||t('Enter positive values after reading market metadata.','市場情報の取得後に正の値を入力してください。')}</code></>}
 {mode===0&&marketKind==='SPOT'&&<aside className="financialSpotQuote" data-testid="financial-spot-quote"><span>{t('PUBLIC TESTNET TOP OF BOOK · READ ONLY','公開Testnet板情報 · 読み取り専用')}</span><strong>{t('MID','中央値')} {spotPrice(observation?.spotTopOfBook?.midPriceChain)} · BID {spotPrice(observation?.spotTopOfBook?.bestBuyPriceChain)} · ASK {spotPrice(observation?.spotTopOfBook?.bestSellPriceChain)}</strong><small>{observation?.spotTopOfBook?observation.observedAt:'UNKNOWN'} · {observation?.marketConsistency??'UNKNOWN'}</small></aside>}
 {mode===1&&<><h3>{t('Required dependency boundary','必要な依存境界')}</h3><p>{t('This is a required rule, not a configured financial graph.','これは必要なルールの説明です。設定済みの金融グラフではありません。')}</p><p>{t('Issuer mandate → credential → policy → proof → protected intent. Public market reads are independent of private credentials.','発行者の委任条件 → 資格 → 方針 → 証明 → 保護対象Intent。公開市場の読み取りは非公開資格とは独立です。')}</p><p>{t('No active mandate or delegated Agent authority is configured.','有効なMandate・委任されたAgent権限は設定されていません。')}</p></>}
 {mode===2&&<><h3>NOT VERIFIED</h3><p>{t('No issuer-authenticated proof is attached to this selected proposal. Local Groth16 fixtures use an untrusted single-machine setup and do not bind this order or authorize an exchange action.','選択中の提案には発行者認証済み証明がありません。ローカルGroth16フィクスチャは信頼されていない単一マシンのセットアップで、この注文を拘束せず、取引所操作を認可しません。')}</p></>}
 {mode===3&&<><h3>LOCAL SIMULATION</h3><p>{t('Rule illustration only: no configured credential, mandate or committed graph is changed.','ルールの説明のみ：設定済みの資格・Mandate・確定グラフは変更しません。')}</p><label><input type="checkbox" checked={revoked} disabled={!!activeScenario} onChange={e=>{if(activeScenario)return;invalidateEvidenceRead();setRevoked(e.target.checked);setVersion(v=>v+1);}}/>{t('Assume credential revoked','資格の失効を仮定')}</label><p>{revoked?t('Dependent proposal: REVOKED (hypothetical). Public market observation: unaffected.','依存する提案：REVOKED（仮定）。公開市場観測：影響なし。'):t('No revocation assumed. No credential or policy is changed.','失効の仮定なし。資格や方針は変更されません。')}</p></>}
 {mode===4&&<><h3>NO EXECUTION</h3><p>{t('The local ActionGate source is not deployed or configured with a production verifier. No order submission, inclusion, order creation or fill occurred in this workflow.','ローカルActionGateのソースは配置されておらず、本番検証器も未設定です。このフローで注文送信・収録・注文作成・約定はありません。')}</p><p>{t('Spot execution is limited to BUY LIMIT in local source tests. SELL inventory enforcement and derivative execution gates are not implemented.','ローカルソースのSpot実行経路はBUY LIMITのテスト範囲です。SELL在庫検証とDerivative実行ゲートは未実装です。')}</p><p>{t('Local ERC20 transfer gate tests are intermediate evidence, not an exchange execution receipt.','ローカルERC20移転ゲートのテストは中間検証であり、取引実行記録ではありません。')}</p></>}
 {mode===5&&<><section className="financialBusinessEvidence" data-testid="financial-business-evidence" data-business-id={businessId}><h3>{t('Draft and authorization evidence','下書きと認可の証拠')}</h3><p>{recordOnly?t('Owner-scoped stored record. Proposal details are not included.','所有者限定の保存記録です。提案の詳細は含まれません。'):t('Business ID / request ID · correlation for the unsigned draft and any fail-closed denial. No Agent provider request was made. Wallet ownership authentication is separate','Business ID / request ID・照合用IDです。Agent依頼は未送信で、Wallet所有認証とは別です')}</p><code data-testid="financial-business-id">{businessId}</code>{!activeScenario&&<div className="financialRequestLookup" data-testid="financial-request-lookup-form"><label>{t('Inspect a recorded Business Request ID','記録済みBusiness Request IDを検査')}<input data-testid="financial-request-id-input" value={requestLookup} maxLength={64} onChange={e=>setRequestLookup(e.target.value)} autoComplete="off" spellCheck={false}/></label><button type="button" data-testid="financial-request-lookup" disabled={!verified||lookupBusy} onClick={()=>void inspectStoredRequest()}>{lookupBusy?t('READING…','読取中…'):t('Read owner-scoped record','所有者限定の記録を読む')}</button><small>{t('Read only. No Agent invocation, signature or execution. Proposal details are not reconstructed from digests.','読取専用。Agent呼出・署名・実行は行いません。digestから提案の詳細を復元しません。')}</small>{lookupError&&<p role="status" data-testid="financial-request-lookup-error">{lookupError}</p>}</div>}<button type="button" data-testid="financial-read-evidence" disabled={!verified||evidenceState==='LOADING'} onClick={()=>void readAuthorizationEvidence()}>{evidenceState==='LOADING'?t('READING EVIDENCE…','根拠を読取中…'):t('READ AUTHORIZATION EVIDENCE','認可根拠を読取')}</button><p data-testid="financial-evidence-status">{evidenceState==='AVAILABLE'?t('LOCAL ISSUER EVIDENCE · '+authorizationEvidence?.status+' · '+evidenceEventCount+' records · EXECUTION NOT_IMPLEMENTED','ローカルIssuer根拠・'+authorizationEvidence?.status+'・'+evidenceEventCount+'件・EXECUTION NOT_IMPLEMENTED'):evidenceState==='NO_RECORD'?(activeScenario?t('NO_REHEARSAL_EVENT · no rehearsal record is persisted','NO_REHEARSAL_EVENT・rehearsal記録は保存されていません'):t('NO_AUTHORIZATION_EVIDENCE_FOR_THIS_ID','このBusiness IDの認可根拠はありません')):evidenceState==='AUTHENTICATION_REQUIRED'?t('WALLET_AUTHENTICATION_REQUIRED','Wallet所有認証が必要です'):evidenceState==='UNKNOWN'?t('EVIDENCE_UNKNOWN · no fallback','EVIDENCE_UNKNOWN・代替データなし'):t('NOT_REQUESTED · no authorization record asserted','未照会・認可記録は未確認')}</p>{onTraceSelect&&verified&&(draftReviewState==='REJECTED'||evidenceState==='AVAILABLE'||evidenceState==='NO_RECORD')&&<button type="button" data-testid="financial-open-trace" onClick={()=>onTraceSelect(traceForSelection)}>{t('Inspect this request in the Consequence workspace','Consequenceワークスペースでこの依頼を検査')}</button>}{authorizationEvidence&&<dl><div><dt>{t('Evidence record ID','Evidence record ID')}</dt><dd><code>{authorizationEvidence.id}</code></dd></div><div><dt>{t('Request ID','Request ID')}</dt><dd><code>{authorizationEvidence.requestId}</code></dd></div><div><dt>{t('Intent digest','Intent digest')}</dt><dd><code>{authorizationEvidence.intentDigest??'UNKNOWN'}</code></dd></div><div><dt>{t('Evidence hash','Evidence hash')}</dt><dd><code>{authorizationEvidence.recordHash}</code></dd></div><div><dt>{t('Reason','理由')}</dt><dd><code>{authorizationEvidence.reason??'NONE'}</code></dd></div></dl>}</section><h3>{t('Observation evidence','観測の根拠')}</h3>{observation?<><dl>{[
 {key:'chainId',label:t('Chain ID','Chain ID'),value:observation.chainId},
 {key:'block',label:t('EVM block','EVMブロック'),value:observation.blockNumber},
 {key:'blockHash',label:t('EVM block hash','EVMブロックhash'),value:observation.blockHash},
 {key:'observedAt',label:t('Observed at','観測時刻'),value:observation.observedAt},
 {key:'market',label:t('Selected market','選択市場'),value:target},
 {key:'marketType',label:t('Market type','市場種別'),value:marketKind},
 {key:'spotMid',label:t('Spot mid (API value)','Spot中央値（API値）'),value:observation.spotTopOfBook?.midPriceChain??'UNKNOWN'},
 {key:'spotBid',label:t('Spot best bid (API value)','Spot最良bid（API値）'),value:observation.spotTopOfBook?.bestBuyPriceChain??'UNKNOWN'},
 {key:'spotAsk',label:t('Spot best ask (API value)','Spot最良ask（API値）'),value:observation.spotTopOfBook?.bestSellPriceChain??'UNKNOWN'},
 {key:'derivativeMark',label:t('Derivative mark (API value)','Derivative mark（API値）'),value:observation.derivativeMarket?.markPrice??'UNKNOWN'},
 {key:'oracleType',label:t('Oracle type','オラクル種別'),value:observation.derivativeMarket?.oracleType??'UNKNOWN'},
 {key:'oracleScale',label:t('Oracle scale','オラクルscale'),value:observation.derivativeMarket?.oracleScaleFactor??'UNKNOWN'},
 {key:'marginRatios',label:t('Initial / maintenance margin','初期 / 維持証拠金率'),value:observation.derivativeMarket?observation.derivativeMarket.initialMarginRatio+' / '+observation.derivativeMarket.maintenanceMarginRatio:'UNKNOWN'},
 {key:'priceTick',label:t('Price tick (API value)','価格tick（API値）'),value:selectedMarket?.priceTickChain??'UNKNOWN'},
 {key:'quantityTick',label:t('Quantity tick (API value)','数量tick（API値）'),value:selectedMarket?.quantityTickChain??'UNKNOWN'},
 {key:'evmClient',label:t('EVM client (endpoint report)','EVM client（接続先報告）'),value:observation.endpointSoftware.evmClientVersion},
 {key:'consensusNode',label:t('Consensus node (endpoint report)','Consensus node（接続先報告）'),value:observation.endpointSoftware.tendermintNodeVersion},
 {key:'injectiveApp',label:t('Injective app (endpoint report)','Injective app（接続先報告）'),value:observation.endpointSoftware.injectiveAppName+' '+observation.endpointSoftware.injectiveAppVersion},
 {key:'appCommit',label:t('App commit (endpoint report)','app commit（接続先報告）'),value:observation.endpointSoftware.injectiveGitCommit},
 {key:'cosmosSdk',label:t('Cosmos SDK (endpoint report)','Cosmos SDK（接続先報告）'),value:observation.endpointSoftware.cosmosSdkVersion},
 {key:'softwareConsistency',label:t('Version report consistency','バージョン報告の整合性'),value:observation.endpointSoftware.consistency},
 {key:'marketConsistency',label:t('Market source consistency','市場データ取得元の整合性'),value:observation.marketConsistency},
 {key:'execution',label:t('Execution state','実行状態'),value:observation.execution},
].map(({key,label,value})=><div key={key}><dt>{label}</dt><dd><code>{value}</code></dd></div>)}</dl><p><a href={observation.rpcSource} target="_blank" rel="noreferrer">EVM RPC</a> · <a href={observation.marketSource} target="_blank" rel="noreferrer">{t('Spot market source','Spot市場取得元')}</a> · <a href={observation.spotTopOfBookSource} target="_blank" rel="noreferrer">{t('Spot top-of-book source','Spot板情報取得元')}</a> · <a href={observation.derivativeSource} target="_blank" rel="noreferrer">{t('Derivative market source','Derivative市場取得元')}</a></p></>:<p>UNKNOWN</p>}</>}
 </div><footer className="financialTarget"><span>{t('Selected object','選択対象')} · V{version}</span><code data-testid="financial-object-id">{businessId} / {marketKind} / {side}</code><span>{t('Market observation','市場観測')}: <code>{target}</code></span></footer>{onTraceSelect&&traceForSelection.marketStatus==='LIVE_READ_ONLY'&&!!traceForSelection.marketId&&!activeScenario&&<div className="financialControlDeckBridge" data-testid="financial-control-deck-bridge"><p><span className="eyebrow">PUBLIC TESTNET / READ ONLY</span>{t('Carry this Business ID, market ID and EVM block into the CONTROL DECK. No wallet or execution action.','このBusiness ID・Market ID・EVMブロックをCONTROL DECKへ引き継ぎます。Wallet操作・金融執行はありません。')}</p><button type="button" data-testid="financial-open-market-trace" onClick={()=>onTraceSelect(traceForSelection)}>{t('Inspect in CONTROL DECK ↗','CONTROL DECKで検査 ↗')}</button></div>}</div></div></section>;
}
