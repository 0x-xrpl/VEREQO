export type RehearsalIntent = {
  intentId: string;
  principalId: string;
  agentId: string;
  issuerId: string;
  credentialId: string;
  mandateId: string;
  marketSymbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'LIMIT';
  quantity: string;
  limitPrice: string;
  units: string;
  notionalQuote: string;
  source: 'SYNTHETIC_FIXTURE';
};

export type RehearsalView = {
  scenarioId: string;
  title: string;
  category: string;
  businessQuestion: string;
  dataClass: 'SYNTHETIC_REHEARSAL';
  source: 'PORTABLE_KIT_V1';
  businessId: string;
  revision: 1;
  intent: RehearsalIntent | null;
  facts: Record<string, string | number | boolean | null>;
  operatorActions: string[];
  evidenceState: 'NO_RECORD';
};

export type RehearsalResult = {
  scenarioId: string;
  businessId: string;
  revision: 1;
  source: 'SYNTHETIC_SERVER_POLICY' | 'LOCAL_VERIFIED_GRAPH' | 'LOCAL_WALLET_RULE' | 'FAIL_CLOSED_PRODUCT_BOUNDARY' | 'SYNTHETIC_FIXTURE' | 'BLOCKED_CAPABILITY' | 'LOCAL_GROTH16_TEST_VECTOR';
  decision: string;
  reason: string;
  authorized: false;
  execution: 'NOT_IMPLEMENTED' | 'NOT_EXECUTED';
  proofStatus: string;
  evidenceState: 'NO_RECORD';
  facts: Record<string, string | number | boolean | null>;
};
