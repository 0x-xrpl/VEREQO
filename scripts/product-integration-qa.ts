import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { Wallet } from 'ethers';
import { createLocalApp } from '../services/issuer/src/http.js';
import type { InjectiveReadAdapter } from '../packages/domain/src/live-injective.js';
import { uiG3Evidence } from '../tests/support/ui-g3-evidence.js';

const out=process.env.VEREQO_PRODUCT_QA_OUTPUT??'docs/evidence/product-integration-2026-11-10/browser';
mkdirSync(out,{recursive:true,mode:0o700});
const app=createLocalApp({databasePath:':memory:',staticRoot:process.env.VEREQO_STATIC_ROOT??'dist/web',injective:{snapshot:async()=>{throw Error('QA_NETWORK_DISABLED');}} as unknown as InjectiveReadAdapter});
await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const listener=app.server.address();if(!listener||typeof listener==='string')throw Error('NO_LISTENER');
const base=`http://127.0.0.1:${listener.port}`;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--disable-sync','--no-first-run','--disable-component-update']});
const checks:string[]=[],errors:string[]=[],requests:{method:string;path:string}[]=[];
let failure:string|null=null;
const check=(label:string,ok:boolean)=>{if(!ok)throw Error(label);checks.push(label);};
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
  try{
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const page=await context.newPage(),wallet=Wallet.createRandom(),id='g3_visual_record';
   page.on('pageerror',error=>errors.push(error.message));
   page.on('request',request=>requests.push({method:request.method(),path:new URL(request.url()).pathname}));
   await page.exposeFunction('__qaSign',async(serialized:string)=>{const p=JSON.parse(serialized);delete p.types.EIP712Domain;return wallet.signTypedData(p.domain,p.types,p.message);});
   await page.addInitScript('Object.defineProperty(window,"ethereum",{value:{request:async function(args){if(args.method==="eth_chainId")return "0x59f";if(args.method==="eth_accounts"||args.method==="eth_requestAccounts")return ['+JSON.stringify(wallet.address)+'];if(args.method==="eth_signTypedData_v4")return window.__qaSign(String(args.params[1]));throw Error("FORBIDDEN_QA_WALLET_METHOD");},on:function(){},removeListener:function(){}}});');
   const evidence=uiG3Evidence(id,wallet.address);
   await page.route(base+'/api/agent/authorization/'+id,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({evidence,events:[evidence]})}));
   await page.goto(base+'/#financial',{waitUntil:'networkidle'});
   await page.getByTestId('language-en').click();
   await page.getByTestId('financial-connect').click();await page.getByTestId('wallet-auth-prepare').click();await page.getByTestId('wallet-auth-sign').click();
   await page.locator('[data-testid="wallet-ownership-state"][data-state="authenticated"]').waitFor();
   await page.locator('#financial-tab-5').click();
   await page.getByTestId('financial-request-id-input').fill(id);await page.getByTestId('financial-request-lookup').click();
   await page.getByTestId('financial-business-id').filter({hasText:id}).waitFor();
   check(width+' owner-scoped record accepted',await page.getByTestId('financial-evidence-status').innerText().then(t=>t.includes('PRE_GATE_VALIDATED')));
   await page.locator('#financial-tab-0').click();
   check(width+' record inspection cannot submit a draft under the imported ID',await page.getByTestId('financial-request-review').isDisabled());
   await page.locator('#financial-tab-5').click();
   await page.getByTestId('financial-open-trace').click();
   for(const surface of ['instrument','consequence','evidence']){
    const panel=page.getByTestId('financial-trace-'+surface);
    check(width+' '+surface+' preserves request ID',await panel.getAttribute('data-object-id')===id);
    check(width+' '+surface+' has five stages',await panel.locator('[data-testid="financial-request-journey"] li').count()===5);
    const text=await panel.innerText();
    check(width+' '+surface+' labels recorded proof and unknown proposal honestly',text.includes('not reverified here')&&text.includes('NOT IN EVIDENCE RECORD')&&text.includes('NOT_APPROVED'));
   }
   const bindings=page.getByTestId('financial-trace-evidence').getByTestId('financial-trace-bindings');
   await bindings.locator('summary').click();
   check(width+' Evidence preserves Disclosure digest',await bindings.innerText().then(t=>t.includes(String(evidence.disclosureBindingDigest))));
   await bindings.locator('summary').click();
   check(width+' no horizontal page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   for(const surface of ['consequence','evidence']){
    const panel=page.getByTestId('financial-trace-'+surface);await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({path:`${out}/${width}-${surface}-synthetic.png`,animations:'disabled'});
   }
   await page.getByTestId('language-ja').click();
   check(width+' Japanese journey is readable',await page.getByTestId('financial-trace-evidence').innerText().then(t=>t.includes('提案')&&t.includes('証拠')&&t.includes('この画面での再検証なし')));
   await page.getByTestId('financial-trace-evidence').screenshot({path:`${out}/${width}-evidence-ja-synthetic.png`,animations:'disabled'});
  }finally{await context.close();}
 }
 check('no browser errors',errors.length===0);
 check('no runtime or financial authorization POST',!requests.some(r=>r.method==='POST'&&/^\/api\/(agent\/(run|authorize|propose)|financial\/)/.test(r.path)));
}catch(error){failure=error instanceof Error?error.message:'QA_FAILED';throw error;}finally{
 await browser.close();await app.close();
 writeFileSync(out+'/report.json',JSON.stringify({scope:'ISOLATED_UI_SYNTHETIC_EVIDENCE_ONLY',status:failure?'FAIL':'PASS',failure,checks,errors,requests,personalChromeProfileUsed:false,realWalletUsed:false,videoCreated:false},null,2));
}
process.stdout.write(JSON.stringify({checks:checks.length,errors:errors.length,out})+'\n');
