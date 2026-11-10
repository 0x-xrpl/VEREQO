import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createLocalApp } from '../services/issuer/src/http';
import { formatSpotPrice, type LiveSnapshot } from '../packages/domain/src/live-injective';

const out=process.env.VEREQO_FINANCIAL_QA_OUTPUT??'docs/evidence/operation-52/financial-browser';
mkdirSync(out,{recursive:true,mode:0o700});
const widths=[1440,1024,768,390,320],results:Record<string,unknown>[]=[];
const browser=await chromium.launch({...(process.env.VEREQO_CHROME?{executablePath:process.env.VEREQO_CHROME}:{}),headless:true,args:['--disable-background-networking','--disable-sync','--no-first-run','--disable-component-update']});
try{
 for(const width of widths){
  const app=createLocalApp({databasePath:':memory:',staticRoot:process.env.VEREQO_STATIC_ROOT??'dist/web'});
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const address=app.server.address();if(!address||typeof address==='string')throw Error('NO_LOCAL_LISTENER');
  const base=`http://127.0.0.1:${address.port}`;
  const context=await browser.newContext({viewport:{width,height:width<=390?844:960},isMobile:width<=390,hasTouch:width<=390});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage(),checks:string[]=[],errors:string[]=[],requests:{method:string;path:string}[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('503'))errors.push(message.text());});
  page.on('request',request=>{const url=new URL(request.url());requests.push({method:request.method(),path:url.pathname});});
  const check=(name:string,ok:boolean)=>{if(!ok)throw Error(`${width}px: ${name}`);checks.push(name);};
  const capture=async(name:string)=>page.screenshot({path:`${out}/${width}-${name}.jpg`,type:'jpeg',quality:90});
  const alignBelowTopbar=()=>page.evaluate(()=>window.scrollBy(0,-(document.querySelector('.topbar')?.getBoundingClientRect().height??0)-12));
  try{
   await page.goto(base,{waitUntil:'networkidle'});
   await page.getByTestId('start-financial').click();
   await page.getByTestId('financial-workflow').waitFor({state:'visible'});
   check('does not connect or sign wallet automatically',!requests.some(request=>request.path.startsWith('/api/wallet/')));
   const [response]=await Promise.all([
    page.waitForResponse(request=>new URL(request.url()).pathname==='/api/financial/market'),
    page.getByTestId('financial-read').click()
   ]);
   check('live market read returns HTTP 200',response.status()===200);
   const body=await response.json() as {snapshot:LiveSnapshot};
   check('EVM chain is Injective Testnet 1439',body.snapshot.status==='LIVE_READ_ONLY'&&body.snapshot.chainId==='1439');
   check('Cosmos chain is Injective Testnet injective-888',body.snapshot.cosmosChainId==='injective-888');
   check('active Spot and Derivative markets are present',body.snapshot.market.ticker==='INJ/USDT'&&body.snapshot.derivativeMarket?.ticker==='ETH/USDC PERP');
   check('Spot top-of-book is observed or explicitly UNKNOWN',Boolean(body.snapshot.spotTopOfBook)||await page.getByTestId('financial-spot-quote').innerText().then(value=>value.includes('UNKNOWN')));
   check('market consistency remains explicitly unpinned',body.snapshot.marketConsistency==='UNPINNED_LCD_READ');
   check('endpoint-advertised software versions are explicit and separately unpinned',Boolean(body.snapshot.endpointSoftware?.injectiveAppVersion&&body.snapshot.endpointSoftware?.injectiveGitCommit&&body.snapshot.endpointSoftware?.evmClientVersion&&body.snapshot.endpointSoftware?.consistency==='UNPINNED_ENDPOINT_REPORTS'));
   check('no execution capability is exposed',body.snapshot.execution==='NOT_IMPLEMENTED'&&await page.getByTestId('financial-intent-sign').isDisabled()&&await page.getByTestId('financial-request-review').isDisabled()&&await page.locator('[data-testid="financial-execute"],[data-testid="financial-order-submit"],[data-testid="financial-broadcast"]').count()===0);
   const spotQuote=await page.getByTestId('financial-spot-quote').innerText();
   const quoteLine=await page.getByTestId('financial-spot-quote').locator('strong').innerText();
   const expectedMid=body.snapshot.spotTopOfBook?formatSpotPrice(body.snapshot.spotTopOfBook.midPriceChain,body.snapshot.market):null;
   check('Spot quote matches the API observation without a wallet action',quoteLine.startsWith('中央値 ')&&expectedMid!==null&&quoteLine.includes(expectedMid)&&!quoteLine.includes('UNKNOWN'));
   const lcdLabel=page.locator('.financialLcd .label');
   check('LCD label fits within its display',await lcdLabel.evaluate(element=>element.scrollWidth<=element.clientWidth));
   await lcdLabel.scrollIntoViewIfNeeded();
   await alignBelowTopbar();
   await capture('financial-instrument');
   await page.getByTestId('financial-spot-quote').scrollIntoViewIfNeeded();
   await alignBelowTopbar();
   await capture('financial-spot');
   await page.getByTestId('language-en').click();
   check('English language is available',await page.getByTestId('financial-workflow').getAttribute('aria-label')==='Injective financial inspection');
   await page.getByTestId('financial-market-kind').selectOption('DERIVATIVE');
   check('Derivative draft selects the live market',await page.getByTestId('financial-panel').locator('h3').innerText()==='ETH/USDC PERP');
   const derivativePanelText=await page.getByTestId('financial-panel').innerText();
   const derivative=body.snapshot.derivativeMarket;
   check('derivative source value, oracle scale and margin metadata are explicit',Boolean(derivative)&&derivativePanelText.includes('Mark price · API value')&&derivativePanelText.includes(derivative!.markPrice)&&derivativePanelText.includes(String(derivative!.oracleScaleFactor))&&derivativePanelText.includes('Initial / maintenance margin ratio')&&derivativePanelText.includes('Price / quantity tick · API value'));
   await page.getByTestId('financial-order-side').selectOption('SELL');
   check('SELL remains a non-executable draft',await page.getByTestId('financial-object-id').innerText().then(value=>value.includes('DERIVATIVE / SELL'))&&(await page.getByTestId('financial-panel').innerText()).includes('SELL inventory and derivative margin are not verified'));
   await page.getByTestId('financial-panel').scrollIntoViewIfNeeded();
   await alignBelowTopbar();
   await capture('financial-derivative-sell');
   await page.getByRole('tab',{name:'EVIDENCE'}).click();
   const evidenceText=await page.getByTestId('financial-panel').innerText();
   check('evidence view shows EVM block identity, API source fields, unpinned LCD consistency and NOT_IMPLEMENTED',evidenceText.includes('EVM block hash')&&evidenceText.includes('Derivative mark (API value)')&&evidenceText.includes('UNPINNED_LCD_READ')&&evidenceText.includes('UNPINNED_ENDPOINT_REPORTS')&&evidenceText.includes('App commit (endpoint report)')&&evidenceText.includes('NOT_IMPLEMENTED'));
   await page.getByTestId('financial-panel').scrollIntoViewIfNeeded();
   await alignBelowTopbar();
   await capture('financial-evidence');
   await page.getByTestId('language-ja').click();
   check('Japanese language remains available',await page.getByTestId('financial-workflow').getAttribute('aria-label')==='Injective金融検査');
   const japaneseEvidenceText=await page.getByTestId('financial-panel').innerText();
   check('evidence labels are localized in Japanese',japaneseEvidenceText.includes('EVMブロックhash')&&japaneseEvidenceText.includes('市場データ取得元の整合性'));
   await page.getByTestId('language-en').click();
   check('no wallet signing or financial write request occurred',!requests.some(request=>request.path.startsWith('/api/wallet/')||['/api/agent/propose','/api/financial/order'].includes(request.path)));
   const businessId=await page.getByTestId('financial-workflow').getAttribute('data-business-id');
   const selectedMarketId=body.snapshot.derivativeMarket?.marketId;
   const selectedBlock=body.snapshot.blockNumber;
   check('read-only observation offers a Control Deck handoff',await page.getByTestId('financial-open-market-trace').isVisible());
   await page.getByTestId('financial-open-market-trace').click();
   const consequenceTrace=page.getByTestId('financial-trace-consequence');
   const instrumentTrace=page.getByTestId('financial-trace-instrument');
   await consequenceTrace.waitFor({state:'visible'});
   await page.waitForFunction(()=>{
    const trace=document.querySelector<HTMLElement>('[data-testid="financial-trace-consequence"]');
    const topbar=document.querySelector<HTMLElement>('.topbar');
    return !!trace&&!!topbar&&trace.getBoundingClientRect().top>=topbar.getBoundingClientRect().bottom;
   });
   check('handoff moves the selected Control Deck trace below sticky navigation',await consequenceTrace.evaluate(element=>{
    const topbar=document.querySelector<HTMLElement>('.topbar');
    return !!topbar&&element.getBoundingClientRect().top>=topbar.getBoundingClientRect().bottom;
   }));
   if(width>900&&width<=1100){
    const traceColumns=await consequenceTrace.locator('.financialTraceIdentity').evaluate(element=>getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length);
    check('narrow Control Deck trace uses a compact two-column provenance layout',traceColumns===2);
   }
   check('Control Deck remains the existing integration surface',await page.getByTestId('white-instrument').isVisible());
   const instrumentBounds=await page.getByTestId('white-instrument').boundingBox();
   check('Control Deck keeps its expected responsive width after the trace is attached',Boolean(instrumentBounds&&instrumentBounds.width>=(width>900?width*0.5:width-48)));
   check('same Business ID is carried into the Control Deck',Boolean(businessId)&&await consequenceTrace.getAttribute('data-object-id')===businessId&&await instrumentTrace.getAttribute('data-object-id')===businessId);
   const consequenceText=await consequenceTrace.innerText();
   check('Testnet market ID, EVM block and read-only state are carried',Boolean(selectedMarketId)&&Boolean(selectedBlock)&&consequenceText.includes(selectedMarketId!)&&consequenceText.includes(selectedBlock!)&&consequenceText.includes(body.snapshot.blockHash)&&consequenceText.includes('LIVE_READ_ONLY'));
   check('EVM block and LCD market source retain their separate unpinned boundary',consequenceText.includes('UNPINNED_LCD_READ')&&consequenceText.includes('not pinned to the EVM block below.')&&await consequenceTrace.getByTestId('financial-trace-block-source').getAttribute('href')===body.snapshot.rpcSource&&await consequenceTrace.getByTestId('financial-trace-market-source').getAttribute('href')===body.snapshot.derivativeSource);
   check('English locale survives navigation into the Control Deck',await page.locator('html').getAttribute('lang')==='en');
   check('authorization and execution remain fail-closed in the Control Deck',consequenceText.includes('NOT_CONFIGURED')&&consequenceText.includes('NOT_VERIFIED')&&consequenceText.includes('NOT_IMPLEMENTED / NONE'));
   check('handoff caused no wallet, signature or financial write request',!requests.some(request=>request.path.startsWith('/api/wallet/')||['/api/agent/propose','/api/financial/order'].includes(request.path)||(!['GET','HEAD'].includes(request.method)&&request.path.startsWith('/api/financial/'))));
   await page.setViewportSize({width,height:1800});
   await consequenceTrace.screenshot({path:`${out}/${width}-control-deck-consequence.jpg`,type:'jpeg',quality:90});
   await instrumentTrace.scrollIntoViewIfNeeded();
   await alignBelowTopbar();
   await instrumentTrace.screenshot({path:`${out}/${width}-control-deck-instrument-trace.jpg`,type:'jpeg',quality:90});
   await page.getByTestId('white-instrument').screenshot({path:`${out}/${width}-control-deck-instrument.jpg`,type:'jpeg',quality:90});
   await page.locator('.operatingSurface').screenshot({path:`${out}/${width}-control-deck-consequence-space.jpg`,type:'jpeg',quality:90});
   check('financial panel has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
   check('no browser runtime errors',errors.length===0);
   results.push({width,checks,errors,spotQuote,snapshot:body.snapshot,screenshotViewportHeight:1800,status:'PASS'});
  }catch(error){
   results.push({width,checks,errors,status:'FAIL',error:String(error)});
   await page.screenshot({path:`${out}/${width}-financial-failure.jpg`,type:'jpeg',quality:80,fullPage:true});
   throw error;
  }finally{await context.close();await app.close();}
 }
}finally{
 await browser.close();
 writeFileSync(`${out}/report.json`,JSON.stringify({scope:'Live read-only financial panel; no wallet/signature/order',results},null,2)+'\n');
}
console.log(JSON.stringify({widths:results.length,checks:results.reduce((sum,result)=>sum+(result.checks as string[]).length,0),out}));
