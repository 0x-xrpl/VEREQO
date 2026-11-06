import { TypedDataEncoder, getAddress, type TypedDataDomain, type TypedDataField } from 'ethers';

/** JSON-safe canonical unsigned integers use decimal strings, never JS numbers. */
export interface FinancialIntent {
  readonly chainId: string;
  readonly verifyingContract: string;
  readonly issuer: string;
  readonly subject: string;
  readonly agent: string;
  readonly credentialId: string;
  readonly credentialEpoch: string;
  readonly policyEpoch: string;
  readonly disclosureRequestId: string;
  readonly marketId: string;
  readonly subaccountId: string;
  /** 0 = LIMIT, 1 = POST_ONLY; not the Injective MsgType enum. */
  readonly orderType: 0 | 1;
  /** 0 = BUY, 1 = SELL; translated explicitly by a future chain adapter. */
  readonly side: 0 | 1;
  /** Human-readable price and quantity scaled by 10^18 for the target precompile. */
  readonly price: string;
  readonly quantity: string;
  readonly nonce: string;
  readonly deadline: string;
}

const KEYS = [
  'chainId', 'verifyingContract', 'issuer', 'subject', 'agent', 'credentialId',
  'credentialEpoch', 'policyEpoch', 'disclosureRequestId', 'marketId', 'subaccountId',
  'orderType', 'side', 'price', 'quantity', 'nonce', 'deadline',
] as const;
const UINT = /^(0|[1-9][0-9]*)$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function uint(value: unknown, name: string, bits = 256, positive = false): string {
  if (typeof value !== 'string' || !UINT.test(value) || value.length > 78) {
    throw new Error(`INVALID_INTENT_${name}`);
  }
  const n = BigInt(value);
  if (n >= 1n << BigInt(bits) || (positive && n === 0n)) throw new Error(`INVALID_INTENT_${name}`);
  return value;
}

function address(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`INVALID_INTENT_${name}`);
  try {
    const parsed = getAddress(value);
    if (parsed === ZERO_ADDRESS) throw new Error('ZERO_ADDRESS');
    return parsed;
  } catch {
    throw new Error(`INVALID_INTENT_${name}`);
  }
}

function bytes32(value: unknown, name: string): string {
  if (typeof value !== 'string' || !BYTES32.test(value) || /^0x0{64}$/.test(value)) throw new Error(`INVALID_INTENT_${name}`);
  return value.toLowerCase();
}

function flag(value: unknown, name: string): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error(`INVALID_INTENT_${name}`);
  return value;
}

export function parseFinancialIntent(input: unknown): FinancialIntent {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('INVALID_INTENT_OBJECT');
  const proto: unknown = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) throw new Error('INVALID_INTENT_OBJECT');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).length !== KEYS.length ||
      KEYS.some((key) => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key]!, 'value'))) {
    throw new Error('INVALID_INTENT_FIELDS');
  }
  const obj = input as Record<string, unknown>;
  return Object.freeze({
    chainId: uint(obj.chainId, 'chainId', 256, true),
    verifyingContract: address(obj.verifyingContract, 'verifyingContract'),
    issuer: address(obj.issuer, 'issuer'),
    subject: address(obj.subject, 'subject'),
    agent: address(obj.agent, 'agent'),
    credentialId: bytes32(obj.credentialId, 'credentialId'),
    credentialEpoch: uint(obj.credentialEpoch, 'credentialEpoch', 256, true),
    policyEpoch: uint(obj.policyEpoch, 'policyEpoch', 256, true),
    disclosureRequestId: bytes32(obj.disclosureRequestId, 'disclosureRequestId'),
    marketId: bytes32(obj.marketId, 'marketId'),
    subaccountId: bytes32(obj.subaccountId, 'subaccountId'),
    orderType: flag(obj.orderType, 'orderType'),
    side: flag(obj.side, 'side'),
    price: uint(obj.price, 'price', 256, true),
    quantity: uint(obj.quantity, 'quantity', 256, true),
    nonce: uint(obj.nonce, 'nonce'),
    deadline: uint(obj.deadline, 'deadline', 64, true),
  });
}

const FINANCIAL_INTENT_TYPES: Record<string, TypedDataField[]> = {
  FinancialIntent: [
    { name: 'issuer', type: 'address' },
    { name: 'subject', type: 'address' },
    { name: 'agent', type: 'address' },
    { name: 'credentialId', type: 'bytes32' },
    { name: 'credentialEpoch', type: 'uint256' },
    { name: 'policyEpoch', type: 'uint256' },
    { name: 'disclosureRequestId', type: 'bytes32' },
    { name: 'marketId', type: 'bytes32' },
    { name: 'subaccountId', type: 'bytes32' },
    { name: 'orderType', type: 'uint8' },
    { name: 'side', type: 'uint8' },
    { name: 'price', type: 'uint256' },
    { name: 'quantity', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
};

export function financialIntentTypedData(input: unknown): {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  value: Omit<FinancialIntent, 'chainId' | 'verifyingContract'>;
} {
  const parsed = parseFinancialIntent(input);
  const { chainId, verifyingContract, ...value } = parsed;
  return {
    domain: { name: 'VEREQO', version: '1', chainId, verifyingContract },
    types: { FinancialIntent: FINANCIAL_INTENT_TYPES.FinancialIntent!.map((field) => ({ ...field })) },
    value,
  };
}

export function financialIntentDigest(input: unknown): string {
  const { domain, types, value } = financialIntentTypedData(input);
  return TypedDataEncoder.hash(domain, types, value);
}

export interface IntentContext {
  readonly chainId: string;
  readonly verifyingContract: string;
  readonly issuer: string;
  readonly subject: string;
  readonly agent: string;
  readonly credentialId: string;
  readonly credentialEpoch: string;
  readonly policyEpoch: string;
  readonly now: string;
  /** Nonces are scoped to issuer + subject + agent + verifying contract + chain. */
  readonly usedNonces: ReadonlySet<string>;
}

/** Only context consistency; never proof verification, authorization or nonce consumption. */
export function validateIntentContext(input: unknown, context: IntentContext):
  { status: 'CONTEXT_MATCH' } | { status: 'REJECTED'; reason: string } {
  try {
    const intent = parseFinancialIntent(input);
    const expected = {
      chainId: uint(context.chainId, 'chainId', 256, true),
      verifyingContract: address(context.verifyingContract, 'verifyingContract'),
      issuer: address(context.issuer, 'issuer'),
      subject: address(context.subject, 'subject'),
      agent: address(context.agent, 'agent'),
      credentialId: bytes32(context.credentialId, 'credentialId'),
      credentialEpoch: uint(context.credentialEpoch, 'credentialEpoch', 256, true),
      policyEpoch: uint(context.policyEpoch, 'policyEpoch', 256, true),
    };
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      if (intent[key] !== expected[key]) return { status: 'REJECTED', reason: `MISMATCH_${key}` };
    }
    if (BigInt(intent.deadline) < BigInt(uint(context.now, 'now', 64))) return { status: 'REJECTED', reason: 'EXPIRED' };
    if (context.usedNonces.has(intent.nonce)) return { status: 'REJECTED', reason: 'REPLAY' };
    return { status: 'CONTEXT_MATCH' };
  } catch {
    return { status: 'REJECTED', reason: 'MALFORMED_CONTEXT_OR_INTENT' };
  }
}
