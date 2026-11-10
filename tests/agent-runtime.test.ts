import { afterEach, expect, it, vi } from 'vitest';
import { prepareAgentProposal } from '../services/issuer/src/agent-runtime.js';
import type { AgentPolicy } from '../packages/domain/src/agent-request.js';
import type { LiveSnapshot } from '../packages/domain/src/live-injective.js';

const a = '0x' + '11'.repeat(20), h = '0x' + '22'.repeat(32);
const policy: AgentPolicy = { principal: a, agent: a, issuer: a, gate: a, credentialId: h, credentialEpoch: '1', policyEpoch: '1', marketId: h, subaccountId: a + '0'.repeat(24), maxNotional: '1', maxFeeRate: '1', maxTotalExposure: '2' };
const snapshot = { status: 'LIVE_READ_ONLY', chainId: '1439', market: { marketId: h }, nested: { immutable: true } } as unknown as LiveSnapshot;
const input = () => ({ requestId: 'runtime-one', objective: 'review a conservative buy proposal', principal: a, policy, snapshot, now: '1800000000' });
const pkg = () => ({ requestId: 'runtime-one', source: 'LIVE_PROVIDER', intent: { principal: a, agent: a } });
afterEach(() => vi.useRealTimers());

it('passes only immutable objective, policy, and read-only market context, then detaches the proposal', async () => {
  const source = pkg();
  const result = await prepareAgentProposal({ generateProposal: async context => {
    expect(Object.keys(context).sort()).toEqual(['now', 'objective', 'policy', 'principal', 'requestId', 'signal', 'snapshot']);
    expect(context.objective).toBe(input().objective);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.policy)).toBe(true);
    expect(Object.isFrozen((context.snapshot as unknown as { nested: object }).nested)).toBe(true);
    expect(Object.hasOwn(context, 'sessionToken')).toBe(false);
    expect(Object.hasOwn(context, 'signer')).toBe(false);
    return source;
  } }, input());
  expect(result).toEqual(source);
  expect(result).not.toBe(source);
});

it('rejects oversized model output with a fixed safe code', async () => {
  await expect(prepareAgentProposal({ generateProposal: async () => ({ ...pkg(), unexpected: 'x'.repeat(16_384) }) }, input()))
    .rejects.toThrow('AGENT_RUNTIME_PACKAGE_INVALID');
});

it('rejects request substitution and principal or Agent substitution before proposal acceptance', async () => {
  await expect(prepareAgentProposal({ generateProposal: async () => ({ ...pkg(), requestId: 'other-request' }) }, input()))
    .rejects.toThrow('AGENT_RUNTIME_REQUEST_MISMATCH');
  for (const field of ['principal', 'agent']) {
    await expect(prepareAgentProposal({ generateProposal: async () => ({ ...pkg(), intent: { ...pkg().intent, [field]: '0x' + '33'.repeat(20) } }) }, input()))
      .rejects.toThrow('AGENT_RUNTIME_IDENTITY_MISMATCH');
  }
});

it('bounds provider work and aborts the runtime signal without exposing its error', async () => {
  vi.useFakeTimers(); let signal: AbortSignal | undefined;
  const pending = prepareAgentProposal({ generateProposal: async context => { signal = context.signal; return new Promise(() => {}); } }, input());
  const rejection = expect(pending).rejects.toThrow('AGENT_RUNTIME_UNAVAILABLE');
  await vi.advanceTimersByTimeAsync(30_000); await rejection;
  expect(signal?.aborted).toBe(true);
});
