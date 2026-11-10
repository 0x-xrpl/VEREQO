import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getAddress } from 'ethers';
import { parseGateManifest } from '../../../packages/domain/src/gate-mandate.js';
import { createLocalApp } from './http.js';

type AppOptions = Parameters<typeof createLocalApp>[0];
export type AuthorizationAdapters = Required<Pick<AppOptions, 'agentPolicy' | 'agentProvider' | 'financialAuthorization'>> & Pick<AppOptions, 'agentRuntime' | 'financialFinalization'>;

/** Operator-owned server composition only. Never accepts an HTTP-supplied module
 * or policy. No default provider, issuer key, proof verifier or Gate is invented. */
export async function loadAuthorizationAdapters(modulePath?: string): Promise<Partial<AuthorizationAdapters>> {
  if (modulePath === undefined) return {};
  if (!isAbsolute(modulePath)) throw Error('AUTHORIZATION_ADAPTER_ABSOLUTE_PATH_REQUIRED');
  try {
    const module = await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
    if (typeof module.createAuthorizationAdapters !== 'function') throw Error();
    const value = await module.createAuthorizationAdapters() as AuthorizationAdapters;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    const moduleKeys = Object.keys(value).sort().join(',');
    if (!['agentPolicy,agentProvider,financialAuthorization','agentPolicy,agentProvider,agentRuntime,financialAuthorization','agentPolicy,agentProvider,financialAuthorization,financialFinalization','agentPolicy,agentProvider,agentRuntime,financialAuthorization,financialFinalization'].includes(moduleKeys)) throw Error();
    const { agentPolicy: policy, agentProvider: provider, financialAuthorization: auth, financialFinalization: finalization } = value;
    if (!policy || !provider || !auth || provider.configured !== true ||
        typeof provider.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(provider.id)) throw Error();
    const manifest = parseGateManifest(auth.gateManifest);
    for (const key of ['principal', 'agent', 'issuer', 'gate'] as const) {
      if (getAddress(policy[key]) === '0x0000000000000000000000000000000000000000') throw Error();
    }
    if (getAddress(policy.principal) !== manifest.principal || getAddress(policy.issuer) !== manifest.issuer || getAddress(policy.gate) !== manifest.gate) throw Error();
    for (const key of ['credentialId', 'marketId', 'subaccountId'] as const) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(policy[key]) || /^0x0{64}$/.test(policy[key])) throw Error();
    }
    if (policy.subaccountId.slice(0, 42).toLowerCase() !== manifest.gate.toLowerCase()) throw Error();
    for (const key of ['credentialEpoch', 'policyEpoch', 'maxNotional', 'maxFeeRate', 'maxTotalExposure'] as const) {
      if (typeof policy[key] !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(policy[key]) || BigInt(policy[key]) >= 1n << 256n) throw Error();
    }
    if (BigInt(policy.maxNotional) === 0n || BigInt(policy.maxTotalExposure) < BigInt(policy.maxNotional) || BigInt(policy.maxFeeRate) > 10n ** 18n) throw Error();
    for (const key of ['currentMandate', 'readGateMandate', 'readCurrentDisclosureHistory', 'verifyProof'] as const) {
      if (typeof auth[key] !== 'function') throw Error();
    }
    if (value.agentRuntime !== undefined && typeof value.agentRuntime?.generateProposal !== 'function') throw Error();
    if (finalization !== undefined) {
      if (!finalization || typeof finalization !== 'object' || Array.isArray(finalization) ||
          Object.keys(finalization).sort().join(',') !== 'admitDisclosure,disclosureAnchorProvenance,gateStateProvenance,generateProof,proofVerifierProvenance,snapshotProvenance' ||
          typeof finalization.admitDisclosure !== 'function' || typeof finalization.generateProof !== 'function' ||
          !['LIVE_INJECTIVE_READ_ADAPTER','SYNTHETIC_TEST_DOUBLE'].includes(finalization.snapshotProvenance) ||
          !['INDEPENDENT_TRUSTED_ANCHOR_CAS','SYNTHETIC_TEST_DOUBLE'].includes(finalization.disclosureAnchorProvenance) ||
          !['TRUSTED_PINNED_GROTH16','LOCAL_UNTRUSTED_GROTH16','SYNTHETIC_TEST_DOUBLE'].includes(finalization.proofVerifierProvenance) ||
          !['READ_ONLY_EVM_RPC','SYNTHETIC_TEST_DOUBLE'].includes(finalization.gateStateProvenance)) throw Error();
    }
    // Runtime configuration is only a proposal-generation capability. It does
    // not attest that a model ran or authorize a signed financial request.
    return {
      agentPolicy: Object.freeze({ ...policy }), agentProvider: Object.freeze({ ...provider }),
      financialAuthorization: { ...auth, gateManifest: manifest },
      ...(value.agentRuntime ? { agentRuntime: value.agentRuntime } : {}),
      ...(finalization ? { financialFinalization: Object.freeze({ ...finalization }) } : {}),
    };
  } catch {
    // Provider initialization errors can contain credentials. Do not retain causes.
    throw Error('AUTHORIZATION_ADAPTER_LOAD_FAILED');
  }
}

export async function createConfiguredLocalApp(databasePath: string, modulePath = process.env.VEREQO_AUTHORIZATION_ADAPTER_MODULE) {
  const adapters = await loadAuthorizationAdapters(modulePath);
  return createLocalApp({ databasePath, ...adapters });
}
