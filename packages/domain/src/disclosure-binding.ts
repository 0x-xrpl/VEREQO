import { TypedDataEncoder, getAddress, verifyTypedData, type TypedDataField } from 'ethers';
import { canonicalBusinessRequestId } from './native-order.js';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const ZERO32 = `0x${'0'.repeat(64)}`;
const KEYS = ['issuer', 'principal', 'agent', 'credentialId', 'requestIdHash', 'historyRoot', 'historySequence', 'policyEpoch', 'credentialEpoch', 'issuedAt', 'expiresAt'] as const;
const TYPES: Record<string, TypedDataField[]> = { DisclosureBinding: [
  { name: 'issuer', type: 'address' }, { name: 'principal', type: 'address' }, { name: 'agent', type: 'address' },
  { name: 'credentialId', type: 'bytes32' }, { name: 'requestIdHash', type: 'bytes32' }, { name: 'historyRoot', type: 'bytes32' },
  { name: 'historySequence', type: 'uint256' }, { name: 'policyEpoch', type: 'uint256' },
  { name: 'credentialEpoch', type: 'uint256' }, { name: 'issuedAt', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' },
] };

export interface DisclosureBinding {
  readonly issuer: string; readonly principal: string; readonly agent: string; readonly credentialId: string;
  readonly requestIdHash: string; readonly historyRoot: string; readonly historySequence: string;
  readonly policyEpoch: string; readonly credentialEpoch: string; readonly issuedAt: string; readonly expiresAt: string;
}
export interface DisclosureBindingEnvelope { readonly binding: DisclosureBinding; readonly signature: string; }
/** Server-authoritative head read from the issuer/credential registry, never from the request envelope. */
export interface CurrentDisclosureHistory {
  readonly issuer: string; readonly principal: string; readonly agent: string; readonly credentialId: string;
  readonly historyRoot: string; readonly historySequence: string; readonly policyEpoch: string; readonly credentialEpoch: string;
  readonly active: boolean;
}
export interface DisclosureBindingContext {
  readonly requestId: string; readonly gate: string; readonly principal: string; readonly agent: string;
  readonly issuer: string; readonly credentialId: string; readonly policyEpoch: string; readonly credentialEpoch: string;
  readonly intentDeadline: string; readonly now: string;
}

function invalid(code: string): never { throw Error(code); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid('DISCLOSURE_BINDING_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key]!, 'value'))) return invalid('DISCLOSURE_BINDING_FIELDS');
  return value as Record<string, unknown>;
}
function address(value: unknown, name: string): string {
  if (typeof value !== 'string' || !ADDRESS.test(value)) return invalid(`DISCLOSURE_${name}_INVALID`);
  try { const parsed = getAddress(value); if (parsed === '0x0000000000000000000000000000000000000000') return invalid(`DISCLOSURE_${name}_INVALID`); return parsed; }
  catch { return invalid(`DISCLOSURE_${name}_INVALID`); }
}
function bytes32(value: unknown, name: string, allowZero = false): string {
  if (typeof value !== 'string' || !BYTES32.test(value) || (!allowZero && value.toLowerCase() === ZERO32)) return invalid(`DISCLOSURE_${name}_INVALID`);
  return value.toLowerCase();
}
function uint(value: unknown, name: string, positive = false): string {
  if (typeof value !== 'string' || !UINT.test(value) || BigInt(value) >= (1n << 256n) || (positive && value === '0')) return invalid(`DISCLOSURE_${name}_INVALID`);
  return value;
}

export function parseDisclosureBinding(input: unknown): DisclosureBinding {
  const raw = exact(input, KEYS);
  return Object.freeze({
    issuer: address(raw.issuer, 'ISSUER'), principal: address(raw.principal, 'PRINCIPAL'), agent: address(raw.agent, 'AGENT'),
    credentialId: bytes32(raw.credentialId, 'CREDENTIAL_ID'), requestIdHash: bytes32(raw.requestIdHash, 'REQUEST_ID_HASH'), historyRoot: bytes32(raw.historyRoot, 'HISTORY_ROOT'),
    historySequence: uint(raw.historySequence, 'HISTORY_SEQUENCE'), policyEpoch: uint(raw.policyEpoch, 'POLICY_EPOCH', true),
    credentialEpoch: uint(raw.credentialEpoch, 'CREDENTIAL_EPOCH', true), issuedAt: uint(raw.issuedAt, 'ISSUED_AT', true),
    expiresAt: uint(raw.expiresAt, 'EXPIRES_AT', true),
  });
}

export function disclosureBindingTypedData(input: unknown, gateInput: string) {
  const binding = parseDisclosureBinding(input), gate = address(gateInput, 'GATE');
  return Object.freeze({
    domain: Object.freeze({ name: 'VEREQO Disclosure History', version: '1', chainId: 1439, verifyingContract: gate }),
    types: Object.freeze({ DisclosureBinding: TYPES.DisclosureBinding!.map(field => ({ ...field })) }),
    value: binding,
  });
}

export function disclosureBindingDigest(input: unknown, gate: string): string {
  const data = disclosureBindingTypedData(input, gate);
  return TypedDataEncoder.hash(data.domain, data.types, data.value);
}

/**
 * Verifies an issuer-signed opaque history root and binds it to this Business Request,
 * credential/policy epochs, Agent, principal, Gate, and intent deadline.
 * The signed history root is an issuer claim; this function does not prove it in Groth16.
 */
export function verifyDisclosureBinding(input: unknown, context: DisclosureBindingContext): {
  readonly binding: DisclosureBinding; readonly digest: string; readonly signer: string;
} {
  const envelope = exact(input, ['binding', 'signature']);
  const binding = parseDisclosureBinding(envelope.binding);
  const signature = envelope.signature;
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return invalid('DISCLOSURE_SIGNATURE_INVALID');
  if (!/^(0|[1-9][0-9]{0,19})$/.test(context.now) || !/^(0|[1-9][0-9]{0,19})$/.test(context.intentDeadline)) return invalid('DISCLOSURE_TIME_INVALID');
  if (binding.requestIdHash !== canonicalBusinessRequestId(context.requestId)) return invalid('DISCLOSURE_REQUEST_ID_MISMATCH');
  for (const [actual, expected, code] of [
    [binding.issuer, address(context.issuer, 'ISSUER'), 'DISCLOSURE_ISSUER_MISMATCH'],
    [binding.principal, address(context.principal, 'PRINCIPAL'), 'DISCLOSURE_PRINCIPAL_MISMATCH'],
    [binding.agent, address(context.agent, 'AGENT'), 'DISCLOSURE_AGENT_MISMATCH'],
    [binding.credentialId, bytes32(context.credentialId, 'CREDENTIAL_ID'), 'DISCLOSURE_CREDENTIAL_MISMATCH'],
  ] as const) if (actual !== expected) return invalid(code);
  if (binding.policyEpoch !== context.policyEpoch || binding.credentialEpoch !== context.credentialEpoch) return invalid('DISCLOSURE_EPOCH_MISMATCH');
  const now = BigInt(context.now), issuedAt = BigInt(binding.issuedAt), expiresAt = BigInt(binding.expiresAt), deadline = BigInt(context.intentDeadline);
  if (issuedAt > now + 30n || expiresAt <= now || expiresAt <= issuedAt || expiresAt > deadline || expiresAt - issuedAt > 300n) return invalid('DISCLOSURE_BINDING_EXPIRED_OR_STALE');
  const data = disclosureBindingTypedData(binding, context.gate);
  let signer: string;
  try { signer = getAddress(verifyTypedData(data.domain, data.types, data.value, signature)); }
  catch { return invalid('DISCLOSURE_SIGNATURE_INVALID'); }
  if (signer !== binding.issuer) return invalid('DISCLOSURE_ISSUER_SIGNATURE_MISMATCH');
  return Object.freeze({ binding, digest: TypedDataEncoder.hash(data.domain, data.types, data.value), signer });
}
