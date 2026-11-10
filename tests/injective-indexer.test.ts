import { describe, expect, it } from 'vitest';
import {
  assessSpotBuyLimitRisk,
  fetchSpotOrderbookV2,
  SPOT_ORDERBOOKS_V2_METHOD,
  TESTNET_INDEXER_GRPC_WEB,
  type SpotOrderbookObservation,
} from '../packages/domain/src/injective-indexer.js';

const marketId = `0x${'12'.repeat(32)}`;
const now = 1_800_000_000_000;

function varint(value: bigint): Uint8Array {
  const out: number[] = [];
  while (value > 127n) { out.push(Number(value & 127n) | 128); value >>= 7n; }
  out.push(Number(value));
  return Uint8Array.from(out);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) { output.set(part, at); at += part.length; }
  return output;
}
function responseBody(bytes: Uint8Array): ArrayBuffer { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
function bytesField(number: number, value: Uint8Array): Uint8Array {
  return concat(varint(BigInt((number << 3) | 2)), varint(BigInt(value.length)), value);
}
function stringField(number: number, value: string): Uint8Array { return bytesField(number, new TextEncoder().encode(value)); }
function uintField(number: number, value: bigint): Uint8Array { return concat(varint(BigInt(number << 3)), varint(value)); }
function sintField(number: number, value: bigint): Uint8Array { return uintField(number, (value << 1n) ^ (value >> 63n)); }
function level(price: string, quantity: string, timestamp: bigint) {
  return concat(stringField(1, price), stringField(2, quantity), sintField(3, timestamp));
}
function grpcResponse(id = marketId, status = '0', outerSequence: bigint | null = null, empty = false, levelTimestamp = BigInt(now)) {
  const timestamp = BigInt(now);
  const book = concat(
    ...(empty ? [] : [
      bytesField(1, level('1.99', '3.0', levelTimestamp)),
      bytesField(2, level('2.0', '1.0', levelTimestamp)),
      bytesField(2, level('2.02', '1.0', levelTimestamp)),
      uintField(3, 5n),
    ]),
    sintField(4, timestamp), sintField(5, 291n),
  );
  const single = concat(stringField(1, id), bytesField(2, book), ...(outerSequence === null ? [] : [uintField(3, outerSequence), sintField(4, timestamp), sintField(5, 291n)]));
  const message = bytesField(1, single);
  const dataLength = new Uint8Array(4);
  new DataView(dataLength.buffer).setUint32(0, message.length, false);
  const trailer = new TextEncoder().encode(`grpc-status: ${status}\r\n`);
  const trailerLength = new Uint8Array(4);
  new DataView(trailerLength.buffer).setUint32(0, trailer.length, false);
  return concat(Uint8Array.of(0), dataLength, message, Uint8Array.of(128), trailerLength, trailer);
}
function book(patch: Partial<SpotOrderbookObservation> = {}): SpotOrderbookObservation {
  return {
    marketId, buys: [{ price: '1.99', quantity: '3', timestampMs: String(now) }],
    sells: [{ price: '2', quantity: '1', timestampMs: String(now) }, { price: '2.02', quantity: '1', timestampMs: String(now) }],
    sequence: '5', timestampMs: String(now), height: '291', fetchedAtMs: String(now),
    source: `${TESTNET_INDEXER_GRPC_WEB}${SPOT_ORDERBOOKS_V2_METHOD}`, consistency: 'UNPINNED_INDEXER_REPORT',
    ...patch,
  };
}
const intent = {
  marketId, side: 'BUY', orderType: 'LIMIT', price: '2020000000000000000', quantity: '2000000000000000000',
  priceTick: '1000000000000000', quantityTick: '1000000000000000', maxNotional: '4100000000000000000',
  maxFeeRate: '500000000000000', maxTotalExposure: '5000000000000000000', marketConfigHash: `0x${'ab'.repeat(32)}`,
};
const riskInput = (patch: Record<string, unknown> = {}) => ({
  marketId, market: { marketId, baseDecimals: 0, quoteDecimals: 0, priceTick: '1000000000000000', quantityTick: '1000000000000000' },
  orderbook: book(), intent, intentDigest: `0x${'cd'.repeat(32)}`, nowMs: now, maxAgeMs: 10_000, maxSlippageBps: 100, ...patch,
});

describe('Injective read-only OrderbooksV2 integration', () => {
  it('compares chain-unit depth to human API18 intents using market decimals', () => {
    const market = { marketId, baseDecimals: 18, quoteDecimals: 6, priceTick: intent.priceTick, quantityTick: intent.quantityTick };
    const raw = book({ buys: [], sells: [{ price: '0.000000000002', quantity: '1000000000000000000', timestampMs: String(now) }] });
    const candidate = { ...intent, price: '1500000000000000000', quantity: '1000000000000000000' };
    expect(assessSpotBuyLimitRisk(riskInput({ market, orderbook: raw, intent: candidate })).reason).toBe('INSUFFICIENT_VISIBLE_ASK_DEPTH');
    const clear = assessSpotBuyLimitRisk(riskInput({ market, orderbook: raw, intent: { ...candidate, price: '2000000000000000000' } }));
    expect(clear).toMatchObject({ status: 'CLEAR_FOR_REVIEW', estimatedQuoteNotional: '2000000000000000000', visibleAskQuantity: '1000000000000000000', authorized: false, gateDecision: 'MARKET_RISK_UNVERIFIED' });
    expect(assessSpotBuyLimitRisk(riskInput({ market: { ...market, baseDecimals: -1 } })).reason).toBe('INVALID_MARKET_DECIMALS');
    const imprecise = book({ buys: [], sells: [{ price: '0.000000000002', quantity: '0.1', timestampMs: String(now) }] });
    expect(assessSpotBuyLimitRisk(riskInput({ market, orderbook: imprecise })).reason).toBe('INVALID_ORDERBOOK_LEVEL');
  });
  it('calls the official Testnet gRPC-Web OrderbooksV2 method and parses depth metadata', async () => {
    let called = '';
    const result = await fetchSpotOrderbookV2(async (url, init) => {
      called = url;
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('content-type')).toBe('application/grpc-web+proto');
      expect(init?.body).toBeInstanceOf(ArrayBuffer);
      const frame = new Uint8Array(init?.body as ArrayBuffer);
      const framedLength = new DataView(frame.buffer, frame.byteOffset + 1, 4).getUint32(0, false);
      const proto = frame.slice(5, 5 + framedLength);
      expect(new TextDecoder().decode(proto)).toContain(marketId);
      expect(Array.from(proto.slice(-2))).toEqual([16, 100]); // depth=50 encoded as protobuf sint32
      return new Response(responseBody(grpcResponse()), { headers: { 'content-type': 'application/grpc-web+proto; charset=utf-8' } });
    }, marketId, () => now, 50);
    expect(called).toBe(`${TESTNET_INDEXER_GRPC_WEB}${SPOT_ORDERBOOKS_V2_METHOD}`);
    expect(result).toMatchObject({ marketId, sequence: '5', height: '291', timestampMs: String(now), fetchedAtMs: String(now), consistency: 'UNPINNED_INDEXER_REPORT' });
    expect(result.sells).toEqual([
      { price: '2.0', quantity: '1.0', timestampMs: String(now) },
      { price: '2.02', quantity: '1.0', timestampMs: String(now) },
    ]);
  });

  it('rejects a successful HTTP response with a missing or non-gRPC-Web content type', async () => {
    const body = responseBody(grpcResponse());
    await expect(fetchSpotOrderbookV2(async () => new Response(body, { headers: { 'content-type': 'text/html' } }), marketId, () => now))
      .rejects.toThrow('INDEXER_UNEXPECTED_CONTENT_TYPE');
    await expect(fetchSpotOrderbookV2(async () => new Response(body), marketId, () => now))
      .rejects.toThrow('INDEXER_UNEXPECTED_CONTENT_TYPE');
  });

  it('rejects a different market and non-success gRPC trailer', async () => {
    const response = (id = marketId, status = '0', sequence: bigint | null = null) =>
      new Response(responseBody(grpcResponse(id, status, sequence)), { headers: { 'content-type': 'application/grpc-web+proto' } });
    await expect(fetchSpotOrderbookV2(async () => response(`0x${'34'.repeat(32)}`), marketId, () => now)).rejects.toThrow('INDEXER_MARKET_MISMATCH');
    await expect(fetchSpotOrderbookV2(async () => response(marketId, '7'), marketId, () => now)).rejects.toThrow('INDEXER_GRPC_NOT_OK');
    await expect(fetchSpotOrderbookV2(async () => response(marketId, '0', 9n), marketId, () => now)).rejects.toThrow('ORDERBOOK_SEQUENCE_MISMATCH');
  });

  it('rejects negative level timestamps from an otherwise valid protobuf response', async () => {
    await expect(fetchSpotOrderbookV2(
      async () => new Response(responseBody(grpcResponse(marketId, '0', null, false, -1n)), { headers: { 'content-type': 'application/grpc-web+proto' } }),
      marketId,
      () => now,
    )).rejects.toThrow('INVALID_ORDERBOOK_TIMESTAMP');
  });

  it('preserves an empty market book with protobuf-default sequence while risk remains blocked', async () => {
    const observation = await fetchSpotOrderbookV2(
      async () => new Response(responseBody(grpcResponse(marketId, '0', null, true)), { headers: { 'content-type': 'application/grpc-web+proto' } }),
      marketId,
      () => now,
      50,
    );
    expect(observation).toMatchObject({ marketId, sequence: '0', timestampMs: String(now), height: '291', buys: [], sells: [] });
    expect(assessSpotBuyLimitRisk(riskInput({ orderbook: observation }))).toMatchObject({
      status: 'BLOCKED', reason: 'NO_VISIBLE_ASK_LIQUIDITY', authorized: false,
      execution: 'NOT_IMPLEMENTED', gateDecision: 'MARKET_RISK_UNVERIFIED',
    });
  });
});

describe('conservative T5 preview risk assessment', () => {
  it('computes visible ask depth, limit exposure and slippage but never authorizes execution', () => {
    const result = assessSpotBuyLimitRisk(riskInput());
    expect(result).toMatchObject({
      status: 'CLEAR_FOR_REVIEW', reason: null, authorized: false, execution: 'NOT_IMPLEMENTED',
      gateDecision: 'MARKET_RISK_UNVERIFIED', dataTrust: 'UNPINNED_INDEXER_REPORT',
      slippageBps: '50', visibleAskQuantity: '2000000000000000000',
      estimatedQuoteNotional: '4020000000000000000', conservativeExposure: '4042020000000000000', observationDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it('blocks unavailable, stale, mismatched, under-depth and excessive-slippage observations', () => {
    expect(assessSpotBuyLimitRisk(riskInput({ orderbook: null })).reason).toBe('ORDERBOOK_UNAVAILABLE');
    expect(assessSpotBuyLimitRisk(riskInput({ nowMs: now + 20_000 })).reason).toBe('ORDERBOOK_STALE');
    expect(assessSpotBuyLimitRisk(riskInput({ marketId: `0x${'34'.repeat(32)}` })).reason).toBe('MARKET_ID_MISMATCH');
    expect(assessSpotBuyLimitRisk(riskInput({ orderbook: book({ sells: [{ price: '2', quantity: '1', timestampMs: String(now) }] }) })).reason).toBe('INSUFFICIENT_VISIBLE_ASK_DEPTH');
    expect(assessSpotBuyLimitRisk(riskInput({ maxSlippageBps: 49 })).reason).toBe('SLIPPAGE_LIMIT_EXCEEDED');
  });

  it('fails closed on stale fetches, future timestamps, and unpinned provenance changes', () => {
    expect(assessSpotBuyLimitRisk(riskInput({ orderbook: book({ fetchedAtMs: String(now - 10_001) }) })).reason)
      .toBe('ORDERBOOK_STALE');
    expect(assessSpotBuyLimitRisk(riskInput({ orderbook: book({ fetchedAtMs: String(now + 2_001) }) })).reason)
      .toBe('ORDERBOOK_FUTURE_DATED');
    expect(assessSpotBuyLimitRisk(riskInput({ orderbook: book({ consistency: 'PINNED_CHAIN_STATE' as never }) })).reason)
      .toBe('UNTRUSTED_ORDERBOOK_PROVENANCE');
    expect(assessSpotBuyLimitRisk(riskInput({ orderbook: book({ source: 'https://attacker.invalid/orderbook' }) })).reason)
      .toBe('UNTRUSTED_ORDERBOOK_PROVENANCE');
  });

  it('rejects malformed sort order and crossed books even when called without the protobuf parser', () => {
    expect(assessSpotBuyLimitRisk(riskInput({
      orderbook: book({ sells: [
        { price: '2.02', quantity: '1', timestampMs: String(now) },
        { price: '2.0', quantity: '1', timestampMs: String(now) },
      ] }),
    })).reason).toBe('UNSORTED_ORDERBOOK_SELLS');
    expect(assessSpotBuyLimitRisk(riskInput({
      orderbook: book({ buys: [{ price: '2.01', quantity: '1', timestampMs: String(now) }] }),
    })).reason).toBe('CROSSED_ORDERBOOK');
  });

  it('binds the unpinned observation digest to the exact intent and observation metadata', () => {
    const first = assessSpotBuyLimitRisk(riskInput());
    const differentIntent = assessSpotBuyLimitRisk(riskInput({ intentDigest: `0x${'ef'.repeat(32)}` }));
    const differentBook = assessSpotBuyLimitRisk(riskInput({ orderbook: book({ sequence: '6' }) }));
    expect(first.observationDigest).not.toBe(differentIntent.observationDigest);
    expect(first.observationDigest).not.toBe(differentBook.observationDigest);
    expect(first.dataTrust).toBe('UNPINNED_INDEXER_REPORT');
    expect(first.gateDecision).toBe('MARKET_RISK_UNVERIFIED');
  });

  it('blocks tick mismatch, signed exposure overflow and unsupported sell risk model', () => {
    expect(assessSpotBuyLimitRisk(riskInput({ intent: { ...intent, priceTick: '1' } })).reason).toBe('ORDER_TICK_MISMATCH');
    expect(assessSpotBuyLimitRisk(riskInput({ intent: { ...intent, maxTotalExposure: '1' } })).reason).toBe('SIGNED_EXPOSURE_CAP');
    expect(assessSpotBuyLimitRisk(riskInput({ intent: { ...intent, side: 'SELL' } })).reason).toBe('UNSUPPORTED_ORDER_RISK_MODEL');
  });
});
