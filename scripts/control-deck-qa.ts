import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createLocalApp} from '../services/issuer/src/http';
const out='.local/control-deck-qa';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.VEREQO_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--no-first-run']});
const results:{width:number;checks:string[];status:string;error?:string}[]=[];
try{for(const width of (process.env.VEREQO_QA_WIDTHS?.split(',').map(Number)??[1440,390,320])){
 const app=createLocalApp({databasePath:':memory:'});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const a=app.server.address();if(!a||typeof a==='string')throw Error('LISTENER');const base=`http://127.0.0.1:${a.port}`;
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<600,reducedMotion:width<600?'reduce':'no-preference'});await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const page=await context.newPage(),checks:string[]=[],errors:string[]=[],mutations:string[]=[],previews:string[]=[],financial:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const p=new URL(r.url()).pathname;if(/^\/api\/(query|graph|reset)$/.test(p))mutations.push(p);if(p==='/api/preview')previews.push(p);if(/^\/api\/(financial|wallet|agent)/.test(p))financial.push(p);});
 const check=(name:string,ok:boolean)=>{if(!ok)throw Error(`${width}: ${name}`);checks.push(name);};
 try{
  await page.goto(base);await page.evaluate(()=>document.fonts.ready);await page.addStyleTag({content:'html{scroll-behavior:auto!important}'});await page.getByTestId('language-en').click();await page.getByTestId('start-demo').click();await page.getByTestId('journey-free').click();await page.getByTestId('mode-impact').click();
  const deck=page.getByTestId('white-instrument');await page.waitForFunction(()=>document.querySelector('[data-testid="deck-display"]')?.getAttribute('data-decision')==='valid');
  check('CONTROL DECK name',await page.getByRole('heading',{name:'CONTROL DECK',exact:true}).isVisible());
  await page.getByTestId('dial-target').click();await page.getByTestId('tile:broker-b').click();check('map B updates dial index',await deck.getByTestId('work-dial').getAttribute('aria-valuenow')==='2');
  await deck.getByTestId('work-dial').focus();await page.keyboard.press('Home');check('dial selects map A',await page.getByTestId('tile:broker-a').getAttribute('aria-pressed')==='true');
  if(width===1440){await deck.getByTestId('work-dial').scrollIntoViewIfNeeded();const b=await deck.getByTestId('work-dial').boundingBox();if(!b)throw Error('DIAL');const x=b.x+b.width/2,y=b.y+b.height/2,r=b.width*.38;await page.mouse.move(x,y-r);await page.mouse.down();for(const angle of [45,90,150])await page.mouse.move(x+r*Math.sin(angle*Math.PI/180),y-r*Math.cos(angle*Math.PI/180));await page.mouse.up();check('pointer rotation selects map B',await page.getByTestId('tile:broker-b').getAttribute('aria-pressed')==='true');await deck.getByTestId('work-dial').focus();await page.keyboard.press('Home');}
  const confirm=deck.getByTestId('work-confirm');await confirm.scrollIntoViewIfNeeded();if(width<600){const b=await confirm.boundingBox();if(!b)throw Error('CENTER');await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await confirm.click();
  check('center confirms inspection only',await page.getByTestId('inspection-confirmation').getAttribute('data-confirmed')==='true'&&mutations.length===0&&previews.length===0);
  await page.getByTestId('tile:broker-b').click();check('target change invalidates confirmation',await page.getByTestId('inspection-confirmation').getAttribute('data-confirmed')==='false');
  await deck.getByTestId('work-dial').focus();await page.keyboard.press('Enter');check('keyboard confirms without release',await page.getByTestId('inspection-confirmation').getAttribute('data-confirmed')==='true'&&mutations.length===0);
  await page.getByTestId('dial-depth').click();await deck.getByTestId('work-dial').focus();await page.keyboard.press('End');check('legacy inspection depth retained',await deck.getByTestId('work-dial').getAttribute('aria-valuenow')==='3');
  const action=page.getByTestId('broker-B').locator('[data-node-id="action_B"]');await action.click();check('pointer selection has one border and no outline',await action.evaluate(e=>getComputedStyle(e).outlineStyle==='none'&&getComputedStyle(e).boxShadow==='none'));
  await page.keyboard.press('Tab');await action.focus();check('keyboard focus remains visible',await action.evaluate(e=>e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle==='solid'));
  await deck.locator('.deviceHeader').click();await deck.screenshot({path:`${out}/${width}-deck.png`});await page.getByTestId('living-board').screenshot({path:`${out}/${width}-board.png`});
  check('LCD retains34 bars',await deck.getByTestId('lcd-meter').locator('i').count()===34);
  await page.getByTestId('key-primary').click();await page.waitForFunction(()=>document.querySelector('[data-testid="working-lcd"]')?.textContent==='06');
  check('preview state and six true consequences',await page.getByTestId('deck-display').getAttribute('data-decision')==='what_if'&&await page.getByTestId('tile:broker-b').getAttribute('data-status')==='PERMITTED');
  await page.getByTestId('living-board').screenshot({path:`${out}/${width}-preview-board.png`});await deck.screenshot({path:`${out}/${width}-preview-deck.png`});
  await page.getByTestId('key-reset').click();await page.waitForFunction(()=>!(document.querySelector('[data-testid="key-reset"]') as HTMLButtonElement)?.disabled);await page.getByTestId('mode-disclosure').click();
  const threshold=async(n:number)=>{await deck.getByTestId('work-dial').focus();await page.keyboard.press('Home');for(let i=0;i<n/10;i++)await page.keyboard.press('PageUp');await page.waitForFunction(v=>{const e=document.querySelector('[data-testid="work-dial"]');return e?.getAttribute('aria-valuenow')===String(v)&&!(document.querySelector('[data-testid="submit-query"]') as HTMLButtonElement)?.disabled;},n);};
  for(const [i,n] of [100,80,70].entries()){await threshold(n);const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/query'),page.getByTestId('key-primary').click()]);const s=(await response.json()).state;check(`actual disclosure step${i+1}`,s.disclosure.candidates.length===[101,81,81][i]&&(i!==2||(s.disclosure.history[2].status==='DENIED'&&!Object.hasOwn(s.disclosure.history[2],'answer'))));}
  await page.waitForFunction(()=>document.querySelector('[data-testid="deck-display"]')?.getAttribute('data-decision')==='denied');check('LCD states DENIED without implying execution',(await page.getByTestId('lcd-decision').innerText()).includes('DENIED')&&await deck.getByTestId('working-lcd').innerText()==='81');await deck.screenshot({path:`${out}/${width}-denied.png`});
  await page.route('**/api/preflight',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"QA_READ_FAILURE"}'}));await deck.getByTestId('work-plus').click();await page.waitForFunction(()=>document.querySelector('[data-testid="deck-display"]')?.getAttribute('data-decision')==='unknown');
  check('UNKNOWN hides stale number and bars',await deck.getByTestId('working-lcd').innerText()==='—'&&await deck.getByTestId('lcd-meter').locator('i.on').count()===0&&await confirm.isDisabled());await deck.screenshot({path:`${out}/${width}-unknown.png`});
  await page.getByTestId('language-ja').click();check('Japanese labels and localized UNKNOWN',(await page.getByTestId('lcd-decision').innerText()).includes('未確認')&&(await confirm.getAttribute('aria-label'))?.includes('実行承認なし')===true);
  check('no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('no runtime errors',errors.length===0);check('no financial APIs or external operations',financial.length===0);
  if(width<600)check('reduced motion respected',await confirm.evaluate(e=>getComputedStyle(e).transitionDuration==='0s'));
  results.push({width,checks,status:'PASS'});
 }catch(e){results.push({width,checks,status:'FAIL',error:String(e)});await page.screenshot({path:`${out}/${width}-failure.png`,fullPage:true});throw e;}finally{await context.close();await app.close();}
}}finally{await browser.close();writeFileSync(`${out}/report.json`,JSON.stringify({scope:'LOCAL_API_UI_ONLY_NO_FINANCIAL_ACTION',results},null,2)+'\n');}
console.log(JSON.stringify({viewports:results.length,checks:results.reduce((n,r)=>n+r.checks.length,0),out}));
