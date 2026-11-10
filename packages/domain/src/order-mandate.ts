import { TypedDataEncoder, getAddress, verifyTypedData, type TypedDataField } from 'ethers';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const WAD = 10n ** 18n;
const KEYS = [
  'chainId', 'verifyingContract', 'issuer', 'principal', 'agent', 'credentialId',
  'commitment', 'credentialEpoch', 'policyEpoch', 'expiry', 'cap', 'marketId',
  'subaccountId', 'marketConfigHash', 'priceTick', 'quantityTick', 'maxFeeRate', 'active',
] as const;

export interface IssuerOrderMandate {
  readonly chainId: string;
  readonly verifyingContract: string;
  readonly issuer: string;
  readonly principal: string;
  readonly agent: string;
  readonly credentialId: string;
  readonly commitment: string;
  readonly credentialEpoch: string;
  readonly policyEpoch: string;
  readonly expiry: string;
  readonly cap: string;
  readonly marketId: string;
  readonly subaccountId: string;
  readonly marketConfigHash: string;
  readonly priceTick: string;
  readonly quantityTick: string;
  readonly maxFeeRate: string;
  readonly active: boolean;
}

const MANDATE_FIELDS: TypedDataField[] = [
  { name: 'issuer', type: 'address' },
  { name: 'principal', type: 'address' },
  { name: 'agent', type: 'address' },
  { name: 'credentialId', type: 'bytes32' },
  { name: 'commitment', type: 'bytes32' },
  { name: 'credentialEpoch', type: 'uint256' },
  { name: 'policyEpoch', type: 'uint256' },
  { name: 'expiry', type: 'uint64' },
  { name: 'cap', type: 'uint256' },
  { name: 'marketId', type: 'bytes32' },
  { name: 'subaccountId', type: 'bytes32' },
  { name: 'marketConfigHash', type: 'bytes32' },
  { name: 'priceTick', type: 'uint256' },
  { name: 'quantityTick', type: 'uint256' },
  { name: 'maxFeeRate', type: 'uint256' },
  { name: 'active', type: 'bool' },
];

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) => {
    const descriptor = descriptors[key];
    return !!descriptor && Object.hasOwn(descriptor, 'value') && descriptor.get === undefined && descriptor.set === undefined;
  });
}

function address(value: unknown, name: string): string {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw Error(`INVALID_MANDATE_${name}`);
  try {
    const result = getAddress(value);
    if (result === ZERO_ADDRESS) throw Error('ZERO');
    return result;
  } catch {
    throw Error(`INVALID_MANDATE_${name}`);
  }
}

function bytes32(value: unknown, name: string): string {
  if (typeof value !== 'string' || !BYTES32.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw Error(`INVALID_MANDATE_${name}`);
  }
  return value.toLowerCase();
}

function uint(value: unknown, name: string, bits = 256, positive = false): string {
  if (typeof value !== 'string' || !UINT.test(value) || value.length > 78) throw Error(`INVALID_MANDATE_${name}`);
  const parsed = BigInt(value);
  if (parsed >= (1n << BigInt(bits)) || (positive && parsed === 0n)) throw Error(`INVALID_MANDATE_${name}`);
  return value;
}

export function parseIssuerOrderMandate(input: unknown): IssuerOrderMandate {
  if (!exactRecord(input, KEYS)) throw Error('INVALID_MANDATE_FIELDS');
  const raw = input as Record<string, unknown>;
  const chainId = uint(raw.chainId, 'CHAIN_ID', 256, true);
  if (chainId !== '1439') throw Error('MANDATE_WRONG_CHAIN');
  const maxFeeRate = uint(raw.maxFeeRate, 'MAX_FEE_RATE');
  if (BigInt(maxFeeRate) > WAD) throw Error('INVALID_MANDATE_MAX_FEE_RATE');
  if (typeof raw.active !== 'boolean') throw Error('INVALID_MANDATE_ACTIVE');
  return Object.freeze({
    chainId,
    verifyingContract: address(raw.verifyingContract, 'GATE'),
    issuer: address(raw.issuer, 'ISSUER'),
    principal: address(raw.principal, 'PRINCIPAL'),
    agent: address(raw.agent, 'AGENT'),
    credentialId: bytes32(raw.credentialId, 'CREDENTIAL_ID'),
    commitment: bytes32(raw.commitment, 'COMMITMENT'),
    credentialEpoch: uint(raw.credentialEpoch, 'CREDENTIAL_EPOCH', 256, true),
    policyEpoch: uint(raw.policyEpoch, 'POLICY_EPOCH', 256, true),
    expiry: uint(raw.expiry, 'EXPIRY', 64, true),
    cap: uint(raw.cap, 'CAP', 256, true),
    marketId: bytes32(raw.marketId, 'MARKET_ID'),
    subaccountId: bytes32(raw.subaccountId, 'SUBACCOUNT_ID'),
    marketConfigHash: bytes32(raw.marketConfigHash, 'MARKET_CONFIG_HASH'),
    priceTick: uint(raw.priceTick, 'PRICE_TICK', 256, true),
    quantityTick: uint(raw.quantityTick, 'QUANTITY_TICK', 256, true),
    maxFeeRate,
    active: raw.active,
  });
}

export function issuerOrderMandateTypedData(input: unknown) {
  const mandate = parseIssuerOrderMandate(input);
  const { chainId, verifyingContract, ...value } = mandate;
  return {
    domain: { name: 'VEREQO Execution', version: '2', chainId, verifyingContract },
    types: { IssuerOrderMandate: MANDATE_FIELDS.map((field) => ({ ...field })) },
    value,
  };
}

export function issuerOrderMandateDigest(input: unknown): string {
  const data = issuerOrderMandateTypedData(input);
  return TypedDataEncoder.hash(data.domain, data.types, data.value);
}

export function verifyIssuerOrderMandate(input: unknown, signature: unknown): boolean {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
  try {
    const data = issuerOrderMandateTypedData(input);
    return getAddress(verifyTypedData(data.domain, data.types, data.value, signature)) === data.value.issuer;
  } catch {
    return false;
  }
}
