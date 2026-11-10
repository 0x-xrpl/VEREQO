/** Synthetic protobuf fixture only; it is not a live Indexer market observation. */
function varint(value: bigint): Uint8Array {
  const bytes: number[] = [];
  while (value > 127n) { bytes.push(Number(value & 127n) | 128); value >>= 7n; }
  bytes.push(Number(value));
  return Uint8Array.from(bytes);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function bytes(number: number, value: Uint8Array): Uint8Array {
  return concat(varint(BigInt((number << 3) | 2)), varint(BigInt(value.length)), value);
}
function string(number: number, value: string): Uint8Array { return bytes(number, new TextEncoder().encode(value)); }
function uint(number: number, value: bigint): Uint8Array { return concat(varint(BigInt(number << 3)), varint(value)); }
function sint(number: number, value: bigint): Uint8Array { return uint(number, (value << 1n) ^ (value >> 63n)); }
function level(price: string, quantity: string, timestamp: bigint) {
  return concat(string(1, price), string(2, quantity), sint(3, timestamp));
}

export function syntheticOrderbookV2GrpcWebResponse(input: {
  marketId: string;
  timestampMs: bigint;
  height: bigint;
  sequence?: bigint;
  buys?: readonly { price: string; quantity: string }[];
  sells?: readonly { price: string; quantity: string }[];
}): ArrayBuffer {
  const sequence = input.sequence ?? 1n;
  const book = concat(
    ...(input.buys ?? []).map(item => bytes(1, level(item.price, item.quantity, input.timestampMs))),
    ...(input.sells ?? [{ price: '0.9', quantity: '10' }]).map(item => bytes(2, level(item.price, item.quantity, input.timestampMs))),
    uint(3, sequence), sint(4, input.timestampMs), sint(5, input.height),
  );
  const single = concat(string(1, input.marketId), bytes(2, book), uint(3, sequence), sint(4, input.timestampMs), sint(5, input.height));
  const message = bytes(1, single);
  const dataLength = new Uint8Array(4);
  new DataView(dataLength.buffer).setUint32(0, message.length, false);
  const trailer = new TextEncoder().encode('grpc-status: 0\r\n');
  const trailerLength = new Uint8Array(4);
  new DataView(trailerLength.buffer).setUint32(0, trailer.length, false);
  const frame = concat(Uint8Array.of(0), dataLength, message, Uint8Array.of(128), trailerLength, trailer);
  return frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer;
}
