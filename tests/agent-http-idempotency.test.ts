import { afterEach, describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalBusinessRequestId } from '../packages/domain/src/native-order.js';
import { createLocalApp } from '../services/issuer/src/http';
import { InjectiveReadAdapter, marketApiTicks, type LiveSnapshot } from '../packages/domain/src/live-injective';
import { marketConfigurationHash, type AgentPolicy } from '../packages/domain/src/agent-request';

const closers: (() => Promise<void>)[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function liveAdapter(): InjectiveReadAdapter {
  const observed = Math.floor(Date.now() / 1000);
  const market = {
    market_id: '0x' + '12'.repeat(32), ticker: 'INJ/USDT', status: 'Active',
    base_denom: 'inj', quote_denom: 'usdt', base_decimals: 18, quote_decimals: 6,
    min_price_tick_size: '0.000000000000001', min_quantity_tick_size: '1000000000000000',
    min_notional: '1000000', taker_fee_rate: '0.0005'
  };
  return new InjectiveReadAdapter(async (url, init) => {
    if (!init?.body) {
      if (url.includes('/node_info')) return Response.json({ default_node_info: { network: 'injective-888', version: '1.0.1' }, application_version: { app_name: 'injectived', version: 'v1.20.4-bl.2', git_commit: 'fixture-1', cosmos_sdk_version: 'v0.50.15-inj.1' } });
      if (url.includes('/derivative/markets')) return Response.json({ markets: [] });
      if (url.includes('/spot/mid_price_and_tob/')) return Response.json({ mid_price: '0.000000000005963000', best_buy_price: '0.000000000004704000', best_sell_price: '0.000000000007222000' });
      return Response.json({ markets: [market] });
    }
    const { method } = JSON.parse(String(init.body)) as { method: string };
    const result = method === 'eth_chainId' ? '0x59f' : method === 'web3_clientVersion' ? 'fixture-rpc/1' : {
      number: '0x123', hash: '0x' + '34'.repeat(32), timestamp: '0x' + observed.toString(16)
    };
    return Response.json({ jsonrpc: '2.0', id: 1, result });
  });
}

describe('authenticated Agent proposal idempotency', () => {
  it('returns identical retries and rejects same-nonce mutations after process restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vereqo-agent-idempotency-'));
    dirs.push(dir);
    const databasePath = join(dir, 'issuer.sqlite');
    const adapter = liveAdapter();
    const snapshot = await adapter.snapshot() as LiveSnapshot;
    const ticks = marketApiTicks(snapshot.market);
    const principal = Wallet.createRandom();
    const agent = Wallet.createRandom();
    const gate = '0x1111111111111111111111111111111111111111';
    const issuer = '0x2222222222222222222222222222222222222222';
    const credentialId = '0x' + 'aa'.repeat(32);
    const policy: AgentPolicy = {
      principal: principal.address, agent: agent.address, issuer, gate, credentialId,
      credentialEpoch: '1', policyEpoch: '1', marketId: snapshot.market.marketId,
      subaccountId: gate.toLowerCase() + '0'.repeat(24),
      maxNotional: '10000000000000000000', maxFeeRate: ticks.feeRate,
      maxTotalExposure: '11000000000000000000'
    };
    const intent = {
      verifyingContract: gate, sender: gate, issuer, principal: principal.address, agent: agent.address,
      credentialId, marketId: snapshot.market.marketId,
      subaccountId: gate.toLowerCase() + '0'.repeat(24),
      marketConfigHash: marketConfigurationHash(snapshot), disclosureRequestId: canonicalBusinessRequestId('req_1'), chainId: '1439',
      credentialEpoch: '1', policyEpoch: '1',
      price: '2000000000000000000', quantity: '1000000000000000000',
      priceTick: ticks.priceTick, quantityTick: ticks.quantityTick,
      nonce: '77', deadline: String(Math.floor(Date.now() / 1000) + 240),
      maxNotional: policy.maxNotional, maxFeeRate: policy.maxFeeRate,
      maxTotalExposure: policy.maxTotalExposure, side: 'BUY', orderType: 'LIMIT'
    };
    const request = { requestId: 'req_1', source: 'FIXTURE', intent };

    const open = async () => {
      const app = createLocalApp({ databasePath, injective: adapter, agentPolicy: policy });
      let isOpen = true;
      closers.push(async () => { if (isOpen) { isOpen = false; await app.close(); } });
      await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
      const address = app.server.address();
      if (!address || typeof address === 'string') throw Error('LISTENER');
      const base = 'http://127.0.0.1:' + address.port;
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        fetch(base + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: base, ...headers },
          body: JSON.stringify(body)
        });
      const challengeResponse = await post('/api/wallet/challenge', { address: principal.address });
      expect(challengeResponse.status).toBe(200);
      const { challenge } = await challengeResponse.json() as { challenge: {
        domain: Record<string, unknown>; types: Record<string, Array<{name:string;type:string}>>;
        value: Record<string, unknown>
      } };
      const signature = await principal.signTypedData(
        challenge.domain, challenge.types, challenge.value
      );
      const verify = await post('/api/wallet/verify', { nonce: challenge.value.nonce, signature });
      expect(verify.status).toBe(200);
      const { session } = await verify.json() as { session: string };
      const propose = (body: unknown) => post('/api/agent/propose', body, { 'x-vereqo-session': session });
      return { app, propose, close: async () => {
        if (isOpen) { isOpen = false; await app.close(); }
      } };
    };

    const firstApp = await open();
    const firstResponse = await firstApp.propose(request);
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first).toMatchObject({ authorized: false, execution: 'NOT_IMPLEMENTED', source: 'FIXTURE' });
    const retryResponse = await firstApp.propose(request);
    expect(retryResponse.status).toBe(200);
    expect(await retryResponse.json()).toEqual(first);

    const changed = { ...request, intent: { ...intent, price: '3000000000000000000' } };
    expect((await firstApp.propose(changed)).status).toBe(409);

    const raceA = { requestId: 'race_a', source: 'FIXTURE', intent: { ...intent, disclosureRequestId: canonicalBusinessRequestId('race_a'), nonce: '78', price: '3000000000000000000' } };
    const raceB = { requestId: 'race_b', source: 'FIXTURE', intent: { ...intent, disclosureRequestId: canonicalBusinessRequestId('race_b'), nonce: '78', price: '4000000000000000000' } };
    const race = await Promise.all([firstApp.propose(raceA), firstApp.propose(raceB)]);
    expect(race.map(response => response.status).sort()).toEqual([200, 409]);

    await firstApp.close();
    const restarted = await open();
    const persistedRetry = await restarted.propose(request);
    expect(persistedRetry.status).toBe(200);
    expect(await persistedRetry.json()).toEqual(first);
    expect((await restarted.propose(changed)).status).toBe(409);
  });
});
