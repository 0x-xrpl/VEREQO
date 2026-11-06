import { getAddress } from 'ethers';
import { financialIntentDigest, parseFinancialIntent, validateIntentContext, type IntentContext } from './intent.js';

/** Supplied expectations are trusted local inputs, not authenticated chain state. */
export interface InjectiveLocalPlanContext extends IntentContext {
  readonly allowedMarketId: string;
  readonly allowedSubaccountId: string;
  readonly caller: string;
  readonly expectedDigest: string;
}

export type InjectiveLocalPlanResult = {
  readonly execution: 'NOT_IMPLEMENTED';
  readonly authorized: false;
} & ({ readonly status: 'LOCAL_PLAN_MATCH' } | { readonly status: 'REJECTED'; readonly reason: string });

function rejected(reason: string): InjectiveLocalPlanResult {
  return { status: 'REJECTED', reason, execution: 'NOT_IMPLEMENTED', authorized: false };
}

/** Context consistency only: no authentication, authorization, nonce consumption or execution. */
export function validateInjectiveLocalPlan(input: unknown, context: InjectiveLocalPlanContext): InjectiveLocalPlanResult {
  try {
    const intent = parseFinancialIntent(input);
    const consistency = validateIntentContext(intent, context);
    if (consistency.status === 'REJECTED') return rejected(consistency.reason);
    // Reuse canonical validation for local expected IDs; this does not establish ownership.
    const allowed = parseFinancialIntent({ ...intent, marketId: context.allowedMarketId, subaccountId: context.allowedSubaccountId });
    if (intent.marketId !== allowed.marketId) return rejected('MISMATCH_marketId');
    if (intent.subaccountId !== allowed.subaccountId) return rejected('MISMATCH_subaccountId');
    // This comparison checks a supplied value, never msg.sender or a signature.
    if (getAddress(context.caller) !== intent.agent) return rejected('UNAUTHORIZED_CALLER');
    if (!/^0x[0-9a-fA-F]{64}$/.test(context.expectedDigest)) return rejected('MALFORMED_CONTEXT_OR_INTENT');
    if (financialIntentDigest(intent) !== context.expectedDigest.toLowerCase()) return rejected('MISMATCH_intentDigest');
    return { status: 'LOCAL_PLAN_MATCH', execution: 'NOT_IMPLEMENTED', authorized: false };
  } catch {
    return rejected('MALFORMED_CONTEXT_OR_INTENT');
  }
}

/** Source ABI only; mutable upstream, live compatibility and native string encodings unverified.
 * https://raw.githubusercontent.com/InjectiveLabs/solidity-contracts/master/src/Exchange.sol
 * Reviewed 2026-11-06. Intended for static codec fixtures, never automatic intent translation.
 */
export const INJECTIVE_SPOT_LIMIT_ORDER_ABI = 'function createSpotLimitOrder(address sender, (string marketID,string subaccountID,string feeRecipient,uint256 price,uint256 quantity,string cid,string orderType,uint256 triggerPrice) order) returns ((string orderHash,string cid) response)';
