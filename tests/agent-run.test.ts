import { afterEach, describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import { createLocalApp } from '../services/issuer/src/http.js';
import type { AgentProposalRuntimeContext } from '../services/issuer/src/agent-runtime.js';
import { marketConfigurationHash, type AgentPolicy } from '../packages/domain/src/agent-request.js';
import { canonicalBusinessRequestId } from '../packages/domain/src/native-order.js';
import { marketApiTicks, type InjectiveReadAdapter, type LiveSnapshot } from '../packages/domain/src/live-injective.js';

const principal = Wallet.createRandom();
const gate = '0x' + '33'.repeat(20), agent = '0x' + '44'.repeat(20), issuer = '0x' + '55'.repeat(20);
const marketId = '0x' + 'aa'.repeat(32), credentialId = '0x' + 'bb'.repeat(32);
const policy: AgentPolicy = {
  principal: principal.address, agent, issuer, gate, credentialId, credentialEpoch: '1', policyEpoch: '2',
  marketId, subaccountId: gate + '0'.repeat(24), maxNotional: '10000000000000000000',
  maxFeeRate: '1000000000000000', maxTotalExposure: '11000000000000000000',
};
const snapshot = (): LiveSnapshot => ({
  status: 'LIVE_READ_ONLY', chainId: '1439', cosmosChainId: 'injective-888', blockNumber: '10',
  blockHash: '0x' + 'cc'.repeat(32), blockTimestamp: '0x' + Math.floor(Date.now() / 1000).toString(16), observedAt: new Date().toISOString(),
  marketSource: 'test-fixture', rpcSource: 'test-fixture', market: {
    marketId, ticker: 'INJ/USDT', baseDenom: 'inj', quoteDenom: 'usdt', baseDecimals: 18, quoteDecimals: 6,
    priceTickChain: '0.000000000000001', quantityTickChain: '1000000000000000', minimumNotionalChain: '1000000', takerFeeRate: '0.0005', status: 'Active',
  }, derivativeSource: 'test-fixture', chainSource: 'test-fixture', derivativeMarket: null,
  spotTopOfBookSource: 'test-fixture', spotTopOfBook: null, spotOrderbookSource: 'test-fixture', spotOrderbook: null,
  endpointSoftware: { evmClientVersion: 'fixture', tendermintNodeVersion: 'fixture', injectiveAppName: 'fixture', injectiveAppVersion: 'fixture', injectiveGitCommit: 'fixture', cosmosSdkVersion: 'fixture', consistency: 'UNPINNED_ENDPOINT_REPORTS' },
  marketConsistency: 'UNPINNED_LCD_READ', execution: 'NOT_IMPLEMENTED',
});
const resources: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of resources.splice(0).reverse()) await close(); });

function unsignedProposal(context: AgentProposalRuntimeContext) {
  const ticks = marketApiTicks(context.snapshot.market);
  return {
    requestId: context.requestId,
    source: 'LIVE_PROVIDER',
    intent: {
      verifyingContract: gate, sender: gate, issuer, principal: context.principal, agent,
      credentialId, marketId, subaccountId: policy.subaccountId,
      marketConfigHash: marketConfigurationHash(context.snapshot),
      disclosureRequestId: canonicalBusinessRequestId(context.requestId), chainId: '1439',
      credentialEpoch: policy.credentialEpoch, policyEpoch: policy.policyEpoch,
      price: '2000000000000000000', quantity: '1000000000000000000',
      priceTick: ticks.priceTick, quantityTick: ticks.quantityTick, nonce: '77',
      deadline: String(Number(context.now) + 120), maxNotional: policy.maxNotional,
      maxFeeRate: policy.maxFeeRate, maxTotalExposure: policy.maxTotalExposure, side: 'BUY', orderType: 'LIMIT',
    },
  };
}

async function open(runtime: { generateProposal(context: AgentProposalRuntimeContext): Promise<unknown> }) {
  let current = snapshot();
  const injective = { snapshot: async () => current } as unknown as InjectiveReadAdapter;
  const app = createLocalApp({
    databasePath: ':memory:', injective, agentPolicy: policy,
    agentProvider: { configured: true, id: 'synthetic-runtime-test' }, agentRuntime: runtime,
  });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (!address || typeof address === 'string') throw Error('NO_TEST_LISTENER');
  const base = 'http://127.0.0.1:' + address.port;
  const post = (path: string, body: unknown, token?: string) => fetch(base + path, {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...(token ? { 'x-vereqo-session': token } : {}) }, body: JSON.stringify(body),
  });
  const challengeResponse = await post('/api/wallet/challenge', { address: principal.address });
  const { challenge } = await challengeResponse.json() as { challenge: { domain: never; types: never; value: { nonce: string } } };
  const signature = await principal.signTypedData(challenge.domain, challenge.types, challenge.value);
  const verify = await post('/api/wallet/verify', { nonce: challenge.value.nonce, signature });
  if (!verify.ok) throw Error('SYNTHETIC_WALLET_VERIFY_FAILED');
  const { session } = await verify.json() as { session: string };
  resources.push(() => app.close());
  return { app, base, post, session, replaceSnapshot(value: LiveSnapshot) { current = value; } };
}

describe('Agent runtime proposal ingress (synthetic integration)', () => {
  it('passes one objective and fresh read-only snapshot to an untrusted provider, stores an unsigned proposal, and needs no financial authorizer', async () => {
    let runtimeCalls = 0;
    const runtime = { generateProposal: async (context: AgentProposalRuntimeContext) => {
      runtimeCalls++;
      expect(context.objective).toBe('review a small conservative INJ buy');
      expect(context.snapshot.status).toBe('LIVE_READ_ONLY');
      expect(Object.keys(context).sort()).toEqual(['now', 'objective', 'policy', 'principal', 'requestId', 'signal', 'snapshot']);
      return unsignedProposal(context);
    } };
    const app = await open(runtime);
    const response = await app.post('/api/agent/run', { requestId: 'business-req-1', objective: 'review a small conservative INJ buy' }, app.session);
    expect(response.status).toBe(200);
    const first = await response.json() as Record<string, unknown>;
    expect(first).toMatchObject({
      requestId: 'business-req-1', status: 'PROPOSAL_READY', authorized: false,
      execution: 'NOT_IMPLEMENTED', ownerAction: 'REVIEW_AND_SIGN_SEPARATELY',
      idempotent: false, objectiveDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/), proposalDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      proposal: { requestId: 'business-req-1', source: 'LIVE_PROVIDER', authorized: false, execution: 'NOT_IMPLEMENTED', marketRisk: { gateDecision: 'MARKET_RISK_UNVERIFIED' } },
    });
    const retry = await app.post('/api/agent/run', { requestId: 'business-req-1', objective: 'review a small conservative INJ buy' }, app.session);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'PROPOSAL_READY', idempotent: true, proposal: first.proposal, proposalDigest: first.proposalDigest });
    const changedObjective = await app.post('/api/agent/run', { requestId: 'business-req-1', objective: 'place a large aggressive order' }, app.session);
    expect(changedObjective.status).toBe(409);
    expect(runtimeCalls).toBe(1);
  });

  it('rejects missing owner session before invoking a provider and requires an explicit objective', async () => {
    let runtimeCalls = 0;
    const app = await open({ generateProposal: async context => { runtimeCalls++; return unsignedProposal(context); } });
    expect((await app.post('/api/agent/run', { requestId: 'no-session', objective: 'read market' })).status).toBe(401);
    expect((await app.post('/api/agent/run', { requestId: 'no-objective' }, app.session)).status).toBe(400);
    expect(runtimeCalls).toBe(0);
  });
});
