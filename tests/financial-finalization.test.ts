import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Wallet, toBeHex, zeroPadValue } from 'ethers';
import { canonicalBusinessRequestId, nativeOrderDigest } from '../packages/domain/src/native-order.js';
import { disclosureBindingTypedData, type CurrentDisclosureHistory, type DisclosureBinding } from '../packages/domain/src/disclosure-binding.js';
import { issuerOrderMandateTypedData, parseIssuerOrderMandate } from '../packages/domain/src/order-mandate.js';
import type { AgentPolicy } from '../packages/domain/src/agent-request.js';
import { expectedFinancialAuthorizationPublicSignals, type Groth16ProofEnvelope } from '../services/issuer/src/financial-authorization.js';
import { assembleOwnerReviewPackage, type FinancialFinalizationAdapters } from '../services/issuer/src/financial-finalization.js';
import { SPOT_ORDERBOOKS_V2_METHOD, TESTNET_INDEXER_GRPC_WEB } from '../packages/domain/src/injective-indexer.js';
import type { LiveSnapshot, SpotMarketObservation } from '../packages/domain/src/live-injective.js';
import type { GateManifest, RegisteredGateMandate } from '../packages/domain/src/gate-mandate.js';

const fixture = JSON.parse(readFileSync(process.env.VEREQO_FINANCIAL_AUTH_FIXTURE_PATH ?? 'contracts/test/fixtures/financial-authorization.json', 'utf8')) as {
  issuer: string; principal: string; agent: string; gate: string; requestId: string;
  market: Record<string, unknown>; policy: Record<string, string>;
  mandate: Record<string, unknown>; intent: Record<string, unknown>;
  proof: Groth16ProofEnvelope;
};
const fixedNow = 1_700_000_000;
const privateKey = (n: number) => zeroPadValue(toBeHex(n), 32);
const principal = new Wallet(privateKey(0xA11CE));
const issuer = new Wallet(privateKey(123));
const gateManifest: GateManifest = {
  chainId: '1439', gate: fixture.gate, gateCodeHash: `0x${'dd'.repeat(32)}`,
  issuer: fixture.issuer, principal: fixture.principal,
  verifier: '0x00000000000000000000000000000000000000aa', verifierCodeHash: `0x${'ee'.repeat(32)}`,
};
const market = fixture.market as unknown as SpotMarketObservation;
const policy = fixture.policy as unknown as AgentPolicy;

function snapshot(now: number, stale = false): LiveSnapshot {
  const timestampMs = String((stale ? now - 11 : now) * 1000);
  return {
    status: 'LIVE_READ_ONLY', chainId: '1439', cosmosChainId: 'injective-888',
    blockNumber: '16', blockHash: `0x${'11'.repeat(32)}`, blockTimestamp: `0x${(now - 1).toString(16)}`,
    observedAt: new Date(now * 1000).toISOString(), market,
    marketSource: 'SYNTHETIC_TEST_FIXTURE', rpcSource: 'SYNTHETIC_TEST_FIXTURE', derivativeSource: 'SYNTHETIC_TEST_FIXTURE',
    chainSource: 'SYNTHETIC_TEST_FIXTURE', derivativeMarket: null, spotTopOfBookSource: 'SYNTHETIC_TEST_FIXTURE', spotTopOfBook: null,
    spotOrderbookSource: TESTNET_INDEXER_GRPC_WEB,
    spotOrderbook: {
      marketId: market.marketId, buys: [],
      sells: [{ price: '0.9', quantity: '5000000', timestampMs }],
      sequence: '8', timestampMs, height: '16', fetchedAtMs: timestampMs,
      source: TESTNET_INDEXER_GRPC_WEB + SPOT_ORDERBOOKS_V2_METHOD,
      consistency: 'UNPINNED_INDEXER_REPORT',
    },
    endpointSoftware: { evmClientVersion: 'fixture', tendermintNodeVersion: 'fixture', injectiveAppName: 'fixture', injectiveAppVersion: 'fixture', injectiveGitCommit: 'fixture', cosmosSdkVersion: 'fixture', consistency: 'UNPINNED_ENDPOINT_REPORTS' },
    marketConsistency: 'UNPINNED_LCD_READ', execution: 'NOT_IMPLEMENTED',
  } as unknown as LiveSnapshot;
}

function signedDisclosure(now: number, requestIdHash = canonicalBusinessRequestId(fixture.requestId)) {
  const binding: DisclosureBinding = {
    issuer: fixture.issuer, principal: fixture.principal, agent: fixture.agent,
    credentialId: String(fixture.intent.credentialId), requestIdHash,
    historyRoot: `0x${'57'.repeat(32)}`, historySequence: '0',
    policyEpoch: String(fixture.intent.policyEpoch), credentialEpoch: String(fixture.intent.credentialEpoch),
    issuedAt: String(now), expiresAt: String(Math.min(now + 120, Number(fixture.intent.deadline))),
  };
  const typed = disclosureBindingTypedData(binding, fixture.gate);
  return issuer.signTypedData(typed.domain, typed.types, typed.value).then(signature => ({ binding, signature }));
}

function signedMandate() {
  const typed = issuerOrderMandateTypedData(fixture.mandate);
  return issuer.signTypedData(typed.domain, typed.types, typed.value).then(signature => ({ mandate: fixture.mandate, signature }));
}

function gateState(): RegisteredGateMandate {
  const mandate = parseIssuerOrderMandate(fixture.mandate);
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

function setup(patch: Partial<FinancialFinalizationAdapters> = {}) {
  let currentDisclosure: CurrentDisclosureHistory | null = {
    issuer: fixture.issuer, principal: fixture.principal, agent: fixture.agent,
    credentialId: String(fixture.intent.credentialId), historyRoot: `0x${'57'.repeat(32)}`,
    historySequence: '0', policyEpoch: String(fixture.intent.policyEpoch),
    credentialEpoch: String(fixture.intent.credentialEpoch), active: true,
  };
  let snapshotReads = 0;
  const envelopePromise = signedDisclosure(fixedNow);
  const mandatePromise = signedMandate();
  const proposal = {
    requestId: fixture.requestId, source: 'LIVE_PROVIDER',
    intent: { ...fixture.intent, disclosureRequestId: canonicalBusinessRequestId(fixture.requestId) },
  };
  const base: FinancialFinalizationAdapters = {
    snapshotProvenance: 'SYNTHETIC_TEST_DOUBLE',
    disclosureAnchorProvenance: 'SYNTHETIC_TEST_DOUBLE',
    proofVerifierProvenance: 'SYNTHETIC_TEST_DOUBLE',
    gateStateProvenance: 'SYNTHETIC_TEST_DOUBLE',
    now: () => String(fixedNow),
    readSnapshot: async () => { snapshotReads++; return snapshot(fixedNow); },
    readExchangeQuoteBalance: async (subaccountId, denom) => ({
      status: 'LIVE_READ_ONLY', authorized: false, execution: 'NOT_IMPLEMENTED', subaccountId, denom,
      availableBalanceChain: '1000000000000000000', totalBalanceChain: '1000000000000000000', lockedBalanceChain: '0',
      blockNumber: '16', blockHash: `0x${'11'.repeat(32)}`, observedAt: new Date(fixedNow * 1000).toISOString(),
      source: 'SYNTHETIC_TEST_FIXTURE', consistency: 'UNPINNED_PRECOMPILE_VIEW',
    }),
    admitDisclosure: async request => {
      expect(request.requestIdHash).toBe(canonicalBusinessRequestId(fixture.requestId));
      expect(request.idempotencyKey).toBe(canonicalBusinessRequestId(fixture.requestId));
      return envelopePromise;
    },
    readCurrentDisclosureHistory: async () => currentDisclosure,
    resolveMandate: async () => mandatePromise,
    readGateMandate: async () => gateState(),
    generateProof: async ({ intent, mandate }) => ({
      proof: fixture.proof.proof,
      publicSignals: expectedFinancialAuthorizationPublicSignals(intent, mandate),
    }),
    // Synthetic adapter double: this suite validates orchestration and exact signals,
    // not the Groth16 implementation or a production proving key.
    verifyProof: async (proof, signals) => JSON.stringify(proof) === JSON.stringify(fixture.proof.proof) && signals.length === 10,
    ...patch,
  };
  return {
    proposal,
    currentDisclosure: (value: CurrentDisclosureHistory | null) => { currentDisclosure = value; },
    getSnapshotReads: () => snapshotReads,
    input: {
      requestId: fixture.requestId,
      proposal,
      agent: { sessionPrincipal: principal.address, policy, usedNonces: new Set<string>(), provider: { configured: true, id: 'synthetic-finalization-test' } },
      gateManifest,
      adapters: base,
    },
  };
}

describe('pre-owner financial finalization assembler', () => {
  it('binds one accepted proposal through Disclosure, Intent, Mandate, Proof and current Gate state without owner signature', async () => {
    const test = setup();
    const result = await assembleOwnerReviewPackage(test.input);
    expect(result).toMatchObject({
      requestId: fixture.requestId, source: 'LIVE_PROVIDER', snapshotProvenance: 'SYNTHETIC_TEST_DOUBLE', dataClass: 'SYNTHETIC_TEST_FIXTURE',
      status: 'ASSEMBLED_PRE_GATE_NOT_EXECUTABLE', authorized: false, execution: 'NOT_IMPLEMENTED',
      ownerSignatureRequired: true, ownerSignatureStatus: 'NOT_REQUESTED_NATIVE_RISK_UNVERIFIED',
      productionGateDecision: 'MARKET_RISK_UNVERIFIED', evidenceStatus: 'NOT_RECORDED_PRE_GATE',
      disclosureAnchorProvenance: 'SYNTHETIC_TEST_DOUBLE',
      proofVerifierProvenance: 'SYNTHETIC_TEST_DOUBLE', proofStatus: 'VERIFIER_ADAPTER_ACCEPTED',
      gateStateProvenance: 'SYNTHETIC_TEST_DOUBLE', gateRegistration: 'REGISTERED_MANDATE_MATCHED_BY_ADAPTER',
    });
    expect(result.intent.disclosureRequestId).toBe(result.disclosureBindingDigest);
    expect(result.intentDigest).toBe(nativeOrderDigest(result.intent));
    expect(result.disclosureBinding.binding.requestIdHash).toBe(canonicalBusinessRequestId(fixture.requestId));
    expect(result).not.toHaveProperty('intentSignature');
    expect(result.marketRisk.status).toBe('CLEAR_FOR_REVIEW');
    expect(result.exchangeQuoteBalancePreflight).toMatchObject({
      status: 'SUFFICIENT_FOR_REVIEW', trust: 'UNPINNED_PRECOMPILE_VIEW', atomicExecutionGuarantee: false,
    });
    expect(test.getSnapshotReads()).toBe(2);
  });

  it('rejects insufficient native Exchange quote balance before admitting disclosure', async () => {
    let admissions = 0;
    const test = setup({
      readExchangeQuoteBalance: async (subaccountId, denom) => ({
        status: 'LIVE_READ_ONLY', authorized: false, execution: 'NOT_IMPLEMENTED', subaccountId, denom,
        availableBalanceChain: '0', totalBalanceChain: '0', lockedBalanceChain: '0',
        blockNumber: '16', blockHash: `0x${'11'.repeat(32)}`, observedAt: new Date(fixedNow * 1000).toISOString(),
        source: 'SYNTHETIC_TEST_FIXTURE', consistency: 'UNPINNED_PRECOMPILE_VIEW',
      }),
      admitDisclosure: async () => { admissions++; return signedDisclosure(fixedNow); },
    });
    await expect(assembleOwnerReviewPackage(test.input)).rejects.toMatchObject({ code: 'INSUFFICIENT_EXCHANGE_QUOTE_BALANCE' });
    expect(admissions).toBe(0);
  });

  it('rechecks Exchange quote balance after proof generation and rejects a depleted balance', async () => {
    let reads = 0;
    const test = setup({ readExchangeQuoteBalance: async (subaccountId, denom) => {
      reads++;
      const amount = reads === 1 ? '1000000000000000000' : '0';
      return {
        status: 'LIVE_READ_ONLY', authorized: false, execution: 'NOT_IMPLEMENTED', subaccountId, denom,
        availableBalanceChain: amount, totalBalanceChain: amount, lockedBalanceChain: '0',
        blockNumber: String(15 + reads), blockHash: `0x${String(15 + reads).padStart(64, '0')}`,
        observedAt: new Date(fixedNow * 1000).toISOString(), source: 'SYNTHETIC_TEST_FIXTURE', consistency: 'UNPINNED_PRECOMPILE_VIEW',
      };
    } });
    await expect(assembleOwnerReviewPackage(test.input)).rejects.toMatchObject({ code: 'INSUFFICIENT_EXCHANGE_QUOTE_BALANCE' });
    expect(reads).toBe(2);
  });

  it('rejects a stale native Exchange balance observation', async () => {
    const test = setup({ readExchangeQuoteBalance: async (subaccountId, denom) => ({
      status: 'LIVE_READ_ONLY', authorized: false, execution: 'NOT_IMPLEMENTED', subaccountId, denom,
      availableBalanceChain: '1000000000000000000', totalBalanceChain: '1000000000000000000', lockedBalanceChain: '0',
      blockNumber: '16', blockHash: `0x${'11'.repeat(32)}`, observedAt: new Date((fixedNow - 11) * 1000).toISOString(),
      source: 'SYNTHETIC_TEST_FIXTURE', consistency: 'UNPINNED_PRECOMPILE_VIEW',
    }) });
    await expect(assembleOwnerReviewPackage(test.input)).rejects.toMatchObject({ code: 'EXCHANGE_QUOTE_BALANCE_STALE' });
  });

  it('rejects a Disclosure signature bound to another Business Request before proof generation', async () => {
    const wrongEnvelope = await signedDisclosure(fixedNow, `0x${'99'.repeat(32)}`);
    let proofs = 0;
    const test = setup({ admitDisclosure: async () => wrongEnvelope, generateProof: async () => { proofs++; throw Error(); } });
    await expect(assembleOwnerReviewPackage(test.input)).rejects.toMatchObject({ code: 'DISCLOSURE_REQUEST_ID_MISMATCH' });
    expect(proofs).toBe(0);
  });

  it('rejects an unavailable or stale independent Disclosure head before proof generation', async () => {
    let proofs = 0;
    const test = setup({
      readCurrentDisclosureHistory: async () => null,
      generateProof: async () => { proofs++; throw Error(); },
    });
    await expect(assembleOwnerReviewPackage(test.input)).rejects.toMatchObject({ code: 'DISCLOSURE_HISTORY_UNAVAILABLE' });
    expect(proofs).toBe(0);
  });

  it('rejects stale market state after proof generation and refuses tampered public signals', async () => {
    const stale = setup({ readSnapshot: async () => snapshot(fixedNow, true) });
    await expect(assembleOwnerReviewPackage(stale.input)).rejects.toMatchObject({ code: 'MARKET_RISK_UNVERIFIED' });

    const wrongSignals = setup({ generateProof: async ({ intent, mandate }) => ({
      proof: fixture.proof.proof,
      publicSignals: ['999', ...expectedFinancialAuthorizationPublicSignals(intent, mandate).slice(1)],
    }) });
    await expect(assembleOwnerReviewPackage(wrongSignals.input)).rejects.toMatchObject({ code: 'PROOF_INTENT_MISMATCH' });
  });

  it('requires a configured owner session and live provider even when adapters exist', async () => {
    const test = setup();
    const input = { ...test.input, agent: { ...test.input.agent, sessionPrincipal: null } };
    await expect(assembleOwnerReviewPackage(input)).rejects.toMatchObject({ code: 'OWNER_SESSION_OR_PROVIDER_REQUIRED' });
  });

  it('stops at the session boundary before irreversible disclosure admission when the wallet session expires', async () => {
    let checks = 0, admissions = 0;
    const test = setup({
      assertSessionCurrent: () => { checks++; if (checks === 4) throw Error('session expired'); },
      admitDisclosure: async () => { admissions++; return signedDisclosure(fixedNow); },
    });
    await expect(assembleOwnerReviewPackage(test.input)).rejects.toMatchObject({ code: 'WALLET_SESSION_INVALIDATED' });
    expect(admissions).toBe(0);
  });
});
