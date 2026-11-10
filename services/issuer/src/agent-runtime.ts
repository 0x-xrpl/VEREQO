import { getAddress } from 'ethers';
import type { AgentPolicy } from '../../../packages/domain/src/agent-request.js';
import type { LiveSnapshot } from '../../../packages/domain/src/live-injective.js';

/** Read-only input for an Agent proposal. It contains no wallet token or signer. */
export interface AgentProposalRuntimeContext {
  readonly requestId: string;
  readonly objective: string;
  readonly principal: string;
  readonly policy: AgentPolicy;
  readonly snapshot: LiveSnapshot;
  readonly now: string;
  readonly signal: AbortSignal;
}

/** Untrusted providers may propose; the owner and authorization pipeline decide. */
export interface AgentRequestRuntime {
  generateProposal(context: AgentProposalRuntimeContext): Promise<unknown>;
}

export class AgentRuntimeError extends Error {
  constructor(readonly code: string) { super(code); }
}

function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeTree(child);
  }
  return value;
}

/**
 * Invokes one bounded proposal generation. The returned object is only an
 * unsigned proposal; the normal owner-signature, credential, proof, mandate,
 * ActionGate, and Evidence checks are separate and remain fail-closed.
 */
export async function prepareAgentProposal(
  runtime: AgentRequestRuntime,
  input: Omit<AgentProposalRuntimeContext, 'signal'>,
): Promise<Record<string, unknown>> {
  if (typeof input.objective !== 'string' || input.objective.trim().length < 1 || input.objective.length > 1024 ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId) || !/^(0|[1-9][0-9]{0,19})$/.test(input.now)) {
    throw new AgentRuntimeError('AGENT_RUNTIME_REQUEST_INVALID');
  }
  let raw: unknown;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = freezeTree(JSON.parse(JSON.stringify(input.snapshot)) as LiveSnapshot);
    raw = await Promise.race([
      runtime.generateProposal(Object.freeze({
        ...input,
        objective: input.objective.trim(),
        principal: getAddress(input.principal),
        policy: Object.freeze({ ...input.policy }),
        snapshot,
        signal: controller.signal,
      })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error()); }, 30_000);
        timer.unref();
      }),
    ]);
  } catch (error) {
    if (error instanceof AgentRuntimeError) throw error;
    throw new AgentRuntimeError('AGENT_RUNTIME_UNAVAILABLE');
  } finally {
    if (timer) clearTimeout(timer);
  }

  let value: Record<string, unknown>;
  try {
    const serialized = JSON.stringify(raw);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 16_384) throw Error();
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    value = parsed as Record<string, unknown>;
  } catch {
    throw new AgentRuntimeError('AGENT_RUNTIME_PACKAGE_INVALID');
  }
  if (value.requestId !== input.requestId || value.source !== 'LIVE_PROVIDER') {
    throw new AgentRuntimeError('AGENT_RUNTIME_REQUEST_MISMATCH');
  }
  try {
    const intent = value.intent as Record<string, unknown>;
    if (getAddress(String(intent.principal)) !== getAddress(input.principal) ||
        getAddress(String(intent.agent)) !== getAddress(input.policy.agent)) throw Error();
  } catch {
    throw new AgentRuntimeError('AGENT_RUNTIME_IDENTITY_MISMATCH');
  }
  return value;
}
