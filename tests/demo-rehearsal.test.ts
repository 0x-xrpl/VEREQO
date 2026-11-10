import { afterEach, describe, expect, it } from 'vitest';
import { createLocalApp } from '../services/issuer/src/http';
import { listRehearsalScenarios, loadRehearsalScenario, replayRehearsalScenario } from '../services/issuer/src/demo-rehearsal';
import { isInjectiveChainId } from '../packages/domain/src/wallet';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe('Operation 59 portable rehearsal adapter', () => {
  it('loads all eight fixtures into a safe projection without expected outcomes or private policy data', () => {
    const scenarios = listRehearsalScenarios();
    expect(scenarios).toHaveLength(8);
    for (const { scenarioId } of scenarios) {
      const view = loadRehearsalScenario(scenarioId);
      expect(view.scenarioId).toBe(scenarioId);
      expect(view.dataClass).toBe('SYNTHETIC_REHEARSAL');
      expect(view.evidenceState).toBe('NO_RECORD');
      expect(view.businessId).toMatch(/^fi_[a-f0-9]{32}$/);
      expect(view).not.toHaveProperty('expectedObservations');
      expect(JSON.stringify(view)).not.toMatch(/maxOrderNotionalQuote|privatePolicyFixtureRef|privateWitness|issuer-policy\.example/);
      expect(view).not.toHaveProperty('chainEvidence.transactionHash');
    }
  });

  it('checks S01 and denies S02 through server-only policy without returning the ceiling', async () => {
    const s01 = await replayRehearsalScenario('S01-eligible-request');
    const s02 = await replayRehearsalScenario('S02-exceeds-private-mandate');
    expect(s01).toMatchObject({ decision: 'WITHIN_SYNTHETIC_POLICY', authorized: false, execution: 'NOT_IMPLEMENTED', source: 'SYNTHETIC_SERVER_POLICY' });
    expect(s01.facts).toMatchObject({ notionalQuote: '480 USDT', policyBoundReturned: false, authority: 'NOT_CONFIGURED' });
    expect(s02).toMatchObject({ decision: 'DENIED', reason: 'SYNTHETIC_LIMIT_EXCEEDED', authorized: false, execution: 'NOT_IMPLEMENTED' });
    expect(s02.facts).toMatchObject({ notionalQuote: '840 USDT', policyBoundReturned: false });
    expect(JSON.stringify([s01, s02])).not.toMatch(/600|maxOrderNotionalQuote|privatePolicyFixtureRef/);
  });

  it('previews the real directed graph without mutating its source; independent B remains valid', async () => {
    const result = await replayRehearsalScenario('S03-revocation-causality');
    expect(result).toMatchObject({ decision: 'WHAT_IF_ONLY', source: 'LOCAL_VERIFIED_GRAPH', authorized: false, execution: 'NOT_IMPLEMENTED' });
    expect(result.facts).toMatchObject({
      graphSequenceBefore: 0,
      graphSequenceAfter: 0,
      previewSequence: 1,
      agentAIntent: 'BLOCKED',
      agentAAction: 'BLOCKED',
      agentBIntent: 'VALID',
      agentBAction: 'VALID',
      existingOrder: 'UNKNOWN_NOT_CHAIN_VERIFIED',
    });
  });

  it('keeps S04/S05/S06/S07 explicit about blocked and unknown outcomes', async () => {
    expect(await replayRehearsalScenario('S04-unverified-market')).toMatchObject({ decision: 'BLOCKED', reason: 'MARKET_RISK_UNVERIFIED' });
    expect(await replayRehearsalScenario('S05-cancel-vs-fill')).toMatchObject({ decision: 'CANCEL_REQUESTED_NOT_CONFIRMED', facts: { orderStatus: 'UNKNOWN' } });
    expect(await replayRehearsalScenario('S06-wrong-chain')).toMatchObject({ decision: 'DENIED_WRONG_CHAIN', facts: { providerChainId: 1, requiredChainId: 1439, walletProviderCalled: false } });
    expect(await replayRehearsalScenario('S07-disclosure-sequence')).toMatchObject({ decision: 'BLOCKED', facts: { disclosureRequestsSent: false } });
  });

  it('verifies the exact S08 Groth16 vector and keeps authorization and execution blocked', async () => {
    const scenario = loadRehearsalScenario('S08-proof-is-not-authority');
    const result = await replayRehearsalScenario('S08-proof-is-not-authority');
    expect(result).toMatchObject({
      scenarioId: scenario.scenarioId, businessId: scenario.businessId,
      source: 'LOCAL_GROTH16_TEST_VECTOR', decision: 'BLOCKED',
      reason: 'LOCAL_REPLAY_ONLY_MANDATE_EPOCH_ADVANCED; LIVE_GATE_NOT_CALLED',
      proofStatus: 'GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP',
      authorized: false, execution: 'NOT_IMPLEMENTED', evidenceState: 'NO_RECORD',
    });
    expect(scenario.intent).toMatchObject({ quantity: '2', limitPrice: '1', notionalQuote: '2', side: 'BUY' });
    expect(result.facts).toMatchObject({
      requestId: scenario.businessId, credentialEpochAtIntent: 1, credentialEpochNow: 2,
      issuerSignatureStatus: 'NOT_VERIFIED_IN_REHEARSAL',
      graphSequenceBefore: 0, graphSequenceAfter: 0, previewSequence: 1,
      agentAIntent: 'BLOCKED', agentAAction: 'BLOCKED', agentBIntent: 'VALID', agentBAction: 'VALID',
      existingOrder: 'UNKNOWN_NOT_CHAIN_VERIFIED', precompileCalled: false,
      walletProviderCalled: false, orderStatus: 'NOT_SUBMITTED',
    });
    expect(result.facts.intentDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.facts.proofDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/pi_a|pi_b|salt|witness|maxNotional|issuer-policy\\.example/);
  });

  it('shares the Wallet chain guard and rejects malformed or non-Injective identifiers', () => {
    expect(isInjectiveChainId('0x59f')).toBe(true);
    expect(isInjectiveChainId('1439')).toBe(true);
    expect(isInjectiveChainId('0x1')).toBe(false);
    expect(isInjectiveChainId('not-a-chain')).toBe(false);
    expect(isInjectiveChainId(1439)).toBe(false);
  });

  it('serves load/replay/reset without wallet auth, private fields, or issuer state mutation', async () => {
    const app = createLocalApp({ databasePath: ':memory:' });
    cleanup.push(() => app.close());
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('NO_LOCAL_LISTENER');
    const base = `http://127.0.0.1:${address.port}`;
    const state = async (): Promise<unknown> => await (await fetch(`${base}/api/state`)).json();
    const before = await state();
    const list = await fetch(`${base}/api/demo/scenarios`);
    expect(list.status).toBe(200);
    expect((await list.json() as { scenarios: unknown[] }).scenarios).toHaveLength(8);
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const loadedResponse = await post('/api/demo/load', { scenarioId: 'S02-exceeds-private-mandate' });
    expect(loadedResponse.status).toBe(200);
    const loaded = await loadedResponse.json() as { scenario: ReturnType<typeof loadRehearsalScenario> };
    expect(JSON.stringify(loaded)).not.toMatch(/600|maxOrderNotionalQuote|privatePolicyFixtureRef|expectedObservations/);
    const key = { scenarioId: loaded.scenario.scenarioId, businessId: loaded.scenario.businessId, revision: loaded.scenario.revision };
    const replay = await post('/api/demo/replay', key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ result: { decision: 'DENIED', authorized: false, execution: 'NOT_IMPLEMENTED' } });
    const s08load = await post('/api/demo/load', { scenarioId: 'S08-proof-is-not-authority' });
    expect(s08load.status).toBe(200);
    const s08view = (await s08load.json() as { scenario: ReturnType<typeof loadRehearsalScenario> }).scenario;
    const s08replay = await post('/api/demo/replay', { scenarioId: s08view.scenarioId, businessId: s08view.businessId, revision: s08view.revision });
    expect(s08replay.status).toBe(200);
    const s08body = await s08replay.json() as { result: Record<string, unknown> };
    expect(s08body.result).toMatchObject({ businessId: s08view.businessId, proofStatus: 'GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP', authorized: false, execution: 'NOT_IMPLEMENTED' });
    expect(JSON.stringify(s08body)).not.toMatch(/pi_a|pi_b|privateWitness|issuer-policy\\.example/);
    const reset = await post('/api/demo/reset', key);
    expect(await reset.json()).toMatchObject({ status: 'RESET', dataMutation: false, scope: 'LOCAL_REHEARSAL_STATE_ONLY' });
    const after = await state();
    expect(after).toEqual(before);
    const traversal = await fetch(`${base}/api/demo/load/../../private/issuer-policy.example.json`);
    expect(traversal.status).not.toBe(200);
    expect(await traversal.text()).not.toMatch(/600|maxOrderNotionalQuote|SYNTHETIC_PRIVATE_SERVER_ONLY/);
    expect((await fetch(`${base}/api/agent/status`)).status).toBe(200);
  });

  it('serves all eight rehearsals sequentially on one local app instance', async () => {
    const app = createLocalApp({ databasePath: ':memory:' });
    cleanup.push(() => app.close());
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('NO_LOCAL_LISTENER');
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    for (const { scenarioId } of listRehearsalScenarios()) {
      const loadedResponse = await post('/api/demo/load', { scenarioId });
      expect(loadedResponse.status, `${scenarioId} load`).toBe(200);
      const loaded = await loadedResponse.json() as { scenario: ReturnType<typeof loadRehearsalScenario> };
      const replayResponse = await post('/api/demo/replay', { scenarioId, businessId: loaded.scenario.businessId, revision: loaded.scenario.revision });
      expect(replayResponse.status, `${scenarioId} replay`).toBe(200);
      const { result } = await replayResponse.json() as { result: Awaited<ReturnType<typeof replayRehearsalScenario>> };
      expect(result).toMatchObject({ scenarioId, businessId: loaded.scenario.businessId, authorized: false, execution: 'NOT_IMPLEMENTED', evidenceState: 'NO_RECORD' });
      if (scenarioId === 'S08-proof-is-not-authority') expect(result.proofStatus).toBe('GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP');
    }
  });
});
