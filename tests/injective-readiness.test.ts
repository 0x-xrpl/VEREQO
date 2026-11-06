import { describe, expect, it } from 'vitest';
import { AbiCoder, Interface, concat, id } from 'ethers';
import { financialIntentDigest, type FinancialIntent } from '../packages/domain/src/intent.js';
import { INJECTIVE_SPOT_LIMIT_ORDER_ABI, validateInjectiveLocalPlan, type InjectiveLocalPlanContext } from '../packages/domain/src/injective-readiness.js';

// Synthetic fixed data: neither a live market nor an account ownership assertion.
const intent: FinancialIntent = {
  chainId: '1439', verifyingContract: `0x${'11'.repeat(20)}`, issuer: `0x${'22'.repeat(20)}`,
  subject: `0x${'33'.repeat(20)}`, agent: `0x${'44'.repeat(20)}`,
  credentialId: `0x${'11'.repeat(32)}`, credentialEpoch: '1', policyEpoch: '1',
  disclosureRequestId: `0x${'22'.repeat(32)}`, marketId: `0x${'ab'.repeat(32)}`,
  subaccountId: `0x${'cd'.repeat(32)}`, orderType: 0, side: 0,
  price: '1050000000000000000', quantity: '2000000000000000000', nonce: '7', deadline: '2000000000',
};
const context: InjectiveLocalPlanContext = {
  ...intent, now: '1999999999', usedNonces: new Set(), caller: intent.agent,
  allowedMarketId: intent.marketId, allowedSubaccountId: intent.subaccountId,
  expectedDigest: financialIntentDigest(intent),
};
const match = { status: 'LOCAL_PLAN_MATCH', execution: 'NOT_IMPLEMENTED', authorized: false };
const rejection = (reason: string) => ({ status: 'REJECTED', reason, execution: 'NOT_IMPLEMENTED', authorized: false });

describe('Injective local plan consistency without authorization', () => {
  it('matches supplied expectations repeatedly without consuming a nonce or issuing a grant/receipt', () => {
    const usedNonces = new Set<string>();
    const local = { ...context, usedNonces };
    expect(validateInjectiveLocalPlan(intent, local)).toEqual(match);
    expect(validateInjectiveLocalPlan(intent, local)).toEqual(match);
    expect([...usedNonces]).toEqual([]);
  });

  it.each(['chainId', 'verifyingContract', 'issuer', 'subject', 'agent', 'credentialId', 'credentialEpoch', 'policyEpoch'] as const)('rejects mismatched %s', (key) => {
    const value = key === 'chainId' ? '1' : key.endsWith('Epoch') ? '2' : key === 'credentialId' ? `0x${'55'.repeat(32)}` : `0x${'55'.repeat(20)}`;
    expect(validateInjectiveLocalPlan(intent, { ...context, [key]: value })).toEqual(rejection(`MISMATCH_${key}`));
  });

  it.each([
    ['allowedMarketId', `0x${'ee'.repeat(32)}`, 'MISMATCH_marketId'],
    ['allowedSubaccountId', `0x${'ee'.repeat(32)}`, 'MISMATCH_subaccountId'],
    ['caller', `0x${'55'.repeat(20)}`, 'UNAUTHORIZED_CALLER'],
    ['expectedDigest', `0x${'ee'.repeat(32)}`, 'MISMATCH_intentDigest'],
    ['now', '2000000001', 'EXPIRED'],
  ])('rejects local %s mismatch', (key, value, reason) => {
    expect(validateInjectiveLocalPlan(intent, { ...context, [key]: value })).toEqual(rejection(reason));
  });

  it('rejects replay supplied in context and accepts deadline equality', () => {
    expect(validateInjectiveLocalPlan(intent, { ...context, usedNonces: new Set(['7']) })).toEqual(rejection('REPLAY'));
    expect(validateInjectiveLocalPlan(intent, { ...context, now: intent.deadline })).toEqual(match);
  });

  it.each(['0', '-1', '1.0', '01', (1n << 256n).toString()])('rejects invalid quantity %s', (quantity) => {
    expect(validateInjectiveLocalPlan({ ...intent, quantity }, context)).toEqual(rejection('MALFORMED_CONTEXT_OR_INTENT'));
  });

  it('detects an otherwise valid changed intent through its expected digest', () => {
    expect(validateInjectiveLocalPlan({ ...intent, quantity: '1' }, context)).toEqual(rejection('MISMATCH_intentDigest'));
  });

  it.each([
    { allowedMarketId: '0x01' }, { allowedSubaccountId: `0x${'00'.repeat(32)}` },
    { caller: 'not-an-address' }, { expectedDigest: '0x01' }, { now: '-1' },
  ])('fails closed for malformed local expectations %#', (change) => {
    expect(validateInjectiveLocalPlan(intent, { ...context, ...change })).toEqual(rejection('MALFORMED_CONTEXT_OR_INTENT'));
  });

  it('normalizes permitted hexadecimal case in supplied IDs and digest', () => {
    expect(validateInjectiveLocalPlan(intent, {
      ...context, allowedMarketId: `0x${'AB'.repeat(32)}`, allowedSubaccountId: `0x${'CD'.repeat(32)}`,
      expectedDigest: `0x${context.expectedDigest.slice(2).toUpperCase()}`,
    })).toEqual(match);
  });
});

describe('source spot limit order ABI static codec only', () => {
  const codec = new Interface([INJECTIVE_SPOT_LIMIT_ORDER_ABI]);
  const signature = 'createSpotLimitOrder(address,(string,string,string,uint256,uint256,string,string,uint256))';
  const tupleType = 'tuple(string,string,string,uint256,uint256,string,string,uint256)';
  // Deliberately opaque strings test ABI positions, not native address/subaccount validity.
  const order = ['fixture-market', 'fixture-subaccount', 'fixture-fee-recipient', 1050000000000000000n, 2000000000000000000n, 'fixture-cid', 'buy', 0n];
  const sender = `0x${'66'.repeat(20)}`;

  it('uses the flat eight-field tuple with independent selector and ABI encoding', () => {
    const fragment = codec.getFunction('createSpotLimitOrder')!;
    expect(fragment.format('sighash')).toBe(signature);
    expect(fragment.inputs[1]!.components!.map((field) => [field.name, field.type])).toEqual([
      ['marketID', 'string'], ['subaccountID', 'string'], ['feeRecipient', 'string'], ['price', 'uint256'],
      ['quantity', 'uint256'], ['cid', 'string'], ['orderType', 'string'], ['triggerPrice', 'uint256'],
    ]);
    const encoded = codec.encodeFunctionData(fragment, [sender, order]);
    expect(encoded).toBe(concat([id(signature).slice(0, 10), AbiCoder.defaultAbiCoder().encode(['address', tupleType], [sender, order])]));
    const decoded = codec.decodeFunctionData(fragment, encoded);
    expect(decoded[0]).toBe(sender);
    expect(Array.from(decoded[1] as Iterable<unknown>)).toEqual(order);
  });

  it('decodes the source response tuple without treating it as an execution receipt', () => {
    const encoded = AbiCoder.defaultAbiCoder().encode(['tuple(string,string)'], [['fixture-order-hash', 'fixture-cid']]);
    const decoded = codec.decodeFunctionResult('createSpotLimitOrder', encoded);
    expect(Array.from(decoded[0] as Iterable<unknown>)).toEqual(['fixture-order-hash', 'fixture-cid']);
  });
});
