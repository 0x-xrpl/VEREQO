import { keccak256, toUtf8Bytes } from 'ethers';

/**
 * Read-only Injective Indexer gRPC-Web adapter for spot OrderbooksV2.
 * The Indexer is an unpinned observer and this data is never an execution proof.
 */
export const TESTNET_INDEXER_GRPC_WEB = 'https://testnet.sentry.exchange.grpc-web.injective.network';
export const SPOT_ORDERBOOKS_V2_METHOD = '/injective_spot_exchange_rpc.InjectiveSpotExchangeRPC/OrderbooksV2';
const decimalPattern = /^(0|[1-9][0-9]*)(\.[0-9]{1,36})?$/;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;
const WAD = 10n ** 18n;
const ORDERBOOK_SOURCE = `${TESTNET_INDEXER_GRPC_WEB}${SPOT_ORDERBOOKS_V2_METHOD}`;

export type IndexerFetcher = (input: string, init?: RequestInit) => Promise<Response>;
export interface SpotBookLevel {
  /** Raw Indexer chain units; convert with market base/quote decimals before comparing to API18 intents. */
  readonly price: string;
  readonly quantity: string;
  readonly timestampMs: string;
}
export interface SpotOrderbookObservation {
  readonly marketId: string;
  readonly buys: readonly SpotBookLevel[];
  readonly sells: readonly SpotBookLevel[];
  readonly sequence: string;
  readonly timestampMs: string;
  readonly height: string;
  readonly fetchedAtMs: string;
  readonly source: string;
  readonly consistency: 'UNPINNED_INDEXER_REPORT';
}
export interface SpotBuyRiskIntent {
  readonly marketId: string;
  readonly side: string;
  readonly orderType: string;
  /** Price, quantity, and limits are Injective API format scaled by 1e18. */
  readonly price: string;
  readonly quantity: string;
  readonly priceTick: string;
  readonly quantityTick: string;
  readonly maxNotional: string;
  readonly maxFeeRate: string;
  readonly maxTotalExposure: string;
  readonly marketConfigHash?: string;
}
export interface SpotBuyRiskAssessment {
  readonly status: 'CLEAR_FOR_REVIEW' | 'BLOCKED' | 'UNKNOWN';
  readonly reason: string | null;
  readonly authorized: false;
  readonly execution: 'NOT_IMPLEMENTED';
  readonly gateDecision: 'MARKET_RISK_UNVERIFIED';
  readonly dataTrust: 'UNPINNED_INDEXER_REPORT';
  readonly marketId: string | null;
  readonly sequence: string | null;
  readonly height: string | null;
  readonly slippageBps: string | null;
  readonly visibleAskQuantity: string | null;
  readonly estimatedQuoteNotional: string | null;
  readonly conservativeExposure: string | null;
  /** Digest of the exact unpinned book, risk policy, market precision, and signed intent digest. Not a proof. */
  readonly observationDigest: string | null;
}

type ProtoField = { readonly number: number; readonly wire: number; readonly value: bigint | Uint8Array };
function fail(code: string): never { throw Error(code); }

function encodeVarint(value: bigint): Uint8Array {
  if (value < 0n) return fail('PROTO_NEGATIVE_VARINT');
  const out: number[] = [];
  while (value > 127n) { out.push(Number(value & 127n) | 128); value >>= 7n; }
  out.push(Number(value));
  return Uint8Array.from(out);
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function lengthDelimited(fieldNumber: number, value: Uint8Array): Uint8Array {
  return concatBytes(encodeVarint(BigInt((fieldNumber << 3) | 2)), encodeVarint(BigInt(value.length)), value);
}
function stringField(fieldNumber: number, value: string): Uint8Array {
  return lengthDelimited(fieldNumber, new TextEncoder().encode(value));
}
function intField(fieldNumber: number, value: bigint): Uint8Array {
  return concatBytes(encodeVarint(BigInt(fieldNumber << 3)), encodeVarint(value));
}
function readVarint(bytes: Uint8Array, start: number): { value: bigint; next: number } {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < bytes.length && shift < 70n) {
    const byte = bytes[offset++]!;
    value |= BigInt(byte & 127) << shift;
    if ((byte & 128) === 0) return { value, next: offset };
    shift += 7n;
  }
  return fail('MALFORMED_PROTO_VARINT');
}
function fields(bytes: Uint8Array): ProtoField[] {
  const out: ProtoField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset); offset = tag.next;
    const number = Number(tag.value >> 3n), wire = Number(tag.value & 7n);
    if (!number) return fail('MALFORMED_PROTO_TAG');
    if (wire === 0) {
      const value = readVarint(bytes, offset); offset = value.next;
      out.push({ number, wire, value: value.value });
    } else if (wire === 2) {
      const length = readVarint(bytes, offset); offset = length.next;
      if (length.value > BigInt(bytes.length - offset)) return fail('MALFORMED_PROTO_LENGTH');
      const end = offset + Number(length.value);
      out.push({ number, wire, value: bytes.slice(offset, end) });
      offset = end;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (offset + size > bytes.length) return fail('MALFORMED_PROTO_FIXED');
      offset += size;
    } else return fail('UNSUPPORTED_PROTO_WIRE');
  }
  return out;
}
function payload(field: ProtoField, expectedWire = 2): Uint8Array {
  if (field.wire !== expectedWire || !(field.value instanceof Uint8Array)) return fail('MALFORMED_PROTO_FIELD');
  return field.value;
}
function text(field: ProtoField): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(payload(field)); }
  catch { return fail('MALFORMED_PROTO_UTF8'); }
}
function one(input: readonly ProtoField[], number: number, wire: number): ProtoField | undefined {
  const values = input.filter(field => field.number === number);
  if (values.length > 1 || (values.length === 1 && values[0]!.wire !== wire)) return fail('MALFORMED_PROTO_CARDINALITY');
  return values[0];
}
function unsigned(input: readonly ProtoField[], number: number): bigint {
  const field = one(input, number, 0);
  if (!field) return 0n;
  if (typeof field.value !== 'bigint') return fail('MALFORMED_PROTO_INTEGER');
  return field.value;
}
function zigZag(value: bigint): bigint { return (value >> 1n) ^ (-(value & 1n)); }
function signed(input: readonly ProtoField[], number: number): bigint {
  const field = one(input, number, 0);
  if (!field) return 0n;
  if (typeof field.value !== 'bigint') return fail('MALFORMED_PROTO_INTEGER');
  return zigZag(field.value);
}
function repeatedBytes(input: readonly ProtoField[], number: number): Uint8Array[] {
  return input.filter(field => field.number === number).map(field => payload(field));
}
function grpcWebFrame(payloadBytes: Uint8Array): Uint8Array {
  if (payloadBytes.length > 0xffffffff) return fail('INDEXER_REQUEST_TOO_LARGE');
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payloadBytes.length, false);
  return concatBytes(Uint8Array.of(0), length, payloadBytes);
}
function orderbooksRequest(marketId: string, depth: number): Uint8Array {
  if (!bytes32Pattern.test(marketId) || /^0x0{64}$/i.test(marketId)) return fail('INVALID_MARKET_ID');
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 100) return fail('INVALID_ORDERBOOK_DEPTH');
  // Injective OrderbooksV2Request: market_ids=1 (repeated string), depth=2 (sint32).
  const zigzagDepth = BigInt(depth) << 1n;
  return concatBytes(stringField(1, marketId.toLowerCase()), intField(2, zigzagDepth));
}
function decodeUnaryGrpcWeb(bytes: Uint8Array): Uint8Array {
  const messages: Uint8Array[] = [];
  let trailerStatus: string | null = null;
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 5 > bytes.length) return fail('MALFORMED_GRPC_WEB_FRAME');
    const flags = bytes[offset]!;
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4).getUint32(0, false);
    offset += 5;
    if (offset + length > bytes.length) return fail('MALFORMED_GRPC_WEB_FRAME');
    const frame = bytes.slice(offset, offset + length);
    offset += length;
    if (flags === 0) messages.push(frame);
    else if (flags === 128) {
      let trailer: string;
      try { trailer = new TextDecoder('utf-8', { fatal: true }).decode(frame); }
      catch { return fail('MALFORMED_GRPC_WEB_TRAILER'); }
      const status = /^grpc-status:\s*([0-9]+)\s*$/im.exec(trailer)?.[1];
      trailerStatus = status ?? null;
    } else return fail('UNSUPPORTED_GRPC_WEB_FRAME');
  }
  if (trailerStatus !== '0') return fail('INDEXER_GRPC_NOT_OK');
  if (messages.length !== 1 || messages[0]!.length === 0) return fail('INVALID_INDEXER_ORDERBOOK_RESPONSE');
  return messages[0]!;
}
function parseLevel(bytes: Uint8Array): SpotBookLevel {
  const f = fields(bytes);
  const priceField = one(f, 1, 2), quantityField = one(f, 2, 2);
  if (!priceField || !quantityField) return fail('INVALID_ORDERBOOK_LEVEL');
  const price = text(priceField), quantity = text(quantityField);
  if (!decimalPattern.test(price) || !/[1-9]/.test(price) || !decimalPattern.test(quantity) || !/[1-9]/.test(quantity)) return fail('INVALID_ORDERBOOK_LEVEL');
  const timestampMs = signed(f, 3);
  if (timestampMs < 0n) return fail('INVALID_ORDERBOOK_TIMESTAMP');
  return Object.freeze({ price, quantity, timestampMs: timestampMs.toString() });
}
function parseSpotBook(bytes: Uint8Array): Omit<SpotOrderbookObservation, 'source' | 'fetchedAtMs' | 'consistency'> & { readonly marketId: string } {
  const outer = fields(bytes);
  const marketField = one(outer, 1, 2), orderbookField = one(outer, 2, 2);
  if (!marketField || !orderbookField) return fail('INVALID_INDEXER_ORDERBOOK_RESPONSE');
  const marketId = text(marketField).toLowerCase();
  if (!bytes32Pattern.test(marketId)) return fail('INVALID_INDEXER_MARKET_ID');
  const book = fields(payload(orderbookField));
  const buys = repeatedBytes(book, 1).map(parseLevel), sells = repeatedBytes(book, 2).map(parseLevel);
  if (buys.length > 100 || sells.length > 100) return fail('ORDERBOOK_DEPTH_EXCEEDED');
  const outerSequence = unsigned(outer, 3), outerTimestamp = signed(outer, 4), outerHeight = signed(outer, 5);
  const innerSequence = unsigned(book, 3), innerTimestamp = signed(book, 4), innerHeight = signed(book, 5);
  if (outerSequence && innerSequence && innerSequence !== outerSequence) return fail('ORDERBOOK_SEQUENCE_MISMATCH');
  if (outerTimestamp && innerTimestamp && innerTimestamp !== outerTimestamp) return fail('ORDERBOOK_TIMESTAMP_MISMATCH');
  if (outerHeight && innerHeight && innerHeight !== outerHeight) return fail('ORDERBOOK_HEIGHT_MISMATCH');
  const sequence = outerSequence || innerSequence, timestamp = outerTimestamp || innerTimestamp, height = outerHeight || innerHeight;
  // Empty markets may legitimately omit sequence (protobuf default 0). Preserve that
  // read as an empty observation; the risk assessor must still reject missing liquidity.
  if (timestamp <= 0n || height <= 0n) return fail('INVALID_ORDERBOOK_METADATA');
  const parse18 = (value: string) => decimalToWad(value);
  const buyPrices = buys.map(level => parse18(level.price)), sellPrices = sells.map(level => parse18(level.price));
  for (let i = 1; i < buyPrices.length; i++) if (buyPrices[i - 1]! < buyPrices[i]!) return fail('UNSORTED_ORDERBOOK_BUYS');
  for (let i = 1; i < sellPrices.length; i++) if (sellPrices[i - 1]! > sellPrices[i]!) return fail('UNSORTED_ORDERBOOK_SELLS');
  if (buyPrices.length && sellPrices.length && buyPrices[0]! >= sellPrices[0]!) return fail('CROSSED_ORDERBOOK');
  return Object.freeze({ marketId, buys: Object.freeze(buys), sells: Object.freeze(sells), sequence: sequence.toString(), timestampMs: timestamp.toString(), height: height.toString() });
}
function decimalToWad(value: string): bigint {
  if (!decimalPattern.test(value)) return fail('INVALID_ORDERBOOK_DECIMAL');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > 18) return fail('ORDERBOOK_PRECISION_UNSUPPORTED');
  return BigInt(whole!) * WAD + BigInt(fraction.padEnd(18, '0'));
}

/** Fetches one unpinned Indexer book snapshot. It cannot establish a chain proof. */
export async function fetchSpotOrderbookV2(
  fetcher: IndexerFetcher,
  marketId: string,
  now: () => number = Date.now,
  depth = 50,
): Promise<SpotOrderbookObservation> {
  const payloadBytes = orderbooksRequest(marketId, depth);
  const framed = grpcWebFrame(payloadBytes);
  const response = await fetcher(`${TESTNET_INDEXER_GRPC_WEB}${SPOT_ORDERBOOKS_V2_METHOD}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/grpc-web+proto',
      accept: 'application/grpc-web+proto',
      'x-grpc-web': '1',
      'x-user-agent': 'verequo-read-only/1',
    },
    body: framed.buffer.slice(framed.byteOffset, framed.byteOffset + framed.byteLength) as ArrayBuffer,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return fail(`INDEXER_HTTP_${response.status}`);
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/grpc-web+proto') return fail('INDEXER_UNEXPECTED_CONTENT_TYPE');
  const responseBytes = new Uint8Array(await response.arrayBuffer());
  if (!responseBytes.length || responseBytes.length > 4_000_000) return fail('INVALID_INDEXER_RESPONSE_SIZE');
  const reply = fields(decodeUnaryGrpcWeb(responseBytes));
  const books = repeatedBytes(reply, 1);
  if (books.length !== 1) return fail('INDEXER_MARKET_CARDINALITY');
  const parsed = parseSpotBook(books[0]!);
  if (parsed.marketId !== marketId.toLowerCase()) return fail('INDEXER_MARKET_MISMATCH');
  const fetchedAtMs = now();
  if (!Number.isSafeInteger(fetchedAtMs) || fetchedAtMs <= 0) return fail('INVALID_LOCAL_TIME');
  return Object.freeze({ ...parsed, fetchedAtMs: String(fetchedAtMs), source: ORDERBOOK_SOURCE, consistency: 'UNPINNED_INDEXER_REPORT' });
}

function ceilDiv(n: bigint, d: bigint): bigint { return (n + d - 1n) / d; }
function risk(status: SpotBuyRiskAssessment['status'], reason: string | null, values: Partial<SpotBuyRiskAssessment> = {}): SpotBuyRiskAssessment {
  return Object.freeze({ status, reason, authorized: false, execution: 'NOT_IMPLEMENTED', gateDecision: 'MARKET_RISK_UNVERIFIED', dataTrust: 'UNPINNED_INDEXER_REPORT', marketId: null, sequence: null, height: null, slippageBps: null, visibleAskQuantity: null, estimatedQuoteNotional: null, conservativeExposure: null, observationDigest: null, ...values });
}

/** Advisory BUY-LIMIT depth/slippage check. A clear result still cannot pass ActionGate. */
export function assessSpotBuyLimitRisk(input: {
  readonly marketId: string;
  readonly market: { readonly marketId: string; readonly priceTick: string; readonly quantityTick: string; readonly baseDecimals: number; readonly quoteDecimals: number };
  readonly orderbook: SpotOrderbookObservation | null | undefined;
  readonly intent: SpotBuyRiskIntent;
  /** Exact typed-data digest; the observation remains advisory and is not a Groth16 public signal. */
  readonly intentDigest: string;
  readonly nowMs: number;
  readonly maxAgeMs: number;
  readonly maxSlippageBps: number;
}): SpotBuyRiskAssessment {
  const { marketId, market, orderbook, intent, intentDigest, nowMs, maxAgeMs, maxSlippageBps } = input;
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 ||
      !Number.isSafeInteger(maxSlippageBps) || maxSlippageBps < 0 || maxSlippageBps > 10000) {
    return risk('BLOCKED', 'INVALID_RISK_POLICY');
  }
  if (![market.baseDecimals, market.quoteDecimals].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 18)) return risk('BLOCKED', 'INVALID_MARKET_DECIMALS');
  const chainLevel = (value: string, power: number): bigint => {
    if (!decimalPattern.test(value)) throw Error('INVALID_ORDERBOOK_DECIMAL');
    const [whole, fraction = ''] = value.split('.');
    const amount = BigInt(whole! + fraction), exponent = power - fraction.length;
    if (exponent >= 0) return amount * 10n ** BigInt(exponent);
    const divisor = 10n ** BigInt(-exponent);
    if (amount % divisor !== 0n) throw Error('UNREPRESENTABLE_ORDERBOOK_PRECISION');
    return amount / divisor;
  };
  const priceWad = (value: string) => chainLevel(value, 18 + market.baseDecimals - market.quoteDecimals);
  const quantityWad = (value: string) => chainLevel(value, 18 - market.baseDecimals);
  let observationDigest: string | null = null;
  if (orderbook) {
    try {
      if (!/^0x[0-9a-fA-F]{64}$/.test(intentDigest) || !/^0x[0-9a-fA-F]{64}$/.test(market.marketId) ||
        !/^0x[0-9a-fA-F]{64}$/.test(orderbook.marketId) || !/^[0-9]+$/.test(orderbook.sequence) ||
        !/^[0-9]+$/.test(orderbook.height) || !/^[0-9]+$/.test(orderbook.timestampMs) || !/^[0-9]+$/.test(orderbook.fetchedAtMs) ||
        !decimalPattern.test(market.priceTick) || !decimalPattern.test(market.quantityTick)) return risk('BLOCKED', 'INVALID_ORDERBOOK_OBSERVATION');
      if (orderbook.source !== ORDERBOOK_SOURCE || orderbook.consistency !== 'UNPINNED_INDEXER_REPORT') {
        return risk('BLOCKED', 'UNTRUSTED_ORDERBOOK_PROVENANCE');
      }
      const levels = (entries: readonly SpotBookLevel[]) => {
        if (!Array.isArray(entries) || entries.length > 100) throw Error('INVALID_ORDERBOOK_OBSERVATION');
        return entries.map(level => {
          if (!decimalPattern.test(level.price) || !/[1-9]/.test(level.price) || !decimalPattern.test(level.quantity) ||
            !/[1-9]/.test(level.quantity) || !/^[0-9]+$/.test(level.timestampMs)) throw Error('INVALID_ORDERBOOK_OBSERVATION');
          return { price: level.price, quantity: level.quantity, timestampMs: level.timestampMs };
        });
      };
      if (intent.marketConfigHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(intent.marketConfigHash)) return risk('BLOCKED', 'INVALID_MARKET_CONFIGURATION_DIGEST');
      const canonical = {
        schema: 'VEREQO_ORDERBOOK_RISK_V2', intentDigest: intentDigest.toLowerCase(), marketId: marketId.toLowerCase(),
        market: { marketId: market.marketId.toLowerCase(), priceTick: market.priceTick, quantityTick: market.quantityTick,
          marketConfigHash: intent.marketConfigHash?.toLowerCase() ?? null, baseDecimals: market.baseDecimals, quoteDecimals: market.quoteDecimals },
        orderbook: { marketId: orderbook.marketId.toLowerCase(), buys: levels(orderbook.buys), sells: levels(orderbook.sells),
          sequence: orderbook.sequence, timestampMs: orderbook.timestampMs, height: orderbook.height, fetchedAtMs: orderbook.fetchedAtMs,
          source: orderbook.source, consistency: orderbook.consistency },
        evaluatedAtMs: String(nowMs), maxAgeMs: String(maxAgeMs), maxSlippageBps: String(maxSlippageBps),
      };
      observationDigest = keccak256(toUtf8Bytes(`VEREQO_ORDERBOOK_RISK_V2:${JSON.stringify(canonical)}`));
    } catch { return risk('BLOCKED', 'INVALID_ORDERBOOK_OBSERVATION'); }
  }
  const base = orderbook ? { marketId: orderbook.marketId, sequence: orderbook.sequence, height: orderbook.height, observationDigest } : {};
  if (!orderbook) return risk('UNKNOWN', 'ORDERBOOK_UNAVAILABLE', base);
  if (marketId.toLowerCase() !== market.marketId.toLowerCase() || intent.marketId.toLowerCase() !== marketId.toLowerCase() || orderbook.marketId.toLowerCase() !== marketId.toLowerCase()) return risk('BLOCKED', 'MARKET_ID_MISMATCH', base);
  const evaluatedAt = BigInt(nowMs), fetchedAt = BigInt(orderbook.fetchedAtMs), timestamp = BigInt(orderbook.timestampMs);
  if (fetchedAt > evaluatedAt + 2000n) return risk('BLOCKED', 'ORDERBOOK_FUTURE_DATED', base);
  if (fetchedAt <= 0n || evaluatedAt - fetchedAt > BigInt(maxAgeMs)) return risk('BLOCKED', 'ORDERBOOK_STALE', base);
  const age = evaluatedAt - timestamp;
  if (age < -2000n || age > BigInt(maxAgeMs)) return risk('BLOCKED', 'ORDERBOOK_STALE', base);
  if (intent.side !== 'BUY' || intent.orderType !== 'LIMIT') return risk('BLOCKED', 'UNSUPPORTED_ORDER_RISK_MODEL', base);
  let limit: bigint, quantity: bigint, priceTick: bigint, quantityTick: bigint, maxNotional: bigint, feeRate: bigint, maxExposure: bigint;
  try {
    for (const value of [intent.price, intent.quantity, intent.priceTick, intent.quantityTick, intent.maxNotional, intent.maxFeeRate, intent.maxTotalExposure, market.priceTick, market.quantityTick]) {
      if (!/^(0|[1-9][0-9]{0,77})$/.test(value)) return risk('BLOCKED', 'INVALID_SIGNED_LIMIT', base);
    }
    limit = BigInt(intent.price); quantity = BigInt(intent.quantity); priceTick = BigInt(intent.priceTick); quantityTick = BigInt(intent.quantityTick);
    maxNotional = BigInt(intent.maxNotional); feeRate = BigInt(intent.maxFeeRate); maxExposure = BigInt(intent.maxTotalExposure);
    if (limit <= 0n || quantity <= 0n || priceTick <= 0n || quantityTick <= 0n || limit % priceTick || quantity % quantityTick || priceTick !== BigInt(market.priceTick) || quantityTick !== BigInt(market.quantityTick)) return risk('BLOCKED', 'ORDER_TICK_MISMATCH', base);
    if (feeRate > WAD) return risk('BLOCKED', 'INVALID_FEE_CEILING', base);
  } catch { return risk('BLOCKED', 'INVALID_SIGNED_LIMIT', base); }
  const limitNotional = ceilDiv(limit * quantity, WAD);
  const feeAtLimit = ceilDiv(limitNotional * feeRate, WAD);
  const conservativeExposureAtLimit = limitNotional + feeAtLimit;
  if (limitNotional > maxNotional || conservativeExposureAtLimit > maxExposure) return risk('BLOCKED', 'SIGNED_EXPOSURE_CAP', { ...base, conservativeExposure: conservativeExposureAtLimit.toString() });
  if (!orderbook.sells.length) return risk('BLOCKED', 'NO_VISIBLE_ASK_LIQUIDITY', base);
  let remaining = quantity, estimatedQuote = 0n, visibleAsk = 0n;
  let bestAsk: bigint, previousBid: bigint | null = null, previousAsk: bigint | null = null;
  try {
    for (const level of orderbook.buys) {
      const price = priceWad(level.price);
      if (previousBid !== null && previousBid < price) return risk('BLOCKED', 'UNSORTED_ORDERBOOK_BUYS', base);
      previousBid = price;
    }
    bestAsk = priceWad(orderbook.sells[0]!.price);
    for (const level of orderbook.sells) {
      const price = priceWad(level.price), available = quantityWad(level.quantity);
      if (previousAsk !== null && previousAsk > price) return risk('BLOCKED', 'UNSORTED_ORDERBOOK_SELLS', base);
      previousAsk = price;
      visibleAsk += available;
      if (price > limit || remaining === 0n) continue;
      const fill = available < remaining ? available : remaining;
      estimatedQuote += ceilDiv(price * fill, WAD);
      remaining -= fill;
    }
  } catch { return risk('BLOCKED', 'INVALID_ORDERBOOK_LEVEL', base); }
  if (orderbook.buys.length && priceWad(orderbook.buys[0]!.price) >= bestAsk) return risk('BLOCKED', 'CROSSED_ORDERBOOK', base);
  if (remaining > 0n) return risk('BLOCKED', 'INSUFFICIENT_VISIBLE_ASK_DEPTH', { ...base, visibleAskQuantity: visibleAsk.toString(), estimatedQuoteNotional: estimatedQuote.toString() });
  const weightedAverage = ceilDiv(estimatedQuote * WAD, quantity);
  if (weightedAverage < bestAsk || bestAsk <= 0n) return risk('BLOCKED', 'INVALID_ORDERBOOK_PRICING', base);
  const slippageBps = ceilDiv((weightedAverage - bestAsk) * 10000n, bestAsk);
  const conservativeExposure = conservativeExposureAtLimit;
  const common = { ...base, slippageBps: slippageBps.toString(), visibleAskQuantity: visibleAsk.toString(), estimatedQuoteNotional: estimatedQuote.toString(), conservativeExposure: conservativeExposure.toString() };
  if (slippageBps > BigInt(maxSlippageBps)) return risk('BLOCKED', 'SLIPPAGE_LIMIT_EXCEEDED', common);
  return risk('CLEAR_FOR_REVIEW', null, common);
}
