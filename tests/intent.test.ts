import { describe, expect, it } from 'vitest';
import { AbiCoder, concat, id, keccak256, TypedDataEncoder } from 'ethers';
import { financialIntentDigest, financialIntentTypedData, parseFinancialIntent, validateIntentContext, type FinancialIntent, type IntentContext } from '../packages/domain/src/intent.js';
import { unimplementedAdapters, type ExecutionEnvironment } from '../packages/domain/src/boundaries.js';

export const intentFixture: FinancialIntent = {
  chainId: '1439',
  verifyingContract: '0x1111111111111111111111111111111111111111',
  issuer: '0x2222222222222222222222222222222222222222',
  subject: '0x3333333333333333333333333333333333333333',
  agent: '0x4444444444444444444444444444444444444444',
  credentialId: `0x${'11'.repeat(32)}`,
  credentialEpoch: '1',
  policyEpoch: '1',
  disclosureRequestId: `0x${'22'.repeat(32)}`,
  marketId: `0x${'33'.repeat(32)}`,
  subaccountId: `0x${'44'.repeat(32)}`,
  orderType: 0,
  side: 0,
  price: '1050000000000000000',
  quantity: '2000000000000000000',
  nonce: '7',
  deadline: '2000000000',
};

const context: IntentContext = { ...intentFixture, now: '1999999999', usedNonces: new Set() };

describe('canonical EIP-712 exact financial intent boundary', () => {
  it('matches independent ABI encoding of domain and struct, without JSON hashing', () => {
    const encode = AbiCoder.defaultAbiCoder();
    const domainHash = keccak256(encode.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [id('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'), id('VEREQO'), id('1'), '1439', intentFixture.verifyingContract],
    ));
    const intentHash = keccak256(encode.encode(
      ['bytes32', 'address', 'address', 'address', 'bytes32', 'uint256', 'uint256', 'bytes32', 'bytes32', 'bytes32', 'uint8', 'uint8', 'uint256', 'uint256', 'uint256', 'uint64'],
      [id('FinancialIntent(address issuer,address subject,address agent,bytes32 credentialId,uint256 credentialEpoch,uint256 policyEpoch,bytes32 disclosureRequestId,bytes32 marketId,bytes32 subaccountId,uint8 orderType,uint8 side,uint256 price,uint256 quantity,uint256 nonce,uint64 deadline)'),
        intentFixture.issuer, intentFixture.subject, intentFixture.agent, intentFixture.credentialId, '1', '1', intentFixture.disclosureRequestId, intentFixture.marketId, intentFixture.subaccountId, 0, 0, intentFixture.price, intentFixture.quantity, '7', intentFixture.deadline],
    ));
    expect(financialIntentDigest(intentFixture)).toBe(keccak256(concat(['0x1901', domainHash, intentHash])));
    expect(financialIntentDigest(intentFixture)).toBe('0xa4888972dbc6be8cb387ebde56b65799614e7753b54628d1fc31e41ea7c19a48');
  });

  it('isolates its typed-data domain from another product', () => {
    const data=financialIntentTypedData(intentFixture);
    expect(data.domain.name).toBe('VEREQO');
    expect(financialIntentDigest(intentFixture)).not.toBe(TypedDataEncoder.hash({...data.domain,name:'OTHER_PRODUCT'},data.types,data.value));
  });

  const mutations: Record<keyof FinancialIntent, unknown> = {
    chainId: '1440', verifyingContract: '0x5555555555555555555555555555555555555555',
    issuer: '0x5555555555555555555555555555555555555555', subject: '0x5555555555555555555555555555555555555555',
    agent: '0x5555555555555555555555555555555555555555', credentialId: `0x${'55'.repeat(32)}`,
    credentialEpoch: '2', policyEpoch: '2', disclosureRequestId: `0x${'55'.repeat(32)}`,
    marketId: `0x${'55'.repeat(32)}`, subaccountId: `0x${'55'.repeat(32)}`, orderType: 1, side: 1,
    price: '1050000000000000001', quantity: '2000000000000000001', nonce: '8', deadline: '2000000001',
  };
  it.each(Object.entries(mutations))('binds field %s', (key, value) => {
    expect(financialIntentDigest({ ...intentFixture, [key]: value })).not.toBe(financialIntentDigest(intentFixture));
  });

  it('canonicalizes permitted address/bytes case and ignores JSON key ordering', () => {
    const reversed = Object.fromEntries(Object.entries(intentFixture).reverse());
    expect(financialIntentDigest(reversed)).toBe(financialIntentDigest(intentFixture));
    expect(parseFinancialIntent({ ...intentFixture, marketId: `0x${'AB'.repeat(32)}` }).marketId).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('cannot have its schema changed by a caller modifying returned typed data', () => {
    const original = financialIntentDigest(intentFixture);
    const typed = financialIntentTypedData(intentFixture);
    typed.types.FinancialIntent![0]!.name = 'other';
    typed.types.FinancialIntent!.reverse();
    expect(financialIntentDigest(intentFixture)).toBe(original);
  });

  it.each([
    null, [], {}, { ...intentFixture, extra: true },
    { ...intentFixture, chainId: 1439 }, { ...intentFixture, nonce: 9007199254740992 },
    { ...intentFixture, nonce: '07' }, { ...intentFixture, nonce: '-1' }, { ...intentFixture, nonce: '1e3' },
    { ...intentFixture, nonce: ' 7' }, { ...intentFixture, nonce: '+7' }, { ...intentFixture, nonce: '7.0' },
    { ...intentFixture, quantity: '0' }, { ...intentFixture, price: '0' }, { ...intentFixture, credentialEpoch: '0' },
    { ...intentFixture, chainId: '0' }, { ...intentFixture, deadline: (1n << 64n).toString() },
    { ...intentFixture, quantity: (1n << 256n).toString() }, { ...intentFixture, orderType: 2 },
    { ...intentFixture, side: '0' }, { ...intentFixture, issuer: '0x0000000000000000000000000000000000000000' },
    { ...intentFixture, marketId: '0x01' }, { ...intentFixture, marketId: `0x${'00'.repeat(32)}` },
  ])('rejects malformed or ambiguous runtime intent %#', (value) => {
    expect(() => financialIntentDigest(value)).toThrow('INVALID_INTENT');
  });

  it('rejects missing fields, inherited fields, accessors, symbols and non-plain objects', () => {
    const missing: Record<string, unknown> = { ...intentFixture };
    delete missing.nonce;
    expect(() => parseFinancialIntent(missing)).toThrow();
    expect(() => parseFinancialIntent(Object.create(intentFixture))).toThrow();
    const accessor = Object.defineProperty({ ...intentFixture }, 'nonce', { get: () => { throw new Error('SHOULD_NOT_READ'); } });
    expect(() => parseFinancialIntent(accessor)).toThrow('INVALID_INTENT_FIELDS');
    expect(() => parseFinancialIntent({ ...intentFixture, [Symbol('nonce')]: '7' })).toThrow();
    expect(() => parseFinancialIntent(new Date())).toThrow();
  });

  it('supports full-width uint256 values without float precision loss', () => {
    const max = ((1n << 256n) - 1n).toString();
    expect(parseFinancialIntent({ ...intentFixture, nonce: max }).nonce).toBe(max);
  });
});

describe('context checks do not imply authorization or execution', () => {
  it('reports only context match and does not consume nonce', () => {
    expect(validateIntentContext(intentFixture, context)).toEqual({ status: 'CONTEXT_MATCH' });
    expect(context.usedNonces.size).toBe(0);
    expect(validateIntentContext(intentFixture, context)).toEqual({ status: 'CONTEXT_MATCH' });
  });
  it.each(['chainId', 'verifyingContract', 'issuer', 'subject', 'agent', 'credentialId', 'credentialEpoch', 'policyEpoch'] as const)('rejects stale/wrong %s', (key) => {
    const replacement = key === 'chainId' ? '1' : key.endsWith('Epoch') ? '2' : key === 'credentialId' ? `0x${'aa'.repeat(32)}` : '0x5555555555555555555555555555555555555555';
    expect(validateIntentContext(intentFixture, { ...context, [key]: replacement })).toEqual({ status: 'REJECTED', reason: `MISMATCH_${key}` });
  });
  it('checks expiry and replay; deadline equality is accepted', () => {
    expect(validateIntentContext(intentFixture, { ...context, now: intentFixture.deadline })).toEqual({ status: 'CONTEXT_MATCH' });
    expect(validateIntentContext(intentFixture, { ...context, now: '2000000001' })).toEqual({ status: 'REJECTED', reason: 'EXPIRED' });
    expect(validateIntentContext(intentFixture, { ...context, usedNonces: new Set(['7']) })).toEqual({ status: 'REJECTED', reason: 'REPLAY' });
    expect(validateIntentContext(intentFixture, { ...context, now: '-1' })).toEqual({ status: 'REJECTED', reason: 'MALFORMED_CONTEXT_OR_INTENT' });
  });
  it.each<ExecutionEnvironment>(['LOCAL_REFERENCE', 'LOCAL_ZK', 'LOCAL_EVM', 'INJECTIVE_TESTNET', 'MIDNIGHT'])('missing %s adapters always fail closed', async (environment) => {
    const adapters = unimplementedAdapters(environment);
    const proof = { status: 'NOT_IMPLEMENTED', environment } as const;
    expect(await adapters.verifier.verify(proof)).toEqual({ status: 'NOT_IMPLEMENTED', valid: false, environment });
    const authorization = await adapters.authorizer.authorize(intentFixture, proof);
    expect(authorization).toEqual({ status: 'NOT_IMPLEMENTED', authorized: false, environment });
    expect(await adapters.executor.execute(intentFixture, authorization)).toEqual({ status: 'NOT_IMPLEMENTED', environment });
  });
});
