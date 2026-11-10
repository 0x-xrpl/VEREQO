import type { CurrentDisclosureHistory, DisclosureBinding } from '../../../packages/domain/src/disclosure-binding.js';
import { IssuerError, IssuerStore } from './store.js';

export interface CurrentCredentialState {
  readonly credentialEpoch: string;
  readonly active: boolean;
}

/** Monotonic checkpoint read from a trusted store independent of IssuerStore's SQLite file. */
export type DisclosureHistoryAnchor = Pick<CurrentDisclosureHistory,
  'issuer' | 'principal' | 'agent' | 'credentialId' | 'historyRoot' | 'historySequence' | 'policyEpoch'>;

/**
 * Connect the financial verifier to the authoritative append-only IssuerStore.
 * Scope mapping is fixed: issuer address / credential id / Agent address, all lowercase;
 * the authorized IssuerStore principal is the wallet principal. Credential lifecycle
 * remains a separate current-state reader because the disclosure demo store has no
 * credential revocation registry of its own.
 */
export function createDisclosureHistoryReader(
  store: IssuerStore,
  readCredentialState: (binding: DisclosureBinding) => Promise<CurrentCredentialState | null>,
  readTrustedAnchor: (binding: DisclosureBinding) => Promise<DisclosureHistoryAnchor | null>,
): (binding: DisclosureBinding) => Promise<CurrentDisclosureHistory | null> {
  return async (binding) => {
    const scope = {
      issuer: binding.issuer.toLowerCase(),
      subject: binding.credentialId.toLowerCase(),
      cohort: binding.agent.toLowerCase(),
    };
    let head;
    try {
      head = store.historyHead({ principal: binding.principal.toLowerCase(), scope });
    } catch (error) {
      if (error instanceof IssuerError && error.code === 'UNAUTHORIZED') return null;
      throw error;
    }
    // SQLite immutability triggers detect row edits, but cannot prove that the whole
    // database was not restored from an older backup. Require an independent monotonic
    // checkpoint and fail closed until its current scope/head matches this local replay.
    const anchor = await readTrustedAnchor(binding);
    if (!anchor ||
        anchor.issuer.toLowerCase() !== binding.issuer.toLowerCase() ||
        anchor.principal.toLowerCase() !== binding.principal.toLowerCase() ||
        anchor.agent.toLowerCase() !== binding.agent.toLowerCase() ||
        anchor.credentialId.toLowerCase() !== binding.credentialId.toLowerCase() ||
        anchor.historyRoot.toLowerCase() !== head.historyRoot.toLowerCase() ||
        anchor.historySequence !== head.historySequence || anchor.policyEpoch !== head.policyEpoch) return null;
    const credential = await readCredentialState(binding);
    if (!credential) return null;
    return Object.freeze({
      issuer: binding.issuer,
      principal: binding.principal,
      agent: binding.agent,
      credentialId: binding.credentialId,
      historyRoot: head.historyRoot,
      historySequence: head.historySequence,
      policyEpoch: head.policyEpoch,
      credentialEpoch: credential.credentialEpoch,
      active: credential.active,
    });
  };
}
