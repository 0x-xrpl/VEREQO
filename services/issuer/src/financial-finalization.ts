import { keccak256, toUtf8Bytes } from 'ethers';
import { acceptAgentProposal, type AgentPolicy, type AgentRequestContext } from '../../../packages/domain/src/agent-request.js';
import {
  canonicalBusinessRequestId,
  nativeOrderDigest,
  nativeOrderExposure,
  parseNativeOrderIntent,
  type NativeOrderIntent,
} from '../../../packages/domain/src/native-order.js';
import {
  verifyDisclosureBinding,
  type CurrentDisclosureHistory,
  type DisclosureBinding,
  type DisclosureBindingEnvelope,
} from '../../../packages/domain/src/disclosure-binding.js';
import {
  issuerOrderMandateDigest,
  parseIssuerOrderMandate,
  verifyIssuerOrderMandate,
  type IssuerOrderMandate,
} from '../../../packages/domain/src/order-mandate.js';
import {
  assertRegisteredGateMandate,
  type GateManifest,
  type RegisteredGateMandate,
} from '../../../packages/domain/src/gate-mandate.js';
import { scaleChainDecimal, type LiveSnapshot } from '../../../packages/domain/src/live-injective.js';
import {
  assertCurrentDisclosureHistory,
  assertFinancialMandateBindsIntent,
  expectedFinancialAuthorizationPublicSignals,
  parseGroth16ProofEnvelope,
  type CurrentIssuerMandate,
  type Groth16ProofEnvelope,
} from './financial-authorization.js';

const REQUEST_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const UINT = /^(0|[1-9][0-9]{0,19})$/;
const UINT256_MAX = (1n << 256n) - 1n;

export class FinancialFinalizationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export interface FinancialFinalizationAgentContext {
  readonly sessionPrincipal: AgentRequestContext['sessionPrincipal'];
  readonly policy: AgentPolicy;
  readonly usedNonces: AgentRequestContext['usedNonces'];
  readonly provider: AgentRequestContext['provider'];
}

export interface DisclosureAdmissionRequest {
  readonly requestId: string;
  /** Stable across retries; the operator's independent Anchor must enforce CAS on it. */
  readonly idempotencyKey: string;
  readonly requestIdHash: string;
  readonly draftIntent: NativeOrderIntent;
  readonly draftIntentDigest: string;
  readonly notAfter: string;
}

/** Read-only Injective Exchange precompile result. This is an unpinned preflight, not an execution guarantee. */
export interface ExchangeQuoteBalanceObservation {
  readonly status: 'LIVE_READ_ONLY';
  readonly authorized: false;
  readonly execution: 'NOT_IMPLEMENTED';
  readonly subaccountId: string;
  readonly denom: string;
  readonly availableBalanceChain: string;
  readonly totalBalanceChain: string;
  readonly lockedBalanceChain: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly observedAt: string;
  readonly source: string;
  readonly consistency: 'UNPINNED_PRECOMPILE_VIEW';
}

/**
 * Operator-owned adapters for the pre-owner-signature assembly path. `admitDisclosure`
 * must durably admit the disclosure and advance an independent Anchor with CAS before
 * returning its Issuer signature. `resolveMandate` must read an already-issued mandate;
 * it must not silently grant or register one. No adapter receives a Wallet token or key.
 */
export interface FinancialFinalizationAdapters {
  readonly snapshotProvenance: 'LIVE_INJECTIVE_READ_ADAPTER' | 'SYNTHETIC_TEST_DOUBLE';
  readonly disclosureAnchorProvenance: 'INDEPENDENT_TRUSTED_ANCHOR_CAS' | 'SYNTHETIC_TEST_DOUBLE';
  readonly proofVerifierProvenance: 'TRUSTED_PINNED_GROTH16' | 'LOCAL_UNTRUSTED_GROTH16' | 'SYNTHETIC_TEST_DOUBLE';
  readonly gateStateProvenance: 'READ_ONLY_EVM_RPC' | 'SYNTHETIC_TEST_DOUBLE';
  readonly now: () => string;
  /** Revalidates the caller's owner session after each asynchronous boundary. */
  readonly assertSessionCurrent?: () => void;
  readonly readSnapshot: () => Promise<LiveSnapshot>;
  readonly readExchangeQuoteBalance: (subaccountId: string, denom: string) => Promise<ExchangeQuoteBalanceObservation>;
  readonly admitDisclosure: (request: DisclosureAdmissionRequest) => Promise<DisclosureBindingEnvelope>;
  readonly readCurrentDisclosureHistory: (binding: DisclosureBinding) => Promise<CurrentDisclosureHistory | null>;
  readonly resolveMandate: (intent: NativeOrderIntent) => Promise<CurrentIssuerMandate | null>;
  readonly readGateMandate: (credentialId: string) => Promise<RegisteredGateMandate>;
  readonly generateProof: (input: {
    readonly requestId: string;
    readonly intent: NativeOrderIntent;
    readonly mandate: IssuerOrderMandate;
    readonly disclosureBinding: DisclosureBindingEnvelope;
  }) => Promise<Groth16ProofEnvelope>;
  readonly verifyProof: (proof: Groth16ProofEnvelope['proof'], publicSignals: readonly string[]) => Promise<boolean>;
}

/** Operator configuration required for the API assembly route. Network readers and
 * current Gate/Issuer readers are composed from the existing authorization adapters. */
export type FinancialFinalizationConfiguredServices = Pick<FinancialFinalizationAdapters,
  'snapshotProvenance' | 'disclosureAnchorProvenance' | 'proofVerifierProvenance' | 'gateStateProvenance' |
  'admitDisclosure' | 'generateProof'>;

export interface OwnerReviewPackage {
  readonly requestId: string;
  readonly source: 'LIVE_PROVIDER';
  readonly provenance: 'PROVIDER_DECLARED_NOT_AUTONOMY_VERIFIED';
  readonly snapshotProvenance: FinancialFinalizationAdapters['snapshotProvenance'];
  readonly dataClass: 'LIVE_READ_ONLY_TESTNET_OBSERVATION' | 'SYNTHETIC_TEST_FIXTURE';
  readonly status: 'ASSEMBLED_PRE_GATE_NOT_EXECUTABLE';
  readonly authorized: false;
  readonly execution: 'NOT_IMPLEMENTED';
  readonly ownerSignatureRequired: true;
  readonly ownerSignatureStatus: 'NOT_REQUESTED_NATIVE_RISK_UNVERIFIED';
  readonly intent: NativeOrderIntent;
  readonly intentDigest: string;
  readonly exchangeQuoteBalancePreflight: {
    readonly status: 'SUFFICIENT_FOR_REVIEW';
    readonly availableBalanceApi18: string;
    readonly requiredExposureApi18: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly observedAt: string;
    readonly trust: 'UNPINNED_PRECOMPILE_VIEW';
    readonly atomicExecutionGuarantee: false;
  };
  readonly disclosureBinding: DisclosureBindingEnvelope;
  readonly disclosureBindingDigest: string;
  readonly mandate: IssuerOrderMandate;
  readonly mandateSignature: string;
  readonly mandateDigest: string;
  readonly proof: Groth16ProofEnvelope;
  readonly proofDigest: string;
  readonly disclosureAnchorProvenance: FinancialFinalizationAdapters['disclosureAnchorProvenance'];
  readonly proofVerifierProvenance: FinancialFinalizationAdapters['proofVerifierProvenance'];
  readonly proofStatus: 'VERIFIER_ADAPTER_ACCEPTED';
  readonly marketRisk: ReturnType<typeof acceptAgentProposal>['marketRisk'];
  readonly gateStateProvenance: FinancialFinalizationAdapters['gateStateProvenance'];
  readonly gateRegistration: 'REGISTERED_MANDATE_MATCHED_BY_ADAPTER';
  readonly productionGateDecision: 'MARKET_RISK_UNVERIFIED';
  readonly evidenceStatus: 'NOT_RECORDED_PRE_GATE';
}

function fail(code: string): never { throw new FinancialFinalizationError(code); }
function assertSessionCurrent(adapters: FinancialFinalizationAdapters): void {
  try { adapters.assertSessionCurrent?.(); }
  catch { fail('WALLET_SESSION_INVALIDATED'); }
}

function readDraft(proposal: unknown, expectedRequestId: string): {
  readonly requestId: string;
  readonly source: 'LIVE_PROVIDER';
  readonly intent: unknown;
} {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return fail('AGENT_PROPOSAL_REQUIRED');
  const fields = Object.getOwnPropertyDescriptors(proposal);
  const requestId = fields.requestId && Object.hasOwn(fields.requestId, 'value') ? fields.requestId.value : undefined;
  const source = fields.source && Object.hasOwn(fields.source, 'value') ? fields.source.value : undefined;
  const intent = fields.intent && Object.hasOwn(fields.intent, 'value') ? fields.intent.value : undefined;
  if (requestId !== expectedRequestId || !REQUEST_ID.test(expectedRequestId) || source !== 'LIVE_PROVIDER') return fail('AGENT_PROPOSAL_BINDING_MISMATCH');
  return { requestId: expectedRequestId, source, intent };
}

function nowSeconds(adapters: FinancialFinalizationAdapters): bigint {
  const value = adapters.now();
  if (typeof value !== 'string' || !UINT.test(value)) return fail('FINALIZATION_CLOCK_INVALID');
  return BigInt(value);
}

function sameDisclosure(binding: DisclosureBinding, current: CurrentDisclosureHistory | null): void {
  try { assertCurrentDisclosureHistory(binding, current); }
  catch (error) {
    const code = error instanceof Error ? error.message : '';
    fail(/^(?:DISCLOSURE_[A-Z0-9_]{1,80})$/.test(code) ? code : 'DISCLOSURE_HISTORY_UNAVAILABLE');
  }
}

function assertLiveMandate(envelope: CurrentIssuerMandate | null, intent: NativeOrderIntent, now: bigint): {
  readonly mandate: IssuerOrderMandate;
  readonly signature: string;
  readonly digest: string;
} {
  if (!envelope) return fail('ISSUER_MANDATE_NOT_CONFIGURED');
  let mandate: IssuerOrderMandate;
  try { mandate = parseIssuerOrderMandate(envelope.mandate); }
  catch { return fail('ISSUER_MANDATE_INVALID'); }
  if (!verifyIssuerOrderMandate(mandate, envelope.signature)) return fail('ISSUER_MANDATE_SIGNATURE_INVALID');
  if (!mandate.active) return fail('ISSUER_MANDATE_REVOKED');
  try { assertFinancialMandateBindsIntent(intent, mandate); }
  catch (error) {
    const code = error instanceof Error ? error.message : '';
    fail(/^(?:MANDATE_[A-Z0-9_]{1,80})$/.test(code) ? code : 'ISSUER_MANDATE_INTENT_MISMATCH');
  }
  if (BigInt(mandate.expiry) <= now) return fail('ISSUER_MANDATE_EXPIRED');
  return { mandate, signature: envelope.signature, digest: issuerOrderMandateDigest(mandate) };
}

function validateAgainstSnapshot(
  draft: { readonly requestId: string; readonly source: 'LIVE_PROVIDER' },
  intent: unknown,
  expectedDisclosureRequestId: string,
  base: FinancialFinalizationAgentContext,
  snapshot: LiveSnapshot,
  now: string,
) {
  try {
    const accepted = acceptAgentProposal({ requestId: draft.requestId, source: draft.source, intent }, {
      ...base,
      snapshot,
      now,
      expectedDisclosureRequestId,
    });
    if (accepted.marketRisk.status !== 'CLEAR_FOR_REVIEW') fail('MARKET_RISK_UNVERIFIED');
    return accepted;
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    fail(/^[A-Z0-9_]{1,80}$/.test(code) ? code : 'AGENT_PROPOSAL_REJECTED');
  }
}

function assertExchangeQuoteBalance(
  observation: ExchangeQuoteBalanceObservation,
  intent: NativeOrderIntent,
  snapshot: LiveSnapshot,
  adapters: FinancialFinalizationAdapters,
): OwnerReviewPackage['exchangeQuoteBalancePreflight'] {
  const now = nowSeconds(adapters);
  const observedAtMs = Date.parse(observation.observedAt);
  if (observation.status !== 'LIVE_READ_ONLY' || observation.authorized !== false ||
      observation.execution !== 'NOT_IMPLEMENTED' || observation.consistency !== 'UNPINNED_PRECOMPILE_VIEW' ||
      observation.subaccountId.toLowerCase() !== intent.subaccountId.toLowerCase() ||
      observation.denom !== snapshot.market.quoteDenom ||
      !/^(0|[1-9][0-9]{0,77})$/.test(observation.availableBalanceChain) ||
      !/^(0|[1-9][0-9]{0,77})$/.test(observation.totalBalanceChain) ||
      !/^(0|[1-9][0-9]{0,77})$/.test(observation.lockedBalanceChain) ||
      !/^(0|[1-9][0-9]{0,19})$/.test(observation.blockNumber) || BigInt(observation.blockNumber) === 0n ||
      !/^0x[0-9a-fA-F]{64}$/.test(observation.blockHash) || /^0x0{64}$/i.test(observation.blockHash) ||
      !Number.isFinite(observedAtMs)) fail('EXCHANGE_QUOTE_BALANCE_INVALID');
  if (BigInt(observation.availableBalanceChain) > BigInt(observation.totalBalanceChain) ||
      BigInt(observation.availableBalanceChain) > UINT256_MAX || BigInt(observation.totalBalanceChain) > UINT256_MAX ||
      BigInt(observation.lockedBalanceChain) > UINT256_MAX ||
      BigInt(observation.lockedBalanceChain) !== BigInt(observation.totalBalanceChain) - BigInt(observation.availableBalanceChain)) {
    fail('EXCHANGE_QUOTE_BALANCE_INCONSISTENT');
  }
  const observedSeconds = BigInt(Math.floor(observedAtMs / 1000));
  if (observedSeconds > now + 30n || now - observedSeconds > 10n) fail('EXCHANGE_QUOTE_BALANCE_STALE');
  let availableBalanceApi18: string;
  try { availableBalanceApi18 = scaleChainDecimal(observation.availableBalanceChain, 18 - snapshot.market.quoteDecimals); }
  catch { return fail('EXCHANGE_QUOTE_BALANCE_PRECISION'); }
  const requiredExposureApi18 = nativeOrderExposure(intent).total;
  if (BigInt(availableBalanceApi18) < BigInt(requiredExposureApi18)) fail('INSUFFICIENT_EXCHANGE_QUOTE_BALANCE');
  return Object.freeze({
    status: 'SUFFICIENT_FOR_REVIEW', availableBalanceApi18, requiredExposureApi18,
    blockNumber: observation.blockNumber, blockHash: observation.blockHash.toLowerCase(),
    observedAt: observation.observedAt, trust: 'UNPINNED_PRECOMPILE_VIEW', atomicExecutionGuarantee: false,
  });
}

/**
 * Assemble an exact-request package up to, but not including, the principal's signature.
 * The independent disclosure anchor, Gate, Issuer, and verifier are re-read after async
 * work. A returned package is still pre-Gate and never authorizes execution.
 */
export async function assembleOwnerReviewPackage(input: {
  readonly requestId: string;
  readonly proposal: unknown;
  readonly agent: FinancialFinalizationAgentContext;
  readonly gateManifest: GateManifest;
  readonly adapters: FinancialFinalizationAdapters;
}): Promise<OwnerReviewPackage> {
  if (!REQUEST_ID.test(input.requestId)) return fail('INVALID_REQUEST_ID');
  const draft = readDraft(input.proposal, input.requestId);
  if (!input.agent.sessionPrincipal || !input.agent.provider.configured) return fail('OWNER_SESSION_OR_PROVIDER_REQUIRED');
  assertSessionCurrent(input.adapters);

  const firstNow = nowSeconds(input.adapters).toString();
  const firstSnapshot = await input.adapters.readSnapshot().catch(() => fail('TESTNET_READ_UNAVAILABLE'));
  assertSessionCurrent(input.adapters);
  const draftProposal = validateAgainstSnapshot(draft, draft.intent, canonicalBusinessRequestId(input.requestId), input.agent, firstSnapshot, firstNow);
  const draftIntent = draftProposal.intent;
  const initialBalance = await input.adapters.readExchangeQuoteBalance(draftIntent.subaccountId, firstSnapshot.market.quoteDenom)
    .catch(() => fail('EXCHANGE_QUOTE_BALANCE_UNAVAILABLE'));
  assertSessionCurrent(input.adapters);
  assertExchangeQuoteBalance(initialBalance, draftIntent, firstSnapshot, input.adapters);
  const notAfter = (BigInt(firstNow) + 120n < BigInt(draftIntent.deadline)
    ? BigInt(firstNow) + 120n
    : BigInt(draftIntent.deadline)).toString();

  let admission: DisclosureBindingEnvelope;
  assertSessionCurrent(input.adapters);
  try {
    admission = await input.adapters.admitDisclosure({
      requestId: input.requestId,
      idempotencyKey: canonicalBusinessRequestId(input.requestId),
      requestIdHash: canonicalBusinessRequestId(input.requestId),
      draftIntent,
      draftIntentDigest: nativeOrderDigest(draftIntent),
      notAfter,
    });
  } catch { return fail('DISCLOSURE_ADMISSION_OR_ANCHOR_CAS_FAILED'); }
  assertSessionCurrent(input.adapters);

  let disclosure;
  try {
    disclosure = verifyDisclosureBinding(admission, {
      requestId: input.requestId,
      gate: draftIntent.verifyingContract,
      issuer: draftIntent.issuer,
      credentialId: draftIntent.credentialId,
      principal: draftIntent.principal,
      agent: draftIntent.agent,
      policyEpoch: draftIntent.policyEpoch,
      credentialEpoch: draftIntent.credentialEpoch,
      intentDeadline: draftIntent.deadline,
      now: nowSeconds(input.adapters).toString(),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    fail(/^(?:DISCLOSURE_[A-Z0-9_]{1,80})$/.test(code) ? code : 'DISCLOSURE_BINDING_INVALID');
  }
  const firstHead = await input.adapters.readCurrentDisclosureHistory(disclosure.binding).catch(() => null);
  assertSessionCurrent(input.adapters);
  sameDisclosure(disclosure.binding, firstHead);

  const intent = parseNativeOrderIntent({ ...draftIntent, disclosureRequestId: disclosure.digest });
  validateAgainstSnapshot(
    draft,
    intent,
    disclosure.digest,
    input.agent,
    firstSnapshot,
    nowSeconds(input.adapters).toString(),
  );

  const mandateEnvelope = await input.adapters.resolveMandate(intent).catch(() => null);
  assertSessionCurrent(input.adapters);
  const signedMandate = assertLiveMandate(mandateEnvelope, intent, nowSeconds(input.adapters));
  const proofEnvelope = await input.adapters.generateProof({
    requestId: input.requestId,
    intent,
    mandate: signedMandate.mandate,
    disclosureBinding: admission,
  }).catch(() => fail('GROTH16_PROVER_UNAVAILABLE'));
  assertSessionCurrent(input.adapters);
  let proof: Groth16ProofEnvelope;
  try { proof = parseGroth16ProofEnvelope(proofEnvelope); }
  catch { return fail('GROTH16_PROOF_ENVELOPE_INVALID'); }
  const expectedSignals = expectedFinancialAuthorizationPublicSignals(intent, signedMandate.mandate);
  if (proof.publicSignals.some((signal, index) => signal !== expectedSignals[index])) return fail('PROOF_INTENT_MISMATCH');
  let proofValid = false;
  try { proofValid = await input.adapters.verifyProof(proof.proof, proof.publicSignals); }
  catch { return fail('GROTH16_VERIFIER_UNAVAILABLE'); }
  assertSessionCurrent(input.adapters);
  if (!proofValid) return fail('GROTH16_PROOF_INVALID');

  // Refresh every externally mutable authority after proof generation.
  const finalSnapshot = await input.adapters.readSnapshot().catch(() => fail('TESTNET_READ_UNAVAILABLE'));
  assertSessionCurrent(input.adapters);
  const finalNow = nowSeconds(input.adapters).toString();
  const finalSnapshotProposal = validateAgainstSnapshot(draft, intent, disclosure.digest, input.agent, finalSnapshot, finalNow);
  const finalHead = await input.adapters.readCurrentDisclosureHistory(disclosure.binding).catch(() => null);
  assertSessionCurrent(input.adapters);
  sameDisclosure(disclosure.binding, finalHead);
  const currentMandateEnvelope = await input.adapters.resolveMandate(intent).catch(() => null);
  assertSessionCurrent(input.adapters);
  const currentMandate = assertLiveMandate(currentMandateEnvelope, intent, nowSeconds(input.adapters));
  if (currentMandate.digest !== signedMandate.digest) return fail('ISSUER_MANDATE_STALE');
  let gateState: RegisteredGateMandate;
  try { gateState = await input.adapters.readGateMandate(signedMandate.mandate.credentialId); }
  catch { return fail('GATE_STATE_UNAVAILABLE'); }
  assertSessionCurrent(input.adapters);
  try { assertRegisteredGateMandate(signedMandate.mandate, gateState, input.gateManifest); }
  catch { return fail('GATE_MANDATE_MISMATCH'); }
  // Keep the last balance observation after other awaited authority reads. This is
  // still unpinned and can change after return; the Gate remains fail-closed.
  const finalBalanceObservation = await input.adapters.readExchangeQuoteBalance(intent.subaccountId, finalSnapshot.market.quoteDenom)
    .catch(() => fail('EXCHANGE_QUOTE_BALANCE_UNAVAILABLE'));
  assertSessionCurrent(input.adapters);
  const finalBalance = assertExchangeQuoteBalance(finalBalanceObservation, intent, finalSnapshot, input.adapters);

  const digest = nativeOrderDigest(finalSnapshotProposal.intent);
  const proofDigest = keccak256(toUtf8Bytes(JSON.stringify({ proof: proof.proof, publicSignals: proof.publicSignals })));
  return Object.freeze({
    requestId: input.requestId,
    source: 'LIVE_PROVIDER',
    provenance: 'PROVIDER_DECLARED_NOT_AUTONOMY_VERIFIED',
    snapshotProvenance: input.adapters.snapshotProvenance,
    dataClass: input.adapters.snapshotProvenance === 'LIVE_INJECTIVE_READ_ADAPTER'
      ? 'LIVE_READ_ONLY_TESTNET_OBSERVATION'
      : 'SYNTHETIC_TEST_FIXTURE',
    status: 'ASSEMBLED_PRE_GATE_NOT_EXECUTABLE',
    authorized: false,
    execution: 'NOT_IMPLEMENTED',
    ownerSignatureRequired: true,
    ownerSignatureStatus: 'NOT_REQUESTED_NATIVE_RISK_UNVERIFIED',
    intent: finalSnapshotProposal.intent,
    intentDigest: digest,
    exchangeQuoteBalancePreflight: finalBalance,
    disclosureBinding: admission,
    disclosureBindingDigest: disclosure.digest,
    mandate: signedMandate.mandate,
    mandateSignature: signedMandate.signature,
    mandateDigest: signedMandate.digest,
    proof,
    proofDigest,
    disclosureAnchorProvenance: input.adapters.disclosureAnchorProvenance,
    proofVerifierProvenance: input.adapters.proofVerifierProvenance,
    proofStatus: 'VERIFIER_ADAPTER_ACCEPTED',
    marketRisk: finalSnapshotProposal.marketRisk,
    gateStateProvenance: input.adapters.gateStateProvenance,
    gateRegistration: 'REGISTERED_MANDATE_MATCHED_BY_ADAPTER',
    productionGateDecision: 'MARKET_RISK_UNVERIFIED',
    evidenceStatus: 'NOT_RECORDED_PRE_GATE',
  });
}
