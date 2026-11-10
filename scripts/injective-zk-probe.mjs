import {readFileSync,writeFileSync} from 'node:fs';
import {AbiCoder} from 'ethers';
import * as snarkjs from 'snarkjs';
const endpoint='https://sentry.json-rpc.testnet.injective.network/';
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});const body=await r.json();if(!r.ok||body.error)throw Error(JSON.stringify(body.error??body));return body.result;}
if(await rpc('eth_chainId',[])!=='0x59f')throw Error('WRONG_CHAIN');
const artifact=JSON.parse(readFileSync('contracts/out/ProofReadProbe.sol/ProofReadProbe.json'));
const fixture=JSON.parse(readFileSync('.local/operation-50/zk/public-proof.json'));
const args=JSON.parse('['+await snarkjs.groth16.exportSolidityCallData(fixture.proof,fixture.publicSignals)+']');
const encode=values=>artifact.bytecode.object+AbiCoder.defaultAbiCoder().encode(['uint256[2]','uint256[2][2]','uint256[2]','uint256[10]'],values).slice(2);
const block=await rpc('eth_blockNumber',[]),call=async(values)=>rpc('eth_call',[{data:encode(values),gas:'0x1c9c380',gasPrice:'0x0'},block]);
const valid=BigInt(await call(args))===1n;
const changed=structuredClone(args);changed[3][1]='0x'+(BigInt(changed[3][1])+1n).toString(16);
const rejected=BigInt(await call(changed))===0n;
if(!valid||!rejected)throw Error('REMOTE_VERIFIER_PROBE_FAILED');
let estimate;try{estimate=BigInt(await rpc('eth_estimateGas',[{data:encode(args),gasPrice:'0x0'}])).toString();}catch(error){estimate='UNAVAILABLE: '+String(error);}
const report={status:'READ_ONLY_EVM_SIMULATION_VERIFIED',chainId:'1439',endpoint,blockNumber:BigInt(block).toString(),observedAt:new Date().toISOString(),validGroth16ProofAccepted:valid,changedExposureRejected:rejected,gasEstimateIncludingCreation:estimate,scope:'eth_call initcode simulation using actual bn254 precompiles. No persisted contract, signature, funding, transaction or exchange order. Single-machine untrusted setup.',transactionHash:null};
writeFileSync('docs/evidence/operation-50/injective-zk-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exit(0);
