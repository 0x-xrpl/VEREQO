import {readFileSync, readdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const parse=(p)=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const manifest=parse('manifest.json');
assert.equal(manifest.status,'PORTABLE_FIXTURE_ONLY_NOT_INTEGRATED');
assert.equal(manifest.dataClass,'SYNTHETIC_REHEARSAL');
assert.equal(manifest.scenarios.length,8);
const files=readdirSync(resolve(root,'scenarios')).filter(x=>x.endsWith('.json'));
assert.equal(files.length,manifest.scenarios.length);
for (const record of manifest.scenarios){
 const s=parse(record.file);
 assert.equal(s.scenarioId,record.scenarioId);
 assert.match(s.scenarioId,/^S\d\d-[a-z0-9-]+$/);
 assert.equal(s.schemaVersion,'1.0.0');
 assert.equal(s.dataClass,'SYNTHETIC_REHEARSAL');
 assert.equal(s.targetNetwork.chainId,1439);
 assert.equal(s.targetNetwork.verifiedOnChain,false);
 assert.equal(s.chainEvidence.executionStatus,'NOT_EXECUTED');
 for(const field of ['transactionHash','blockHash','blockHeight','marketId','orderHash'])assert.equal(s.chainEvidence[field],null,field);
 for(const value of Object.values(s.releaseClaims))assert.equal(value,false);
 assert.equal(s.privacy,'DO_NOT_SEND_PRIVATE_WITNESS_TO_BROWSER');
 assert.ok(s.operatorActions.length>0&&s.expectedObservations.length>0);
 if(s.inputs.intent){
  const i=s.inputs.intent;
  assert.equal((BigInt(i.quantity)*BigInt(i.limitPrice)).toString(),i.maxNotionalQuote,'Example notional mismatch');
  assert.equal(i.issuerSignature,null);assert.equal(i.zkProof,null);assert.equal(i.signedIntent,null);
 }
 console.log('PASS',s.scenarioId);
}
const p=parse('private/issuer-policy.example.json');
assert.equal(p.dataClass,'SYNTHETIC_PRIVATE_SERVER_ONLY');
const a=p.policies.find(x=>x.credentialId==='credential-A');
assert.ok(BigInt(a.maxOrderNotionalQuote)>=480n && BigInt(a.maxOrderNotionalQuote)<840n);
const graph=parse('scenarios/S03-revocation-causality.json').inputs.dependencyGraph;
assert.ok(graph['credential-A'].includes('intent-A01'));
assert.ok(!graph['credential-A'].includes('intent-B01'));
console.log('PASS all fixtures; no live/cryptographic integration is claimed.');
