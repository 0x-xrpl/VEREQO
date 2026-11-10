import { afterEach, describe, expect, it } from 'vitest';
import { AbiCoder, Wallet, id } from 'ethers';
import { createLocalApp } from '../services/issuer/src/http.js';
import { EXCHANGE_PRECOMPILE, InjectiveReadAdapter, type Fetcher } from '../packages/domain/src/live-injective.js';
import type { AgentPolicy } from '../packages/domain/src/agent-request.js';

const closes: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });

describe('authenticated read-only Exchange balance inspection', () => {
  it('reads only the configured Gate default subaccount and marks local recovery code as runtime-unverified', async () => {
    const now = 1_800_000_000_000;
    const marketId = `0x${'12'.repeat(32)}`;
    const gate = `0x${'ab'.repeat(20)}`;
    const principal = Wallet.createRandom();
    const policy: AgentPolicy = {
      principal: principal.address, agent: `0x${'22'.repeat(20)}`, issuer: `0x${'33'.repeat(20)}`, gate,
      credentialId: `0x${'44'.repeat(32)}`, credentialEpoch: '1', policyEpoch: '1', marketId, subaccountId: `${gate}${'0'.repeat(24)}`,
      maxNotional: '1000000000000000000', maxFeeRate: '500000000000000', maxTotalExposure: '1001000000000000000',
    };
    const rpcCalls: Array<{ method: string; params: unknown[] }> = [];
    const fetcher: Fetcher = async (input, init) => {
      const url = String(input);
      if (url.includes('testnet.sentry.exchange.grpc-web.injective.network')) return new Response('', { status: 503 });
      if (!init?.body) {
        if (url.includes('/node_info')) return Response.json({ default_node_info: { network: 'injective-888', version: 'test' }, application_version: { app_name: 'injectived', version: 'test', git_commit: 'fixture', cosmos_sdk_version: 'test' } });
        if (url.includes('/derivative/markets')) return Response.json({ markets: [] });
        if (url.includes('/spot/mid_price_and_tob/')) return Response.json({ mid_price: '1', best_buy_price: '1', best_sell_price: '1' });
        return Response.json({ markets: [{ market_id: marketId, ticker: 'INJ/USDT', status: 'Active', base_denom: 'inj', quote_denom: 'usdt', base_decimals: 18, quote_decimals: 6, min_price_tick_size: '0.000000000000001', min_quantity_tick_size: '1000000000000000', min_notional: '1000000', taker_fee_rate: '0.0005' }] });
      }
      const call = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
      rpcCalls.push(call);
      const result = call.method === 'eth_chainId' ? '0x59f'
        : call.method === 'web3_clientVersion' ? 'test-rpc/1'
          : call.method === 'eth_getBlockByNumber' ? { number: '0x123', hash: `0x${'55'.repeat(32)}`, timestamp: `0x${Math.floor(now / 1000).toString(16)}` }
            : call.method === 'eth_call' ? AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [7_000_000n, 9_000_000n]) : null;
      return Response.json({ jsonrpc: '2.0', id: 1, result });
    };
    const app = createLocalApp({ databasePath: ':memory:', injective: new InjectiveReadAdapter(fetcher, () => now), agentPolicy: policy, nowSeconds: () => Math.floor(now / 1000) });
    closes.push(app.close);
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw Error('LISTENER');
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });

    expect((await fetch(base + '/api/financial/exchange-balance', { headers: { origin: base } })).status).toBe(401);
    const challengeResponse = await post('/api/wallet/challenge', { address: principal.address });
    const { challenge } = await challengeResponse.json() as { challenge: { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; value: Record<string, unknown> } };
    const signature = await principal.signTypedData(challenge.domain, challenge.types, challenge.value);
    const verifyResponse = await post('/api/wallet/verify', { nonce: challenge.value.nonce, signature });
    expect(verifyResponse.status).toBe(200);
    const { session } = await verifyResponse.json() as { session: string };

    const response = await fetch(base + '/api/financial/exchange-balance', { headers: { origin: base, 'x-vereqo-session': session } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: 'LIVE_READ_ONLY', authorized: false, execution: 'NOT_IMPLEMENTED', custodyMode: 'DIRECT_GATE_OWNED_SUBACCOUNT',
      exchangeBalance: { denom: 'usdt', availableBalanceChain: '7000000', totalBalanceChain: '9000000', lockedBalanceChain: '2000000', blockNumber: '291' },
      capabilities: { deposit: 'LOCAL_ONLY_NOT_RUNTIME_VERIFIED', order: 'ACTIONGATE_RISK_BLOCKED', cancel: 'LOCAL_ONLY_NOT_RUNTIME_VERIFIED', withdraw: 'LOCAL_ONLY_NOT_RUNTIME_VERIFIED', gateBankRecovery: 'OWNER_ONLY_LOCAL_NOT_RUNTIME_VERIFIED', principalRecovery: 'EXCHANGE_PRINCIPAL_SUBACCOUNT_ONLY_LOCAL_RUNTIME_UNVERIFIED' },
    });
    const read = rpcCalls.find(call => call.method === 'eth_call');
    expect(read?.params[0]).toMatchObject({ to: EXCHANGE_PRECOMPILE });
    expect(read?.params[1]).toBe('0x123');
    const calldata = String((read?.params[0] as { data: string }).data);
    expect(calldata.slice(0, 10)).toBe(id('subaccountDeposit(string,string)').slice(0, 10));
    const expectedSubaccount = `${gate}${'0'.repeat(24)}`;
    const [decodedSubaccount, decodedDenom] = AbiCoder.defaultAbiCoder().decode(['string', 'string'], `0x${calldata.slice(10)}`);
    expect(decodedSubaccount).toBe(expectedSubaccount);
    expect(decodedDenom).toBe('usdt');
  });
});
