import { Interface, JsonRpcProvider, getAddress, keccak256 } from 'ethers';
import type { IssuerOrderMandate } from './order-mandate.js';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const GATE_ABI = new Interface([
  'function issuer() view returns (address)',
  'function principal() view returns (address)',
  'function verifier() view returns (address)',
  'function verifierCodeHash() view returns (bytes32)',
  'function policyEpoch() view returns (uint256)',
  'function getOrderMandate(bytes32 id) view returns ((bytes32 commitment,address agent,uint256 epoch,uint64 expiry,uint256 cap,uint256 spent,bytes32 marketId,bytes32 subaccountId,bytes32 marketConfigHash,uint256 priceTick,uint256 quantityTick,uint256 maxFeeRate,bool active))',
]);

export interface GateManifest {
  readonly chainId: '1439';
  readonly gate: string;
  readonly gateCodeHash: string;
  readonly issuer: string;
  readonly principal: string;
  readonly verifier: string;
  readonly verifierCodeHash: string;
}

export interface RegisteredGateMandate {
  readonly chainId: string;
  readonly gate: string;
  readonly gateCodeHash: string;
  readonly issuer: string;
  readonly principal: string;
  readonly verifier: string;
  readonly verifierCodeHash: string;
  readonly storedVerifierCodeHash: string;
  readonly policyEpoch: string;
  readonly credentialId: string;
  readonly commitment: string;
  readonly agent: string;
  readonly credentialEpoch: string;
  readonly expiry: string;
  readonly cap: string;
  readonly spent: string;
  readonly marketId: string;
  readonly subaccountId: string;
  readonly marketConfigHash: string;
  readonly priceTick: string;
  readonly quantityTick: string;
  readonly maxFeeRate: string;
  readonly active: boolean;
  readonly blockNumber: number;
  readonly blockHash: string;
}

function address(value: unknown): string {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw Error('INVALID_GATE_MANIFEST');
  try { return getAddress(value); } catch { throw Error('INVALID_GATE_MANIFEST'); }
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !BYTES32.test(value)) throw Error('INVALID_GATE_MANIFEST');
  return value.toLowerCase();
}

/** Validate operator-pinned deployment identity; it is never derived from request data. */
export function parseGateManifest(input: unknown): GateManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw Error('INVALID_GATE_MANIFEST');
  const expected = ['chainId', 'gate', 'gateCodeHash', 'issuer', 'principal', 'verifier', 'verifierCodeHash'];
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).length !== expected.length || expected.some((key) => !descriptors[key] || !Object.hasOwn(descriptors[key]!, 'value'))) throw Error('INVALID_GATE_MANIFEST');
  const raw = input as Record<string, unknown>;
  if (raw.chainId !== '1439') throw Error('GATE_WRONG_CHAIN');
  return Object.freeze({
    chainId: '1439', gate: address(raw.gate), gateCodeHash: hash(raw.gateCodeHash),
    issuer: address(raw.issuer), principal: address(raw.principal), verifier: address(raw.verifier),
    verifierCodeHash: hash(raw.verifierCodeHash),
  });
}

/**
 * Read all identity and mandate fields from one block. The reader is read-only;
 * the caller must still treat a later Gate execution as the final authority.
 */
export async function readRegisteredGateMandate(provider: JsonRpcProvider, manifestInput: unknown, credentialIdInput: string): Promise<RegisteredGateMandate> {
  const manifest = parseGateManifest(manifestInput);
  const credentialId = hash(credentialIdInput);
  const [network, block] = await Promise.all([provider.getNetwork(), provider.getBlock('latest')]);
  if (network.chainId !== 1439n || !block?.hash) throw Error('GATE_STATE_UNAVAILABLE');
  const blockTag = `0x${block.number.toString(16)}`;
  const callAt = (data: string) => provider.send('eth_call', [{ to: manifest.gate, data }, blockTag]) as Promise<string>;
  const [gateCode, issuerData, principalData, verifierData, storedVerifierHashData, epochData, mandateData] = await Promise.all([
    provider.getCode(manifest.gate, block.number),
    callAt(GATE_ABI.encodeFunctionData('issuer')),
    callAt(GATE_ABI.encodeFunctionData('principal')),
    callAt(GATE_ABI.encodeFunctionData('verifier')),
    callAt(GATE_ABI.encodeFunctionData('verifierCodeHash')),
    callAt(GATE_ABI.encodeFunctionData('policyEpoch')),
    callAt(GATE_ABI.encodeFunctionData('getOrderMandate', [credentialId])),
  ]);
  const runtimeGateHash = keccak256(gateCode).toLowerCase();
  if (gateCode === '0x' || runtimeGateHash !== manifest.gateCodeHash) throw Error('GATE_CODEHASH_MISMATCH');
  const issuer = getAddress(GATE_ABI.decodeFunctionResult('issuer', issuerData)[0] as string);
  const principal = getAddress(GATE_ABI.decodeFunctionResult('principal', principalData)[0] as string);
  const verifier = getAddress(GATE_ABI.decodeFunctionResult('verifier', verifierData)[0] as string);
  const storedVerifierCodeHash = (GATE_ABI.decodeFunctionResult('verifierCodeHash', storedVerifierHashData)[0] as string).toLowerCase();
  const policyEpoch = String(GATE_ABI.decodeFunctionResult('policyEpoch', epochData)[0]);
  const row = GATE_ABI.decodeFunctionResult('getOrderMandate', mandateData)[0];
  const config = row as unknown as readonly [string, string, bigint, bigint, bigint, bigint, string, string, string, bigint, bigint, bigint, boolean];
  const verifierCode = await provider.getCode(verifier, block.number);
  const verifierCodeHash = keccak256(verifierCode).toLowerCase();
  if (verifierCode === '0x' || verifier !== manifest.verifier || verifierCodeHash !== manifest.verifierCodeHash || storedVerifierCodeHash !== manifest.verifierCodeHash) throw Error('VERIFIER_CODEHASH_MISMATCH');
  if (issuer !== manifest.issuer || principal !== manifest.principal) throw Error('GATE_IDENTITY_MISMATCH');
  return Object.freeze({
    chainId: '1439', gate: manifest.gate, gateCodeHash: runtimeGateHash, issuer, principal, verifier,
    verifierCodeHash, storedVerifierCodeHash, policyEpoch, credentialId,
    commitment: String(config[0]).toLowerCase(), agent: getAddress(config[1]), credentialEpoch: String(config[2]),
    expiry: String(config[3]), cap: String(config[4]), spent: String(config[5]),
    marketId: String(config[6]).toLowerCase(), subaccountId: String(config[7]).toLowerCase(),
    marketConfigHash: String(config[8]).toLowerCase(), priceTick: String(config[9]),
    quantityTick: String(config[10]), maxFeeRate: String(config[11]), active: config[12],
    blockNumber: block.number, blockHash: block.hash.toLowerCase(),
  });
}

/** Reconcile the signed envelope to the Gate registration and immutable trust root. */
export function assertRegisteredGateMandate(mandate: IssuerOrderMandate, state: RegisteredGateMandate, manifestInput: unknown): void {
  const manifest = parseGateManifest(manifestInput);
  if (state.chainId !== manifest.chainId || state.gate.toLowerCase() !== manifest.gate.toLowerCase() ||
      state.gateCodeHash.toLowerCase() !== manifest.gateCodeHash || state.issuer.toLowerCase() !== manifest.issuer.toLowerCase() ||
      state.principal.toLowerCase() !== manifest.principal.toLowerCase() || state.verifier.toLowerCase() !== manifest.verifier.toLowerCase() ||
      state.verifierCodeHash.toLowerCase() !== manifest.verifierCodeHash || state.storedVerifierCodeHash.toLowerCase() !== manifest.verifierCodeHash) throw Error('GATE_MANIFEST_MISMATCH');
  const equal: ReadonlyArray<readonly [string, string]> = [
    [mandate.chainId, state.chainId], [mandate.verifyingContract, state.gate], [mandate.issuer, state.issuer],
    [mandate.principal, state.principal], [mandate.policyEpoch, state.policyEpoch], [mandate.credentialId, state.credentialId],
    [mandate.commitment, state.commitment], [mandate.agent, state.agent], [mandate.credentialEpoch, state.credentialEpoch],
    [mandate.expiry, state.expiry], [mandate.cap, state.cap], [mandate.marketId, state.marketId],
    [mandate.subaccountId, state.subaccountId], [mandate.marketConfigHash, state.marketConfigHash],
    [mandate.priceTick, state.priceTick], [mandate.quantityTick, state.quantityTick], [mandate.maxFeeRate, state.maxFeeRate],
  ];
  if (equal.some(([left, right]) => left.toLowerCase() !== right.toLowerCase()) || mandate.active !== state.active || BigInt(state.spent) > BigInt(state.cap)) throw Error('GATE_MANDATE_MISMATCH');
}
