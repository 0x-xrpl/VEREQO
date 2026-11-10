import {readFileSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const id=process.argv[2];
const manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'));
const chosen=manifest.scenarios.filter(s=>!id||s.scenarioId===id||s.scenarioId.startsWith(id));
if(!chosen.length){console.error('Unknown scenario ID. Try node scripts/preview.mjs');process.exit(1)}
for(const entry of chosen){
 const path=resolve(root,entry.file);
 if(!existsSync(path))throw Error('Missing: '+entry.file);
 const s=JSON.parse(readFileSync(path,'utf8'));
 console.log(`\n${s.scenarioId}: ${s.title}\nQUESTION: ${s.businessQuestion}\nMODE: ${s.dataClass} / ${s.chainEvidence.executionStatus}\n`);
 if(s.inputs.intent){const o=s.inputs.intent;console.log(`INTENT: ${o.agentId} ${o.type} ${o.side} ${o.quantity} ${o.marketSymbol} @ ${o.limitPrice} = ${o.maxNotionalQuote} USDT`)}
 console.log('OPERATOR STEPS:',s.operatorActions.join(' → '));
 for(const e of s.expectedObservations)console.log('  EXPECTED',e.at,'→',e.state);
 console.log('NOTE: This is a portable fixture preview, not a VEREQO app execution, signed proof, or chain transaction.');
}
