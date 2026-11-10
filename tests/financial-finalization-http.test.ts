import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinancialObjectTracePanel, type FinancialObjectTrace } from '../apps/web/src/components/FinancialObjectTrace.js';
import { parseFinancialFinalizationHistory } from '../apps/web/src/finalizationEvidence.js';
import { decimalToApi18, nativeOrderDigest } from '../packages/domain/src/native-order.js';
import { afterEach, describe, expect, it } from 'vitest';
import { Wallet, toBeHex, zeroPadValue } from 'ethers';
import { readFileSync, writeFileSync } from 'node:fs';
import { createLocalApp } from '../services/issuer/src/http.js';
import { canonicalBusinessRequestId } from '../packages/domain/src/native-order.js';
import { disclosureBindingTypedData, type CurrentDisclosureHistory, type DisclosureBinding } from '../packages/domain/src/disclosure-binding.js';
import { issuerOrderMandateTypedData, parseIssuerOrderMandate } from '../packages/domain/src/order-mandate.js';
import { expectedFinancialAuthorizationPublicSignals, type Groth16ProofEnvelope } from '../services/issuer/src/financial-authorization.js';
import { SPOT_ORDERBOOKS_V2_METHOD, TESTNET_INDEXER_GRPC_WEB } from '../packages/domain/src/injective-indexer.js';
import type { AgentPolicy } from '../packages/domain/src/agent-request.js';
import type { LiveSnapshot, SpotMarketObservation } from '../packages/domain/src/live-injective.js';
import type { GateManifest, RegisteredGateMandate } from '../packages/domain/src/gate-mandate.js';
import type { AgentProposalRuntimeContext } from '../services/issuer/src/agent-runtime.js';

const fixture = JSON.parse(readFileSync(process.env.VEREQO_FINANCIAL_AUTH_FIXTURE_PATH ?? 'contracts/test/fixtures/financial-authorization.json', 'utf8')) as {
  issuer: string; principal: string; agent: string; gate: string; requestId: string;
  market: Record<string, unknown>; policy: Record<string, string>; mandate: Record<string, unknown>;
  intent: Record<string, unknown>; proof: Groth16ProofEnvelope;
};
const fixedNow = 1_700_000_000;
const principal = new Wallet(zeroPadValue(toBeHex(0xA11CE), 32));
const issuer = new Wallet(zeroPadValue(toBeHex(123), 32));
const market = fixture.market as unknown as SpotMarketObservation;
const policy = fixture.policy as unknown as AgentPolicy;
const gateManifest: GateManifest = {
  chainId: '1439', gate: fixture.gate, gateCodeHash: `0x${'dd'.repeat(32)}`,
  issuer: fixture.issuer, principal: fixture.principal,
  verifier: '0x00000000000000000000000000000000000000aa', verifierCodeHash: `0x${'ee'.repeat(32)}`,
};
const snapshots = (): LiveSnapshot => {
  const timestampMs = String(fixedNow * 1000);
  return {
    status: 'LIVE_READ_ONLY', chainId: '1439', cosmosChainId: 'injective-888', blockNumber: '16',
    blockHash: `0x${'11'.repeat(32)}`, blockTimestamp: `0x${(fixedNow - 1).toString(16)}`,
    observedAt: new Date(fixedNow * 1000).toISOString(), market,
    marketSource: 'SYNTHETIC_TEST_FIXTURE', rpcSource: 'SYNTHETIC_TEST_FIXTURE', derivativeSource: 'SYNTHETIC_TEST_FIXTURE',
    chainSource: 'SYNTHETIC_TEST_FIXTURE', derivativeMarket: null, spotTopOfBookSource: 'SYNTHETIC_TEST_FIXTURE', spotTopOfBook: null,
    spotOrderbookSource: TESTNET_INDEXER_GRPC_WEB,
    spotOrderbook: { marketId: market.marketId, buys: [], sells: [{ price: '0.9', quantity: '5000000', timestampMs }], sequence: '8', timestampMs, height: '16', fetchedAtMs: timestampMs, source: TESTNET_INDEXER_GRPC_WEB + SPOT_ORDERBOOKS_V2_METHOD, consistency: 'UNPINNED_INDEXER_REPORT' },
    endpointSoftware: { evmClientVersion: 'fixture', tendermintNodeVersion: 'fixture', injectiveAppName: 'fixture', injectiveAppVersion: 'fixture', injectiveGitCommit: 'fixture', cosmosSdkVersion: 'fixture', consistency: 'UNPINNED_ENDPOINT_REPORTS' },
    marketConsistency: 'UNPINNED_LCD_READ', execution: 'NOT_IMPLEMENTED',
  };
};

function signedDisclosure(requestId: string) {
  const source = fixture.intent;
  const binding: DisclosureBinding = {
    issuer: fixture.issuer, principal: fixture.principal, agent: fixture.agent,
    credentialId: String(source.credentialId), requestIdHash: canonicalBusinessRequestId(requestId),
    historyRoot: `0x${'57'.repeat(32)}`, historySequence: '0', policyEpoch: String(source.policyEpoch),
    credentialEpoch: String(source.credentialEpoch), issuedAt: String(fixedNow),
    expiresAt: String(Math.min(fixedNow + 120, Number(source.deadline))),
  };
  const typed = disclosureBindingTypedData(binding, fixture.gate);
  return issuer.signTypedData(typed.domain, typed.types, typed.value).then(signature => ({ binding, signature }));
}

function signedMandate() {
  const typed = issuerOrderMandateTypedData(fixture.mandate);
  return issuer.signTypedData(typed.domain, typed.types, typed.value).then(signature => ({ mandate: fixture.mandate, signature }));
}

function gateState(): RegisteredGateMandate {
  const m = parseIssuerOrderMandate(fixture.mandate);
  return {
    ...gateManifest, storedVerifierCodeHash: gateManifest.verifierCodeHash, policyEpoch: m.policyEpoch,
    credentialId: m.credentialId, commitment: m.commitment, agent: m.agent, credentialEpoch: m.credentialEpoch,
    expiry: m.expiry, cap: m.cap, spent: '0', marketId: m.marketId, subaccountId: m.subaccountId,
    marketConfigHash: m.marketConfigHash, priceTick: m.priceTick, quantityTick: m.quantityTick,
    maxFeeRate: m.maxFeeRate, active: m.active, blockNumber: 16, blockHash: `0x${'11'.repeat(32)}`,
  };
}

const apps: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of apps.splice(0).reverse()) await close(); });

async function open(options: { readonly casConflict?: boolean; readonly expireSessionDuringDisclosure?: boolean; readonly modelCandidate?: { requestId: string; order: { price: string; quantity: string } } } = {}) {
  const now = () => fixedNow;
  const requestId = options.modelCandidate?.requestId ?? fixture.requestId;
  let session = '';
  let currentDisclosure: CurrentDisclosureHistory = {
    issuer: fixture.issuer, principal: fixture.principal, agent: fixture.agent,
    credentialId: String(fixture.intent.credentialId), historyRoot: `0x${'57'.repeat(32)}`,
    historySequence: '0', policyEpoch: String(fixture.intent.policyEpoch), credentialEpoch: String(fixture.intent.credentialEpoch), active: true,
  };
  const mandate = await signedMandate();
  const disclosure = await signedDisclosure(requestId);
  const proof = async (input: { readonly intent: import('../packages/domain/src/native-order.js').NativeOrderIntent; readonly mandate: import('../packages/domain/src/order-mandate.js').IssuerOrderMandate }) => ({
    proof: fixture.proof.proof, publicSignals: expectedFinancialAuthorizationPublicSignals(input.intent, input.mandate),
  });
  const readSnapshot = async () => {
    const value = snapshots();
    return options.modelCandidate ? { ...value, spotOrderbook: { ...value.spotOrderbook!, sells: [{ ...value.spotOrderbook!.sells[0]!, price: options.modelCandidate.order.price }] } } : value;
  };
  const balance = async (subaccountId: string, denom: string) => ({
    status: 'LIVE_READ_ONLY' as const, authorized: false as const, execution: 'NOT_IMPLEMENTED' as const,
    subaccountId, denom, availableBalanceChain: '1000000000000000000000000',
    totalBalanceChain: '1000000000000000000000000', lockedBalanceChain: '0', blockNumber: '16',
    blockHash: `0x${'11'.repeat(32)}`, observedAt: new Date(fixedNow * 1000).toISOString(),
    source: 'SYNTHETIC_TEST_FIXTURE', consistency: 'UNPINNED_PRECOMPILE_VIEW' as const,
  });
  const app = createLocalApp({
    databasePath: ':memory:', agentPolicy: policy, nowSeconds: now,
    agentProvider: { configured: true, id: 'synthetic-http-test' },
    agentRuntime: { generateProposal: async (context: AgentProposalRuntimeContext) => ({
      requestId: context.requestId, source: 'LIVE_PROVIDER', intent: options.modelCandidate ? { ...fixture.intent, disclosureRequestId: canonicalBusinessRequestId(context.requestId), price: decimalToApi18(options.modelCandidate.order.price), quantity: decimalToApi18(options.modelCandidate.order.quantity) } : fixture.intent,
    }) },
    injective: { snapshot: readSnapshot, exchangeSubaccountDeposit: balance } as never,
    financialAuthorization: {
      currentMandate: () => mandate, gateManifest, readGateMandate: async () => gateState(),
      readCurrentDisclosureHistory: async () => currentDisclosure,
      verifyProof: async (_value, signals) => signals.length === 10,
    },
    financialFinalization: {
      snapshotProvenance: 'SYNTHETIC_TEST_DOUBLE', disclosureAnchorProvenance: 'SYNTHETIC_TEST_DOUBLE',
      proofVerifierProvenance: 'SYNTHETIC_TEST_DOUBLE', gateStateProvenance: 'SYNTHETIC_TEST_DOUBLE',
      admitDisclosure: async () => {
        if (options.expireSessionDuringDisclosure) await post('/api/wallet/logout', {}, session);
        if (options.casConflict) throw Error('synthetic CAS conflict');
        return disclosure;
      },
      generateProof: proof,
    },
  });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (!address || typeof address === 'string') throw Error('NO_TEST_LISTENER');
  const base = `http://127.0.0.1:${address.port}`;
  async function post(path: string, body: unknown, token = session) {
    return fetch(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...(token ? { 'x-vereqo-session': token } : {}) }, body: JSON.stringify(body) });
  }
  async function request(path: string, token = session) {
    return fetch(`${base}${path}`, { headers: { origin: base, ...(token ? { 'x-vereqo-session': token } : {}) } });
  }
  const challengeResponse = await post('/api/wallet/challenge', { address: principal.address });
  const { challenge } = await challengeResponse.json() as { challenge: { domain: never; types: never; value: Record<string, unknown> } };
  const signature = await principal.signTypedData(challenge.domain, challenge.types, challenge.value);
  const verifyResponse = await post('/api/wallet/verify', { nonce: challenge.value.nonce, signature });
  if (!verifyResponse.ok) throw Error('SYNTHETIC_WALLET_VERIFY_FAILED');
  session = (await verifyResponse.json() as { session: string }).session;
  apps.push(() => app.close());
  return { post, request, base, session, requestId, objective: 'review one bounded synthetic test proposal', setDisclosure(value: CurrentDisclosureHistory) { currentDisclosure = value; } };
}

describe('financial finalization API to digest Evidence (synthetic adapters)', () => {
  it('carries the recorded real phi proposal through one Request; downstream adapters remain synthetic', async () => {
    // Replay of a genuine inference artifact, not a new live model call in this test.
    const artifact = JSON.parse(readFileSync('docs/evidence/critical-engineering-2026-11-10/agent-model-output.json', 'utf8'));
    expect(artifact.evidenceClass).toBe('REAL_MODEL_ON_SYNTHETIC_INPUT');
    expect(artifact.metadata).toMatchObject({ http: 200, done: true });
    const app = await open({ modelCandidate: artifact.proposal });
    const body = { requestId: app.requestId, objective: artifact.scenario.objective };
    const run = await app.post('/api/agent/run', body);
    expect(run.status).toBe(200);
    const proposed = await run.json() as { proposal: { intent: Record<string, string> } };
    expect(proposed.proposal.intent).toMatchObject({ price: decimalToApi18(artifact.proposal.order.price), quantity: decimalToApi18(artifact.proposal.order.quantity) });
    const result = await app.post('/api/agent/finalize', body);
    expect(result.status).toBe(200);
    const assembled = await result.json();
    expect(assembled).toMatchObject({ status: 'OWNER_SIGNATURE_REQUIRED', authorized: false, execution: 'NOT_IMPLEMENTED' });
    expect(assembled.reviewPackage).toMatchObject({ requestId: artifact.proposal.requestId, dataClass: 'SYNTHETIC_TEST_FIXTURE', snapshotProvenance: 'SYNTHETIC_TEST_DOUBLE', proofVerifierProvenance: 'SYNTHETIC_TEST_DOUBLE' });
    expect(assembled.reviewPackage.intentDigest).toBe(nativeOrderDigest(assembled.reviewPackage.intent));
    expect(assembled.evidence.intentDigest).toBe(assembled.reviewPackage.intentDigest);
    const response = await app.request(`/api/agent/finalization/${app.requestId}`);
    expect(response.status).toBe(200);
    const history = parseFinancialFinalizationHistory(await response.json(), app.requestId, principal.address);
    expect(history.evidence.recordHash).toBe(assembled.evidence.recordHash);
    const trace: FinancialObjectTrace = { requestId: app.requestId, revision: 1, marketKind: 'SPOT', marketId: market.marketId, marketStatus: 'UNKNOWN', blockNumber: null, observedAt: null, side: 'BUY', price: artifact.proposal.order.price, quantity: artifact.proposal.order.quantity, draftStatus: 'UNSIGNED_DRAFT', evidenceState: 'NOT_REQUESTED', evidenceId: null, evidenceStatus: null, evidenceReason: null, intentDigest: history.evidence.intentDigest, evidenceHash: null, evidenceEventCount: 0, hypotheticalCredentialRevocation: false, requestSource: 'SYNTHETIC_REHEARSAL', finalizationEvidenceState: 'AVAILABLE', finalizationEvidenceId: history.evidence.id, finalizationEvidenceStatus: history.evidence.status, finalizationOwnerSignatureStatus: history.evidence.ownerSignatureStatus, finalizationEvidenceHash: history.evidence.recordHash, finalizationProofDigest: history.evidence.proofDigest };
    for (const surface of ['INSTRUMENT', 'CONSEQUENCE', 'EVIDENCE'] as const) {
      const html = renderToStaticMarkup(createElement(FinancialObjectTracePanel, { trace, surface, language: 'en' }));
      expect(html).toContain(app.requestId);
      expect(html).toContain('OWNER SIGNATURE REQUIRED');
      expect(html).toContain('NOT_APPROVED');
      if (surface === 'EVIDENCE') {
        expect(html).toContain(history.evidence.recordHash);
        expect(html).toContain(history.evidence.proofDigest);
        expect(html).toContain('NOT_IMPLEMENTED');
      }
    }
    expect((await app.request(`/api/agent/finalization/${app.requestId}`, '')).status).toBe(401);
    if (process.env.VEREQO_CRITICAL_TRACE_EVIDENCE) {
      writeFileSync(process.env.VEREQO_CRITICAL_TRACE_EVIDENCE, JSON.stringify({
        evidenceClass: 'REAL_MODEL_ARTIFACT_WITH_SYNTHETIC_DOWNSTREAM',
        requestId: app.requestId, modelResponseSha256: artifact.metadata.responseSha256,
        generatedOrder: artifact.proposal.order,
        normalizedIntentDigest: assembled.reviewPackage.intentDigest,
        disclosureBindingDigest: history.evidence.disclosureBindingDigest,
        mandateDigest: history.evidence.mandateDigest, proofDigest: history.evidence.proofDigest,
        requestDigest: history.evidence.requestDigest, recordHash: history.evidence.recordHash,
        retrievalMatchedSavedRecord: true,
        controlDeckVerification: 'SSR_OF_EXISTING_INSTRUMENT_CONSEQUENCE_EVIDENCE_COMPONENTS_NOT_BROWSER_QA',
        ownerSignatureStatus: history.evidence.ownerSignatureStatus,
        authorized: false, execution: 'NOT_IMPLEMENTED',
        syntheticAdapters: ['Identity and market mapping', 'Wallet test authentication', 'Issuer', 'Gate state', 'Disclosure Anchor', 'Proof generation and verification'],
        realGroth16Claimed: false, realIssuerClaimed: false, realAnchorClaimed: false,
      }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }

  });

  it('assembles and persists one Request as owner-signature-pending, then retrieves it owner-scoped', async () => {
    const app = await open();
    const body = { requestId: app.requestId, objective: app.objective };
    const run = await app.post('/api/agent/run', body, app.session);
    expect(run.status).toBe(200);
    expect(await run.json()).toMatchObject({ requestId: app.requestId, status: 'PROPOSAL_READY', authorized: false, execution: 'NOT_IMPLEMENTED' });
    const assembled = await app.post('/api/agent/finalize', body, app.session);
    expect(assembled.status).toBe(200);
    const first = await assembled.json() as Record<string, unknown>;
    expect(first).toMatchObject({ status: 'OWNER_SIGNATURE_REQUIRED', ownerSignatureStatus: 'REQUIRED', authorized: false, execution: 'NOT_IMPLEMENTED', ownerAction: 'REVIEW_AND_SIGN_SEPARATELY' });
    expect(first.reviewPackage).toMatchObject({ requestId: app.requestId, status: 'ASSEMBLED_PRE_GATE_NOT_EXECUTABLE', authorized: false, ownerSignatureRequired: true, evidenceStatus: 'NOT_RECORDED_PRE_GATE' });
    const evidence = first.evidence as Record<string, unknown>;
    expect(evidence).toMatchObject({ requestId: app.requestId, status: 'OWNER_SIGNATURE_REQUIRED', ownerSignatureStatus: 'REQUIRED', execution: 'NOT_IMPLEMENTED' });
    expect(evidence).not.toHaveProperty('proof');
    expect(evidence).not.toHaveProperty('mandateSignature');
    const retried = await app.post('/api/agent/finalize', body, app.session);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ status: 'OWNER_SIGNATURE_REQUIRED', evidence: { id: evidence.id, requestDigest: evidence.requestDigest } });
    const history = await app.request(`/api/agent/finalization/${app.requestId}`, app.session);
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ evidence: { id: evidence.id, requestId: app.requestId, status: 'OWNER_SIGNATURE_REQUIRED' }, events: [{ id: evidence.id, ownerSignatureStatus: 'REQUIRED' }] });
    const unauthenticated = await app.request(`/api/agent/finalization/${app.requestId}`, '');
    expect(unauthenticated.status).toBe(401);
  });

  it('records Disclosure CAS conflict as rejected evidence without requesting owner signature', async () => {
    const app = await open({ casConflict: true });
    const body = { requestId: app.requestId, objective: app.objective };
    expect((await app.post('/api/agent/run', body, app.session)).status).toBe(200);
    const failed = await app.post('/api/agent/finalize', body, app.session);
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ status: 'REJECTED', reason: 'DISCLOSURE_ADMISSION_OR_ANCHOR_CAS_FAILED', ownerSignatureStatus: 'NOT_REQUESTED', authorized: false, execution: 'NOT_IMPLEMENTED' });
  });

  it('does not return or store a review package if the owner session expires during Disclosure admission', async () => {
    const app = await open({ expireSessionDuringDisclosure: true });
    const body = { requestId: app.requestId, objective: app.objective };
    expect((await app.post('/api/agent/run', body, app.session)).status).toBe(200);
    const response = await app.post('/api/agent/finalize', body, app.session);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: 'REJECTED', reason: 'WALLET_SESSION_INVALIDATED', ownerSignatureStatus: 'NOT_REQUESTED', authorized: false, execution: 'NOT_IMPLEMENTED' });
  });
});
