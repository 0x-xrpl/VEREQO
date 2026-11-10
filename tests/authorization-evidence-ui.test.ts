import {expect,it} from 'vitest';
import {parseAuthorizationHistory} from '../apps/web/src/authorizationEvidence.js';
import {uiG3Evidence} from './support/ui-g3-evidence.js';
const record=()=>uiG3Evidence('g3_one');
const parse=(e:unknown)=>parseAuthorizationHistory({evidence:e,events:[e]},'g3_one','0x'+'11'.repeat(20));
it('accepts the current enriched G3 API schema without dropping proof or disclosure binding',()=>{
 const e=record();expect(parse(e).evidence).toEqual(e);
});
it.each(['disclosureHistoryRoot','disclosureCredentialEpoch','proofDigest','requestId','principal','unexpected'])('rejects malformed, incomplete, foreign or additional %s metadata',key=>{
 const e:Record<string,unknown>={...record()};
 if(key==='disclosureHistoryRoot')delete e[key];
 else if(key==='disclosureCredentialEpoch')e[key]='0';
 else if(key==='principal')e[key]='0x'+'33'.repeat(20);
 else e[key]='invalid';
 expect(()=>parse(e)).toThrow();
});
it('requires a matching latest history record and complete pre-Gate digests',()=>{
 const e=record();expect(()=>parse({...e,proofDigest:null})).toThrow();
 expect(()=>parseAuthorizationHistory({evidence:e,events:[{...e,recordHash:'0x'+'ff'.repeat(32)}]},'g3_one')).toThrow();
});
