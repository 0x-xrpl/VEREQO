import { describe, expect, it } from 'vitest';
import { OllamaAgentRuntime } from '../services/issuer/src/ollama-agent-runtime.js';
import { parseNativeOrderIntent } from '../packages/domain/src/native-order.js';
import { acceptAgentProposal } from '../packages/domain/src/agent-request.js';
import { SPOT_ORDERBOOKS_V2_METHOD, TESTNET_INDEXER_GRPC_WEB } from '../packages/domain/src/injective-indexer.js';
import type { AgentProposalRuntimeContext } from '../services/issuer/src/agent-runtime.js';
import type { AgentPolicy } from '../packages/domain/src/agent-request.js';
import type { LiveSnapshot } from '../packages/domain/src/live-injective.js';

const gate = '0x' + '33'.repeat(20), principal = '0x' + '11'.repeat(20), agent = '0x' + '22'.repeat(20);
const marketId = '0x' + 'aa'.repeat(32), credentialId = '0x' + 'bb'.repeat(32);
const policy: AgentPolicy = {
  principal, agent, issuer: '0x' + '44'.repeat(20), gate, credentialId,
  credentialEpoch: '2', policyEpoch: '3', marketId, subaccountId: gate + '0'.repeat(24),
  maxNotional: '10000000000000000000', maxFeeRate: '1000000000000000', maxTotalExposure: '11000000000000000000',
};
const now = 1_800_000_000;
function context(patch: Partial<AgentProposalRuntimeContext> = {}): AgentProposalRuntimeContext {
  const observedAt = new Date(now * 1000).toISOString();
  const snapshot = {
    status: 'LIVE_READ_ONLY', chainId: '1439', cosmosChainId: 'injective-888', blockNumber: '12',
    blockHash: '0x' + 'cc'.repeat(32), blockTimestamp: '0x' + (now - 1).toString(16), observedAt,
    market: {
      marketId, ticker: 'INJ/USDT', baseDenom: 'inj', quoteDenom: 'usdt', baseDecimals: 18, quoteDecimals: 6,
      priceTickChain: '0.000000000000001', quantityTickChain: '1000000000000000', minimumNotionalChain: '1000000', takerFeeRate: '0.0005', status: 'Active',
    },
    marketSource: 'official-testnet-lcd', rpcSource: 'official-testnet-rpc', derivativeSource: 'official-testnet-lcd',
    chainSource: 'official-testnet-rpc', derivativeMarket: null, spotTopOfBookSource: 'official-testnet-lcd', spotTopOfBook: null,
    spotOrderbookSource: TESTNET_INDEXER_GRPC_WEB, spotOrderbook: {
      marketId, buys: [{ price: '0.0000000000019', quantity: '5000000000000000000', timestampMs: String(now * 1000) }],
      sells: [{ price: '0.000000000002', quantity: '5000000000000000000', timestampMs: String(now * 1000) }], sequence: '8', timestampMs: String(now * 1000),
      height: '11', fetchedAtMs: String(now * 1000), source: TESTNET_INDEXER_GRPC_WEB + SPOT_ORDERBOOKS_V2_METHOD,
      consistency: 'UNPINNED_INDEXER_REPORT',
    },
    endpointSoftware: { evmClientVersion: 'test', tendermintNodeVersion: 'test', injectiveAppName: 'injectived', injectiveAppVersion: 'test', injectiveGitCommit: 'test', cosmosSdkVersion: 'test', consistency: 'UNPINNED_ENDPOINT_REPORTS' },
    marketConsistency: 'UNPINNED_LCD_READ', execution: 'NOT_IMPLEMENTED',
  } as unknown as LiveSnapshot;
  return { requestId: 'ollama-test', objective: 'evaluate a small conservative buy', principal, policy, snapshot, now: String(now), signal: new AbortController().signal, ...patch };
}

function modelResponse(decision = 'PROPOSE', side = 'BUY', price = '2', quantity = '1') {
  return Response.json({ response: JSON.stringify({ decision, side, price, quantity }) });
}

describe('loopback Ollama proposal adapter', () => {
  it('sends only objective, public market data, and policy bounds to a loopback model and builds a server-bound unsigned intent', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const runtime = new OllamaAgentRuntime('phi:latest', 'http://127.0.0.1:11434', async (url, init) => {
      expect(String(url)).toBe('http://127.0.0.1:11434/api/generate');
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(init?.method).toBe('POST');
      return modelResponse();
    });
    const result = await runtime.generateProposal(context()) as { requestId: string; source: string; intent: Record<string, string> };
    const prompt = String(requestBody?.prompt);
    expect(prompt).toContain('evaluate a small conservative buy');
    expect(prompt).toContain(marketId);
    expect(prompt).toContain('topAsks');
    const modelMarket = JSON.parse(prompt).market;
    expect(modelMarket.topAsks[0]).toEqual({ price: '2', quantity: '5', timestampMs: String(now * 1000) });
    expect(modelMarket.topBids[0].price).toBe('1.9');
    expect(prompt).not.toContain(principal);
    expect(prompt).not.toContain(agent);
    expect(prompt).not.toContain('sessionToken');
    expect(result).toMatchObject({ requestId: 'ollama-test', source: 'LIVE_PROVIDER' });
    expect(result.intent).toMatchObject({
      verifyingContract: gate, sender: gate, principal, agent, marketId, credentialId,
      disclosureRequestId: expect.stringMatching(/^0x[0-9a-f]{64}$/), chainId: '1439',
      price: '2000000000000000000', quantity: '1000000000000000000',
      deadline: String(now + 120), maxNotional: policy.maxNotional, side: 'BUY', orderType: 'LIMIT',
    });
    expect(result.intent.nonce).toMatch(/^[1-9][0-9]*$/);
    const input = context();
    expect(acceptAgentProposal(result, { sessionPrincipal: principal, policy, snapshot: input.snapshot, now: input.now, usedNonces: new Set(), provider: { configured: true, id: 'test-runtime' } }))
      .toMatchObject({ authorized: false, execution: 'NOT_IMPLEMENTED', intent: { price: '2000000000000000000', quantity: '1000000000000000000' } });
  });

  it('rejects non-loopback providers so policy data cannot be sent to an external service', () => {
    expect(() => new OllamaAgentRuntime('phi:latest', 'https://api.example.com')).toThrow('AGENT_RUNTIME_LOOPBACK_REQUIRED');
  });

  it('refuses missing or stale orderbooks without invoking inference', async () => {
    let invoked = false;
    const runtime = new OllamaAgentRuntime('phi:latest', 'http://localhost:11434', async () => { invoked = true; return modelResponse(); });
    const noBook = context({ snapshot: { ...context().snapshot, spotOrderbook: null } as LiveSnapshot });
    await expect(runtime.generateProposal(noBook)).rejects.toThrow('AGENT_RUNTIME_MARKET_STATE_UNAVAILABLE');
    const stale = context({ snapshot: { ...context().snapshot, spotOrderbook: { ...context().snapshot.spotOrderbook!, fetchedAtMs: String((now - 11) * 1000) } } as LiveSnapshot });
    await expect(runtime.generateProposal(stale)).rejects.toThrow('AGENT_RUNTIME_MARKET_STATE_UNAVAILABLE');
    for (const timestampMs of [String((now - 11) * 1000), String((now + 3) * 1000), '0', 'invalid']) {
      const oldBook = context({ snapshot: { ...context().snapshot, spotOrderbook: { ...context().snapshot.spotOrderbook!, timestampMs } } as LiveSnapshot });
      await expect(runtime.generateProposal(oldBook)).rejects.toThrow('AGENT_RUNTIME_MARKET_STATE_UNAVAILABLE');
    }
    expect(invoked).toBe(false);
  });

  it('rejects a model decline and malformed proposals instead of coercing values', async () => {
    const decline = new OllamaAgentRuntime('phi:latest', 'http://127.0.0.1:11434', async () => modelResponse('DECLINE'));
    await expect(decline.generateProposal(context())).rejects.toThrow('AGENT_PROPOSAL_DECLINED');
    const malformed = new OllamaAgentRuntime('phi:latest', 'http://127.0.0.1:11434', async () => modelResponse('PROPOSE', 'SELL'));
    await expect(malformed.generateProposal(context())).rejects.toThrow('AGENT_RUNTIME_OUTPUT_INVALID');
    const wrongTick = new OllamaAgentRuntime('phi:latest', 'http://127.0.0.1:11434', async () => modelResponse('PROPOSE', 'BUY', '2.000000000001'));
    const proposal = await wrongTick.generateProposal(context()) as { intent: unknown };
    expect(() => parseNativeOrderIntent(proposal.intent)).toThrow('INVALID_NATIVE_ORDER');
  });

  it('validates an explicitly synthetic rehearsal candidate without producing a chain Intent', async () => {
    let body: Record<string, unknown> | undefined;
    const runtime = new OllamaAgentRuntime('tinyllama:latest', 'http://127.0.0.1:11434', async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return modelResponse('PROPOSE', 'BUY', '2', '1');
    });
    const proposal = await runtime.generateSyntheticProposal({
      dataClass: 'SYNTHETIC_REHEARSAL', scenarioId: 'safe-synthetic-buy',
      objective: 'Evaluate one small synthetic limit buy.',
      market: { label: 'SYNTH/QUOTE rehearsal market', bestAsk: '2', visibleAskQuantity: '2' },
      limits: { priceTick: '0.01', quantityTick: '0.01', minNotional: '1', maxNotional: '3', maxTotalExposure: '3.01', maxFeeRate: '0.001', maxSlippageBps: 100 },
    });
    expect(body).toMatchObject({ model: 'tinyllama:latest', keep_alive: '0' });
    expect(body?.system).toContain('absence of execution authority is not itself a reason to decline a paper proposal');
    expect(body?.system).toContain('If any constraint fails');
    expect(String(body?.prompt)).toContain('SYNTHETIC_REHEARSAL');
    expect(String(body?.prompt)).toContain('NO_ORDER_SUBMISSION');
    expect(proposal).toMatchObject({
      requestId: 'safe-synthetic-buy', dataClass: 'SYNTHETIC_REHEARSAL',
      status: 'SYNTHETIC_UNSIGNED_PROPOSAL_READY', authorized: false, execution: 'NOT_IMPLEMENTED',
      order: { side: 'BUY', orderType: 'LIMIT', price: '2', quantity: '1' }, estimatedNotional: '2',
    });
    expect(proposal).not.toHaveProperty('intent');
    expect(proposal).not.toHaveProperty('signature');
  });

  it('rejects synthetic candidates outside price, quantity, tick, or exposure bounds', async () => {
    let calls = 0;
    const runtime = new OllamaAgentRuntime('tinyllama:latest', 'http://127.0.0.1:11434', async () => {
      calls++;
      return modelResponse('PROPOSE', 'BUY', '2.02', '3');
    });
    await expect(runtime.generateSyntheticProposal({
      dataClass: 'SYNTHETIC_REHEARSAL', scenarioId: 'out-of-bounds', objective: 'Synthetic safe rehearsal.',
      market: { label: 'SYNTH/QUOTE rehearsal market', bestAsk: '2', visibleAskQuantity: '2' },
      limits: { priceTick: '0.01', quantityTick: '0.01', minNotional: '1', maxNotional: '3', maxTotalExposure: '3.01', maxFeeRate: '0.001', maxSlippageBps: 100 },
    })).rejects.toThrow('AGENT_SYNTHETIC_PROPOSAL_OUT_OF_BOUNDS');
    expect(calls).toBe(1);
  });

  it('exposes only the Ollama HTTP status code for a failed local request', async () => {
    const runtime = new OllamaAgentRuntime('phi:latest', 'http://127.0.0.1:11434', async () => new Response('private local runtime detail', { status: 500 }));
    await expect(runtime.generateSyntheticProposal({
      dataClass: 'SYNTHETIC_REHEARSAL', scenarioId: 'http-status', objective: 'Synthetic safe rehearsal.',
      market: { label: 'SYNTH/QUOTE rehearsal market', bestAsk: '2', visibleAskQuantity: '2' },
      limits: { priceTick: '0.01', quantityTick: '0.01', minNotional: '1', maxNotional: '3', maxTotalExposure: '3.01', maxFeeRate: '0.001', maxSlippageBps: 100 },
    })).rejects.toThrow('AGENT_RUNTIME_HTTP_500');
  });
});
