import { Interface, TypedDataEncoder, getAddress, keccak256, toUtf8Bytes, type TypedDataField } from 'ethers';

export const EXCHANGE_SOURCE_REVISION = '811a0a1b3e7303234bd42c6d00b47cc464d143ad';
export const EXCHANGE_PRECOMPILE = '0x0000000000000000000000000000000000000065';
export const SPOT_ORDER_ABI = 'function createSpotLimitOrder(address sender,(string marketID,string subaccountID,string feeRecipient,uint256 price,uint256 quantity,string cid,string orderType,uint256 triggerPrice) order) returns ((string orderHash,string cid))';
const exchange = new Interface([SPOT_ORDER_ABI]);
const SCALE = 10n ** 18n, MAX = (1n << 256n) - 1n;
const addressFields = ['verifyingContract', 'sender', 'issuer', 'principal', 'agent'] as const;
const hashFields = ['credentialId', 'marketId', 'subaccountId', 'marketConfigHash', 'disclosureRequestId'] as const;
const uintFields = ['chainId', 'credentialEpoch', 'policyEpoch', 'price', 'quantity', 'priceTick', 'quantityTick', 'nonce', 'deadline', 'maxNotional', 'maxFeeRate', 'maxTotalExposure'] as const;
const keys = [...addressFields, ...hashFields, ...uintFields, 'side', 'orderType'];
export interface NativeOrderIntent {
  readonly verifyingContract: string; readonly sender: string; readonly issuer: string; readonly principal: string; readonly agent: string;
  readonly credentialId: string; readonly marketId: string; readonly subaccountId: string; readonly marketConfigHash: string;
  /** Hash of the canonical business request ID. Its digest is included in Groth16 public intent signals and the Gate signature. */ readonly disclosureRequestId: string;
  readonly chainId: string; readonly credentialEpoch: string; readonly policyEpoch: string;
  /** All financial numbers are API/human quantities scaled by 1e18, not bank units. */
  readonly price: string; readonly quantity: string; readonly priceTick: string; readonly quantityTick: string;
  readonly nonce: string; readonly deadline: string; readonly maxNotional: string; readonly maxFeeRate: string; readonly maxTotalExposure: string;
  readonly side: 'BUY' | 'SELL'; readonly orderType: 'LIMIT' | 'POST_ONLY';
}
function fail(): never { throw Error('INVALID_NATIVE_ORDER'); }
function uint(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > MAX) return fail();
  return value;
}
export function canonicalBusinessRequestId(requestId: string): string {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(requestId)) return fail();
  return keccak256(toUtf8Bytes(`VEREQO_BUSINESS_REQUEST_V1:${requestId}`));
}
export function decimalToApi18(value: string): string {
  if (typeof value !== 'string' || value.length > 100 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)) return fail();
  const [whole, fraction = ''] = value.split('.');
  return uint((BigInt(whole!) * SCALE + BigInt(fraction.padEnd(18, '0'))).toString());
}
export function parseNativeOrderIntent(input: unknown): NativeOrderIntent {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).length !== keys.length || keys.some(k => !Object.hasOwn(descriptors, k) || !Object.hasOwn(descriptors[k]!, 'value'))) return fail();
  const raw = input as Record<string, unknown>, out: Record<string, string> = {};
  for (const k of addressFields) {
    if (typeof raw[k] !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(raw[k] as string)) return fail();
    out[k] = getAddress(raw[k] as string); if (/^0x0{40}$/.test(out[k]!)) return fail();
  }
  for (const k of hashFields) { if (typeof raw[k] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(raw[k] as string) || /^0x0{64}$/.test(raw[k] as string)) return fail(); out[k] = (raw[k] as string).toLowerCase(); }
  for (const k of uintFields) out[k] = uint(raw[k]);
  if (raw.side !== 'BUY' && raw.side !== 'SELL' || raw.orderType !== 'LIMIT' && raw.orderType !== 'POST_ONLY') return fail();
  out.side = raw.side; out.orderType = raw.orderType;
  if (out.chainId !== '1439' || out.sender !== out.verifyingContract || !out.subaccountId!.startsWith(out.sender!.toLowerCase())) return fail();
  for (const k of ['credentialEpoch','policyEpoch','price','quantity','priceTick','quantityTick','deadline','maxNotional','maxTotalExposure']) if (out[k] === '0') return fail();
  if (BigInt(out.deadline!) >= 1n << 64n || BigInt(out.maxFeeRate!) > SCALE || BigInt(out.price!) % BigInt(out.priceTick!) || BigInt(out.quantity!) % BigInt(out.quantityTick!)) return fail();
  const parsed = Object.freeze(out) as unknown as NativeOrderIntent;
  const exposure = nativeOrderExposure(parsed);
  if (BigInt(exposure.notional) > BigInt(parsed.maxNotional) || BigInt(exposure.total) > BigInt(parsed.maxTotalExposure)) return fail();
  return parsed;
}
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
/** Quote-notional bound; sell-side base inventory must additionally be enforced by executor. */
export function nativeOrderExposure(intent: NativeOrderIntent) {
  const product = BigInt(intent.price) * BigInt(intent.quantity);
  // Restrict to Solidity checked uint256 multiplication semantics.
  if (product > MAX) return fail();
  const notional = ceil(product, SCALE), feeProduct = notional * BigInt(intent.maxFeeRate);
  if (feeProduct > MAX) return fail();
  const fee = ceil(feeProduct, SCALE), total = notional + fee;
  if (total > MAX) return fail();
  return { notional: notional.toString(), fee: fee.toString(), total: total.toString() };
}
const types: Record<string, TypedDataField[]> = { NativeOrderIntent: [
  ...addressFields.filter(k => k !== 'verifyingContract').map(name => ({ name, type: 'address' })),
  ...hashFields.map(name => ({ name, type: 'bytes32' })),
  ...uintFields.filter(k => k !== 'chainId').map(name => ({ name, type: 'uint256' })),
  {name:'side', type:'string'}, {name:'orderType',type:'string'},
] };
export function nativeOrderTypedData(input: unknown) {
  const { chainId, verifyingContract, ...value } = parseNativeOrderIntent(input);
  return { domain: { name: 'VEREQO Execution', version: '2', chainId, verifyingContract }, types: { NativeOrderIntent: types.NativeOrderIntent!.map(f => ({...f})) }, value };
}
export function nativeOrderDigest(input: unknown): string { const t = nativeOrderTypedData(input); return TypedDataEncoder.hash(t.domain, t.types, t.value); }
/** Deterministic codec only; no ownership, signature, proof or native compatibility assertion. */
export function prepareNativeOrder(input: unknown) {
  const i = parseNativeOrderIntent(input);
  const orderType = i.side === 'BUY' ? i.orderType === 'LIMIT' ? 'buy' : 'buyPostOnly' : i.orderType === 'LIMIT' ? 'sell' : 'sellPostOnly';
  const order = { marketID:i.marketId, subaccountID:i.subaccountId, feeRecipient:'', price:i.price, quantity:i.quantity, cid:'', orderType, triggerPrice:'0' };
  return Object.freeze({ status:'PREVIEW' as const, authorized:false as const, execution:'NOT_IMPLEMENTED' as const, to:EXCHANGE_PRECOMPILE, sender:i.sender, order, digest:nativeOrderDigest(i), exposure:nativeOrderExposure(i), calldata:exchange.encodeFunctionData('createSpotLimitOrder',[i.sender,order]) });
}
export function matchesNativeOrderCalldata(input: unknown, calldata: unknown): boolean {
  try { return typeof calldata === 'string' && prepareNativeOrder(input).calldata.toLowerCase() === calldata.toLowerCase(); } catch { return false; }
}
