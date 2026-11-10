import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createLocalApp} from '../services/issuer/src/http';
const dir='.local/operation-50/live-browser';mkdirSync(dir,{recursive:true});
const app=createLocalApp({databasePath:':memory:'});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));
const addr=app.server.address();if(!addr||typeof addr==='string')throw Error('ADDRESS');const base=`http://127.0.0.1:${addr.port}`;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results:unknown[]=[];
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1000}});await page.goto(base);await page.getByTestId('language-en').click();await page.getByTestId('start-financial').click();
 await page.getByTestId('financial-read').scrollIntoViewIfNeeded();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/financial/market'),{timeout:30000});await page.getByTestId('financial-read').click();const r=await response;const evidence=await r.json();
 await page.getByTestId('financial-workflow').getByText('LIVE READ-ONLY',{exact:true}).waitFor({timeout:30000});await page.locator('#financial-tab-5').click();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('OVERFLOW');
 await page.getByTestId('financial-workflow').screenshot({path:`${dir}/${width}.png`});results.push({width,status:'PASS',scope:'ACTUAL_LIVE_READ_ONLY_NO_SIGNING',evidence});await page.close();
}}finally{await browser.close();await app.close();writeFileSync('docs/evidence/operation-50/live-browser.json',JSON.stringify({results},null,2)+'\n');}
console.log(JSON.stringify({liveBrowserViewports:results.length,signatures:0,broadcasts:0}));
