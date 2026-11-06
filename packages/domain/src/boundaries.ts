import type { FinancialIntent } from './intent.js';

/** Execution environment and implementation evidence are separate dimensions. */
export type ExecutionEnvironment =
  | 'LOCAL_REFERENCE'
  | 'LOCAL_ZK'
  | 'LOCAL_EVM'
  | 'INJECTIVE_TESTNET'
  | 'MIDNIGHT';

export type EvidenceStatus =
  | 'NOT_STARTED'
  | 'DESIGNED'
  | 'MOCK_ONLY'
  | 'LOCAL_TESTED'
  | 'ACTUAL_ZK_VERIFIED'
  | 'LOCAL_EVM_VERIFIED'
  | 'INJECTIVE_TESTNET_VERIFIED';

export interface ProofRequest {
  readonly requestId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly authorizedCohort: string;
  readonly predicateId: 'x.lte.v1';
  readonly threshold: number;
  readonly policyEpoch: number;
  readonly intentDigest?: string;
}

export type DisclosureDecision =
  | {
      readonly status: 'ALLOWED';
      readonly requestId: string;
      readonly policyEpoch: number;
      readonly remainingCandidates: number;
    }
  | {
      readonly status: 'DENIED';
      readonly requestId: string;
      readonly policyEpoch: number;
      readonly reason: string;
      // A denied response deliberately has no answer or proof field.
    };

export type IssuerAttestation =
  | { readonly status: 'NOT_IMPLEMENTED'; readonly environment: ExecutionEnvironment }
  | {
      readonly status: 'UNVERIFIED';
      readonly environment: 'LOCAL_ZK' | 'LOCAL_EVM' | 'INJECTIVE_TESTNET' | 'MIDNIGHT';
      readonly issuer: string;
      readonly credentialId: string;
      readonly commitment: string;
      readonly credentialEpoch: string;
      readonly signature: string;
    };

export interface CredentialState {
  readonly credentialId: string;
  readonly issuer: string;
  readonly epoch: string;
  readonly status: 'ACTIVE' | 'REVOKED' | 'UNKNOWN';
  readonly environment: ExecutionEnvironment;
}

export type ProofArtifact =
  | { readonly status: 'NOT_IMPLEMENTED'; readonly environment: ExecutionEnvironment }
  | {
      readonly status: 'UNVERIFIED';
      readonly environment: 'LOCAL_ZK' | 'LOCAL_EVM' | 'INJECTIVE_TESTNET' | 'MIDNIGHT';
      readonly scheme: string;
      readonly proofBytes: string;
      readonly publicInputs: readonly string[];
      readonly requestId: string;
      readonly intentDigest: string;
    };

export type ProofValidity =
  | { readonly status: 'NOT_IMPLEMENTED'; readonly valid: false; readonly environment: ExecutionEnvironment }
  | { readonly status: 'INVALID'; readonly valid: false; readonly environment: ExecutionEnvironment; readonly reason: string }
  | { readonly status: 'VALID'; readonly valid: true; readonly environment: Exclude<ExecutionEnvironment, 'LOCAL_REFERENCE'>; readonly verifierId: string };

export type AuthorizationDecision =
  | { readonly status: 'NOT_IMPLEMENTED'; readonly authorized: false; readonly environment: ExecutionEnvironment }
  | { readonly status: 'DENIED'; readonly authorized: false; readonly environment: ExecutionEnvironment; readonly reason: string }
  | {
      readonly status: 'AUTHORIZED';
      readonly authorized: true;
      readonly environment: Exclude<ExecutionEnvironment, 'LOCAL_REFERENCE'>;
      readonly intentDigest: string;
      readonly grantId: string;
    };

export type ExecutionReceipt =
  | { readonly status: 'NOT_IMPLEMENTED'; readonly environment: ExecutionEnvironment }
  | { readonly status: 'REJECTED'; readonly environment: ExecutionEnvironment; readonly reason: string }
  | {
      readonly status: 'SUBMITTED' | 'ORDER_PLACED' | 'MATCHED' | 'CANCELLED' | 'SETTLED';
      readonly environment: 'LOCAL_EVM' | 'INJECTIVE_TESTNET' | 'MIDNIGHT';
      readonly transactionHash: string;
      readonly intentDigest: string;
      readonly evidenceReference: string;
    };

export interface ProofVerifier {
  verify(artifact: ProofArtifact): Promise<ProofValidity>;
}
export interface FinancialAuthorizer {
  authorize(intent: FinancialIntent, proof: ProofArtifact): Promise<AuthorizationDecision>;
}
export interface FinancialExecutor {
  execute(intent: FinancialIntent, authorization: AuthorizationDecision): Promise<ExecutionReceipt>;
}

/** A missing implementation always refuses. Nothing can turn a local flip into execution. */
export function unimplementedAdapters(environment: ExecutionEnvironment): {
  readonly verifier: ProofVerifier;
  readonly authorizer: FinancialAuthorizer;
  readonly executor: FinancialExecutor;
} {
  return {
    verifier: { verify: async () => ({ status: 'NOT_IMPLEMENTED', valid: false, environment }) },
    authorizer: { authorize: async () => ({ status: 'NOT_IMPLEMENTED', authorized: false, environment }) },
    executor: { execute: async () => ({ status: 'NOT_IMPLEMENTED', environment }) },
  };
}

export type { FinancialIntent } from './intent.js';
