import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoGraph, previewGraphCommand } from '../../../packages/consequence/src/index';
import type { RehearsalIntent, RehearsalResult, RehearsalView } from '../../../packages/domain/src/rehearsal';
import { isInjectiveChainId } from '../../../packages/domain/src/wallet';
import { nativeOrderDigest, nativeOrderExposure, parseNativeOrderIntent } from '../../../packages/domain/src/native-order';
import { validatePinnedSources } from '../../../scripts/zk-artifacts.mjs';
import { verifyLocalGroth16 } from '../../../scripts/local-groth16-verifier.mjs';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../demo/hacker-house');
const PROJECT_ROOT = resolve(KIT_ROOT, '../..');
const FINANCIAL_VECTOR_PATH = resolve(PROJECT_ROOT, 'contracts/test/fixtures/financial-authorization.json');
const FINANCIAL_VECTOR_SHA256 = 'f483c54b615e248f8d90bb6b47a2cc93169ca226ead1bab0fcc8d4b6bf40eeba';
const SCENARIO_ID = /^S0[1-8]-[a-z0-9-]+$/;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/;
type FinancialVector = {
  intent: Record<string, string>;
  mandate: Record<string, string | boolean>;
  policy: Record<string, string>;
  intentDigest: string;
  exposure: string;
  expectedPublicSignals: string[];
  proof: { proof: unknown; publicSignals: string[] };
  market: { ticker: string };
};

type RawScenario = {
  schemaVersion: string;
  dataClass: string;
  scenarioId: string;
  title: string;
  businessQuestion: string;
  category: string;
  inputs: Record<string, unknown>;
  operatorActions: string[];
  chainEvidence: Record<string, unknown>;
  releaseClaims: Record<string, unknown>;
};

type ManifestEntry = { scenarioId: string; file: string; title: string; category: string };
type Manifest = { schemaVersion: string; kitId: string; dataClass: string; status: string; scenarios: ManifestEntry[] };

function exactRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function resolveKitPath(relativePath: string): string {
  if (!relativePath || relativePath.includes('\\')) throw new Error('INVALID_KIT_PATH');
  const resolved = resolve(KIT_ROOT, relativePath);
  const fromRoot = relative(KIT_ROOT, resolved);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || resolve(resolved) !== resolved) throw new Error('INVALID_KIT_PATH');
  return resolved;
}

function getManifest(): Manifest {
  const value: unknown = readJson(resolveKitPath('manifest.json'));
  if (!exactRecord(value) || value.schemaVersion !== '1.0.0' || value.kitId !== 'vereqo-demo-kit-v1' ||
      value.dataClass !== 'SYNTHETIC_REHEARSAL' || value.status !== 'PORTABLE_FIXTURE_ONLY_NOT_INTEGRATED' ||
      !Array.isArray(value.scenarios) || value.scenarios.length !== 8) throw new Error('INVALID_DEMO_MANIFEST');
  const entries = value.scenarios as ManifestEntry[];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!exactRecord(entry) || typeof entry.scenarioId !== 'string' || !SCENARIO_ID.test(entry.scenarioId) ||
        typeof entry.file !== 'string' || typeof entry.title !== 'string' || typeof entry.category !== 'string' || ids.has(entry.scenarioId)) {
      throw new Error('INVALID_DEMO_MANIFEST_ENTRY');
    }
    resolveKitPath(entry.file);
    ids.add(entry.scenarioId);
  }
  return value as unknown as Manifest;
}

function scenarioById(scenarioId: unknown): RawScenario {
  if (typeof scenarioId !== 'string' || !SCENARIO_ID.test(scenarioId)) throw new Error('UNKNOWN_SCENARIO');
  const entry = getManifest().scenarios.find(item => item.scenarioId === scenarioId);
  if (!entry) throw new Error('UNKNOWN_SCENARIO');
  const value: unknown = readJson(resolveKitPath(entry.file));
  if (!exactRecord(value) || value.schemaVersion !== '1.0.0' || value.dataClass !== 'SYNTHETIC_REHEARSAL' ||
      value.scenarioId !== scenarioId || typeof value.title !== 'string' || typeof value.businessQuestion !== 'string' ||
      typeof value.category !== 'string' || !exactRecord(value.inputs) || !Array.isArray(value.operatorActions) ||
      !exactRecord(value.chainEvidence) || !exactRecord(value.releaseClaims)) throw new Error('INVALID_DEMO_SCENARIO');
  const evidence = value.chainEvidence;
  if (evidence.executionStatus !== 'NOT_EXECUTED' || ['transactionHash', 'blockHash', 'blockHeight', 'marketId', 'orderHash'].some(key => evidence[key] !== null)) {
    throw new Error('INVALID_DEMO_CHAIN_EVIDENCE');
  }
  if (Object.values(value.releaseClaims).some(claim => claim !== false)) throw new Error('INVALID_DEMO_RELEASE_CLAIM');
  return value as unknown as RawScenario;
}

function publicIntent(scenario: RawScenario): RehearsalIntent | null {
  const raw = scenario.inputs.intent;
  if (!exactRecord(raw)) return null;
  if (raw.side !== 'BUY' && raw.side !== 'SELL') throw new Error('INVALID_DEMO_INTENT');
  for (const key of ['intentId', 'principalId', 'agentId', 'issuerId', 'credentialId', 'mandateId', 'marketSymbol', 'quantity', 'limitPrice', 'units']) {
    if (typeof raw[key] !== 'string') throw new Error('INVALID_DEMO_INTENT');
  }
  if (raw.type !== 'LIMIT' || raw.signedIntent !== null || raw.issuerSignature !== null || raw.zkProof !== null ||
      !DECIMAL.test(raw.quantity as string) || !DECIMAL.test(raw.limitPrice as string)) throw new Error('INVALID_DEMO_INTENT');
  const quantity = raw.quantity as string;
  const limitPrice = raw.limitPrice as string;
  const scale = 10n ** 18n;
  const toScaled = (decimal: string) => {
    const [whole, fraction = ''] = decimal.split('.');
    return BigInt(whole!) * scale + BigInt(fraction.padEnd(18, '0') || '0');
  };
  const notionalScaled = (toScaled(quantity) * toScaled(limitPrice) + scale - 1n) / scale;
  const whole = notionalScaled / scale;
  const fraction = (notionalScaled % scale).toString().padStart(18, '0').replace(/0+$/, '');
  const notionalQuote = fraction ? `${whole}.${fraction}` : whole.toString();
  if (raw.maxNotionalQuote !== notionalQuote) throw new Error('DEMO_NOTIONAL_MISMATCH');
  return {
    intentId: raw.intentId as string,
    principalId: raw.principalId as string,
    agentId: raw.agentId as string,
    issuerId: raw.issuerId as string,
    credentialId: raw.credentialId as string,
    mandateId: raw.mandateId as string,
    marketSymbol: raw.marketSymbol as string,
    side: raw.side,
    orderType: 'LIMIT',
    quantity,
    limitPrice,
    units: raw.units as string,
    notionalQuote,
    source: 'SYNTHETIC_FIXTURE',
  };
}

function businessIdFor(scenarioId: string): string {
  return `fi_${createHash('sha256').update(`vereqo-demo-kit-v1:${scenarioId}`).digest('hex').slice(0, 32)}`;
}

function human18(value: string): string {
  const n = BigInt(value), scale = 10n ** 18n;
  const whole = (n / scale).toString();
  const fraction = (n % scale).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

async function verifyCanonicalS08Vector(view: RehearsalView) {
  const raw = readFileSync(FINANCIAL_VECTOR_PATH);
  if (createHash('sha256').update(raw).digest('hex') !== FINANCIAL_VECTOR_SHA256) throw new Error('S08_FINANCIAL_VECTOR_HASH_MISMATCH');
  const vector = JSON.parse(raw.toString('utf8')) as FinancialVector;
  const intent = vector.intent, mandate = vector.mandate, policy = vector.policy;
  const parsedIntent = parseNativeOrderIntent(intent);
  const exposure = nativeOrderExposure(parsedIntent);
  if (!view.intent ||
      view.intent.principalId.toLowerCase() !== intent.principal!.toLowerCase() ||
      view.intent.agentId.toLowerCase() !== intent.agent!.toLowerCase() ||
      view.intent.issuerId.toLowerCase() !== intent.issuer!.toLowerCase() ||
      view.intent.credentialId.toLowerCase() !== intent.credentialId!.toLowerCase() ||
      view.intent.marketSymbol !== vector.market.ticker ||
      view.intent.side !== intent.side ||
      view.intent.quantity !== human18(intent.quantity!) ||
      view.intent.limitPrice !== human18(intent.price!) ||
      view.intent.notionalQuote !== human18(exposure.notional)) {
    throw new Error('S08_INTENT_VECTOR_MISMATCH');
  }
  const mandatePairs: ReadonlyArray<readonly [string, string | boolean]> = [
    [intent.chainId!, mandate.chainId!], [intent.verifyingContract!, mandate.verifyingContract!],
    [intent.issuer!, mandate.issuer!], [intent.principal!, mandate.principal!], [intent.agent!, mandate.agent!],
    [intent.credentialId!, mandate.credentialId!], [intent.credentialEpoch!, mandate.credentialEpoch!],
    [intent.policyEpoch!, mandate.policyEpoch!], [intent.marketId!, mandate.marketId!],
    [intent.subaccountId!, mandate.subaccountId!], [intent.marketConfigHash!, mandate.marketConfigHash!],
    [intent.priceTick!, mandate.priceTick!], [intent.quantityTick!, mandate.quantityTick!],
    [intent.maxFeeRate!, mandate.maxFeeRate!],
  ];
  const policyPairs: ReadonlyArray<readonly [string, string]> = [
    [policy.principal!, intent.principal!], [policy.agent!, intent.agent!], [policy.issuer!, intent.issuer!],
    [policy.gate!, intent.verifyingContract!], [policy.credentialId!, intent.credentialId!],
    [policy.credentialEpoch!, intent.credentialEpoch!], [policy.policyEpoch!, intent.policyEpoch!],
    [policy.marketId!, intent.marketId!],
  ];
  if (mandatePairs.some(([actual, expected]) => String(actual).toLowerCase() !== String(expected).toLowerCase()) ||
      policyPairs.some(([actual, expected]) => actual.toLowerCase() !== expected.toLowerCase()) ||
      mandate.active !== true || BigInt(intent.deadline!) > BigInt(String(mandate.expiry)) ||
      BigInt(intent.maxTotalExposure!) > BigInt(String(mandate.cap)) ||
      BigInt(intent.maxNotional!) !== BigInt(policy.maxNotional!) ||
      BigInt(intent.maxFeeRate!) !== BigInt(policy.maxFeeRate!) ||
      BigInt(intent.maxTotalExposure!) !== BigInt(policy.maxTotalExposure!) ||
      Number(view.facts.credentialEpochAtIntent) !== Number(mandate.credentialEpoch) ||
      Number(view.facts.credentialEpochNow) !== Number(mandate.credentialEpoch) + 1) {
    throw new Error('S08_MANDATE_POLICY_VECTOR_MISMATCH');
  }
  if (nativeOrderDigest(intent).toLowerCase() !== vector.intentDigest.toLowerCase()) throw new Error('S08_INTENT_DIGEST_MISMATCH');
  if (JSON.stringify(vector.proof.publicSignals) !== JSON.stringify(vector.expectedPublicSignals)) throw new Error('S08_PUBLIC_SIGNAL_VECTOR_MISMATCH');
  const digest = BigInt(vector.intentDigest), mask = (1n << 128n) - 1n;
  const signals = vector.proof.publicSignals;
  if (vector.exposure !== exposure.total ||
      signals[0] !== BigInt(String(mandate.commitment)).toString() || signals[1] !== exposure.total ||
      signals[2] !== (digest >> 128n).toString() || signals[3] !== (digest & mask).toString() ||
      signals[4] !== BigInt(intent.issuer!).toString() || signals[5] !== '1439' ||
      signals[6] !== BigInt(intent.verifyingContract!).toString() ||
      signals[7] !== intent.credentialEpoch || signals[8] !== intent.policyEpoch || signals[9] !== mandate.expiry) {
    throw new Error('S08_PROOF_CONTEXT_MISMATCH');
  }
  const pinned = validatePinnedSources(PROJECT_ROOT) as unknown as { fixtures: { verificationKey: unknown } };
  if (!await verifyLocalGroth16(pinned.fixtures.verificationKey, signals, vector.proof.proof)) throw new Error('S08_GROTH16_PROOF_INVALID');
  const proofDigest = createHash('sha256').update(JSON.stringify(vector.proof)).digest('hex');
  return {
    intentDigest: vector.intentDigest,
    proofDigest: `0x${proofDigest}`,
    proofArtifact: 'LOCAL_PUBLIC_TEST_VECTOR / proof bytes stay server-side',
  };
}

export function listRehearsalScenarios(): Pick<ManifestEntry, 'scenarioId' | 'title' | 'category'>[] {
  return getManifest().scenarios.map(({ scenarioId, title, category }) => ({ scenarioId, title, category }));
}

export function loadRehearsalScenario(scenarioId: unknown): RehearsalView {
  const scenario = scenarioById(scenarioId);
  const facts: RehearsalView['facts'] = {
    targetChainId: 1439,
    verifiedOnChain: false,
    chainStatus: 'NOT_EXECUTED',
    marketId: null,
    orderHash: null,
  };
  if (scenario.scenarioId === 'S03-revocation-causality') {
    facts.agentAIntents = 'intent-A01, intent-A02';
    facts.agentBIntents = 'intent-B01';
    facts.openOrderState = 'UNKNOWN_NOT_CHAIN_VERIFIED';
  } else if (scenario.scenarioId === 'S04-unverified-market') {
    facts.marketConsistency = 'UNPINNED_LCD_READ';
    facts.marketRisk = 'UNVERIFIED';
  } else if (scenario.scenarioId === 'S05-cancel-vs-fill') {
    facts.syntheticOrderId = 'synthetic-order-A01';
    facts.requestedQuantity = '40 INJ';
    facts.simulatedFilledQuantity = '10 INJ';
    facts.simulatedRemainingQuantity = '30 INJ';
    facts.cancelConfirmed = false;
  } else if (scenario.scenarioId === 'S06-wrong-chain') {
    const providerChainId = scenario.inputs.providerChainId;
    facts.providerChainId = typeof providerChainId === 'number' ? providerChainId : 1;
    facts.requiredChainId = 1439;
  } else if (scenario.scenarioId === 'S07-disclosure-sequence') {
    facts.requestCount = exactRecord(scenario.inputs) && Array.isArray(scenario.inputs.requests) ? scenario.inputs.requests.length : 0;
    facts.disclosureAdapter = 'NOT_CONNECTED_TO_THIS_KIT_SEQUENCE';
  } else if (scenario.scenarioId === 'S08-proof-is-not-authority') {
    facts.credentialEpochAtIntent = scenario.inputs.credentialEpochAtIntent as number;
    facts.credentialEpochNow = scenario.inputs.credentialEpochNow as number;
    facts.proofArtifact = 'LOCAL_PUBLIC_TEST_VECTOR / NOT VERIFIED UNTIL REPLAY';
  }
  return {
    scenarioId: scenario.scenarioId,
    title: scenario.title,
    category: scenario.category,
    businessQuestion: scenario.businessQuestion,
    dataClass: 'SYNTHETIC_REHEARSAL',
    source: 'PORTABLE_KIT_V1',
    businessId: businessIdFor(scenario.scenarioId),
    revision: 1,
    intent: publicIntent(scenario),
    facts,
    operatorActions: scenario.operatorActions,
    evidenceState: 'NO_RECORD',
  };
}

function commonResult(view: RehearsalView, source: RehearsalResult['source'], decision: string, reason: string, proofStatus: string, facts: RehearsalResult['facts'] = {}): RehearsalResult {
  return {
    scenarioId: view.scenarioId,
    businessId: view.businessId,
    revision: view.revision,
    source,
    decision,
    reason,
    authorized: false,
    execution: 'NOT_IMPLEMENTED',
    proofStatus,
    evidenceState: 'NO_RECORD',
    facts,
  };
}

function syntheticPolicy(): { policies: { credentialId: string; maxOrderNotionalQuote: string }[] } {
  const value: unknown = readJson(resolveKitPath('private/issuer-policy.example.json'));
  if (!exactRecord(value) || value.dataClass !== 'SYNTHETIC_PRIVATE_SERVER_ONLY' || !Array.isArray(value.policies)) throw new Error('INVALID_PRIVATE_DEMO_POLICY');
  const policies = value.policies.map(item => {
    if (!exactRecord(item) || typeof item.credentialId !== 'string' || typeof item.maxOrderNotionalQuote !== 'string' || !/^\d+$/.test(item.maxOrderNotionalQuote)) throw new Error('INVALID_PRIVATE_DEMO_POLICY');
    return { credentialId: item.credentialId, maxOrderNotionalQuote: item.maxOrderNotionalQuote };
  });
  return { policies };
}

export async function replayRehearsalScenario(scenarioId: unknown): Promise<RehearsalResult> {
  const view = loadRehearsalScenario(scenarioId);
  if (view.scenarioId === 'S01-eligible-request' || view.scenarioId === 'S02-exceeds-private-mandate') {
    if (!view.intent) throw new Error('DEMO_INTENT_REQUIRED');
    const policy = syntheticPolicy().policies.find(item => item.credentialId === view.intent!.credentialId);
    if (!policy) return commonResult(view, 'SYNTHETIC_SERVER_POLICY', 'BLOCKED', 'SYNTHETIC_POLICY_NOT_CONFIGURED', 'NOT_PROVIDED');
    const allowed = BigInt(view.intent.notionalQuote) <= BigInt(policy.maxOrderNotionalQuote);
    return commonResult(
      view,
      'SYNTHETIC_SERVER_POLICY',
      allowed ? 'WITHIN_SYNTHETIC_POLICY' : 'DENIED',
      allowed ? 'POLICY_CHECK_ONLY_NOT_AUTHORIZATION' : 'SYNTHETIC_LIMIT_EXCEEDED',
      'NOT_PROVIDED',
      { notionalQuote: `${view.intent.notionalQuote} USDT`, policyBoundReturned: false, authority: 'NOT_CONFIGURED' },
    );
  }
  if (view.scenarioId === 'S03-revocation-causality') {
    const graph = createDemoGraph();
    const original = structuredClone(graph);
    const preview = previewGraphCommand(graph, { type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', eventId: 'operation59-s03-revoke-a', expectedSequence: 0 });
    const state = (id: string) => preview.snapshot.nodes.find(node => node.id === id)?.state ?? 'UNKNOWN';
    const unchanged = JSON.stringify(graph) === JSON.stringify(original) && graph.sequence === 0;
    if (!unchanged || state('intent_A') !== 'BLOCKED' || state('action_B') !== 'VALID') throw new Error('REVOCATION_PREVIEW_INVARIANT_FAILED');
    return commonResult(view, 'LOCAL_VERIFIED_GRAPH', 'WHAT_IF_ONLY', 'PREVIEW_DID_NOT_COMMIT', 'NOT_PROVIDED', {
      graphSequenceBefore: original.sequence,
      graphSequenceAfter: graph.sequence,
      previewSequence: preview.snapshot.sequence,
      agentAIntent: state('intent_A'),
      agentAAction: state('action_A'),
      agentBIntent: state('intent_B'),
      agentBAction: state('action_B'),
      existingOrder: 'UNKNOWN_NOT_CHAIN_VERIFIED',
    });
  }
  if (view.scenarioId === 'S04-unverified-market') {
    return commonResult(view, 'FAIL_CLOSED_PRODUCT_BOUNDARY', 'BLOCKED', 'MARKET_RISK_UNVERIFIED', 'NOT_EVALUATED', {
      nonceConsumed: false, budgetReserved: false, precompileCalled: false,
    });
  }
  if (view.scenarioId === 'S05-cancel-vs-fill') {
    return commonResult(view, 'SYNTHETIC_FIXTURE', 'CANCEL_REQUESTED_NOT_CONFIRMED', 'CHAIN_ORDER_READBACK_UNAVAILABLE', 'NOT_EVALUATED', {
      requestedQuantity: '40 INJ', simulatedFilledQuantity: '10 INJ', simulatedRemainingQuantity: '30 INJ', orderStatus: 'UNKNOWN',
    });
  }
  if (view.scenarioId === 'S06-wrong-chain') {
    const providerChainId = Number(view.facts.providerChainId);
    return commonResult(view, 'LOCAL_WALLET_RULE', isInjectiveChainId(`0x${providerChainId.toString(16)}`) ? 'CHAIN_ACCEPTED_FOR_AUTH_ONLY' : 'DENIED_WRONG_CHAIN', 'NO_WALLET_OR_TRANSACTION_REQUESTED', 'NOT_EVALUATED', {
      providerChainId, requiredChainId: 1439, walletProviderCalled: false,
    });
  }
  if (view.scenarioId === 'S07-disclosure-sequence') {
    return commonResult(view, 'BLOCKED_CAPABILITY', 'BLOCKED', 'CUMULATIVE_DISCLOSURE_ADAPTER_NOT_CONNECTED_TO_THIS_KIT_SEQUENCE', 'NOT_EVALUATED', {
      requestCount: view.facts.requestCount ?? 0, disclosureRequestsSent: false,
    });
  }
  const vector = await verifyCanonicalS08Vector(view);
  const graph = createDemoGraph();
  const before = structuredClone(graph);
  const preview = previewGraphCommand(graph, {
    type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A',
    eventId: `operation-final-s08-${view.businessId}`, expectedSequence: 0,
  });
  const state = (id: string) => preview.snapshot.nodes.find(node => node.id === id)?.state ?? 'UNKNOWN';
  if (JSON.stringify(graph) !== JSON.stringify(before) || graph.sequence !== 0 ||
      state('intent_A') !== 'BLOCKED' || state('action_A') !== 'BLOCKED' ||
      state('intent_B') !== 'VALID' || state('action_B') !== 'VALID') throw new Error('S08_CONSEQUENCE_PREVIEW_INVARIANT_FAILED');
  return commonResult(view, 'LOCAL_GROTH16_TEST_VECTOR', 'BLOCKED', 'LOCAL_REPLAY_ONLY_MANDATE_EPOCH_ADVANCED; LIVE_GATE_NOT_CALLED', 'GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP', {
    requestId: view.businessId,
    intentDigest: vector.intentDigest,
    proofDigest: vector.proofDigest,
    proofArtifact: vector.proofArtifact,
    authority: 'LOCAL SCENARIO: CREDENTIAL EPOCH 1 → 2; NO LIVE MANDATE',
    credentialEpochAtIntent: view.facts.credentialEpochAtIntent ?? null,
    credentialEpochNow: view.facts.credentialEpochNow ?? null,
    issuerSignatureStatus: 'NOT_VERIFIED_IN_REHEARSAL',
    graphSequenceBefore: before.sequence,
    graphSequenceAfter: graph.sequence,
    previewSequence: preview.snapshot.sequence,
    agentAIntent: state('intent_A'),
    agentAAction: state('action_A'),
    agentBIntent: state('intent_B'),
    agentBAction: state('action_B'),
    existingOrder: 'UNKNOWN_NOT_CHAIN_VERIFIED',
    gateTestForThisScenario: 'LOCAL FOUNDRY: FinancialAuthorizationE2E.testIssuerRevocationFailsBeforePrecompile',
    precompileCalled: false,
    walletProviderCalled: false,
    orderStatus: 'NOT_SUBMITTED',
  });
}
