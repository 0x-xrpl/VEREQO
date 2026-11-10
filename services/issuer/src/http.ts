import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getAddress } from 'ethers';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { GraphError, type GraphCommand } from '../../../packages/consequence/src/index';
import { DemoRepository } from './demo';
import { IssuerError } from './store';
import { AgentProposalService } from './agent-api';
import { AgentRuntimeError, prepareAgentProposal, type AgentRequestRuntime } from './agent-runtime.js';
import { AgentProposalReplayError, AgentProposalStore } from './agent-proposals';
import { acceptAgentProposal, type AgentPolicy } from '../../../packages/domain/src/agent-request';
import { WalletAuthError, WalletAuthRegistry, type WalletAuthServerStage } from './wallet-auth';
import { InjectiveReadAdapter, type LiveSnapshot } from '../../../packages/domain/src/live-injective';
import { assertRegisteredGateMandate } from '../../../packages/domain/src/gate-mandate.js';
import { issuerOrderMandateDigest, parseIssuerOrderMandate, verifyIssuerOrderMandate } from '../../../packages/domain/src/order-mandate.js';
import { assertCurrentDisclosureHistory, authorizationFailureCode, FinancialAuthorizationError, getAuthorizationDigests, getAuthorizationRequestId, validateFinancialAuthorization } from './financial-authorization.js';
import { authorizationRequestDigest, FinancialAuthorizationStore } from './financial-authorization-store.js';
import { assembleOwnerReviewPackage, FinancialFinalizationError, type FinancialFinalizationConfiguredServices } from './financial-finalization.js';
import { FinancialFinalizationEvidenceStore } from './financial-finalization-store.js';
import { listRehearsalScenarios, loadRehearsalScenario, replayRehearsalScenario } from './demo-rehearsal';
import type { Groth16ProofEnvelope, CurrentIssuerMandate, ValidatedFinancialAuthorization } from './financial-authorization.js';
import type { GateManifest, RegisteredGateMandate } from '../../../packages/domain/src/gate-mandate.js';
import { parseDisclosureBinding, type CurrentDisclosureHistory, type DisclosureBinding } from '../../../packages/domain/src/disclosure-binding.js';

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function exact(body: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(body).sort().join(',') !== keys.sort().join(',')) throw new HttpError(400, 'INVALID_FIELDS');
}
async function parseBody(req: IncomingMessage, maxBytes = 4096): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new HttpError(415, 'JSON_REQUIRED');
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk); length += buffer.length;
    if (length > maxBytes) throw new HttpError(413, 'BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, 'INVALID_JSON'); }
}

export function createLocalApp(options: {
  databasePath: string;
  staticRoot?: string;
  injective?: InjectiveReadAdapter;
  agentPolicy?: AgentPolicy;
  agentProvider?: {configured:boolean;id:string};
  agentRuntime?: AgentRequestRuntime;
  financialFinalization?: FinancialFinalizationConfiguredServices;
  nowSeconds?: () => number;
  financialAuthorization?: {
    currentMandate: () => CurrentIssuerMandate | null;
    gateManifest: GateManifest;
    readGateMandate: (credentialId: string) => Promise<RegisteredGateMandate>;
    readCurrentDisclosureHistory?: (binding: DisclosureBinding) => Promise<CurrentDisclosureHistory | null>;
    verifyProof: (proof: Groth16ProofEnvelope['proof'], publicSignals: readonly string[]) => Promise<boolean>;
  };
}) {
  if (options.databasePath !== ':memory:') mkdirSync(dirname(resolve(options.databasePath)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(options.databasePath);
  const repo = new DemoRepository(db);
  const agentProposals = new AgentProposalStore(db);
  const financialAuthorization = new FinancialAuthorizationStore(db);
  const financialFinalizationEvidence = new FinancialFinalizationEvidenceStore(db);
  const staticRoot = resolve(options.staticRoot ?? 'dist/web');
  const auth = new Map<string, WalletAuthRegistry>();
  const runtimePreparations = new Set<string>();
  const authInstance = randomUUID(); // Public process identity, never an authentication credential.
  const injective = options.injective ?? new InjectiveReadAdapter();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
    try {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 4317;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5173', 'localhost:5173']);
      if (!req.headers.host || !allowedHosts.has(req.headers.host)) throw new HttpError(403, 'INVALID_HOST');
      if (req.headers.origin && ![...allowedHosts].some(host => req.headers.origin === `http://${host}`)) throw new HttpError(403, 'INVALID_ORIGIN');
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = requestUrl.pathname;
      if(path==='/api/agent/status' && req.method==='GET'){
        json(res,200,{status:options.agentPolicy?'CONFIGURED_INGRESS':'NOT_CONFIGURED',providerConfigured:options.agentProvider?.configured??false,autonomousRuntime:options.agentRuntime?'CONFIGURED_NOT_VERIFIED':'NOT_IMPLEMENTED',execution:'NOT_IMPLEMENTED',...(options.agentRuntime?{requestRuntime:'UNSIGNED_PROPOSAL_GENERATION'}:{})});return;
      }
      if (path === '/api/demo/scenarios') {
        if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        json(res, 200, { dataClass: 'SYNTHETIC_REHEARSAL', scenarios: listRehearsalScenarios() }); return;
      }
      if (path === '/api/demo/load') {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        const body = await parseBody(req, 512); exact(body, ['scenarioId']);
        json(res, 200, { scenario: loadRehearsalScenario(body.scenarioId) }); return;
      }
      if (path === '/api/demo/replay') {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        const body = await parseBody(req, 512); exact(body, ['scenarioId', 'businessId', 'revision']);
        const scenario = loadRehearsalScenario(body.scenarioId);
        if (body.businessId !== scenario.businessId || body.revision !== scenario.revision) throw new HttpError(409, 'SCENARIO_REVISION_MISMATCH');
        json(res, 200, { result: await replayRehearsalScenario(scenario.scenarioId) }); return;
      }
      if (path === '/api/demo/reset') {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        const body = await parseBody(req, 512); exact(body, ['scenarioId', 'businessId', 'revision']);
        const scenario = loadRehearsalScenario(body.scenarioId);
        if (body.businessId !== scenario.businessId || body.revision !== scenario.revision) throw new HttpError(409, 'SCENARIO_REVISION_MISMATCH');
        json(res, 200, { status: 'RESET', businessId: scenario.businessId, revision: scenario.revision, dataMutation: false, scope: 'LOCAL_REHEARSAL_STATE_ONLY' }); return;
      }
      if (path === '/api/agent/request-review') {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        const origin = req.headers.origin, token = req.headers['x-vereqo-session'];
        const session = origin && typeof token === 'string' ? auth.get(origin)?.authenticate(token) : null;
        if (!session) throw new HttpError(401, 'WALLET_AUTHENTICATION_REQUIRED');
        const input = await parseBody(req, 4096);
        exact(input, ['requestId', 'draft']);
        const requestId = getAuthorizationRequestId(input);
        if (!requestId) throw new HttpError(400, 'INVALID_REQUEST_ID');
        const rawDraft = input.draft;
        if (!rawDraft || typeof rawDraft !== 'object' || Array.isArray(rawDraft)) throw new HttpError(400, 'INVALID_DRAFT');
        const draft = rawDraft as Record<string, unknown>;
        exact(draft, ['chainId', 'marketKind', 'marketId', 'side', 'orderType', 'price', 'quantity']);
        const decimalDraft = (value: unknown) => typeof value === 'string' && value.length <= 100 &&
          (value === '' || /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value));
        if (draft.chainId !== '1439' || (draft.marketKind !== 'SPOT' && draft.marketKind !== 'DERIVATIVE') ||
            (draft.marketId !== null && (typeof draft.marketId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(draft.marketId))) ||
            (draft.side !== 'BUY' && draft.side !== 'SELL') || draft.orderType !== 'LIMIT' ||
            !decimalDraft(draft.price) || !decimalDraft(draft.quantity)) throw new HttpError(400, 'INVALID_DRAFT');
        const now = options.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
        const requestDigest = authorizationRequestDigest(input);
        const evidence = financialAuthorization.recordRejected({
          requestId, principal: session.address, reason: 'SIGNED_AUTHORIZATION_PACKAGE_REQUIRED',
          intentDigest: null, mandateDigest: null, requestDigest, createdAt: new Date(now * 1000).toISOString(),
        });
        json(res, 200, { status: evidence.status, reason: evidence.reason, authorized: false, execution: 'NOT_IMPLEMENTED', evidence });
        return;
      }
      if (path === '/api/agent/authorize' || path === '/api/agent/run' || path === '/api/agent/finalize') {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        const origin = req.headers.origin, token = req.headers['x-vereqo-session'];
        const session = origin && typeof token === 'string' ? auth.get(origin)?.authenticate(token) : null;
        if (!session) throw new HttpError(401, 'WALLET_AUTHENTICATION_REQUIRED');
        if (!options.agentPolicy) {
          json(res,503,{status:'NOT_CONFIGURED',authorized:false,execution:'NOT_IMPLEMENTED'});return;
        }
        if (path === '/api/agent/run') {
          const trigger = await parseBody(req, 2_048); exact(trigger, ['requestId', 'objective']);
          const requestId = getAuthorizationRequestId(trigger);
          if (!requestId) throw new HttpError(400, 'INVALID_REQUEST_ID');
          if (typeof trigger.objective !== 'string' || trigger.objective.trim().length < 1 || trigger.objective.length > 1024) throw new HttpError(400, 'INVALID_AGENT_OBJECTIVE');
          const objective = trigger.objective.trim();
          try {
            const prior = agentProposals.resolveRun(session.address, requestId, objective);
            if (prior) {
              json(res,200,{requestId,status:'PROPOSAL_READY',proposal:prior.proposal,objectiveDigest:prior.objectiveDigest,proposalDigest:prior.proposalDigest,idempotent:true,authorized:false,execution:'NOT_IMPLEMENTED',ownerAction:'REVIEW_AND_SIGN_SEPARATELY'});
              return;
            }
          } catch (error) {
            if (error instanceof AgentProposalReplayError) throw new HttpError(409,error.code);
            throw new HttpError(503,'AGENT_RUN_RECORD_UNAVAILABLE');
          }
          if (!options.agentRuntime || !options.agentProvider?.configured) {
            json(res,503,{status:'NOT_CONFIGURED',reason:'AGENT_RUNTIME_NOT_CONFIGURED',authorized:false,execution:'NOT_IMPLEMENTED'});return;
          }
          let snapshot: LiveSnapshot;
          try { snapshot = await injective.snapshot(options.agentPolicy.marketId); }
          catch { json(res,503,{status:'UNKNOWN',reason:'TESTNET_READ_UNAVAILABLE',authorized:false,execution:'NOT_IMPLEMENTED'});return; }
          const preparationKey = session.address.toLowerCase() + ':' + requestId;
          if (runtimePreparations.has(preparationKey)) throw new HttpError(409,'AGENT_REQUEST_IN_PROGRESS');
          if (runtimePreparations.size >= 16) throw new HttpError(503,'AGENT_RUNTIME_CAPACITY');
          runtimePreparations.add(preparationKey);
          let proposal: Record<string, unknown>;
          const runtimeNow = options.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
          try {
            proposal = await prepareAgentProposal(options.agentRuntime, {
              requestId,
              objective,
              principal: session.address,
              policy: options.agentPolicy,
              snapshot,
              now: String(runtimeNow),
            });
          } catch (error) {
            const reason = error instanceof AgentRuntimeError ? error.code : 'AGENT_RUNTIME_UNAVAILABLE';
            json(res,422,{requestId,status:'REJECTED_BEFORE_AUTHORIZATION',reason,authorized:false,execution:'NOT_IMPLEMENTED'});return;
          } finally { runtimePreparations.delete(preparationKey); }
          // Model work is untrusted. Recheck the owner session before storing its proposal.
          if (auth.get(origin!)?.authenticate(token as string)?.address !== session.address) throw new HttpError(401,'WALLET_SESSION_INVALIDATED');
          const proposalNow = options.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
          const service = new AgentProposalService(() => ({
            sessionPrincipal: session.address,
            policy: options.agentPolicy!,
            snapshot,
            now: String(proposalNow),
            usedNonces: new Set<string>(),
            provider: options.agentProvider ?? { configured: false, id: 'UNCONFIGURED' },
          }));
          try {
            const accepted = service.propose(proposal);
            const stored = agentProposals.recordRun(session.address,requestId,objective,accepted);
            json(res,200,{requestId,status:'PROPOSAL_READY',proposal:stored.proposal,objectiveDigest:stored.objectiveDigest,proposalDigest:stored.proposalDigest,idempotent:stored.idempotent,authorized:false,execution:'NOT_IMPLEMENTED',ownerAction:'REVIEW_AND_SIGN_SEPARATELY'});
          } catch (error) {
            if (error instanceof AgentProposalReplayError) throw new HttpError(409,error.code);
            json(res,422,{requestId,status:'REJECTED_BEFORE_AUTHORIZATION',reason:'AGENT_PROPOSAL_REJECTED',authorized:false,execution:'NOT_IMPLEMENTED'});
          }
          return;
        }
        if (path === '/api/agent/finalize') {
          if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
          if (!options.agentPolicy || !options.agentProvider?.configured || !options.financialAuthorization || !options.financialFinalization) {
            json(res,503,{status:'NOT_CONFIGURED',reason:'FINALIZATION_ADAPTERS_NOT_CONFIGURED',authorized:false,execution:'NOT_IMPLEMENTED'});return;
          }
          const body = await parseBody(req, 2_048); exact(body, ['requestId', 'objective']);
          const requestId = getAuthorizationRequestId(body);
          if (!requestId) throw new HttpError(400, 'INVALID_REQUEST_ID');
          if (typeof body.objective !== 'string' || body.objective.trim().length < 1 || body.objective.length > 1_024) throw new HttpError(400, 'INVALID_AGENT_OBJECTIVE');
          let run;
          try { run = agentProposals.resolveRun(session.address, requestId, body.objective.trim()); }
          catch (error) {
            if (error instanceof AgentProposalReplayError) throw new HttpError(409,error.code);
            throw new HttpError(503,'AGENT_RUN_RECORD_UNAVAILABLE');
          }
          if (!run) throw new HttpError(404,'AGENT_PROPOSAL_NOT_FOUND');
          const createdAt = new Date(options.nowSeconds?.() ?? Math.floor(Date.now() / 1000)).toISOString();
          const assertCurrentSession = () => {
            const currentSession = typeof origin === 'string' && typeof token === 'string'
              ? auth.get(origin)?.authenticate(token) : null;
            if (!currentSession || currentSession.address.toLowerCase() !== session.address.toLowerCase()) throw Error('WALLET_SESSION_INVALIDATED');
          };
          const adapters = {
            ...options.financialFinalization,
            now: () => String(options.nowSeconds?.() ?? Math.floor(Date.now() / 1000)),
            assertSessionCurrent: assertCurrentSession,
            readSnapshot: () => injective.snapshot(options.agentPolicy!.marketId),
            readExchangeQuoteBalance: (subaccountId: string, denom: string) => injective.exchangeSubaccountDeposit(subaccountId,denom),
            admitDisclosure: options.financialFinalization.admitDisclosure,
            readCurrentDisclosureHistory: options.financialAuthorization.readCurrentDisclosureHistory ?? (async () => null),
            resolveMandate: async () => options.financialAuthorization!.currentMandate(),
            readGateMandate: options.financialAuthorization.readGateMandate,
            generateProof: options.financialFinalization.generateProof,
            verifyProof: options.financialAuthorization.verifyProof,
          };
          try {
            const reviewPackage = await assembleOwnerReviewPackage({
              requestId, proposal: run.proposal,
              agent: { sessionPrincipal: session.address, policy: options.agentPolicy, usedNonces: new Set<string>(), provider: options.agentProvider },
              gateManifest: options.financialAuthorization.gateManifest, adapters,
            });
            assertCurrentSession();
            const evidence = financialFinalizationEvidence.recordOwnerReview({
              package: reviewPackage, principal: session.address, objectiveDigest: run.objectiveDigest,
              proposalDigest: run.proposalDigest, createdAt,
            });
            const replayed = evidence.status === 'REJECTED';
            json(res,replayed?409:200,{
              status:evidence.status,ownerSignatureStatus:evidence.ownerSignatureStatus,ownerAction:'REVIEW_AND_SIGN_SEPARATELY',
              authorized:false,execution:'NOT_IMPLEMENTED',replayed,reviewPackage:replayed?undefined:reviewPackage,evidence,
            });
          } catch (error) {
            const reason = error instanceof FinancialFinalizationError ? error.code : 'FINALIZATION_FAILED';
            const requestDigest = authorizationRequestDigest({ requestId, objectiveDigest: run.objectiveDigest, proposalDigest: run.proposalDigest, reason });
            const evidence = financialFinalizationEvidence.recordRejected({ requestId, principal: session.address, reason, requestDigest, createdAt });
            const sessionLost = reason === 'WALLET_SESSION_INVALIDATED';
            const conflict = reason === 'DISCLOSURE_ADMISSION_OR_ANCHOR_CAS_FAILED' || evidence.reason === 'REQUEST_ID_CONFLICT';
            json(res,sessionLost?401:conflict?409:422,{
              status:evidence.status,reason:evidence.reason ?? reason,ownerSignatureStatus:'NOT_REQUESTED',
              authorized:false,execution:'NOT_IMPLEMENTED',evidence,
            });
          }
          return;
        }
        if (!options.financialAuthorization) {
          json(res,503,{status:'NOT_CONFIGURED',authorized:false,execution:'NOT_IMPLEMENTED'});return;
        }
        const input = await parseBody(req, 16_384);
        const now = options.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
        const createdAt = new Date(now * 1000).toISOString();
        const requestDigest = authorizationRequestDigest(input);
        const requestId = getAuthorizationRequestId(input);
        if (requestId) {
          const prior = financialAuthorization.resolveRequest(requestId, session.address, requestDigest, createdAt);
          if (prior) {
            const { evidence } = prior;
            const status = evidence.status === 'PRE_GATE_VALIDATED' ? 200 : evidence.reason === 'REPLAY' || prior.kind === 'CONFLICT' ? 409 : 422;
            json(res, status, { status: evidence.status, reason: evidence.reason, authorized: false, execution: 'NOT_IMPLEMENTED', idempotent: prior.kind === 'MATCH', evidence });
            return;
          }
        }
        let result: ValidatedFinancialAuthorization;
        try {
          let snapshot;
          try { snapshot = await injective.snapshot(options.agentPolicy.marketId); }
          catch {
            const evidence = financialAuthorization.recordRejected({
              requestId: getAuthorizationRequestId(input), principal: session.address,
              reason: 'TESTNET_READ_UNAVAILABLE', ...getAuthorizationDigests(input), requestDigest, createdAt,
            });
            const acceptedEarlier = evidence.status === 'PRE_GATE_VALIDATED';
            json(res, acceptedEarlier ? 200 : 503, {status:evidence.status,reason:evidence.reason ?? 'TESTNET_READ_UNAVAILABLE',authorized:false,execution:'NOT_IMPLEMENTED',idempotent:acceptedEarlier,evidence});return;
          }
          result = await validateFinancialAuthorization(input, {
            agent: {
              sessionPrincipal: session.address,
              policy: options.agentPolicy,
              snapshot,
              now: String(now),
              usedNonces: new Set<string>(),
              provider: options.agentProvider ?? {configured:false,id:'UNCONFIGURED'},
            },
            currentMandate: options.financialAuthorization.currentMandate(),
            gateManifest: options.financialAuthorization.gateManifest,
            readGateMandate: options.financialAuthorization.readGateMandate,
            readCurrentDisclosureHistory: options.financialAuthorization.readCurrentDisclosureHistory ?? (async () => null),
            verifyProof: options.financialAuthorization.verifyProof,
          });
          const currentNow = () => options.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
          const assertCurrentSession = () => {
            const currentSession = typeof origin === 'string' && typeof token === 'string'
              ? auth.get(origin)?.authenticate(token) : null;
            if (!currentSession || currentSession.address.toLowerCase() !== session.address.toLowerCase()) {
              throw new FinancialAuthorizationError('WALLET_SESSION_INVALIDATED');
            }
          };
          const assertCurrentMandate = () => {
            const envelope = options.financialAuthorization!.currentMandate();
            if (!envelope) throw new FinancialAuthorizationError('ISSUER_MANDATE_NOT_CONFIGURED');
            let mandate;
            try { mandate = parseIssuerOrderMandate(envelope.mandate); }
            catch { throw new FinancialAuthorizationError('INVALID_MANDATE'); }
            if (!verifyIssuerOrderMandate(mandate, envelope.signature)) {
              throw new FinancialAuthorizationError('ISSUER_CONFIGURATION_SIGNATURE_INVALID');
            }
            if (!mandate.active) throw new FinancialAuthorizationError('MANDATE_REVOKED');
            if (issuerOrderMandateDigest(mandate) !== result.mandateDigest) {
              throw new FinancialAuthorizationError('MANDATE_STALE');
            }
            const timestamp = BigInt(currentNow());
            if (BigInt(mandate.expiry) <= timestamp) throw new FinancialAuthorizationError('MANDATE_EXPIRED');
            if (BigInt(result.intent.deadline) <= timestamp) throw new FinancialAuthorizationError('INTENT_EXPIRED');
            return mandate;
          };

          // Validation awaits public reads and Groth16 verification. Recheck the
          // live context after those awaits; this still creates only PRE_GATE evidence.
          assertCurrentSession();
          let currentSnapshot: LiveSnapshot;
          try { currentSnapshot = await injective.snapshot(options.agentPolicy.marketId); }
          catch { throw new FinancialAuthorizationError('TESTNET_READ_UNAVAILABLE'); }
          assertCurrentSession();
          try {
            acceptAgentProposal({
              requestId: result.requestId, source: result.source, intent: result.intent,
            }, {
              sessionPrincipal: session.address,
              policy: options.agentPolicy,
              snapshot: currentSnapshot,
              now: String(currentNow()),
              usedNonces: new Set<string>(),
              expectedDisclosureRequestId: result.intent.disclosureRequestId,
              provider: options.agentProvider ?? { configured: false, id: 'UNCONFIGURED' },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : '';
            throw new FinancialAuthorizationError(/^[A-Z0-9_]{1,80}$/.test(message) ? message : 'MARKET_REVALIDATION_FAILED');
          }

          const mandateBeforeGateRead = assertCurrentMandate();
          let registeredGateMandate: RegisteredGateMandate;
          try {
            registeredGateMandate = await options.financialAuthorization.readGateMandate(mandateBeforeGateRead.credentialId);
          } catch {
            throw new FinancialAuthorizationError('GATE_STATE_UNAVAILABLE');
          }
          assertCurrentSession();
          if (result.disclosureBindingDigest) {
            let binding: DisclosureBinding;
            try {
              const envelope = input.disclosureBinding as { binding?: unknown } | undefined;
              binding = parseDisclosureBinding(envelope?.binding);
            } catch { throw new FinancialAuthorizationError('DISCLOSURE_BINDING_INVALID'); }
            let currentHistory: CurrentDisclosureHistory | null;
            try {
              currentHistory = await (options.financialAuthorization.readCurrentDisclosureHistory ?? (async () => null))(binding);
            } catch { throw new FinancialAuthorizationError('DISCLOSURE_HISTORY_UNAVAILABLE'); }
            assertCurrentDisclosureHistory(binding, currentHistory);
            assertCurrentSession();
          }
          // The disclosure head read is the final await. Recheck the captured snapshot,
          // mandate and Gate state synchronously before appending pre-Gate evidence.
          try {
            acceptAgentProposal({
              requestId: result.requestId, source: result.source, intent: result.intent,
            }, {
              sessionPrincipal: session.address,
              policy: options.agentPolicy,
              snapshot: currentSnapshot,
              now: String(currentNow()),
              usedNonces: new Set<string>(),
              expectedDisclosureRequestId: result.intent.disclosureRequestId,
              provider: options.agentProvider ?? { configured: false, id: 'UNCONFIGURED' },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : '';
            throw new FinancialAuthorizationError(/^(?:[A-Z0-9_]{1,80}|POLICY_[A-Za-z0-9_]{1,64})$/.test(message) ? message : 'MARKET_REVALIDATION_FAILED');
          }
          const mandateAfterGateRead = assertCurrentMandate();
          try {
            assertRegisteredGateMandate(mandateAfterGateRead, registeredGateMandate, options.financialAuthorization.gateManifest);
          } catch {
            throw new FinancialAuthorizationError('GATE_MANDATE_CHANGED_DURING_VALIDATION');
          }
          assertCurrentSession();
        } catch (error) {
          const reason = authorizationFailureCode(error);
          const evidence = financialAuthorization.recordRejected({
            requestId: getAuthorizationRequestId(input), principal: session.address, reason,
            ...getAuthorizationDigests(input), requestDigest, createdAt,
          });
          const acceptedEarlier = evidence.status === 'PRE_GATE_VALIDATED';
          json(res, reason === 'WALLET_SESSION_INVALIDATED' ? 401 : acceptedEarlier ? 200 : evidence.reason === 'REPLAY' || evidence.reason === 'REQUEST_ID_CONFLICT' ? 409 : 422,
            {status:evidence.status,reason:evidence.reason ?? reason,authorized:false,execution:'NOT_IMPLEMENTED',idempotent:acceptedEarlier,evidence});return;
        }
        const evidence = financialAuthorization.recordValidated(result, createdAt, requestDigest);
        if (evidence.status === 'REJECTED') {
          json(res,409,{status:'REJECTED',reason:evidence.reason,authorized:false,execution:'NOT_IMPLEMENTED',evidence});return;
        }
        json(res,200,{...result,evidence});return;
      }
      const evidenceRequest = /^\/api\/agent\/authorization\/([a-zA-Z0-9_-]{1,64})$/.exec(path);
      if (evidenceRequest && req.method === 'GET') {
        const origin = req.headers.origin ?? `http://${req.headers.host}`, token = req.headers['x-vereqo-session'];
        const session = origin && typeof token === 'string' ? auth.get(origin)?.authenticate(token) : null;
        if (!session) throw new HttpError(401, 'WALLET_AUTHENTICATION_REQUIRED');
        const evidence = financialAuthorization.latest(evidenceRequest[1]!, session.address);
        if (!evidence) throw new HttpError(404, 'AUTHORIZATION_EVIDENCE_NOT_FOUND');
        const before = requestUrl.searchParams.get('before');
        if (before !== null && !/^[1-9][0-9]{0,18}$/.test(before)) throw new HttpError(400, 'INVALID_EVIDENCE_CURSOR');
        const rawLimit = requestUrl.searchParams.get('limit');
        if (rawLimit !== null && !/^[0-9]{1,2}$/.test(rawLimit)) throw new HttpError(400, 'INVALID_EVIDENCE_LIMIT');
        const page = financialAuthorization.history(evidenceRequest[1]!, session.address, before, rawLimit === null ? 20 : Number(rawLimit));
        json(res,200,{evidence,events:page.events,nextCursor:page.nextCursor});return;
      }
      const finalizationRequest = /^\/api\/agent\/finalization\/([a-zA-Z0-9_-]{1,64})$/.exec(path);
      if (finalizationRequest && req.method === 'GET') {
        const origin = req.headers.origin ?? `http://${req.headers.host}`, token = req.headers['x-vereqo-session'];
        const session = origin && typeof token === 'string' ? auth.get(origin)?.authenticate(token) : null;
        if (!session) throw new HttpError(401, 'WALLET_AUTHENTICATION_REQUIRED');
        const history = financialFinalizationEvidence.history(finalizationRequest[1]!,session.address);
        if (!history) throw new HttpError(404,'FINALIZATION_EVIDENCE_NOT_FOUND');
        json(res,200,history);return;
      }
      const evidenceById = /^\/api\/agent\/evidence\/([1-9][0-9]{0,18})$/.exec(path);
      if (evidenceById && req.method === 'GET') {
        const origin = req.headers.origin ?? `http://${req.headers.host}`, token = req.headers['x-vereqo-session'];
        const session = origin && typeof token === 'string' ? auth.get(origin)?.authenticate(token) : null;
        if (!session) throw new HttpError(401, 'WALLET_AUTHENTICATION_REQUIRED');
        const evidence = financialAuthorization.byId(evidenceById[1]!, session.address);
        if (!evidence) throw new HttpError(404, 'AUTHORIZATION_EVIDENCE_NOT_FOUND');
        json(res,200,{evidence});return;
      }
      if(path==='/api/agent/propose'){
        if(req.method!=='POST')throw new HttpError(405,'METHOD_NOT_ALLOWED');
        const origin=req.headers.origin,token=req.headers['x-vereqo-session'];
        const session=origin&&typeof token==='string'?auth.get(origin)?.authenticate(token):null;
        if(!session)throw new HttpError(401,'WALLET_AUTHENTICATION_REQUIRED');
        if(!options.agentPolicy){json(res,503,{status:'NOT_CONFIGURED',execution:'NOT_IMPLEMENTED'});return;}
        const input=await parseBody(req);
        let snapshot;try{snapshot=await injective.snapshot(options.agentPolicy.marketId);}catch{throw new HttpError(503,'TESTNET_READ_UNAVAILABLE');}
        const service=new AgentProposalService(()=>({sessionPrincipal:session.address,policy:options.agentPolicy!,snapshot,now:String(Math.floor(Date.now()/1000)),usedNonces:new Set<string>(),provider:options.agentProvider??{configured:false,id:'UNCONFIGURED'}}));
        try {
          json(res,200,agentProposals.record(service.propose(input)));
        } catch (error) {
          if (error instanceof AgentProposalReplayError) throw new HttpError(409,'AGENT_PROPOSAL_REPLAY');
          throw new HttpError(400,'AGENT_PROPOSAL_REJECTED');
        }
        return;
      }
      if (path === '/api/financial/market' && req.method === 'GET') {
        try { json(res,200,{snapshot:await injective.snapshot()}); }
        catch { json(res,503,{status:'UNKNOWN',reason:'TESTNET_READ_UNAVAILABLE',execution:'NOT_IMPLEMENTED'}); }
        return;
      }
      if (path === '/api/financial/exchange-balance' && req.method === 'GET') {
        const origin=req.headers.origin,token=req.headers['x-vereqo-session'];
        const session=origin&&typeof token==='string'?auth.get(origin)?.authenticate(token):null;
        if(!session)throw new HttpError(401,'WALLET_AUTHENTICATION_REQUIRED');
        const policy=options.agentPolicy;
        if(!policy){json(res,503,{status:'NOT_CONFIGURED',authorized:false,execution:'NOT_IMPLEMENTED'});return;}
        let principal:string,gate:string;
        try{principal=getAddress(policy.principal);gate=getAddress(policy.gate);}catch{throw new HttpError(503,'INVALID_SERVER_POLICY');}
        if(session.address!==principal)throw new HttpError(403,'POLICY_PRINCIPAL_MISMATCH');
        let snapshot:LiveSnapshot;
        try{snapshot=await injective.snapshot(policy.marketId);}catch{json(res,503,{status:'UNKNOWN',reason:'TESTNET_READ_UNAVAILABLE',authorized:false,execution:'NOT_IMPLEMENTED'});return;}
        if(snapshot.market.marketId!==policy.marketId)throw new HttpError(409,'MARKET_CONFIGURATION_MISMATCH');
        const subaccountId=policy.subaccountId.toLowerCase();
        if(!/^0x[0-9a-f]{64}$/.test(subaccountId)||subaccountId.slice(0,42)!==gate.toLowerCase())throw new HttpError(503,'INVALID_SERVER_SUBACCOUNT_POLICY');
        try{
          const exchangeBalance=await injective.exchangeSubaccountDeposit(subaccountId,snapshot.market.quoteDenom);
          json(res,200,{status:'LIVE_READ_ONLY',authorized:false,execution:'NOT_IMPLEMENTED',custodyMode:'DIRECT_GATE_OWNED_SUBACCOUNT',exchangeBalance,capabilities:{deposit:'LOCAL_ONLY_NOT_RUNTIME_VERIFIED',order:'ACTIONGATE_RISK_BLOCKED',cancel:'LOCAL_ONLY_NOT_RUNTIME_VERIFIED',withdraw:'LOCAL_ONLY_NOT_RUNTIME_VERIFIED',gateBankRecovery:'OWNER_ONLY_LOCAL_NOT_RUNTIME_VERIFIED',principalRecovery:'EXCHANGE_PRINCIPAL_SUBACCOUNT_ONLY_LOCAL_RUNTIME_UNVERIFIED'}});
        }catch{json(res,503,{status:'UNKNOWN',reason:'EXCHANGE_BALANCE_READ_UNAVAILABLE',authorized:false,execution:'NOT_IMPLEMENTED'});}
        return;
      }
      if (path.startsWith('/api/wallet/')) {
        res.setHeader('X-Vereqo-Auth-Instance', authInstance);
        const requestedCorrelation=req.headers['x-vereqo-auth-correlation'];
        const correlationId=typeof requestedCorrelation==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedCorrelation)?requestedCorrelation:randomUUID();
        res.setHeader('X-Vereqo-Auth-Correlation',correlationId);
        res.setHeader('X-Vereqo-Auth-Stage','REQUEST_RECEIVED');
        const origin=req.headers.origin ?? (req.method==='GET' ? `http://${req.headers.host}` : undefined);
        if (!origin || ![...allowedHosts].some(host => origin === `http://${host}`)) throw new HttpError(403,'AUTH_ORIGIN_REQUIRED');
        let registry=auth.get(origin); if(!registry){registry=new WalletAuthRegistry(origin, () => options.nowSeconds?.() ?? Math.floor(Date.now()/1000));auth.set(origin,registry);}
        const token=req.headers['x-vereqo-session'];
        if(path==='/api/wallet/status' && req.method==='GET'){
          const session=typeof token==='string'?registry.authenticate(token):null;
          res.setHeader('X-Vereqo-Auth-Stage',session?'SESSION_STATUS_CONFIRMED':'SESSION_STATUS_EMPTY');
          json(res,200,{session});return;
        }
        if(req.method!=='POST')throw new HttpError(405,'METHOD_NOT_ALLOWED');
        const body=await parseBody(req);
        if(path==='/api/wallet/challenge'){
          res.setHeader('X-Vereqo-Auth-Stage','CHALLENGE_REQUEST_VALIDATED');
          exact(body,['address']);if(typeof body.address!=='string')throw new HttpError(400,'INVALID_ADDRESS');
          try {const challenge=registry.issue(body.address);res.setHeader('X-Vereqo-Auth-Stage','CHALLENGE_CREATED');json(res,200,{challenge});}
          catch(error) {
            if(error instanceof Error && error.message==='AUTH_CAPACITY') throw new HttpError(503,'CHALLENGE_CAPACITY');
            throw new HttpError(400,'INVALID_ADDRESS');
          }
          return;
        }
        if(path==='/api/wallet/verify'){
          res.setHeader('X-Vereqo-Auth-Stage','VERIFY_REQUEST_RECEIVED');
          exact(body,['nonce','signature']);if(typeof body.nonce!=='string'||typeof body.signature!=='string')throw new HttpError(400,'INVALID_AUTH_REQUEST');
          const stages:WalletAuthServerStage[]=[];
          try {
            const session=registry.verify(body.nonce,body.signature,origin,stage=>stages.push(stage));
            res.setHeader('X-Vereqo-Auth-Stages',stages.join(','));
            res.setHeader('X-Vereqo-Auth-Stage','SESSION_ISSUED');
            json(res,200,{session});
          }
          catch(error) {
            let code: string=error instanceof WalletAuthError?error.code:'AUTHENTICATION_FAILED';
            res.setHeader('X-Vereqo-Auth-Stages',stages.join(','));
            res.setHeader('X-Vereqo-Auth-Stage',stages.at(-1)??'VERIFY_REJECTED');
            if(error instanceof WalletAuthError)res.setHeader('X-Vereqo-Auth-Diagnostic',error.diagnostic);
            if(code==='CHALLENGE_UNKNOWN'&&[...auth].some(([issuedOrigin,issuedRegistry])=>issuedOrigin!==origin&&issuedRegistry.knowsChallenge(body.nonce as string))) code='ORIGIN_MISMATCH';
            const status=code==='CHALLENGE_EXPIRED'?410:code==='CHALLENGE_ALREADY_USED'?409:code==='CHALLENGE_UNKNOWN'?404:code==='ORIGIN_MISMATCH'?403:code==='SESSION_CAPACITY'?503:401;
            throw new HttpError(status,code);
          }
          return;
        }
        if(path==='/api/wallet/logout'){exact(body,[]);if(typeof token==='string')registry.revoke(token);res.setHeader('X-Vereqo-Auth-Stage','SESSION_REVOKED');json(res,200,{status:'DISCONNECTED'});return;}
        throw new HttpError(404,'NOT_FOUND');
      }
      if (path === '/api/state' && req.method === 'GET') { json(res, 200, repo.state()); return; }
      if (path.startsWith('/api/')) {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        const token = req.headers['x-vereqo-token'];
        // Reject non-ASCII bytes before timingSafeEqual's equal-byte-length precondition.
        if (typeof token !== 'string' || !/^[0-9a-f]{48}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(repo.requestToken))) throw new HttpError(403, 'INVALID_REQUEST_TOKEN');
        const body = await parseBody(req);
        // Body streaming yields to other requests; reset may rotate the generation.
        // Keep this check adjacent to the synchronous dispatch below.
        if (!timingSafeEqual(Buffer.from(token), Buffer.from(repo.requestToken))) throw new HttpError(403, 'INVALID_REQUEST_TOKEN');
        if (path === '/api/preflight') {
          exact(body, ['threshold', 'policyEpoch']);
          const preflight = repo.issuer.preflight(repo.context, { threshold: body.threshold, policyEpoch: body.policyEpoch as number });
          json(res, 200, { preflight }); return;
        } else if (path === '/api/query') {
          exact(body, ['threshold', 'idempotencyKey', 'policyEpoch']);
          repo.issuer.request(repo.context, { threshold: body.threshold, idempotencyKey: body.idempotencyKey as string, policyEpoch: body.policyEpoch as number });
        } else if (path === '/api/preview') {
          json(res, 200, repo.preview(body as unknown as GraphCommand)); return;
        } else if (path === '/api/graph') repo.command(body as unknown as GraphCommand);
        else if (path === '/api/reset') { exact(body, []); repo.reset(); }
        else throw new HttpError(404, 'NOT_FOUND');
        json(res, 200, { state: repo.state() }); return;
      }
      if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      const file = resolve(staticRoot, path === '/' ? 'index.html' : `.${path}`);
      if (!file.startsWith(staticRoot + sep)) throw new HttpError(404, 'NOT_FOUND');
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain' };
      const mime = types[extname(file)]; if (!mime) throw new HttpError(404, 'NOT_FOUND');
      let content; try { content = await readFile(file); } catch { throw new HttpError(404, 'NOT_FOUND'); }
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` }); res.end(content);
    } catch (e) {
      if (res.headersSent || res.destroyed) { res.end(); return; }
      if (e instanceof HttpError) json(res, e.status, { error: e.message });
      else if (e instanceof IssuerError) json(res, e.code === 'UNAUTHORIZED' ? 403 : e.code === 'INVALID_INPUT' ? 400 : e.code === 'STALE_POLICY' || e.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 503, { error: e.code });
      else if (e instanceof GraphError) json(res, e.code.includes('CONFLICT') || e.code.includes('SEQUENCE') || e.code.includes('EPOCH') || e.code.includes('REVOKED') ? 409 : 400, { error: e.code });
      else json(res, 503, { error: 'LOCAL_SERVICE_UNAVAILABLE' });
    }
  });
  return { server, close: async () => {
    if (server.listening) await new Promise<void>((resolveClose, reject) => server.close(e => e ? reject(e) : resolveClose()));
    repo.close();
  } };
}
