import { mkdirSync, writeFileSync } from 'node:fs';
import { InjectiveReadAdapter } from '../packages/domain/src/live-injective';
const dir=process.env.VEREQO_EVIDENCE_DIR??'docs/evidence/operation-50';mkdirSync(dir,{recursive:true,mode:0o700});
try { const snapshot=await new InjectiveReadAdapter().snapshot();writeFileSync(`${dir}/live-read.json`,JSON.stringify(snapshot,null,2)+'\n'); console.log(JSON.stringify(snapshot,null,2)); }
catch(error){console.error(String(error));process.exitCode=1;}
