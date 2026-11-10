/** Regenerates a public, LOCAL_ZK-only proof vector. Never writes the private witness. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AbiCoder, Wallet, getBytes, toBeHex, zeroPadValue } from 'ethers';
import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import { marketConfigurationHash } from '../packages/domain/src/agent-request.js';
import { canonicalBusinessRequestId } from '../packages/domain/src/native-order.js';
import { parseNativeOrderIntent, nativeOrderDigest, nativeOrderExposure } from '../packages/domain/src/native-order.js';
import { marketApiTicks } from '../packages/domain/src/live-injective.js';
import { loadRehearsalScenario } from '../services/issuer/src/demo-rehearsal.js';
import { LOCAL_DIR, validatePinnedKey, validatePinnedSources, validateCompiledArtifacts } from './zk-artifacts.mjs';

const { manifest } = validatePinnedSources();
mkdirSync(LOCAL_DIR, { recursive: true, mode: 0o700 });
const buildDir = mkdtempSync(`${LOCAL_DIR}/financial-auth-build-`);
execFileSync(process.execPath, [
  'node_modules/circom2/cli.js', 'circuits/confidential_limit.circom', '--r1cs', '--wasm', '-l', 'node_modules', '-o', buildDir,
], { stdio: 'pipe' });
validateCompiledArtifacts(buildDir, manifest);
const provingKey = `${LOCAL_DIR}/local_final.zkey`;
const verificationKey = await validatePinnedKey(provingKey, manifest);

const key = (value) => zeroPadValue(toBeHex(value), 32);
const issuerWallet = new Wallet(key(123));
const principalWallet = new Wallet(key(0xA11CE));
const agentWallet = new Wallet(key(0xB0B));
const gate = '0x00000000000000000000000000000000000001c8';
const subaccountId = `0x${Buffer.concat([getBytes(gate), Buffer.alloc(12)]).toString('hex')}`;
const credentialId = `0x${'0'.repeat(63)}1`;
const marketId = `0x${'ab'.repeat(32)}`;
const market = {
  marketId, ticker: 'INJ/USDT', baseDenom: 'inj', quoteDenom: 'qa-usdt',
  baseDecimals: 6, quoteDecimals: 6, priceTickChain: '0.01', quantityTickChain: '10000',
  minimumNotionalChain: '0.000001', takerFeeRate: '0.0005', status: 'Active',
};
const marketConfigHash = marketConfigurationHash({ market });
const ticks = marketApiTicks(market);
const requestId = loadRehearsalScenario('S08-proof-is-not-authority').businessId;
const now = 1_700_000_000n;
const intent = {
  chainId: '1439', verifyingContract: gate, sender: gate, issuer: issuerWallet.address,
  principal: principalWallet.address, agent: agentWallet.address, credentialId, marketId,
  subaccountId, marketConfigHash, disclosureRequestId: canonicalBusinessRequestId(requestId), credentialEpoch: '1', policyEpoch: '1',
  price: '1000000000000000000', quantity: '2000000000000000000',
  priceTick: ticks.priceTick, quantityTick: ticks.quantityTick, nonce: '77',
  deadline: (now + 200n).toString(), maxNotional: '3000000000000000000',
  maxFeeRate: ticks.feeRate, maxTotalExposure: '3000000000000000000', side: 'BUY', orderType: 'LIMIT',
};
parseNativeOrderIntent(intent);
const intentDigest = nativeOrderDigest(intent);
const [intentHi, intentLo] = [BigInt(intentDigest) >> 128n, BigInt(intentDigest) & ((1n << 128n) - 1n)];
const expiry = (now + 300n).toString();
const maxNotional = BigInt(intent.maxNotional);
const salt = BigInt(`0x${randomBytes(30).toString('hex')}`);
const poseidon = await buildPoseidon();
const commitmentValue = BigInt(poseidon.F.toString(poseidon([
  maxNotional, salt, BigInt(issuerWallet.address), 1439n, BigInt(gate), 1n, 1n,
  BigInt(expiry), intentHi, intentLo,
].map(BigInt))));
const commitment = `0x${commitmentValue.toString(16).padStart(64, '0')}`;
const exposure = nativeOrderExposure(intent).total;
const mandate = {
  chainId: '1439', verifyingContract: gate, issuer: issuerWallet.address,
  principal: principalWallet.address, agent: agentWallet.address, credentialId,
  commitment, credentialEpoch: '1', policyEpoch: '1', expiry,
  cap: '5000000000000000000', marketId, subaccountId, marketConfigHash,
  priceTick: ticks.priceTick, quantityTick: ticks.quantityTick, maxFeeRate: ticks.feeRate, active: true,
};
const policy = {
  principal: principalWallet.address, agent: agentWallet.address, issuer: issuerWallet.address,
  gate, credentialId, credentialEpoch: '1', policyEpoch: '1', marketId, subaccountId,
  maxNotional: '3000000000000000000', maxFeeRate: ticks.feeRate,
  maxTotalExposure: '3000000000000000000',
};
const witness = {
  maxNotional: maxNotional.toString(), salt: salt.toString(), commitment: commitmentValue.toString(),
  requiredExposure: exposure, intentHi: intentHi.toString(), intentLo: intentLo.toString(),
  issuer: BigInt(issuerWallet.address).toString(), chainId: '1439', gate: BigInt(gate).toString(),
  credentialEpoch: '1', policyEpoch: '1', expiry,
};
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  witness, `${buildDir}/confidential_limit_js/confidential_limit.wasm`, provingKey,
);
if (publicSignals.length !== 10 || !await snarkjs.groth16.verify(verificationKey, publicSignals, proof)) {
  throw Error('FINANCIAL_AUTH_FIXTURE_PROOF_INVALID');
}
const expectedPublicSignals = [
  BigInt(commitment).toString(), exposure, intentHi.toString(), intentLo.toString(),
  BigInt(issuerWallet.address).toString(), '1439', BigInt(gate).toString(), '1', '1', expiry,
];
if (JSON.stringify(publicSignals) !== JSON.stringify(expectedPublicSignals)) throw Error('FINANCIAL_AUTH_FIXTURE_SIGNAL_MISMATCH');

const intentTuple = 'tuple(address sender,address issuer,address principal,address agent,bytes32 credentialId,bytes32 marketId,bytes32 subaccountId,bytes32 marketConfigHash,bytes32 disclosureRequestId,uint256 chainId,uint256 credentialEpoch,uint256 policyEpoch,uint256 price,uint256 quantity,uint256 priceTick,uint256 quantityTick,uint256 nonce,uint256 deadline,uint256 maxNotional,uint256 maxFeeRate,uint256 maxTotalExposure,string side,string orderType)';
const mandateTuple = 'tuple(bytes32 commitment,address agent,uint256 epoch,uint64 expiry,uint256 cap,bytes32 marketId,bytes32 subaccountId,bytes32 marketConfigHash,uint256 priceTick,uint256 quantityTick,uint256 maxFeeRate,bool active)';
const coder = AbiCoder.defaultAbiCoder();
const intentAbi = coder.encode([intentTuple], [[
  intent.sender, intent.issuer, intent.principal, intent.agent, intent.credentialId,
  intent.marketId, intent.subaccountId, intent.marketConfigHash, intent.disclosureRequestId, intent.chainId,
  intent.credentialEpoch, intent.policyEpoch, intent.price, intent.quantity,
  intent.priceTick, intent.quantityTick, intent.nonce, intent.deadline,
  intent.maxNotional, intent.maxFeeRate, intent.maxTotalExposure, intent.side, intent.orderType,
]]);
const mandateConfigAbi = coder.encode([mandateTuple], [[
  mandate.commitment, mandate.agent, mandate.credentialEpoch, mandate.expiry, mandate.cap,
  mandate.marketId, mandate.subaccountId, mandate.marketConfigHash, mandate.priceTick,
  mandate.quantityTick, mandate.maxFeeRate, mandate.active,
]]);
const solidityCallData = JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`);
const proofAbi = coder.encode(['uint256[2]', 'uint256[2][2]', 'uint256[2]'], solidityCallData.slice(0, 3));
const output = {
  scope: 'PUBLIC_TEST_VECTOR_LOCAL_ZK_UNTRUSTED_SETUP_NO_REAL_WALLET_OR_CHAIN_ACTION',
  requestId,
  chainId: '1439', issuer: issuerWallet.address, principal: principalWallet.address,
  agent: agentWallet.address, gate, credentialId, market, marketConfigHash, policy, mandate,
  intent, intentDigest, exposure, expectedPublicSignals,
  proof: { proof, publicSignals },
  solidity: { intentAbi, mandateConfigAbi, proofAbi },
};
const outputPath = process.env.VEREQO_FINANCIAL_AUTH_FIXTURE_PATH ?? 'contracts/test/fixtures/financial-authorization.json';
mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ status: 'LOCAL_GROTH16_VECTOR_GENERATED_AND_VERIFIED', outputPath, digest: intentDigest, proofSignals: publicSignals.length, privateWitnessWritten: false, setup: manifest.setup }));
