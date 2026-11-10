/** LOCAL VERIFICATION ONLY. No setup, signing, deployment or transaction. */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,normalize,relative,resolve} from 'node:path';
import {createRequire} from 'node:module';
import * as snarkjs from 'snarkjs';
const require=createRequire(import.meta.url);
const ejs=require(require.resolve('ejs',{paths:[require.resolve('snarkjs')]}));
export const MANIFEST='docs/evidence/operation-51/zk-artifacts.json';
export const FIXTURES='docs/evidence/operation-51/zk-public-fixtures.json';
export const LOCAL_DIR='.local/operation-50/zk';
export const PUBLIC_INPUTS=['commitment','requiredExposure','intentHi','intentLo','issuer','chainId','gate','credentialEpoch','policyEpoch','expiry'];
export const hashBytes=value=>createHash('sha256').update(value).digest('hex');
export const hashFile=path=>hashBytes(readFileSync(path));
export const stable=value=>JSON.stringify(value,Object.keys(value).sort());
export function assertSameHashes(expected,actual,label){
 if(stable(expected)!==stable(actual))throw Error(`ZK_ARTIFACT_MISMATCH:${label}`);
}
/** Include closure, rather than just the top-level circuit or package version. */
export function circuitSources(root=process.cwd(),entry='circuits/confidential_limit.circom'){
 const result={};const base=resolve(root);
 function visit(name){
  const abs=resolve(base,name),key=relative(base,abs).split('\\').join('/');
  if(key.startsWith('../')||key==='..')throw Error('CIRCUIT_INCLUDE_OUTSIDE_ROOT');
  if(Object.hasOwn(result,key))return;
  const data=readFileSync(abs,'utf8');result[key]=hashBytes(data);
  for(const match of data.matchAll(/include\s+"([^"]+)"\s*;/g)){
   const local=normalize(join(dirname(key),match[1]));
   visit(existsSync(resolve(base,local))?local:join('node_modules',match[1]));
  }
 }
 visit(entry);return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
export function toolchainSources(root=process.cwd()){
 const files=['node_modules/circom2/package.json','node_modules/circom2/circom.wasm','node_modules/circom2/cli.js','node_modules/snarkjs/package.json','node_modules/snarkjs/templates/verifier_groth16.sol.ejs','node_modules/circomlib/package.json','node_modules/circomlibjs/package.json'];
 return Object.fromEntries(files.map(p=>[p,hashFile(resolve(root,p))]));
}
const decimal=n=>BigInt(n).toString();
export function solidityFixtureVector(source){
 const body=/function proof\(\)[^{]*\{\s*return abi\.encode\(([\s\S]*?)\);\s*\}/.exec(source)?.[1];
 const commitment=/COMMITMENT\s*=\s*bytes32\(uint256\((\d+)\)\)/.exec(source)?.[1];
 if(!body||!commitment)throw Error('SOLIDITY_FIXTURE_NOT_FOUND');
 const points=[...body.matchAll(/uint256\((\d+)\)/g)].map(m=>decimal(m[1]));
 if(points.length!==8)throw Error('SOLIDITY_FIXTURE_POINT_COUNT');
 const digest=/EXPECTED_DIGEST\s*=\s*bytes32\(uint256\((0x[0-9a-fA-F]+)\)\)/.exec(source)?.[1];
 return {points,commitment:decimal(commitment),...(digest?{digest:digest.toLowerCase()}: {})};
}
export function assertFixtureContract(fixture,source){
 const actual=solidityFixtureVector(source);
 const expected={points:fixture.solidity.slice(0,3).flat(Infinity).map(decimal),commitment:fixture.publicSignals[0],...(fixture.digest?{digest:fixture.digest.toLowerCase()}: {})};
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('SOLIDITY_PUBLIC_FIXTURE_MISMATCH');
}
export function validatePinnedSources(root=process.cwd()){
 const manifest=JSON.parse(readFileSync(resolve(root,MANIFEST),'utf8'));
 if(manifest.format!==1||manifest.setup!=='SINGLE_MACHINE_UNTRUSTED_NOT_FOR_DEPLOYMENT')throw Error('UNSUPPORTED_ZK_MANIFEST');
 assertSameHashes(manifest.circuitSources,circuitSources(root),'circuit/include sources');
 assertSameHashes(manifest.toolchainSources,toolchainSources(root),'compiler/dependency sources');
 if(hashFile(resolve(root,FIXTURES))!==manifest.publicFixturesSha256)throw Error('ZK_ARTIFACT_MISMATCH:public fixtures');
 if(hashFile(resolve(root,'contracts/src/LocalGroth16Verifier.sol'))!==manifest.verifierSha256)throw Error('ZK_ARTIFACT_MISMATCH:committed verifier');
 const fixtures=JSON.parse(readFileSync(resolve(root,FIXTURES),'utf8'));
 const rendered=ejs.render(readFileSync(resolve(root,'node_modules/snarkjs/templates/verifier_groth16.sol.ejs'),'utf8'),fixtures.verificationKey);
 if(hashBytes(rendered)!==manifest.verifierSha256)throw Error('VERIFICATION_KEY_VERIFIER_MISMATCH');
 if(hashBytes(JSON.stringify(fixtures.verificationKey))!==manifest.verificationKeySha256)throw Error('ZK_ARTIFACT_MISMATCH:verification key');
 for(const fixture of fixtures.vectors)assertFixtureContract(fixture,readFileSync(resolve(root,fixture.contract),'utf8'));
 return {manifest,fixtures};
}
export function validateCompiledArtifacts(dir,manifest){
 const actual={r1cs:hashFile(join(dir,'confidential_limit.r1cs')),wasm:hashFile(join(dir,'confidential_limit_js/confidential_limit.wasm'))};
 assertSameHashes(manifest.compiled,actual,'fresh compiled circuit');return actual;
}
export async function validatePinnedKey(path,manifest){
 if(hashFile(path)!==manifest.provingKeySha256)throw Error('ZK_ARTIFACT_MISMATCH:proving key');
 const vk=await snarkjs.zKey.exportVerificationKey(path);
 if(hashBytes(JSON.stringify(vk))!==manifest.verificationKeySha256)throw Error('ZK_ARTIFACT_MISMATCH:proving/verification key');
 return vk;
}
