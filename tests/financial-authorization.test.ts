import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Wallet, toBeHex, zeroPadValue } from 'ethers';
import { marketConfigurationHash } from '../packages/domain/src/agent-request.js';
import { issuerOrderMandateTypedData, parseIssuerOrderMandate } from '../packages/domain/src/order-mandate.js';
import type { GateManifest, RegisteredGateMandate } from '../packages/domain/src/gate-mandate.js';
import { disclosureBindingDigest, disclosureBindingTypedData } from '../packages/domain/src/disclosure-binding.js';
import type { CurrentDisclosureHistory } from '../packages/domain/src/disclosure-binding.js';
import { canonicalBusinessRequestId, nativeOrderDigest, nativeOrderExposure, nativeOrderTypedData, parseNativeOrderIntent } from '../packages/domain/src/native-order.js';
import { InjectiveReadAdapter, type LiveSnapshot, type SpotMarketObservation } from '../packages/domain/src/live-injective.js';
import { createLocalApp } from '../services/issuer/src/http.js';
import type { Groth16ProofEnvelope } from '../services/issuer/src/financial-authorization.js';
import type { ValidatedFinancialAuthorization } from '../services/issuer/src/financial-authorization.js';
import { authorizationRequestDigest, FinancialAuthorizationStore } from '../services/issuer/src/financial-authorization-store.js';
import { validatePinnedSources } from '../scripts/zk-artifacts.mjs';
import { verifyLocalGroth16 } from '../scripts/local-groth16-verifier.mjs';
import { loadRehearsalScenario } from '../services/issuer/src/demo-rehearsal';
import { syntheticOrderbookV2GrpcWebResponse } from './support/injective-orderbook.js';

const fixture = JSON.parse(await (await import('node:fs/promises')).readFile(process.env.VEREQO_FINANCIAL_AUTH_FIXTURE_PATH ?? 'contracts/test/fixtures/financial-authorization.json', 'utf8')) as {
  readonly issuer: string;
  readonly principal: string;
  readonly agent: string;
  readonly gate: string;
  readonly requestId: string;
  readonly market: Record<string, unknown>;
  readonly marketConfigHash: string;
  readonly policy: Record<string, string>;
  readonly mandate: Record<string, unknown>;
  readonly intent: Record<string, unknown>;
  readonly intentDigest: string;
  readonly proof: { readonly proof: never; readonly publicSignals: string[] };
};

const gateManifest: GateManifest = {
  chainId: '1439', gate: fixture.gate, gateCodeHash: `0x${'dd'.repeat(32)}`,
  issuer: fixture.issuer, principal: fixture.principal,
  verifier: '0x00000000000000000000000000000000000000aa', verifierCodeHash: `0x${'ee'.repeat(32)}`,
};

const privateKey = (value: number) => zeroPadValue(toBeHex(value), 32);
const principalWallet = new Wallet(privateKey(0xA11CE));
const issuerWallet = new Wallet(privateKey(123));
const otherWallet = new Wallet(privateKey(0xBAD));
const fixedNow = 1_700_000_000;
let marketNow = fixedNow;
const market = fixture.market as unknown as SpotMarketObservation;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const rawMarket = {
  market_id: market.marketId, ticker: market.ticker, status: market.status,
  base_denom: market.baseDenom, quote_denom: market.quoteDenom,
  base_decimals: market.baseDecimals, quote_decimals: market.quoteDecimals,
  min_price_tick_size: market.priceTickChain, min_quantity_tick_size: market.quantityTickChain,
  min_notional: market.minimumNotionalChain, taker_fee_rate: market.takerFeeRate,
};

function adapter() {
  return new InjectiveReadAdapter(async (input, init) => {
    const url = String(input);
    if (url.includes('testnet.sentry.exchange.grpc-web.injective.network')) return new Response(syntheticOrderbookV2GrpcWebResponse({ marketId: market.marketId, timestampMs: BigInt(marketNow) * 1000n, height: 16n, sells: [{ price: '0.9', quantity: (10n * 10n ** BigInt(market.baseDecimals)).toString() }] }), { headers: { 'content-type': 'application/grpc-web+proto' } });
    if (url.endsWith('/cosmos/base/tendermint/v1beta1/node_info')) return Response.json({ default_node_info: { network: 'injective-888', version: '1.0.1' }, application_version: { app_name: 'injectived', version: 'v1.20.4-bl.2', git_commit: 'fixture-1', cosmos_sdk_version: 'v0.50.15-inj.1' } });
    if (url.endsWith('/injective/exchange/v1beta1/spot/markets')) return Response.json({ markets: [rawMarket] });
    if (url.includes('/injective/exchange/v1beta1/spot/mid_price_and_tob/')) return Response.json({ mid_price: '1', best_buy_price: '1', best_sell_price: '1' });
    if (url.endsWith('/injective/exchange/v1beta1/derivative/markets')) return Response.json({ markets: [] });
    const body = JSON.parse(String(init?.body)) as { method: string };
    if (body.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: 1, result: '0x59f' });
    if (body.method === 'web3_clientVersion') return Response.json({ jsonrpc: '2.0', id: 1, result: 'fixture-rpc/1' });
    if (body.method === 'eth_getBlockByNumber') return Response.json({ jsonrpc: '2.0', id: 1, result: { number: '0x10', hash: `0x${'11'.repeat(32)}`, timestamp: `0x${marketNow.toString(16)}` } });
    throw Error('UNEXPECTED_TEST_RPC');
  }, () => marketNow * 1000);
}

function signedMandate(mandate: Record<string, unknown>) {
  const data = issuerOrderMandateTypedData(mandate);
  return issuerWallet.signTypedData(data.domain, data.types, data.value);
}

function signedIntent(intent: Record<string, unknown>, wallet = principalWallet) {
  const data = nativeOrderTypedData(intent);
  return wallet.signTypedData(data.domain, data.types, data.value);
}

function expectedSignalsFor(intentInput: Record<string, unknown>, mandate: Record<string, unknown>): string[] {
  const intent = parseNativeOrderIntent(intentInput);
  const digest = BigInt(nativeOrderDigest(intent));
  const exposure = nativeOrderExposure(intent);
  return [
    BigInt(String(mandate.commitment)).toString(), exposure.total,
    (digest >> 128n).toString(), (digest & ((1n << 128n) - 1n)).toString(),
    BigInt(String(mandate.issuer)).toString(), BigInt(intent.chainId).toString(),
    BigInt(intent.verifyingContract).toString(), intent.credentialEpoch, intent.policyEpoch, String(mandate.expiry),
  ];
}

function proofVerifier() {
  const { fixtures } = validatePinnedSources();
  const verificationKey = (fixtures as { verificationKey: unknown }).verificationKey;
  return (proof: Groth16ProofEnvelope['proof'], signals: readonly string[]) => verifyLocalGroth16(verificationKey, signals, proof);
}

function registeredMandate(value: Record<string, unknown>): RegisteredGateMandate {
  const mandate = parseIssuerOrderMandate(value);
  return {
    ...gateManifest, storedVerifierCodeHash: gateManifest.verifierCodeHash,
    policyEpoch: mandate.policyEpoch, credentialId: mandate.credentialId, commitment: mandate.commitment,
    agent: mandate.agent, credentialEpoch: mandate.credentialEpoch, expiry: mandate.expiry, cap: mandate.cap,
    spent: '0', marketId: mandate.marketId, subaccountId: mandate.subaccountId,
    marketConfigHash: mandate.marketConfigHash, priceTick: mandate.priceTick,
    quantityTick: mandate.quantityTick, maxFeeRate: mandate.maxFeeRate, active: mandate.active,
    blockNumber: 16, blockHash: `0x${'11'.repeat(32)}`,
  };
}

describe('local wallet-to-ActionGate authorization package', () => {
  let app: ReturnType<typeof createLocalApp>;
  let base = '';
  let session = '';
  let currentMandate: { mandate: Record<string, unknown>; signature: string };
  let currentGateMandate: RegisteredGateMandate;
  let readGateMandate: () => Promise<RegisteredGateMandate>;
  let verifyProof: (proof: Groth16ProofEnvelope['proof'], publicSignals: readonly string[]) => Promise<boolean>;
  let initialProofVerifier: typeof verifyProof;
  let authorizationNow: number;
  let currentDisclosureHistory: CurrentDisclosureHistory | null;
  let readDisclosureHistory: (binding: import('../packages/domain/src/disclosure-binding.js').DisclosureBinding) => Promise<CurrentDisclosureHistory | null>;
  let close: (() => Promise<void>) | undefined;

  async function post(path: string, body: unknown, token = session) {
    return fetch(`${base}${path}`, {
      method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...(token ? { 'x-vereqo-session': token } : {}) },
      body: JSON.stringify(body),
    });
  }

  async function authorize(overrides: Record<string, unknown> = {}, token = session) {
    const requestId = (overrides.requestId as string | undefined) ?? fixture.requestId;
    const source = (overrides.source as string | undefined) ?? 'FIXTURE';
    const mandate = (overrides.mandate as Record<string, unknown> | undefined) ?? fixture.mandate;
    const mandateSignature = (overrides.mandateSignature as string | undefined) ?? await signedMandate(mandate);
    const sourceIntent = (overrides.intent as Record<string, unknown> | undefined) ?? fixture.intent;
    const bindRequestId = overrides.bindRequestId !== false;
    let disclosureBinding: unknown;
    let disclosureRequestId: string | null = null;
    if (source === 'LIVE_PROVIDER' && overrides.omitDisclosureBinding !== true) {
      const binding = {
        issuer: String(sourceIntent.issuer), principal: String(sourceIntent.principal), agent: String(sourceIntent.agent),
        credentialId: String(sourceIntent.credentialId), requestIdHash: canonicalBusinessRequestId(requestId),
        historyRoot: `0x${'57'.repeat(32)}`, historySequence: '0',
        policyEpoch: String(sourceIntent.policyEpoch), credentialEpoch: String(sourceIntent.credentialEpoch),
        issuedAt: String(authorizationNow),
        expiresAt: String(Math.min(authorizationNow + 120, Number(sourceIntent.deadline))),
      };
      const typed = disclosureBindingTypedData(binding, String(sourceIntent.verifyingContract));
      disclosureBinding = overrides.disclosureBinding ?? { binding, signature: await issuerWallet.signTypedData(typed.domain, typed.types, typed.value) };
      try { disclosureRequestId = disclosureBindingDigest((disclosureBinding as { binding: unknown }).binding, String(sourceIntent.verifyingContract)); }
      catch { disclosureRequestId = null; }
    }
    const reboundBusinessId = bindRequestId && requestId !== fixture.requestId && sourceIntent.disclosureRequestId === fixture.intent.disclosureRequestId;
    const intent = source === 'LIVE_PROVIDER' && bindRequestId && disclosureRequestId
      ? { ...sourceIntent, disclosureRequestId }
      : reboundBusinessId ? { ...sourceIntent, disclosureRequestId: canonicalBusinessRequestId(requestId) } : sourceIntent;
    const intentSignature = (overrides.intentSignature as string | undefined) ?? await signedIntent(intent);
    const sourceProof = (overrides.proof as typeof fixture.proof | undefined) ?? fixture.proof;
    const expectedSignals = expectedSignalsFor(intent, mandate);
    const sameOriginalSignals = JSON.stringify(sourceProof.publicSignals) === JSON.stringify(fixture.proof.publicSignals);
    const intentRebound = intent.disclosureRequestId !== fixture.intent.disclosureRequestId;
    const proof = intentRebound && sameOriginalSignals ? { ...sourceProof, publicSignals: expectedSignals } : sourceProof;
    if (intentRebound && overrides.proof === undefined && verifyProof === initialProofVerifier) {
      // This synthetic provider path uses the pinned proof point bytes with a local verifier stub
      // after changing the signed intent. Only the fixed S08 test below verifies a real Groth16 proof.
      verifyProof = async (candidate) => JSON.stringify(candidate) === JSON.stringify(fixture.proof.proof);
    }
    const body = {
      requestId, source, intent, intentSignature,
      ...(source === 'LIVE_PROVIDER' && disclosureBinding !== undefined ? { disclosureBinding } : {}),
      mandate, mandateSignature, proof,
    };
    return post('/api/agent/authorize', body, token);
  }

  beforeEach(async () => {
    authorizationNow = fixedNow;
    marketNow = fixedNow;
    verifyProof = proofVerifier();
    initialProofVerifier = verifyProof;
    currentMandate = { mandate: fixture.mandate, signature: await signedMandate(fixture.mandate) };
    currentGateMandate = registeredMandate(fixture.mandate);
    readGateMandate = async () => currentGateMandate;
    currentDisclosureHistory = {
      issuer: fixture.issuer, principal: fixture.principal, agent: fixture.agent,
      credentialId: String(fixture.intent.credentialId), historyRoot: `0x${'57'.repeat(32)}`,
      historySequence: '0', policyEpoch: String(fixture.intent.policyEpoch),
      credentialEpoch: String(fixture.intent.credentialEpoch), active: true,
    };
    readDisclosureHistory = async () => currentDisclosureHistory;
    app = createLocalApp({
      databasePath: ':memory:', injective: adapter(), agentPolicy: fixture.policy as never, agentProvider: { configured: true, id: 'synthetic-test-provider' },
      nowSeconds: () => authorizationNow,
      financialAuthorization: {
        currentMandate: () => currentMandate,
        gateManifest,
        readGateMandate: () => readGateMandate(),
        readCurrentDisclosureHistory: (binding) => readDisclosureHistory(binding),
        verifyProof: (proof, signals) => verifyProof(proof, signals),
      },
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw Error('NO_TEST_LISTENER');
    base = `http://127.0.0.1:${address.port}`;
    const challengeResponse = await post('/api/wallet/challenge', { address: principalWallet.address }, '');
    const { challenge } = await challengeResponse.json() as { challenge: { domain: never; types: never; value: never } };
    const walletSignature = await principalWallet.signTypedData(challenge.domain, challenge.types, challenge.value);
    const verified = await post('/api/wallet/verify', { nonce: (challenge.value as { nonce: string }).nonce, signature: walletSignature }, '');
    if (!verified.ok) throw Error(`WALLET_VERIFY_${verified.status}`);
    session = (await verified.json() as { session: string }).session;
    const status = await fetch(base + '/api/wallet/status', { headers: { origin: base, 'x-vereqo-session': session } });
    const statusBody = await status.json() as { session: { address: string } | null };
    expect(status.headers.get('X-Vereqo-Auth-Stage')).toBe('SESSION_STATUS_CONFIRMED');
    expect(statusBody.session).toMatchObject({ address: principalWallet.address, origin: base });
    close = app.close;
  });

  afterEach(async () => { await close?.(); close = undefined; });

  it('binds the canonical Request ID into signed Intent and proof context for every proposal source', async () => {
    const matching=await authorize({requestId:fixture.requestId,source:'LIVE_PROVIDER'});
    expect(matching.status, JSON.stringify(await matching.clone().json())).toBe(200);
    expect(await matching.clone().json()).toMatchObject({ disclosureBindingStatus: 'ISSUER_SIGNATURE_VERIFIED', disclosureBindingDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/), disclosureHistoryRoot: `0x${'57'.repeat(32)}`, evidence: { disclosureBindingDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/) } });
    const missingBinding = await authorize({ requestId: 'provider-without-disclosure', source: 'LIVE_PROVIDER', omitDisclosureBinding: true });
    expect(missingBinding.status).toBe(422);
    expect(await missingBinding.json()).toMatchObject({ reason: 'DISCLOSURE_BINDING_REQUIRED', authorized: false, execution: 'NOT_IMPLEMENTED' });
    for(const source of ['FIXTURE','LIVE_PROVIDER']){
      const mismatch=await authorize({requestId:`different-${source.toLowerCase()}-id`,source,bindRequestId:false});
      expect(mismatch.status).toBe(422);
      expect(await mismatch.json()).toMatchObject({status:'REJECTED',reason:'REQUEST_ID_INTENT_MISMATCH',authorized:false,execution:'NOT_IMPLEMENTED'});
    }
  });

  it('fails closed when the issuer current disclosure head is unavailable, stale, forked, or revoked', async () => {
    const cases: Array<[string, CurrentDisclosureHistory | null, string]> = [
      ['unavailable', null, 'DISCLOSURE_HISTORY_UNAVAILABLE'],
      ['stale-root', { ...currentDisclosureHistory!, historyRoot: `0x${'58'.repeat(32)}` }, 'DISCLOSURE_HISTORY_STALE'],
      ['stale-sequence', { ...currentDisclosureHistory!, historySequence: '1' }, 'DISCLOSURE_HISTORY_STALE'],
      ['policy-rollback', { ...currentDisclosureHistory!, policyEpoch: '2' }, 'DISCLOSURE_EPOCH_MISMATCH'],
      ['credential-revoked', { ...currentDisclosureHistory!, active: false }, 'DISCLOSURE_CREDENTIAL_REVOKED'],
      ['issuer-confusion', { ...currentDisclosureHistory!, issuer: principalWallet.address }, 'DISCLOSURE_CURRENT_BINDING_MISMATCH'],
    ];
    for (const [, state, reason] of cases) {
      currentDisclosureHistory = state;
      const response = await authorize({ source: 'LIVE_PROVIDER', requestId: `head-${reason.toLowerCase()}` });
      expect(response.status, reason).toBe(422);
      expect(await response.json()).toMatchObject({ status: 'REJECTED', reason, authorized: false, execution: 'NOT_IMPLEMENTED' });
    }
  });

  it('re-reads the authoritative disclosure head after asynchronous Gate checks before committing evidence', async () => {
    const current = currentDisclosureHistory!;
    let reads = 0;
    readDisclosureHistory = async () => ++reads === 1 ? current : { ...current, historySequence: '1' };
    const response = await authorize({ source: 'LIVE_PROVIDER', requestId: 'disclosure-raced-head' });
    expect(reads).toBe(2);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ status: 'REJECTED', reason: 'DISCLOSURE_HISTORY_STALE', authorized: false });
  });
  it('authenticates the wallet, verifies owner intent + issuer mandate + real proof, and commits pre-Gate evidence', async () => {
    expect(marketConfigurationHash({ market } as unknown as LiveSnapshot)).toBe(fixture.marketConfigHash);
    const response = await authorize();
    expect(response.status).toBe(200);
    const result = await response.json() as Record<string, unknown>;
    expect(result).toMatchObject({
      status: 'PRE_GATE_VALIDATED', authorized: false, execution: 'NOT_IMPLEMENTED',
      proofStatus: 'GROTH16_VERIFIED', disclosureBindingStatus: 'NOT_PROVIDED_FIXTURE', intentDigest: fixture.intentDigest,
    });
    expect(result).not.toHaveProperty('proof');
    expect(result).not.toHaveProperty('witness');
    expect(result.evidence).toMatchObject({ status: 'PRE_GATE_VALIDATED', reason: null });

    const evidenceResponse = await fetch(`${base}/api/agent/authorization/${fixture.requestId}`, {
      headers: { 'x-vereqo-session': session },
    });
    expect(evidenceResponse.status).toBe(200);
    expect((await evidenceResponse.json()).evidence).toMatchObject({
      status: 'PRE_GATE_VALIDATED', intentDigest: fixture.intentDigest,
    });
  });

  it('uses the same canonical S08 request ID for the exact signed intent, mandate and proof vector', async () => {
    const scenario = loadRehearsalScenario('S08-proof-is-not-authority');
    expect(scenario.businessId).toBe(fixture.requestId);
    const response = await authorize({ requestId: scenario.businessId });
    expect(response.status).toBe(200);
    const result = await response.json() as Record<string, unknown>;
    expect(result).toMatchObject({
      requestId: scenario.businessId, status: 'PRE_GATE_VALIDATED',
      authorized: false, execution: 'NOT_IMPLEMENTED', proofStatus: 'GROTH16_VERIFIED',
      intentDigest: fixture.intentDigest,
    });
    const evidence = await fetch(`${base}/api/agent/authorization/${scenario.businessId}`, {
      headers: { 'x-vereqo-session': session },
    });
    expect(evidence.status).toBe(200);
    expect((await evidence.json()).evidence).toMatchObject({
      requestId: scenario.businessId, status: 'PRE_GATE_VALIDATED', intentDigest: fixture.intentDigest,
    });
  });

  it('rejects a fresh owner signature over a changed order because proof is bound to the old digest', async () => {
    const changedIntent = { ...fixture.intent, price: '1010000000000000000' };
    const response = await authorize({ intent: changedIntent });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ status: 'REJECTED', reason: 'PROOF_INTENT_MISMATCH', authorized: false, execution: 'NOT_IMPLEMENTED' });
  });

  it('rejects a wallet signature from a different owner even when the authenticated session is correct', async () => {
    const response = await authorize({ intentSignature: await signedIntent(fixture.intent, otherWallet) });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ status: 'REJECTED', reason: 'INTENT_SIGNER_MISMATCH' });
  });

  it('rejects forged issuer signatures and altered proof inputs with durable reason evidence', async () => {
    const forged = await authorize({ mandateSignature: `0x${'00'.repeat(65)}` });
    expect(forged.status).toBe(422);
    expect(await forged.json()).toMatchObject({ status: 'REJECTED', reason: 'MANDATE_SIGNATURE_INVALID' });

    const proof = structuredClone(fixture.proof) as { proof: { pi_a: string[] }; publicSignals: string[] };
    proof.publicSignals[1] = '2000000000000000001';
    const substituted = await authorize({ requestId: 'substituted-proof', proof });
    expect(substituted.status).toBe(422);
    expect(await substituted.json()).toMatchObject({ status: 'REJECTED', reason: 'PROOF_INTENT_MISMATCH' });
    const evidence = await fetch(`${base}/api/agent/authorization/substituted-proof`, { headers: { 'x-vereqo-session': session } });
    expect((await evidence.json()).evidence).toMatchObject({ status: 'REJECTED', reason: 'PROOF_INTENT_MISMATCH' });
  });

  it('rejects a valid issuer signature when the live Gate registration has a different commitment', async () => {
    const substitutedMandate = { ...fixture.mandate, commitment: `0x${'ab'.repeat(32)}` };
    currentMandate = { mandate: substitutedMandate, signature: await signedMandate(substitutedMandate) };
    const response = await authorize({ requestId: 'wrong-gate-commitment', mandate: substitutedMandate });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ status: 'REJECTED', reason: 'GATE_MANDATE_MISMATCH', authorized: false });
  });

  it('fails closed when the pinned Gate state cannot be read', async () => {
    readGateMandate = async () => { throw Error('RPC_UNAVAILABLE'); };
    const response = await authorize({ requestId: 'gate-unavailable' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ status: 'REJECTED', reason: 'GATE_STATE_UNAVAILABLE', authorized: false });
  });

  it('rechecks the owner session after proof verification before reserving a nonce', async () => {
    const pending = deferred<boolean>();
    let entered!: () => void;
    const verificationStarted = new Promise<void>((resolve) => { entered = resolve; });
    verifyProof = async () => { entered(); return pending.promise; };
    const responsePromise = authorize({ requestId: 'logout-during-proof' });
    await verificationStarted;
    expect((await post('/api/wallet/logout', {}, session)).status).toBe(200);
    pending.resolve(true);

    const response = await responsePromise;
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      status: 'REJECTED', reason: 'WALLET_SESSION_INVALIDATED',
      authorized: false, execution: 'NOT_IMPLEMENTED', evidence: { status: 'REJECTED' },
    });

    const challengeResponse = await post('/api/wallet/challenge', { address: principalWallet.address }, '');
    const { challenge } = await challengeResponse.json() as { challenge: { value: { nonce: string }; domain: never; types: never } };
    const verified = await post('/api/wallet/verify', {
      nonce: challenge.value.nonce,
      signature: await principalWallet.signTypedData(challenge.domain, challenge.types, challenge.value),
    }, '');
    const replacementSession = (await verified.json() as { session: string }).session;
    const retry = await authorize({ requestId: 'same-nonce-after-logout' }, replacementSession);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'PRE_GATE_VALIDATED', authorized: false });
  });

  it('rejects an expired owner session after asynchronous proof verification', async () => {
    const pending = deferred<boolean>();
    let entered!: () => void;
    const verificationStarted = new Promise<void>((resolve) => { entered = resolve; });
    verifyProof = async () => { entered(); return pending.promise; };
    const responsePromise = authorize({ requestId: 'session-expires-during-proof' });
    await verificationStarted;
    authorizationNow = fixedNow + 601;
    pending.resolve(true);

    const response = await responsePromise;
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      status: 'REJECTED', reason: 'WALLET_SESSION_INVALIDATED',
      authorized: false, execution: 'NOT_IMPLEMENTED',
    });
  });

  it('rejects a mandate revoked while proof verification is pending without consuming the nonce', async () => {
    const pending = deferred<boolean>();
    let entered!: () => void;
    const verificationStarted = new Promise<void>((resolve) => { entered = resolve; });
    verifyProof = async () => { entered(); return pending.promise; };
    const responsePromise = authorize({ requestId: 'revoke-during-proof' });
    await verificationStarted;
    const revoked = { ...fixture.mandate, active: false };
    currentMandate = { mandate: revoked, signature: await signedMandate(revoked) };
    currentGateMandate = registeredMandate(revoked);
    pending.resolve(true);

    const response = await responsePromise;
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      status: 'REJECTED', reason: 'MANDATE_REVOKED',
      authorized: false, execution: 'NOT_IMPLEMENTED',
    });

    currentMandate = { mandate: fixture.mandate, signature: await signedMandate(fixture.mandate) };
    currentGateMandate = registeredMandate(fixture.mandate);
    const retry = await authorize({ requestId: 'same-nonce-after-revoke' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'PRE_GATE_VALIDATED', authorized: false });
  });

  it('re-reads the Gate registration after proof verification', async () => {
    const pending = deferred<boolean>();
    let entered!: () => void;
    const verificationStarted = new Promise<void>((resolve) => { entered = resolve; });
    verifyProof = async () => { entered(); return pending.promise; };
    const responsePromise = authorize({ requestId: 'gate-change-during-proof' });
    await verificationStarted;
    currentGateMandate = { ...currentGateMandate, policyEpoch: '99' };
    pending.resolve(true);

    const response = await responsePromise;
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      status: 'REJECTED', reason: 'GATE_MANDATE_CHANGED_DURING_VALIDATION',
      authorized: false, execution: 'NOT_IMPLEMENTED',
    });

    currentGateMandate = registeredMandate(fixture.mandate);
    const retry = await authorize({ requestId: 'same-nonce-after-gate-change' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'PRE_GATE_VALIDATED', authorized: false });
  });

  it('revalidates snapshot freshness and Intent expiry after asynchronous proof work', async () => {
    const pending = deferred<boolean>();
    let entered!: () => void;
    const verificationStarted = new Promise<void>((resolve) => { entered = resolve; });
    verifyProof = async () => { entered(); return pending.promise; };
    const staleSnapshotPromise = authorize({ requestId: 'snapshot-stale-during-proof' });
    await verificationStarted;
    authorizationNow = fixedNow + 61;
    pending.resolve(true);
    const staleSnapshot = await staleSnapshotPromise;
    expect(staleSnapshot.status).toBe(422);
    expect(await staleSnapshot.json()).toMatchObject({ status: 'REJECTED', reason: 'STALE_OR_UNTRUSTED_SNAPSHOT' });

    authorizationNow = Number(fixture.intent.deadline);
    marketNow = authorizationNow;
    const expiredIntent = await authorize({ requestId: 'intent-expired-after-proof' });
    expect(expiredIntent.status).toBe(422);
    expect(await expiredIntent.json()).toMatchObject({ status: 'REJECTED', reason: 'EXPIRED_FUTURE_OR_REPLAY' });

    authorizationNow = fixedNow;
    marketNow = fixedNow;
    const retry = await authorize({ requestId: 'same-nonce-after-stale-checks' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'PRE_GATE_VALIDATED', authorized: false });
  });

  it('rechecks market freshness after a delayed final Gate read without consuming the nonce', async () => {
    const pending = deferred<RegisteredGateMandate>();
    let entered!: () => void;
    const gateReadStarted = new Promise<void>((resolve) => { entered = resolve; });
    let gateReads = 0;
    readGateMandate = async () => {
      gateReads += 1;
      if (gateReads === 2) { entered(); return pending.promise; }
      return currentGateMandate;
    };
    const responsePromise = authorize({ requestId: 'snapshot-stale-during-final-gate-read' });
    await gateReadStarted;
    authorizationNow = fixedNow + 61;
    pending.resolve(currentGateMandate);

    const stale = await responsePromise;
    expect(stale.status).toBe(422);
    expect(await stale.json()).toMatchObject({
      status: 'REJECTED', reason: 'STALE_OR_UNTRUSTED_SNAPSHOT', authorized: false,
    });

    authorizationNow = fixedNow;
    marketNow = fixedNow;
    const retry = await authorize({ requestId: 'same-nonce-after-final-gate-stale' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'PRE_GATE_VALIDATED', authorized: false });
  });

  it('rechecks the current Agent policy after a delayed final Gate read without consuming the nonce', async () => {
    const pending = deferred<RegisteredGateMandate>();
    let entered!: () => void;
    const gateReadStarted = new Promise<void>((resolve) => { entered = resolve; });
    let gateReads = 0;
    readGateMandate = async () => {
      gateReads += 1;
      if (gateReads === 2) { entered(); return pending.promise; }
      return currentGateMandate;
    };
    const originalMaxNotional = fixture.policy.maxNotional!;
    const responsePromise = authorize({ requestId: 'policy-change-during-final-gate-read' });
    await gateReadStarted;
    fixture.policy.maxNotional = '1';
    pending.resolve(currentGateMandate);

    try {
      const changedPolicy = await responsePromise;
      expect(changedPolicy.status).toBe(422);
      expect(await changedPolicy.json()).toMatchObject({
        status: 'REJECTED', reason: 'POLICY_maxNotional', authorized: false,
      });
    } finally {
      fixture.policy.maxNotional = originalMaxNotional;
    }
    const retry = await authorize({ requestId: 'same-nonce-after-final-gate-policy-change' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'PRE_GATE_VALIDATED', authorized: false });
  });

  it('rejects market configuration changes observed after proof verification', async () => {
    const pending = deferred<boolean>();
    let entered!: () => void;
    const verificationStarted = new Promise<void>((resolve) => { entered = resolve; });
    verifyProof = async () => { entered(); return pending.promise; };
    const originalMarket = structuredClone(rawMarket);
    const responsePromise = authorize({ requestId: 'market-config-changes-during-proof' });
    await verificationStarted;
    rawMarket.taker_fee_rate = '0.0015';
    pending.resolve(true);
    const response = await responsePromise;
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      status: 'REJECTED', reason: 'MARKET_CONFIGURATION',
      authorized: false, execution: 'NOT_IMPLEMENTED',
    });

    Object.assign(rawMarket, originalMarket);
    const retry = await authorize({ requestId: 'same-nonce-after-market-change' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'PRE_GATE_VALIDATED', authorized: false });
  });

  it('rejects invalid Groth16 points after matching the public Intent signals', async () => {
    const proof = structuredClone(fixture.proof) as { proof: { pi_a: string[] }; publicSignals: string[] };
    proof.proof.pi_a[0] = (BigInt(proof.proof.pi_a[0]!) + 1n).toString();
    const response = await authorize({ requestId: 'invalid-proof', proof });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ status: 'REJECTED', reason: 'INVALID_GROTH16_PROOF' });
  });

  it('rejects a revoked current mandate, expired intent, and a foreign wallet session', async () => {
    const revoked = { ...fixture.mandate, active: false };
    currentMandate = { mandate: revoked, signature: await signedMandate(revoked) };
    const revokedResponse = await authorize({ requestId: 'revoked' });
    expect(revokedResponse.status).toBe(422);
    expect(await revokedResponse.json()).toMatchObject({ status: 'REJECTED', reason: 'MANDATE_REVOKED' });

    currentMandate = { mandate: fixture.mandate, signature: await signedMandate(fixture.mandate) };
    const expiredIntent = { ...fixture.intent, deadline: '1699999999' };
    const expiredResponse = await authorize({ requestId: 'expired-intent', intent: expiredIntent });
    expect(expiredResponse.status).toBe(422);
    expect(await expiredResponse.json()).toMatchObject({ status: 'REJECTED', reason: 'EXPIRED_FUTURE_OR_REPLAY' });

    const challengeResponse = await post('/api/wallet/challenge', { address: otherWallet.address }, '');
    const { challenge } = await challengeResponse.json() as { challenge: { domain: never; types: never; value: { nonce: string } } };
    const signature = await otherWallet.signTypedData(challenge.domain, challenge.types, challenge.value);
    const verified = await post('/api/wallet/verify', { nonce: challenge.value.nonce, signature }, '');
    const foreignSession = (await verified.json() as { session: string }).session;
    const foreignResponse = await authorize({ requestId: 'foreign-wallet' }, foreignSession);
    expect(foreignResponse.status).toBe(422);
    expect(await foreignResponse.json()).toMatchObject({ status: 'REJECTED', reason: 'UNAUTHENTICATED_PRINCIPAL' });
  });

  it('claims a successful nonce once, then records replay rejection before returning it', async () => {
    expect((await authorize()).status).toBe(200);
    const replay = await authorize({ requestId: 'replay-order' });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ status: 'REJECTED', reason: 'REPLAY', authorized: false });
  });

  it('makes requestId idempotent, records payload conflicts, and returns the full owner-scoped history', async () => {
    const first = await authorize({ requestId: 'stable-request' });
    expect(first.status).toBe(200);
    const firstEvidence = (await first.json() as { evidence: { id: string } }).evidence;

    const retry = await authorize({ requestId: 'stable-request' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'PRE_GATE_VALIDATED', authorized: false, idempotent: true, evidence: { id: firstEvidence.id } });

    const collision = await authorize({ requestId: 'stable-request', intent: { ...fixture.intent, price: '1010000000000000000' } });
    expect(collision.status).toBe(409);
    expect(await collision.json()).toMatchObject({ status: 'REJECTED', reason: 'REQUEST_ID_CONFLICT', authorized: false });

    const pageOneResponse = await fetch(`${base}/api/agent/authorization/stable-request?limit=1`, { headers: { 'x-vereqo-session': session } });
    const pageOne = await pageOneResponse.json() as { evidence: { id: string; reason: string | null }; events: Array<{ id: string }>; nextCursor: string | null };
    expect(pageOneResponse.status).toBe(200);
    expect(pageOne.events).toHaveLength(1);
    expect(pageOne.evidence.reason).toBe('REQUEST_ID_CONFLICT');
    expect(pageOne.nextCursor).not.toBeNull();

    const pageTwoResponse = await fetch(`${base}/api/agent/authorization/stable-request?before=${pageOne.nextCursor}&limit=1`, { headers: { 'x-vereqo-session': session } });
    const pageTwo = await pageTwoResponse.json() as { events: Array<{ id: string }> };
    expect(pageTwo.events).toMatchObject([{ id: firstEvidence.id }]);
    const byId = await fetch(`${base}/api/agent/evidence/${firstEvidence.id}`, { headers: { 'x-vereqo-session': session } });
    expect((await byId.json()).evidence).toMatchObject({ id: firstEvidence.id, status: 'PRE_GATE_VALIDATED' });
  });
});


describe('financial authorization nonce store', () => {
  const timestamp = new Date(fixedNow * 1000).toISOString();
  const rejected = (requestId: string, digest: string) => ({
    requestId, principal: principalWallet.address, reason: 'TEST_REJECTION', intentDigest: null,
    mandateDigest: null, requestDigest: digest, createdAt: timestamp,
  });

  it('matches ActionGate nonce scope across principals, agents, and credentials', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const store = new FinancialAuthorizationStore(db);
      const base = {
        requestId: 'nonce-owner-a', source: 'FIXTURE', provenance: 'IMPORTED_FIXTURE',
        status: 'PRE_GATE_VALIDATED', authorized: false, execution: 'NOT_IMPLEMENTED',
        intent: {
          chainId: '1439', verifyingContract: '0x00000000000000000000000000000000000001c8',
          principal: '0x0000000000000000000000000000000000000011',
          agent: '0x0000000000000000000000000000000000000022',
          credentialId: '0x' + '11'.repeat(32), nonce: '77',
        },
        preview: {}, marketRisk: { observationDigest: '0x' + 'dd'.repeat(32) }, intentDigest: '0x' + 'aa'.repeat(32),
        mandateDigest: '0x' + 'bb'.repeat(32), proofDigest: '0x' + 'cc'.repeat(32),
        proofStatus: 'GROTH16_VERIFIED',
      } as unknown as ValidatedFinancialAuthorization;
      const timestamp = new Date(fixedNow * 1000).toISOString();
      const firstDigest = authorizationRequestDigest({ request: 'first' });
      const collisionDigest = authorizationRequestDigest({ request: 'different' });
      const firstEvidence = store.recordValidated(base, timestamp, firstDigest);
      expect(firstEvidence.status).toBe('PRE_GATE_VALIDATED');
      expect(store.recordValidated(base, timestamp, firstDigest).id).toBe(firstEvidence.id);
      const conflict = store.recordValidated(base, timestamp, collisionDigest);
      expect(conflict).toMatchObject({ status: 'REJECTED', reason: 'REQUEST_ID_CONFLICT' });
      expect(store.history(base.requestId, base.intent.principal, null, 10).events.map((event) => event.id)).toEqual([conflict.id, firstEvidence.id]);
      const otherScope = {
        ...base,
        requestId: 'nonce-owner-b',
        intent: {
          ...base.intent,
          principal: '0x0000000000000000000000000000000000000033',
          agent: '0x0000000000000000000000000000000000000044',
          credentialId: '0x' + '22'.repeat(32),
        },
      } as ValidatedFinancialAuthorization;
      expect(store.recordValidated(otherScope, timestamp, authorizationRequestDigest({ request: 'other' })))
        .toMatchObject({ status: 'REJECTED', reason: 'REPLAY' });
    } finally {
      db.close();
    }
  });

  it('rejects disclosure history rollback and same-sequence forks before reserving an ActionGate nonce', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const store = new FinancialAuthorizationStore(db);
      const base = {
        requestId: 'disclosure-head-1', source: 'LIVE_PROVIDER', provenance: 'PROVIDER_DECLARED_NOT_AUTONOMY_VERIFIED',
        status: 'PRE_GATE_VALIDATED', authorized: false, execution: 'NOT_IMPLEMENTED',
        intent: { chainId: '1439', verifyingContract: '0x00000000000000000000000000000000000001c8', principal: principalWallet.address, issuer: issuerWallet.address, credentialId: '0x' + '11'.repeat(32), nonce: '101' },
        preview: {}, marketRisk: { observationDigest: '0x' + 'dd'.repeat(32) }, intentDigest: '0x' + 'aa'.repeat(32),
        mandateDigest: '0x' + 'bb'.repeat(32), proofDigest: '0x' + 'cc'.repeat(32), proofStatus: 'GROTH16_VERIFIED',
        disclosureBindingDigest: '0x' + '44'.repeat(32), disclosureHistoryRoot: '0x' + '55'.repeat(32),
        disclosureHistorySequence: '3', disclosurePolicyEpoch: '4', disclosureCredentialEpoch: '7',
        disclosureIssuer: issuerWallet.address, disclosureCredentialId: '0x' + '11'.repeat(32),
      } as unknown as ValidatedFinancialAuthorization;
      const record = (patch: Partial<ValidatedFinancialAuthorization>) => store.recordValidated({
        ...base, ...patch, intent: { ...base.intent, ...patch.intent },
      } as ValidatedFinancialAuthorization, timestamp, authorizationRequestDigest({ request: patch.requestId ?? base.requestId, disclosure: patch.disclosureHistoryRoot ?? base.disclosureHistoryRoot }));
      expect(record({}).status).toBe('PRE_GATE_VALIDATED');
      const rollback = record({ requestId: 'disclosure-rollback', disclosureHistorySequence: '2', disclosureHistoryRoot: '0x' + '66'.repeat(32), disclosureBindingDigest: '0x' + '67'.repeat(32), intent: { ...base.intent, nonce: '102' } as never });
      expect(rollback).toMatchObject({ status: 'REJECTED', reason: 'DISCLOSURE_HISTORY_ROLLBACK' });
      const fork = record({ requestId: 'disclosure-fork', disclosureHistorySequence: '3', disclosureHistoryRoot: '0x' + '77'.repeat(32), disclosureBindingDigest: '0x' + '78'.repeat(32), intent: { ...base.intent, nonce: '103' } as never });
      expect(fork).toMatchObject({ status: 'REJECTED', reason: 'DISCLOSURE_HISTORY_FORK' });
      const epochRollback = record({ requestId: 'disclosure-epoch-rollback', disclosureHistorySequence: '4', disclosureHistoryRoot: '0x' + '88'.repeat(32), disclosureBindingDigest: '0x' + '89'.repeat(32), disclosurePolicyEpoch: '3', intent: { ...base.intent, nonce: '104' } as never });
      expect(epochRollback).toMatchObject({ status: 'REJECTED', reason: 'DISCLOSURE_POLICY_ROLLBACK' });
      const advanced = record({ requestId: 'disclosure-next', disclosureHistorySequence: '4', disclosureHistoryRoot: '0x' + '99'.repeat(32), disclosureBindingDigest: '0x' + '9a'.repeat(32), intent: { ...base.intent, nonce: '105' } as never });
      expect(advanced.status).toBe('PRE_GATE_VALIDATED');
      expect(db.prepare('SELECT COUNT(*) AS count FROM financial_authorization_gate_nonces').get()).toMatchObject({ count: 2 });
      expect(store.evidenceChainStatus().valid).toBe(true);
      db.prepare("UPDATE financial_authorization_evidence SET disclosure_history_sequence='0' WHERE evidence_id=?").run(advanced.id);
      expect(store.evidenceChainStatus().valid).toBe(false);
    } finally { db.close(); }
  });

  it('links the market observation digest into the append-only evidence hash', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const store = new FinancialAuthorizationStore(db);
      const base = {
        requestId: 'market-evidence-link', source: 'FIXTURE', provenance: 'IMPORTED_FIXTURE',
        status: 'PRE_GATE_VALIDATED', authorized: false, execution: 'NOT_IMPLEMENTED',
        intent: { chainId: '1439', verifyingContract: '0x00000000000000000000000000000000000001c8', principal: principalWallet.address, nonce: '91' },
        preview: {}, marketRisk: { observationDigest: '0x' + 'ee'.repeat(32) }, intentDigest: '0x' + 'aa'.repeat(32),
        mandateDigest: '0x' + 'bb'.repeat(32), proofDigest: '0x' + 'cc'.repeat(32), proofStatus: 'GROTH16_VERIFIED',
      } as unknown as ValidatedFinancialAuthorization;
      const evidence = store.recordValidated(base, timestamp, authorizationRequestDigest({ request: 'market' }));
      expect(evidence.marketObservationDigest).toBe('0x' + 'ee'.repeat(32));
      expect(store.evidenceChainStatus().valid).toBe(true);
      db.prepare('UPDATE financial_authorization_evidence SET market_observation_digest=? WHERE evidence_id=?').run('0x' + 'ff'.repeat(32), evidence.id);
      expect(store.evidenceChainStatus().valid).toBe(false);
    } finally { db.close(); }
  });

  it('hashes request objects canonically and detects evidence row tampering', () => {
    expect(authorizationRequestDigest({ b: 2, a: { y: 'proof', x: 1 } }))
      .toBe(authorizationRequestDigest({ a: { x: 1, y: 'proof' }, b: 2 }));
    expect(authorizationRequestDigest({ proof: 'one' })).not.toBe(authorizationRequestDigest({ proof: 'two' }));
    const db = new DatabaseSync(':memory:');
    try {
      const store = new FinancialAuthorizationStore(db);
      const evidence = store.recordRejected(rejected('tamper-check', authorizationRequestDigest({ request: 1 })));
      expect(evidence.recordHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(store.evidenceChainStatus()).toMatchObject({ valid: true, headEvidenceId: evidence.id, headHash: evidence.recordHash, legacyUnchainedCount: 0 });
      db.prepare("UPDATE financial_authorization_evidence SET reason='ALTERED' WHERE evidence_id=?").run(evidence.id);
      expect(store.evidenceChainStatus().valid).toBe(false);
      expect(() => store.latest('tamper-check', principalWallet.address)).toThrow('EVIDENCE_CHAIN_INVALID');
    } finally { db.close(); }
  });

  it('preserves legacy rows as explicitly unchained when migrating an old SQLite schema', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE financial_authorization_evidence (
        evidence_id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, principal TEXT NOT NULL,
        status TEXT NOT NULL, reason TEXT, intent_digest TEXT, mandate_digest TEXT, proof_digest TEXT, created_at TEXT NOT NULL
      ) STRICT`);
      db.prepare(`INSERT INTO financial_authorization_evidence (request_id,principal,status,reason,created_at) VALUES (?,?,?,?,?)`)
        .run('legacy', principalWallet.address.toLowerCase(), 'REJECTED', 'OLD', timestamp);
      const store = new FinancialAuthorizationStore(db);
      expect(store.evidenceChainStatus()).toMatchObject({ valid: true, legacyUnchainedCount: 1, headEvidenceId: '0' });
      expect(store.history('legacy', principalWallet.address, null, 10).events[0]).toMatchObject({ recordHash: null, requestDigest: null });
      store.recordRejected(rejected('after-migration', authorizationRequestDigest({ request: 2 })));
      expect(store.evidenceChainStatus()).toMatchObject({ valid: true, legacyUnchainedCount: 1, headEvidenceId: '2' });
    } finally { db.close(); }
  });

  it('rolls back evidence and chain head when durable COMMIT fails', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const store = new FinancialAuthorizationStore(db);
      const exec = db.exec.bind(db);
      Object.defineProperty(db, 'exec', { value: (sql: string) => {
        if (sql === 'COMMIT') throw Error('INJECTED_COMMIT_FAILURE');
        return exec(sql);
      } });
      expect(() => store.recordRejected(rejected('commit-failure', authorizationRequestDigest({ request: 3 }))))
        .toThrow('INJECTED_COMMIT_FAILURE');
      expect(db.prepare('SELECT COUNT(*) AS count FROM financial_authorization_evidence').get()).toMatchObject({ count: 0 });
      expect(store.evidenceChainStatus()).toMatchObject({ valid: true, headEvidenceId: '0', headHash: `0x${'0'.repeat(64)}` });
    } finally { db.close(); }
  });
});
