import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { Interface, JsonRpcProvider, keccak256 } from 'ethers';
import { assertRegisteredGateMandate, parseGateManifest, readRegisteredGateMandate } from '../packages/domain/src/gate-mandate.js';
import { parseIssuerOrderMandate } from '../packages/domain/src/order-mandate.js';

const fixture = JSON.parse(await readFile('contracts/test/fixtures/financial-authorization.json', 'utf8')) as {
  issuer: string; principal: string; gate: string; mandate: Record<string, unknown>;
};
const verifier = '0x00000000000000000000000000000000000000aa';
const gateCode = '0x60016000';
const verifierCode = '0x60026000';
const manifest = parseGateManifest({
  chainId: '1439', gate: fixture.gate, gateCodeHash: keccak256(gateCode), issuer: fixture.issuer,
  principal: fixture.principal, verifier, verifierCodeHash: keccak256(verifierCode),
});
const abi = new Interface([
  'function issuer() view returns (address)',
  'function principal() view returns (address)',
  'function verifier() view returns (address)',
  'function verifierCodeHash() view returns (bytes32)',
  'function policyEpoch() view returns (uint256)',
  'function getOrderMandate(bytes32 id) view returns ((bytes32 commitment,address agent,uint256 epoch,uint64 expiry,uint256 cap,uint256 spent,bytes32 marketId,bytes32 subaccountId,bytes32 marketConfigHash,uint256 priceTick,uint256 quantityTick,uint256 maxFeeRate,bool active))',
]);

describe('read-only Gate mandate reconciliation', () => {
  let provider: JsonRpcProvider | undefined;
  afterEach(async () => { await provider?.destroy(); provider = undefined; });

  function fakeProvider() {
    provider = new JsonRpcProvider('http://127.0.0.1:8545');
    const mandate = parseIssuerOrderMandate(fixture.mandate);
    const config = [mandate.commitment, mandate.agent, BigInt(mandate.credentialEpoch), BigInt(mandate.expiry), BigInt(mandate.cap), 0n,
      mandate.marketId, mandate.subaccountId, mandate.marketConfigHash, BigInt(mandate.priceTick), BigInt(mandate.quantityTick), BigInt(mandate.maxFeeRate), mandate.active];
    Object.defineProperties(provider, {
      getNetwork: { value: async () => ({ chainId: 1439n }) },
      getBlock: { value: async () => ({ number: 100, hash: `0x${'11'.repeat(32)}` }) },
      getCode: { value: async (address: string, block: number) => {
        expect(block).toBe(100);
        return address.toLowerCase() === manifest.gate.toLowerCase() ? gateCode : verifierCode;
      } },
      send: { value: async (method: string, params: unknown[]) => {
        expect(method).toBe('eth_call');
        expect(params[1]).toBe('0x64');
        const tx = params[0] as { data: string };
        const fn = abi.getFunction(tx.data.slice(0, 10));
        if (!fn) throw Error('UNKNOWN_CALL');
        const values: Record<string, unknown[]> = {
          issuer: [fixture.issuer], principal: [fixture.principal], verifier: [verifier],
          verifierCodeHash: [keccak256(verifierCode)], policyEpoch: [BigInt(mandate.policyEpoch)],
          getOrderMandate: [config],
        };
        return abi.encodeFunctionResult(fn, values[fn.name]!);
      } },
    });
    return provider;
  }

  it('pins every Gate and verifier read to one block and matches the signed mandate', async () => {
    const snapshot = await readRegisteredGateMandate(fakeProvider(), manifest, fixture.mandate.credentialId as string);
    expect(snapshot.blockNumber).toBe(100);
    expect(snapshot.blockHash).toBe(`0x${'11'.repeat(32)}`);
    assertRegisteredGateMandate(parseIssuerOrderMandate(fixture.mandate), snapshot, manifest);
  });

  it('rejects validly shaped signed data that differs from the registered commitment', async () => {
    const snapshot = await readRegisteredGateMandate(fakeProvider(), manifest, fixture.mandate.credentialId as string);
    const altered = parseIssuerOrderMandate({ ...fixture.mandate, commitment: `0x${'ab'.repeat(32)}` });
    expect(() => assertRegisteredGateMandate(altered, snapshot, manifest)).toThrow('GATE_MANDATE_MISMATCH');
  });

  it('rejects a different code hash in the trusted manifest', async () => {
    const wrong = { ...manifest, gateCodeHash: `0x${'ab'.repeat(32)}` };
    await expect(readRegisteredGateMandate(fakeProvider(), wrong, fixture.mandate.credentialId as string)).rejects.toThrow('GATE_CODEHASH_MISMATCH');
  });
});
