/** LOCAL TEST ONLY. Existing single-machine ceremony is NOT a trusted setup. */
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import * as snarkjs from 'snarkjs';
import {buildPoseidon} from 'circomlibjs';
import {LOCAL_DIR,PUBLIC_INPUTS,validatePinnedSources,validateCompiledArtifacts,validatePinnedKey} from './zk-artifacts.mjs';
const {manifest,fixtures}=validatePinnedSources();
mkdirSync(LOCAL_DIR,{recursive:true,mode:0o700});
// Compile every time. An unchanged filename never authenticates compiled constraints.
const dir=mkdtempSync(`${LOCAL_DIR}/checked-build-`);
execFileSync(process.execPath,['node_modules/circom2/cli.js','circuits/confidential_limit.circom','--r1cs','--wasm','-l','node_modules','-o',dir],{stdio:'pipe'});
validateCompiledArtifacts(dir,manifest);
const wasm=`${dir}/confidential_limit_js/confidential_limit.wasm`;
const checkedVectors=[];
for(const fixture of fixtures.vectors){
 if(!await snarkjs.groth16.verify(fixtures.verificationKey,fixture.publicSignals,fixture.proof))throw Error('PINNED_PUBLIC_PROOF_INVALID');
 checkedVectors.push(fixture.name);
}
const negative=[];const fixture=fixtures.vectors[0];
for(let i=0;i<PUBLIC_INPUTS.length;i++){
 const changed=[...fixture.publicSignals];changed[i]=(BigInt(changed[i])+1n).toString();
 if(await snarkjs.groth16.verify(fixtures.verificationKey,changed,fixture.proof))throw Error('SUBSTITUTED_PUBLIC_INPUT_ACCEPTED');
 negative.push(PUBLIC_INPUTS[i]);
}
const poseidon=await buildPoseidon();
// Synthetic private opening remains process memory only; never serialize/log input.
const input={maxNotional:'100000',salt:BigInt('0x'+randomBytes(30).toString('hex')).toString(),requiredExposure:'1000',intentHi:'1234',intentLo:'5678',issuer:'123',chainId:'1439',gate:'456',credentialEpoch:'1',policyEpoch:'1',expiry:'2000000000'};
input.commitment=poseidon.F.toString(poseidon([input.maxNotional,input.salt,input.issuer,input.chainId,input.gate,input.credentialEpoch,input.policyEpoch,input.expiry,input.intentHi,input.intentLo].map(BigInt)));
await snarkjs.wtns.calculate(input,wasm,{type:'mem'});
const invalidWitnessRejected=[];
for(const [name,override] of [['exposure-above-secret-bound',{requiredExposure:'100001'}],['forged-opening',{salt:(BigInt(input.salt)+1n).toString()}],['out-of-range-exposure',{requiredExposure:(1n<<128n).toString()}]]){
 let rejected=false;
 try{await snarkjs.wtns.calculate({...input,...override},wasm,{type:'mem'});}catch{rejected=true;}
 if(!rejected)throw Error(`INVALID_WITNESS_ACCEPTED:${name}`);
 invalidWitnessRejected.push(name);
}
const key=`${LOCAL_DIR}/local_final.zkey`;let freshProof='NOT_RUN_MISSING_PINNED_KEY';
if(existsSync(key)){
 const vk=await validatePinnedKey(key,manifest);
 const {proof,publicSignals}=await snarkjs.groth16.fullProve(input,wasm,key);
 if(publicSignals.length!==10||PUBLIC_INPUTS.some((k,i)=>publicSignals[i]!==input[k]))throw Error('PUBLIC_INPUT_ORDER_MISMATCH');
 if(!await snarkjs.groth16.verify(vk,publicSignals,proof))throw Error('FRESH_REAL_PROOF_INVALID');
 writeFileSync(`${LOCAL_DIR}/fresh-public-proof.json`,JSON.stringify({scope:'LOCAL_SYNTHETIC_FRESH_PROOF_NOT_THE_CHECKED_IN_FIXTURE',proof,publicSignals},null,2),{mode:0o600});
 freshProof='GENERATED_AND_CRYPTOGRAPHICALLY_VERIFIED';
}
const report={environment:'LOCAL_ZK',scheme:'Circom2/Groth16/BN254',setup:manifest.setup,provenance:'PINNED_SOURCE_COMPILER_INCLUDE_CLOSURE_FRESH_COMPILE_KEY_VERIFIER_PUBLIC_FIXTURES',issuerAuthentication:'PUBLIC_CONTEXT_BOUND_SEPARATE_ACTIONGATE_TESTS_AUTHENTICATE_REGISTRATION',injectiveVerifierDeployment:'NOT_AUTHORIZED_NOT_PERFORMED',checkedInPublicProofsVerified:checkedVectors,freshProof,changedPublicInputsRejected:negative,invalidWitnessRejected,privateWitnessWritten:false,circuitSha256:manifest.circuitSources['circuits/confidential_limit.circom'],r1csSha256:manifest.compiled.r1cs,verifierSha256:manifest.verifierSha256,observedAt:new Date().toISOString()};
const evidencePath=process.env.VEREQO_ZK_EVIDENCE_PATH??'docs/evidence/operation-51/zk-local.json';
writeFileSync(evidencePath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exit(0);
