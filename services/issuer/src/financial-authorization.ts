import { getAddress, keccak256, toUtf8Bytes, verifyTypedData } from 'ethers';
import { canonicalBusinessRequestId, nativeOrderDigest, nativeOrderExposure, nativeOrderTypedData, parseNativeOrderIntent } from '../../../packages/domain/src/native-order.js';
import { issuerOrderMandateDigest, parseIssuerOrderMandate, verifyIssuerOrderMandate, type IssuerOrderMandate } from '../../../packages/domain/src/order-mandate.js';
import { acceptAgentProposal, type AgentRequestContext } from '../../../packages/domain/src/agent-request.js';
import { verifyDisclosureBinding, type CurrentDisclosureHistory, type DisclosureBinding } from '../../../packages/domain/src/disclosure-binding.js';
import { assertRegisteredGateMandate, type GateManifest, type RegisteredGateMandate } from '../../../packages/domain/src/gate-mandate.js';

const REQUEST_KEYS = ['requestId', 'source', 'intent', 'intentSignature', 'mandate', 'mandateSignature', 'proof'] as const;
const LIVE_REQUEST_KEYS = [...REQUEST_KEYS, 'disclosureBinding'] as const;
const SIGNAL_NAMES = ['commitment', 'requiredExposure', 'intentHi', 'intentLo', 'issuer', 'chainId', 'gate', 'credentialEpoch', 'policyEpoch', 'expiry'] as const;
const UINT = /^(0|[1-9][0-9]*)$/;
const MAX_UINT = (1n << 256n) - 1n;

export class FinancialAuthorizationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export interface Groth16ProofEnvelope {
  readonly proof: {
    readonly pi_a: readonly [string, string, string];
    readonly pi_b: readonly [readonly [string, string], readonly [string, string], readonly [string, string]];
    readonly pi_c: readonly [string, string, string];
    readonly protocol: 'groth16';
    readonly curve: 'bn128';
  };
  readonly publicSignals: readonly string[];
}

export interface CurrentIssuerMandate {
  readonly mandate: unknown;
  readonly signature: string;
}

export interface FinancialAuthorizationContext {
  readonly agent: AgentRequestContext;
  readonly currentMandate: CurrentIssuerMandate | null;
  readonly gateManifest: GateManifest;
  readonly readGateMandate: (credentialId: string) => Promise<RegisteredGateMandate>;
  readonly readCurrentDisclosureHistory: (binding: DisclosureBinding) => Promise<CurrentDisclosureHistory | null>;
  readonly verifyProof: (proof: Groth16ProofEnvelope['proof'], publicSignals: readonly string[]) => Promise<boolean>;
}

function fail(code: string): never { throw new FinancialAuthorizationError(code); }

/** Compare an issuer-signed root to the independently-read current issuer state. */
export function assertCurrentDisclosureHistory(binding: DisclosureBinding, current: CurrentDisclosureHistory | null): void {
  if (!current) fail('DISCLOSURE_HISTORY_UNAVAILABLE');
  const validAddress = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) return false;
    try { return getAddress(value) !== '0x0000000000000000000000000000000000000000'; } catch { return false; }
  };
  const validUint = (value: unknown, positive = false): value is string =>
    typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < (1n << 256n) && (!positive || value !== '0');
  if (!validAddress(current.issuer) || !validAddress(current.principal) || !validAddress(current.agent) ||
      typeof current.credentialId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(current.credentialId) ||
      typeof current.historyRoot !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(current.historyRoot) ||
      !validUint(current.historySequence) || !validUint(current.policyEpoch, true) || !validUint(current.credentialEpoch, true) ||
      typeof current.active !== 'boolean') fail('DISCLOSURE_CURRENT_STATE_INVALID');
  if (!current.active) fail('DISCLOSURE_CREDENTIAL_REVOKED');
  if (getAddress(current.issuer) !== getAddress(binding.issuer) ||
      getAddress(current.principal) !== getAddress(binding.principal) ||
      getAddress(current.agent) !== getAddress(binding.agent) ||
      current.credentialId.toLowerCase() !== binding.credentialId.toLowerCase()) fail('DISCLOSURE_CURRENT_BINDING_MISMATCH');
  if (current.policyEpoch !== binding.policyEpoch || current.credentialEpoch !== binding.credentialEpoch) fail('DISCLOSURE_EPOCH_MISMATCH');
  if (current.historyRoot.toLowerCase() !== binding.historyRoot.toLowerCase() ||
      current.historySequence !== binding.historySequence) fail('DISCLOSURE_HISTORY_STALE');
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_AUTHORIZATION_REQUEST');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail('INVALID_AUTHORIZATION_REQUEST');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some((key) => {
    const descriptor = descriptors[key];
    return !descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get !== undefined || descriptor.set !== undefined;
  })) return fail('INVALID_AUTHORIZATION_FIELDS');
  return value as Record<string, unknown>;
}

function decimal(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UINT.test(value) || value.length > 78 || BigInt(value) > MAX_UINT) {
    return fail(`INVALID_PROOF_${name}`);
  }
  return value;
}

function decimalTuple(value: unknown, length: number, name: string): string[] {
  if (!Array.isArray(value) || value.length !== length) return fail(`INVALID_PROOF_${name}`);
  return value.map((entry) => decimal(entry, name));
}

export function parseGroth16ProofEnvelope(input: unknown): Groth16ProofEnvelope {
  const envelope = exact(input, ['proof', 'publicSignals']);
  const rawProof = exact(envelope.proof, ['pi_a', 'pi_b', 'pi_c', 'protocol', 'curve']);
  if (rawProof.protocol !== 'groth16' || rawProof.curve !== 'bn128') return fail('INVALID_PROOF_SCHEME');
  const piA = decimalTuple(rawProof.pi_a, 3, 'PI_A') as [string, string, string];
  if (!Array.isArray(rawProof.pi_b) || rawProof.pi_b.length !== 3) return fail('INVALID_PROOF_PI_B');
  const piB = rawProof.pi_b.map((row) => decimalTuple(row, 2, 'PI_B')) as [[string, string], [string, string], [string, string]];
  const piC = decimalTuple(rawProof.pi_c, 3, 'PI_C') as [string, string, string];
  const signals = decimalTuple(envelope.publicSignals, SIGNAL_NAMES.length, 'PUBLIC_SIGNALS');
  return Object.freeze({
    proof: Object.freeze({ pi_a: piA, pi_b: piB, pi_c: piC, protocol: 'groth16', curve: 'bn128' }),
    publicSignals: Object.freeze(signals),
  });
}

export function expectedFinancialAuthorizationPublicSignals(intentInput: unknown, mandate: IssuerOrderMandate): string[] {
  const intent = parseNativeOrderIntent(intentInput);
  const digest = BigInt(nativeOrderDigest(intent));
  const digestMask = (1n << 128n) - 1n;
  const exposure = nativeOrderExposure(intent);
  return [
    BigInt(mandate.commitment).toString(),
    exposure.total,
    (digest >> 128n).toString(),
    (digest & digestMask).toString(),
    BigInt(mandate.issuer).toString(),
    BigInt(intent.chainId).toString(),
    BigInt(intent.verifyingContract).toString(),
    intent.credentialEpoch,
    intent.policyEpoch,
    mandate.expiry,
  ];
}

export function assertFinancialMandateBindsIntent(intentInput: unknown, mandate: IssuerOrderMandate): void {
  const intent = parseNativeOrderIntent(intentInput);
  const pairs: ReadonlyArray<readonly [string, string]> = [
    [intent.chainId, mandate.chainId],
    [intent.verifyingContract, mandate.verifyingContract],
    [intent.issuer, mandate.issuer],
    [intent.principal, mandate.principal],
    [intent.agent, mandate.agent],
    [intent.credentialId, mandate.credentialId],
    [intent.credentialEpoch, mandate.credentialEpoch],
    [intent.policyEpoch, mandate.policyEpoch],
    [intent.marketId, mandate.marketId],
    [intent.subaccountId, mandate.subaccountId],
    [intent.marketConfigHash, mandate.marketConfigHash],
    [intent.priceTick, mandate.priceTick],
    [intent.quantityTick, mandate.quantityTick],
    [intent.maxFeeRate, mandate.maxFeeRate],
  ];
  if (pairs.some(([a, b]) => a.toLowerCase() !== b.toLowerCase())) fail('MANDATE_INTENT_MISMATCH');
  if (BigInt(intent.maxTotalExposure) > BigInt(mandate.cap)) fail('MANDATE_CAP_EXCEEDED');
  if (BigInt(intent.deadline) > BigInt(mandate.expiry)) fail('MANDATE_EXPIRES_BEFORE_INTENT');
}

function recoverIntentSigner(intent: unknown, signature: unknown): string | null {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  try {
    const data = nativeOrderTypedData(intent);
    return getAddress(verifyTypedData(data.domain, data.types, data.value, signature));
  } catch {
    return null;
  }
}

export interface ValidatedFinancialAuthorization {
  readonly requestId: string;
  readonly source: 'FIXTURE' | 'LIVE_PROVIDER';
  readonly provenance: 'IMPORTED_FIXTURE' | 'PROVIDER_DECLARED_NOT_AUTONOMY_VERIFIED';
  readonly status: 'PRE_GATE_VALIDATED';
  readonly authorized: false;
  readonly execution: 'NOT_IMPLEMENTED';
  readonly intent: ReturnType<typeof parseNativeOrderIntent>;
  readonly preview: ReturnType<typeof acceptAgentProposal>['preview'];
  readonly marketRisk: ReturnType<typeof acceptAgentProposal>['marketRisk'];
  readonly intentDigest: string;
  readonly mandateDigest: string;
  readonly proofDigest: string;
  readonly proofStatus: 'GROTH16_VERIFIED';
  readonly disclosureBindingStatus: 'ISSUER_SIGNATURE_VERIFIED' | 'NOT_PROVIDED_FIXTURE';
  readonly disclosureBindingDigest: string | null;
  readonly disclosureHistoryRoot: string | null;
  readonly disclosureHistorySequence: string | null;
  readonly disclosurePolicyEpoch: string | null;
  readonly disclosureCredentialEpoch: string | null;
  readonly disclosureIssuer: string | null;
  readonly disclosureCredentialId: string | null;
}

/**
 * Verify the owner session, owner-signed exact order, issuer-signed current mandate,
 * and a real Groth16 proof over the same ActionGate digest. This is still pre-Gate:
 * the API never reports authorization or execution and cannot submit a transaction.
 */
export async function validateFinancialAuthorization(input: unknown, context: FinancialAuthorizationContext): Promise<ValidatedFinancialAuthorization> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_AUTHORIZATION_REQUEST');
  const sourceDescriptor = Object.getOwnPropertyDescriptor(input, 'source');
  const source = sourceDescriptor && Object.hasOwn(sourceDescriptor, 'value') ? sourceDescriptor.value : undefined;
  const hasDisclosureBinding = Object.hasOwn(input, 'disclosureBinding');
  const request = exact(input, source === 'LIVE_PROVIDER' && hasDisclosureBinding ? LIVE_REQUEST_KEYS : REQUEST_KEYS);
  if (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.requestId)) fail('INVALID_REQUEST_ID');
  if (request.source !== 'FIXTURE' && request.source !== 'LIVE_PROVIDER') fail('INVALID_PROVENANCE');
  if (typeof request.intentSignature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(request.intentSignature)) fail('INVALID_INTENT_SIGNATURE');
  if (typeof request.mandateSignature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(request.mandateSignature)) fail('INVALID_MANDATE_SIGNATURE');

  let expectedDisclosureRequestId = canonicalBusinessRequestId(request.requestId);
  let disclosureBindingDigest: string | null = null, disclosureHistoryRoot: string | null = null;
  let disclosureHistorySequence: string | null = null, disclosurePolicyEpoch: string | null = null;
  let disclosureCredentialEpoch: string | null = null, disclosureIssuer: string | null = null, disclosureCredentialId: string | null = null;
  if (request.source === 'LIVE_PROVIDER') {
    if (request.disclosureBinding === undefined) fail('DISCLOSURE_BINDING_REQUIRED');
    let candidate;
    try { candidate = parseNativeOrderIntent(request.intent); }
    catch { fail('INVALID_NATIVE_ORDER_INTENT'); }
    let binding;
    try {
      binding = verifyDisclosureBinding(request.disclosureBinding, {
        requestId: request.requestId, gate: candidate.verifyingContract, issuer: candidate.issuer, credentialId: candidate.credentialId,
        principal: candidate.principal, agent: candidate.agent, policyEpoch: candidate.policyEpoch,
        credentialEpoch: candidate.credentialEpoch, intentDeadline: candidate.deadline, now: context.agent.now,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      fail(/^(?:DISCLOSURE_[A-Z0-9_]{1,80})$/.test(message) ? message : 'DISCLOSURE_BINDING_INVALID');
    }
    let currentDisclosureHistory: CurrentDisclosureHistory | null;
    try { currentDisclosureHistory = await context.readCurrentDisclosureHistory(binding.binding); }
    catch { fail('DISCLOSURE_HISTORY_UNAVAILABLE'); }
    assertCurrentDisclosureHistory(binding.binding, currentDisclosureHistory);
    expectedDisclosureRequestId = binding.digest;
    disclosureBindingDigest = binding.digest;
    disclosureHistoryRoot = binding.binding.historyRoot;
    disclosureHistorySequence = binding.binding.historySequence;
    disclosurePolicyEpoch = binding.binding.policyEpoch;
    disclosureCredentialEpoch = binding.binding.credentialEpoch;
    disclosureIssuer = binding.binding.issuer;
    disclosureCredentialId = binding.binding.credentialId;
  }
  const agentContext = { ...context.agent, expectedDisclosureRequestId };
  let proposal: ReturnType<typeof acceptAgentProposal>;
  try {
    proposal = acceptAgentProposal({ requestId: request.requestId, source: request.source, intent: request.intent }, agentContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    fail(/^[A-Z0-9_]{1,80}$/.test(message) ? message : 'AGENT_REQUEST_REJECTED');
  }
  if (proposal.marketRisk.status !== 'CLEAR_FOR_REVIEW') fail('MARKET_RISK_UNVERIFIED');

  if (proposal.intent.disclosureRequestId !== expectedDisclosureRequestId) fail('REQUEST_ID_INTENT_MISMATCH');
  if (!context.currentMandate) fail('ISSUER_MANDATE_NOT_CONFIGURED');
  let mandate: IssuerOrderMandate, currentMandate: IssuerOrderMandate;
  try {
    mandate = parseIssuerOrderMandate(request.mandate);
    currentMandate = parseIssuerOrderMandate(context.currentMandate.mandate);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    fail(/^[A-Z0-9_]{1,80}$/.test(message) ? message : 'INVALID_MANDATE');
  }
  const mandateDigest = issuerOrderMandateDigest(mandate);
  const currentMandateDigest = issuerOrderMandateDigest(currentMandate);
  if (!verifyIssuerOrderMandate(mandate, request.mandateSignature)) fail('MANDATE_SIGNATURE_INVALID');
  if (!verifyIssuerOrderMandate(currentMandate, context.currentMandate.signature)) fail('ISSUER_CONFIGURATION_SIGNATURE_INVALID');
  if (!currentMandate.active || !mandate.active) fail('MANDATE_REVOKED');
  if (mandateDigest !== currentMandateDigest) fail('MANDATE_STALE');

  assertFinancialMandateBindsIntent(request.intent, mandate);
  let registeredGateMandate: RegisteredGateMandate;
  try { registeredGateMandate = await context.readGateMandate(mandate.credentialId); }
  catch { fail('GATE_STATE_UNAVAILABLE'); }
  try { assertRegisteredGateMandate(mandate, registeredGateMandate, context.gateManifest); }
  catch (error) {
    const message = error instanceof Error ? error.message : '';
    fail(message === 'GATE_MANIFEST_MISMATCH' ? message : 'GATE_MANDATE_MISMATCH');
  }
  const now = BigInt(context.agent.now);
  if (BigInt(mandate.expiry) <= now) fail('MANDATE_EXPIRED');

  const signer = recoverIntentSigner(request.intent, request.intentSignature);
  if (!signer || signer !== proposal.intent.principal || signer !== context.agent.sessionPrincipal) fail('INTENT_SIGNER_MISMATCH');

  const proof = parseGroth16ProofEnvelope(request.proof);
  const expected = expectedFinancialAuthorizationPublicSignals(proposal.intent, mandate);
  if (proof.publicSignals.some((signal, index) => signal !== expected[index])) fail('PROOF_INTENT_MISMATCH');
  let proofValid = false;
  try { proofValid = await context.verifyProof(proof.proof, proof.publicSignals); }
  catch { fail('PROOF_VERIFIER_UNAVAILABLE'); }
  if (!proofValid) fail('INVALID_GROTH16_PROOF');

  const intentDigest = nativeOrderDigest(proposal.intent);
  const proofDigest = keccak256(toUtf8Bytes(JSON.stringify({ proof: proof.proof, publicSignals: proof.publicSignals })));
  return Object.freeze({
    requestId: proposal.requestId,
    source: proposal.source,
    provenance: proposal.provenance,
    status: 'PRE_GATE_VALIDATED',
    authorized: false,
    execution: 'NOT_IMPLEMENTED',
    intent: proposal.intent,
    preview: proposal.preview,
    marketRisk: proposal.marketRisk,
    intentDigest,
    mandateDigest,
    proofDigest,
    proofStatus: 'GROTH16_VERIFIED',
    disclosureBindingStatus: disclosureBindingDigest ? 'ISSUER_SIGNATURE_VERIFIED' : 'NOT_PROVIDED_FIXTURE',
    disclosureBindingDigest, disclosureHistoryRoot, disclosureHistorySequence, disclosurePolicyEpoch,
    disclosureCredentialEpoch, disclosureIssuer, disclosureCredentialId,
  });
}

export function authorizationFailureCode(error: unknown): string {
  return error instanceof FinancialAuthorizationError ? error.code : 'AUTHORIZATION_VALIDATION_FAILED';
}

export function getAuthorizationRequestId(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>).requestId;
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : null;
}

export function getAuthorizationDigests(input: unknown): { intentDigest: string | null; mandateDigest: string | null } {
  let intentDigest: string | null = null, mandateDigest: string | null = null;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const value = input as Record<string, unknown>;
    try { intentDigest = nativeOrderDigest(value.intent); } catch { /* malformed intent has no canonical digest */ }
    try { mandateDigest = issuerOrderMandateDigest(value.mandate); } catch { /* malformed mandate has no canonical digest */ }
  }
  return { intentDigest, mandateDigest };
}
