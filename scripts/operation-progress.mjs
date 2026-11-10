#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (path.basename(process.cwd()) !== 'VEREQO') {
  throw new Error('Run from the VEREQO repository root only.');
}

const dataPath = path.resolve('docs/evidence/operation-57/progress.json');
const command = process.argv[2] ?? 'report';
const args = process.argv.slice(3);
const now = () => new Date().toISOString();

const plan = [
  {
    id: 'T1', title: 'Trusted issuer manifest and Gate reconciliation',
    estimateMinutes: 120, dependsOn: [],
    acceptance: 'Configured issuer, mandate epoch and commitment reconcile to the fixed manifest; default startup remains NOT_CONFIGURED; mismatch negative test passes.',
    basis: 'Retrospective coarse allocation for Op55 implementation and its financial-auth tests; actual historic timing was not recorded.',
    retrospectiveStatus: 'PASS',
    evidence: 'docs/STATE.md — Operation 55 implementation and verified financial-auth/contract gates.'
  },
  {
    id: 'T2', title: 'Idempotent request and append-only evidence history',
    estimateMinutes: 180, dependsOn: [],
    acceptance: 'Request payload binding, concurrent retries, restart and durable evidence-history invariants pass; storage failure never returns success.',
    basis: 'Retrospective coarse allocation for Op55 store/HTTP changes and recorded test scope; actual historic timing was not recorded.',
    retrospectiveStatus: 'PASS',
    evidence: 'docs/STATE.md — Operation 55 implementation and local test checkpoint.'
  },
  {
    id: 'T3', title: 'ORDER_ONLY authorization, pause and Gate-wide budget',
    estimateMinutes: 180, dependsOn: ['T1'],
    acceptance: 'Unauthorized capabilities, wrong market/unit, expired intent and aggregate budget overrun reject; legacy transfer regression remains intact.',
    basis: 'Retrospective coarse allocation for Op55 ActionGate isolation and Foundry negative tests; actual historic timing was not recorded.',
    retrospectiveStatus: 'PASS',
    evidence: 'docs/STATE.md — Operation 55 contract tests and security boundary.'
  },
  {
    id: 'T4', title: 'Tracked-order cancellation and independent revocation',
    estimateMinutes: 150, dependsOn: ['T3'],
    acceptance: 'Only a recorded order can be cancelled; failed/false native cancel stays unresolved and consumes no false acknowledgment; revoke remains independent.',
    basis: 'Retrospective coarse allocation for Op55 lifecycle implementation and Foundry tests; actual historic timing was not recorded.',
    retrospectiveStatus: 'PASS',
    evidence: 'docs/STATE.md — Operation 55 cancellation and local regression evidence.'
  },
  {
    id: 'T5.1', title: 'Pin native Injective implementation identity',
    estimateMinutes: 180, dependsOn: ['T3'],
    acceptance: 'Map the observed Testnet app/commit and deployed precompile behavior to exact source/build identities, or record a concrete unresolvable version gap.',
    basis: 'Op56 evidence explicitly labels endpoint reports UNPINNED; bounded source/version trace plus one read-only compatibility attempt.',
    blockerReleaseCondition: 'A reproducible source/build identity for the target Testnet implementation and precompile must be available.',
  },
  {
    id: 'T5.2', title: 'Prove same-execution market risk and fee facts',
    estimateMinutes: 240, dependsOn: ['T5.1'],
    acceptance: 'Establish enforceable active/status/tick/minimum/fee facts and future-fee reservation semantics for the exact execution; stale or unavailable data rejects.',
    basis: 'Op54 T5 and Op56 risks identify native same-execution risk and future-fee reservation as unknown; source trace and focused negative tests.',
    blockerReleaseCondition: 'Exact native source/runtime semantics or an enforceable same-transaction state interface must be proven.',
  },
  {
    id: 'T5.3', title: 'Implement or keep native market gate closed',
    estimateMinutes: 300, dependsOn: ['T5.2'],
    acceptance: 'Only source-proven risk checks are enforced. If proof is unavailable, production route remains MARKET_RISK_UNVERIFIED with no nonce, budget or precompile side effect.',
    basis: 'Conditional implementation estimate from ActionGate hook and test harness; includes focused positive/negative cases, not chain deployment.',
    blockerReleaseCondition: 'T5.2 proof and reviewable same-execution integration boundary.',
  },
  {
    id: 'T5.4', title: 'Fee, fill/cancel race and rollback regression',
    estimateMinutes: 180, dependsOn: ['T5.3'],
    acceptance: 'Partial fill, cancel race, fee overrun, native failure and EVM rollback cases preserve budget, nonce and truthful unresolved status.',
    basis: 'Operation 54 R1/R2 conditions and existing Foundry harness; local tests only do not prove native semantics.',
    blockerReleaseCondition: 'Native transition semantics are available to model or exercise without guessing.',
  },
  {
    id: 'T6.1', title: 'Trace funding, denom and principal recovery semantics',
    estimateMinutes: 180, dependsOn: ['T3'],
    acceptance: 'Identify native deposit/withdraw actor, subaccount, denom conversion, destination and available-balance semantics for exact source version.',
    basis: 'Op54 T6 and Op56 checkpoint show no verified Gate-to-principal recovery; scoped source/interface trace.',
    blockerReleaseCondition: 'Exact Injective native bank/exchange balance transition source is available and version matched.',
  },
  {
    id: 'T6.2', title: 'Implement principal-attributable recovery and accounting',
    estimateMinutes: 360, dependsOn: ['T6.1', 'T5.1'],
    acceptance: 'Recovery is principal-scoped, cannot exceed attributable unencumbered assets, is separate from order authority, and rolls back atomically on failure.',
    basis: 'Conditional ActionGate custody/accounting implementation with focused invariant tests; estimate excludes Testnet deployment.',
    blockerReleaseCondition: 'T6.1 establishes safe actor/denom/destination semantics and T5.1 pins the native implementation.',
  },
  {
    id: 'T6.3', title: 'Recovery adversarial and fault-injection tests',
    estimateMinutes: 210, dependsOn: ['T6.2'],
    acceptance: 'Wrong principal/denom/recipient, locked funds, partial state, retry, pause, revert and accounting-underflow cases fail safely.',
    basis: 'Foundry failure-mode matrix derived from Op54 N7 and native balance preservation acceptance.',
    blockerReleaseCondition: 'Recovery implementation exists and exposes observable state transitions.',
  },
  {
    id: 'T7.1', title: 'Synthetic wallet negative browser QA',
    estimateMinutes: 120, dependsOn: ['T1'],
    acceptance: 'Synthetic provider tests wrong EVM chain, account change, rejected typed-data signature, disconnect and expiry; no Intent/order/send route is called.',
    basis: 'Op56 wallet browser QA already covers authentication; add bounded cases to the existing Playwright harness at desktop/mobile.',
  },
  {
    id: 'T7.2A', title: 'Canonical Intent contract and read-only review UI',
    estimateMinutes: 150, dependsOn: ['T7.1', 'T2'],
    acceptance: 'The review UI presents canonical Intent fields, explicitly labels unavailable Gate/issuer/nonce/proof values, keeps signing unavailable, and makes no wallet signing request; JP/EN and focused browser checks pass.',
    basis: 'Scoped read-only subgate from Op54 T7; reuses native-order schema and current UI without implying configured authority.',
    retrospectiveStatus: 'PASS',
    evidence: 'apps/web/src/components/FinancialWorkflow.tsx; tests/financial-workflow.test.tsx; docs/evidence/operation-57/intent-review-boundary.json; docs/evidence/operation-57/wallet-browser/report.json.',
  },
  {
    id: 'T7.2B', title: 'Enable explicit Intent signing after verified deployment binding',
    estimateMinutes: 90, dependsOn: ['T7.2A', 'T7.3'],
    acceptance: 'Only verified Gate/codehash, issuer and mandate registration, nonce/expiry source, and exact EIP-712/Gate/proof binding may enable an explicit Intent-sign action distinct from ownership authentication.',
    basis: 'Remaining deployment-bound portion of Op54 T7; no real user signature or transaction in this task.',
    retrospectiveStatus: 'BLOCKED',
    blockerReason: 'No verified deployed Gate, issuer registration, credential/subaccount, nonce source or end-to-end signature/proof binding is configured.',
    blockerReleaseCondition: 'Independent verification of exact Gate address/codehash, issuer/mandate state, nonce and expiry source, plus cross-layer Intent/proof binding.',
  },
  {
    id: 'T7.3', title: 'Bind Agent, issuer mandate, proof and Gate request',
    estimateMinutes: 300, dependsOn: ['T7.2A', 'T1'],
    acceptance: 'One canonical digest and public-input vector is checked across owner signature, issuer signature, proof and ActionGate; all altered fields reject.',
    basis: 'Existing Op53/55 local authorization path plus Op54 order-specific binding requirement; bounded integration and negative matrix.',
    blockerReleaseCondition: 'Canonical Intent contract and verifier/Gate digest agreement are available.',
  },
  {
    id: 'T7.4', title: 'Intent lifecycle and truthful receipt/evidence states',
    estimateMinutes: 210, dependsOn: ['T7.3', 'T2'],
    acceptance: 'Expiry, replay, revoke, restart and unknown receipt remain distinct; evidence records immutable IDs and never upgrades PRE_GATE_VALIDATED to execution.',
    basis: 'Op54 T7/N8 and existing durable store; focused HTTP/store/UI regressions.',
  },
  {
    id: 'T8.1', title: 'R1 native source and ABI compatibility evidence',
    estimateMinutes: 180, dependsOn: ['T5.1'],
    acceptance: 'Record pinned source refs, interface/hash/build relation and known gaps for actor/subaccount, fee, cancel/fill and rollback; no mock substitutes for unknowns.',
    basis: 'Operation 54 R1 acceptance; bounded primary-source and local artifact comparison.',
  },
  {
    id: 'T8.2', title: 'R2 local native/precompile behavior verification',
    estimateMinutes: 240, dependsOn: ['T5.4', 'T6.3', 'T7.3'],
    acceptance: 'The exact target native implementation or a reproducible local node proves BN254/gas, actor/subaccount, balances, cancellation and rollback; otherwise preserve explicit NO-GO.',
    basis: 'Operation 54 R2 matrix; local executable compatibility environment may not exist and is not replaced by ABI mocks.',
    blockerReleaseCondition: 'Reproducible target-version local native/precompile test environment or separately approved isolated Testnet experiment.',
  },
  {
    id: 'T8.3', title: 'R3 approved Testnet protected-order verification',
    estimateMinutes: 120, dependsOn: ['T5.4', 'T6.3', 'T7.4', 'T8.2'],
    acceptance: 'Only after explicit approval: exact chain/Gate/codehash/sender/calldata/amount/fee/recovery limits are approved and a protected test order lifecycle is verified end-to-end.',
    basis: 'Operation 54 R3 gate; 120 minutes is execution effort only and excludes approval/network wait.',
    retrospectiveStatus: 'BLOCKED',
    blockerReason: 'No explicit authorization for deploy, transaction signing, funding, broadcast, or order submission is present in this task.',
    blockerReleaseCondition: 'Separate written approval for the exact Testnet write, actor/key custody, amount/fee cap, contract/codehash, order parameters and recovery plan.',
  },
  {
    id: 'T9.1', title: 'Preserve disabled order-type fail-closed coverage',
    estimateMinutes: 60, dependsOn: ['T3'],
    acceptance: 'Spot SELL, Spot MARKET/Post-only and Derivative remain unavailable unless each has independent asset/margin and authority guards; negative tests prove no native call.',
    basis: 'Op56 contract suite and existing testSellAndOtherOrderTypesFailClosed test; retrospective status based on saved Op56 report.',
    retrospectiveStatus: 'PASS',
    evidence: 'docs/STATE.md — Operation 56: 77/77 Foundry tests; contracts/test/SpotOrderGate.t.sol contains fail-closed order-type test.'
  },
  {
    id: 'T9.2', title: 'Order-type extension gates and per-type negative tests',
    estimateMinutes: 240, dependsOn: ['T8.3'],
    acceptance: 'Any enabled extension has its own inventory/margin, fee, replay and lifecycle enforcement; otherwise types remain closed with explicit UI labels and passing negative tests.',
    basis: 'Conditional scope for SELL/MARKET/Derivative; each has distinct custody/risk invariants and no shortcut from BUY tests.',
    blockerReleaseCondition: 'T8.3 protected-order verification and source-proven per-type asset/risk controls.',
  },
  {
    id: 'T10.1A', title: 'Owner-authenticated draft review and durable denial evidence',
    estimateMinutes: 90, dependsOn: ['T2', 'T7.4'],
    acceptance: 'The UI submits only an unsigned draft with the same non-secret Business ID; owner-authenticated API records a digest-only fail-closed rejection, retries are idempotent, changed payloads conflict, and owner-scoped evidence is readable. No Agent/provider, signature, proof, or transaction is invoked.',
    basis: 'Safe independent subgate of Op54 H/T10; uses existing append-only evidence store and local UI.',
  },
  {
    id: 'T10.1B', title: 'Bind business ID through Agent proposal and authorization evidence',
    estimateMinutes: 90, dependsOn: ['T10.1A', 'T7.3'],
    acceptance: 'The same ID binds an actual Agent proposal, complete signed authorization decision, and immutable evidence history with restart/idempotency guarantees.',
    basis: 'Remaining Op54 H/T10 acceptance; requires a configured Agent request path and full signed authorization package.',
    retrospectiveStatus: 'BLOCKED',
    blockerReason: 'No configured Agent proposal flow or authenticated request-to-proposal-to-signed-authorization integration exists; local draft rejection is not an Agent proposal.',
    blockerReleaseCondition: 'A configured authenticated Agent proposal path and validated owner/issuer/proof/Gate package use the exact same requestId end-to-end.',
  },
  {
    id: 'T10.2A', title: 'Carry the same unsigned draft ID through Instrument, Consequence and Evidence inspection',
    estimateMinutes: 120, dependsOn: ['T10.1A', 'T7.3', 'T7.4'],
    acceptance: 'Selecting an owner-authenticated unsigned draft carries its exact Business ID and revision across the Financial Instrument, existing Consequence inspection context, and Evidence Inspector. Only evidence returned for that owner and ID is rendered; no Agent authorization, credential dependency, proof, order or chain receipt is inferred. WHAT-IF and navigation do not commit or mutate history.',
    basis: 'Independent, read-only half of T10.2; reuses T10.1A owner-scoped evidence and existing T7.3 digest/T7.4 lifecycle boundaries.',
  },
  {
    id: 'T10.2B', title: 'Bind configured Agent authorization and canonical dependency events to the same Instrument object',
    estimateMinutes: 120, dependsOn: ['T10.1B', 'T10.2A', 'T7.3'],
    acceptance: 'After a configured Agent proposal exists, the same business ID links canonical signed Intent, mandate/proof/Gate lifecycle to the true directed Consequence graph and immutable Evidence history; unknown events remain UNKNOWN; WHAT-IF never commits.',
    basis: 'Blocked completion half of original T10.2; preserves the original combined 240-minute estimate.',
    blockerReleaseCondition: 'T10.1B configured Agent proposal and authorization evidence plus verified canonical Gate lifecycle linkage.',
  },
  {
    id: 'T10.3', title: 'End-to-end browser and accessibility negative QA',
    estimateMinutes: 120, dependsOn: ['T7.4', 'T10.2A', 'T10.2B'],
    acceptance: 'JP/EN, responsive, keyboard/reduced-motion, network/account/signature refusal, stale/replay and truthful UNKNOWN/PENDING views pass in real local Chromium.',
    basis: 'Op56 browser suites provide baseline; targeted changed-flow checks and screenshots.',
  },
  {
    id: 'Q.1', title: 'Final app, contract and local-ZK regression',
    estimateMinutes: 150, dependsOn: ['T5.4', 'T6.3', 'T7.4', 'T9.1', 'T10.3'],
    acceptance: 'npm run check, npm run test:contracts and npm run test:zk each pass; reports distinguish LOCAL and Testnet evidence.',
    basis: 'Op56 historical runtimes establish baseline scale; final integration changes require complete applicable regression.',
  },
  {
    id: 'Q.2', title: 'Final real-browser QA and visual inspection',
    estimateMinutes: 180, dependsOn: ['Q.1'],
    acceptance: 'Desktop and mobile local Chromium flows pass for approved product scope; screenshots inspected; no external write route, runtime error or overflow.',
    basis: 'Op56 generated 215/63/22 checks and screenshots; targeted final run only after integration stabilizes.',
  },
  {
    id: 'Q.3', title: 'Eight-lens and four-reviewer evidence-based gate review',
    estimateMinutes: 180, dependsOn: ['Q.1', 'Q.2'],
    acceptance: 'Security, Injective, wallet, ZK, custody, UX, reliability and product truth lenses each cite evidence; final four views record only substantiated findings/scores.',
    basis: 'One-agent cross-review per current instruction; no subagents or invented external judge results.',
  },
  {
    id: 'Q.4', title: 'Claims, checkpoint, verified local commit',
    estimateMinutes: 60, dependsOn: ['Q.3'],
    acceptance: 'Claims/State accurately record PASS/FAIL/BLOCKED, evidence paths, exact resume task and local commit; user-provided untracked package is preserved.',
    basis: 'Small final documentation/commit gate with git diff/status verification; no push.',
  }
];

function readData() {
  if (!existsSync(dataPath)) throw new Error('Progress data missing. Run init first.');
  return JSON.parse(readFileSync(dataPath, 'utf8'));
}

function derive(data, timestamp = now()) {
  const tasks = data.tasks;
  const totalEstimateMinutes = tasks.reduce((sum, task) => sum + task.estimateMinutes, 0);
  const passed = tasks.filter(task => task.status === 'PASS');
  const passEstimateMinutes = passed.reduce((sum, task) => sum + task.estimateMinutes, 0);
  const calibrationClass = task => {
    if (task.id === 'T5.1' || task.id === 'T8.1') return 'NATIVE_SOURCE_EVIDENCE';
    if (task.id.startsWith('T5.')) return 'MARKET_RISK_SECURITY';
    if (task.id.startsWith('T6.')) return 'CUSTODY_RECOVERY';
    if (task.id === 'T7.1') return 'WALLET_BROWSER_QA';
    if (task.id === 'T7.2A') return 'INTENT_REVIEW_UI';
    if (task.id === 'T7.2B') return 'FINANCIAL_INTENT_SIGNING';
    if (task.id === 'T7.3') return 'CRYPTO_GATE_BINDING';
    if (task.id === 'T7.4') return 'AUTHORIZATION_LIFECYCLE';
    if (task.id === 'T8.2' || task.id === 'T8.3') return 'NATIVE_RUNTIME_VALIDATION';
    if (task.id.startsWith('T9.')) return 'ORDER_TYPE_EXTENSION';
    if (task.id.startsWith('T10.')) return 'PRODUCT_EVIDENCE_INTEGRATION';
    return task.id.startsWith('Q.') ? 'FINAL_REGRESSION_REVIEW' : 'OTHER';
  };
  const ratiosByClass = new Map();
  for (const task of passed) {
    if (task.retrospective || !Number.isFinite(task.actualMinutes) || task.actualMinutes <= 0) continue;
    const key = calibrationClass(task);
    const list = ratiosByClass.get(key) ?? [];
    list.push(task.actualMinutes / task.estimateMinutes);
    ratiosByClass.set(key, list);
  }
  const medianOf = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length === 0 ? null : sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  };
  const calibrationByClass = Object.fromEntries([...ratiosByClass].map(([key, values]) => [key, {
    measuredTasks: values.length,
    medianActualToEstimate: Math.round(medianOf(values) * 100) / 100,
    appliedScale: values.length >= 3 ? Math.round(medianOf(values) * 100) / 100 : 1,
    scaleApplied: values.length >= 3
  }]));
  const measuredCalibrationTasks = [...ratiosByClass.values()].reduce((sum, values) => sum + values.length, 0);
  const scaleFor = task => calibrationByClass[calibrationClass(task)]?.scaleApplied
    ? calibrationByClass[calibrationClass(task)].appliedScale
    : 1;
  const activeResumeMinutes = data.activeResumeSession?.startedAt ? Math.max(0, (Date.parse(timestamp) - Date.parse(data.activeResumeSession.startedAt)) / 60000) : 0;
  const elapsedMinutes = data.elapsedBeforeResumeMinutes !== undefined
    ? Math.max(0, data.elapsedBeforeResumeMinutes + activeResumeMinutes)
    : Math.max(0, (Date.parse(timestamp) - Date.parse(data.sessionStartedAt)) / 60000);
  const active = tasks.find(task => task.status === 'ACTIVE');
  const ready = tasks.find(task =>
    task.status === 'PENDING' && task.dependsOn.every(id => tasks.find(item => item.id === id)?.status === 'PASS')
  );
  const current = active ?? ready;
  const taskActualNow = task => (task.actualMinutes ?? 0) +
    (task.status === 'ACTIVE' && task.activeStartedAt ? Math.max(0, (Date.parse(timestamp) - Date.parse(task.activeStartedAt)) / 60000) : 0);
  const remainingFor = task => Math.max(0, task.estimateMinutes * scaleFor(task) - taskActualNow(task));
  const remainingTasks = tasks.filter(task => task.status !== 'PASS');
  const remainingClasses = [...new Set(remainingTasks.map(calibrationClass))];
  const calibratedClasses = remainingClasses.filter(key => calibrationByClass[key]?.scaleApplied).length;
  const calibrationCoverage = remainingClasses.length ? calibratedClasses / remainingClasses.length : 1;
  const remainingWorkMinutes = remainingTasks.reduce((sum, task) => sum + remainingFor(task), 0);
  const currentCalibration = current ? calibrationByClass[calibrationClass(current)] : null;
  const confidence = remainingTasks.length === 0 ? 'HIGH'
    : calibrationCoverage >= 0.8 && measuredCalibrationTasks >= 8 ? 'HIGH'
      : calibrationCoverage >= 0.5 && measuredCalibrationTasks >= 4 ? 'MEDIUM'
        : 'LOW';
  const waits = data.externalWaits.filter(wait => wait.status !== 'CLEARED');
  const conditionalFinish = new Date(Date.parse(timestamp) + remainingWorkMinutes * 60000).toISOString();
  const jst = iso => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(iso)).replace(' ', 'T');
  return {
    calculatedAt: timestamp,
    scope: data.scope,
    projectPercentage: totalEstimateMinutes ? Math.round(passEstimateMinutes / totalEstimateMinutes * 1000) / 10 : 0,
    passEstimateMinutes,
    totalEstimateMinutes,
    elapsedMinutes: Math.round(elapsedMinutes * 10) / 10,
    currentTask: current?.id ?? null,
    currentTaskTitle: current?.title ?? (waits.length ? 'Waiting on external approval' : 'No ready task'),
    currentTaskRemainingMinutes: current ? Math.round(remainingFor(current) * 10) / 10 : null,
    remainingWorkMinutes: Math.round(remainingWorkMinutes * 10) / 10,
    conditionalFinishJST: jst(conditionalFinish),
    predictedFinishJST: waits.length ? null : jst(conditionalFinish),
    finishStatus: waits.length ? 'UNDETERMINED_EXTERNAL_WAIT' : 'CONDITIONAL_ZERO_WAIT_ESTIMATE',
    confidence,
    measuredCalibrationTasks,
    calibrationPolicy: 'Task-class median applies only after at least 3 measured PASS tasks in the same class; uncalibrated classes retain their original estimate.',
    calibrationCoverage: Math.round(calibrationCoverage * 100) / 100,
    calibrationByClass,
    calibrationMedianActualToEstimate: currentCalibration?.medianActualToEstimate ?? null,
    appliedCalibrationScale: current ? scaleFor(current) : 1,
    passCount: passed.length,
    activeCount: tasks.filter(task => task.status === 'ACTIVE').length,
    blockedCount: tasks.filter(task => task.status === 'BLOCKED').length,
    failCount: tasks.filter(task => task.status === 'FAIL').length,
    pendingCount: tasks.filter(task => task.status === 'PENDING').length,
    externalWaits: waits,
    nextAction: active
      ? 'Continue ' + active.id + ': ' + active.acceptance
      : ready
        ? 'Start ' + ready.id + ': ' + ready.title
        : waits.length
          ? 'No dependency-ready implementation task remains; external approval is still pending and blocked work is not counted as complete.'
          : 'Resolve failed or dependency-blocked task before claiming completion.'
  };
}

function persist(data) {
  data.updatedAt = now();
  data.summary = derive(data, data.updatedAt);
  writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  return data.summary;
}

function show(summary) {
  const hours = minutes => minutes == null ? 'UNKNOWN' : String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(Math.floor(minutes % 60)).padStart(2, '0');
  console.log(JSON.stringify(summary, null, 2));
  console.log('');
  console.log('VEREQO — LIVE EXECUTION');
  const filled = Math.round(summary.projectPercentage / 10);
  console.log('PROJECT     [' + '█'.repeat(filled) + '░'.repeat(10 - filled) + '] ' + summary.projectPercentage.toFixed(1) + '% (' + summary.scope + ')');
  console.log('CURRENT     ' + (summary.currentTask ?? '—') + ' / ' + summary.currentTaskTitle);
  console.log('ELAPSED     ' + hours(summary.elapsedMinutes) + '  [MEASURED]');
  console.log('TASK LEFT   ' + hours(summary.currentTaskRemainingMinutes) + '  [ESTIMATED]');
  console.log('TOTAL LEFT  ' + hours(summary.remainingWorkMinutes) + '  [ESTIMATED WORK ONLY]');
  console.log('FINISH JST  ' + (summary.predictedFinishJST ?? 'UNDETERMINED — no-wait estimate ' + summary.conditionalFinishJST + ' (external wait excluded)') + (summary.predictedFinishJST ? ' [CONDITIONAL]' : ''));
  console.log('CONFIDENCE  ' + summary.confidence + ' (' + summary.measuredCalibrationTasks + ' measured tasks; class coverage ' + Math.round(summary.calibrationCoverage * 100) + '%)');
  console.log('PASS        ' + summary.passCount + ' tasks');
  console.log('ACTIVE      ' + summary.activeCount);
  console.log('BLOCKED     ' + summary.blockedCount);
  console.log('NEXT        ' + summary.nextAction);
}

if (command === 'init') {
  if (existsSync(dataPath)) throw new Error('Refusing to overwrite existing progress history.');
  const startedAtFlag = args.indexOf('--started-at');
  const startedAt = startedAtFlag >= 0 ? args[startedAtFlag + 1] : null;
  if (!startedAt || Number.isNaN(Date.parse(startedAt))) throw new Error('Use init --started-at <verified ISO timestamp>.');
  mkdirSync(path.dirname(dataPath), { recursive: true, mode: 0o700 });
  const tasks = plan.map(item => {
    const isRetrospective = item.retrospectiveStatus === 'PASS';
    const task = {
      ...item,
      initialEstimateMinutes: item.estimateMinutes,
      estimateRevisions: [],
      status: item.retrospectiveStatus ?? 'PENDING',
      startAt: null,
      endAt: null,
      actualMinutes: null,
      activeStartedAt: null,
      retrospective: isRetrospective,
      attempts: [],
      blockerReason: item.blockerReason ?? null,
      blockerReleaseCondition: item.blockerReleaseCondition ?? null
    };
    delete task.retrospectiveStatus;
    return task;
  });
  const data = {
    schema: 'vereqo.operation-progress.v1',
    scope: 'Operation 54 acceptance scope (T1–T10 plus final QA), reconstructed for Operations 57–58; not whole-project completion.',
    repository: process.cwd(),
    baseline: { branch: 'codex/vereqo-release-integration-2026-11-07', head: '1d6b08c9916e3f84c4b9e64cb0b4299a77c28ef5' },
    priorProgressRecord: null,
    priorProgressNote: 'No numeric weighted progress ledger existed at resume. Historical PASS statuses use saved Op55/Op56 records, with estimates reconstructed and actualMinutes/startAt/endAt left null.',
    sessionStartedAt: startedAt,
    initializedAt: now(),
    updatedAt: null,
    externalWaits: [{
      id: 'R3_TESTNET_WRITE_APPROVAL',
      status: 'BLOCKED',
      reason: 'No explicit authorization for Testnet deployment, signing, funding, broadcast, or order submission.',
      releaseCondition: 'Separate written approval for the exact chain, Gate/codehash, sender, operation/calldata, caps, custody and recovery plan.',
      waitMinutes: null
    }],
    estimationMethod: 'Coarse 30-minute effort units based on the Op54 acceptance matrix, current source/test scope, and saved Op55/Op56 test evidence. Native integration tasks remain low-confidence; external wait is excluded from work-minute ETA. Calibration multiplier is applied only after at least three measured completed tasks.',
    calendarEstimateBasis: 'Conditional finish assumes uninterrupted work at 24 hours/day; no work schedule is known. It is not a committed calendar date. External approval/network waits are excluded.',
    tasks
  };
  persist(data);
  show(data.summary);
} else {
  const data = readData();
  const taskId = args[0];
  const task = taskId ? data.tasks.find(item => item.id === taskId) : null;
  if (command === 'resume') {
    if (data.activeResumeSession?.startedAt) throw new Error('A measured resume session is already active.');
    data.elapsedBeforeResumeMinutes ??= data.summary.elapsedMinutes;
    data.activeResumeSession = { startedAt: now() };
    data.resumeSessions ??= [];
    data.resumeSessions.push({ startedAt: data.activeResumeSession.startedAt, endedAt: null, actualMinutes: null });
    show(persist(data));
  } else if (command === 'checkpoint') {
    if (!data.activeResumeSession?.startedAt) throw new Error('No measured resume session is active.');
    const endedAt = now();
    const minutes = Math.max(0, (Date.parse(endedAt) - Date.parse(data.activeResumeSession.startedAt)) / 60000);
    data.elapsedBeforeResumeMinutes = Math.round(((data.elapsedBeforeResumeMinutes ?? 0) + minutes) * 10) / 10;
    const session = data.resumeSessions.at(-1);
    session.endedAt = endedAt;
    session.actualMinutes = Math.round(minutes * 10) / 10;
    data.activeResumeSession = null;
    show(persist(data));
  } else if (command === 'report') {
    show(persist(data));
  } else if (command === 'start') {
    if (!task) throw new Error('Unknown task ID.');
    if (data.tasks.some(item => item.status === 'ACTIVE' && item.id !== task.id)) throw new Error('Only one active task is allowed.');
    const unmet = task.dependsOn.filter(id => data.tasks.find(item => item.id === id)?.status !== 'PASS');
    if (unmet.length) throw new Error('Dependencies not PASS: ' + unmet.join(', '));
    task.status = 'ACTIVE';
    task.startAt ??= now();
    task.activeStartedAt = now();
    task.blockerReason = null;
    task.blockerReleaseCondition = task.blockerReleaseCondition ?? null;
    task.attempts.push({ startedAt: task.activeStartedAt });
    show(persist(data));
  } else if (command === 'adjust') {
    if (!task) throw new Error('Unknown task ID.');
    const estimate = Number(args[1]);
    const reasonIndex = args.indexOf('--reason');
    const reason = reasonIndex >= 0 ? args.slice(reasonIndex + 1).join(' ') : '';
    if (!Number.isInteger(estimate) || estimate <= 0 || !reason) throw new Error('Use adjust <ID> <positive minutes> --reason <evidence>.');
    task.initialEstimateMinutes ??= task.estimateMinutes;
    task.estimateRevisions ??= [];
    task.estimateRevisions.push({ at: now(), fromMinutes: task.estimateMinutes, toMinutes: estimate, reason });
    task.estimateMinutes = estimate;
    show(persist(data));
  } else if (['pass', 'block', 'fail'].includes(command)) {
    if (!task) throw new Error('Unknown task ID.');
    if (task.status !== 'ACTIVE' || !task.activeStartedAt) throw new Error('Task must be ACTIVE before it can be closed.');
    const optionText = flag => {
      const index = args.indexOf(flag);
      if (index < 0) return '';
      const nextOption = args.findIndex((value, i) => i > index && value.startsWith('--'));
      return args.slice(index + 1, nextOption < 0 ? args.length : nextOption).join(' ');
    };
    const endedAt = now();
    const minutes = Math.max(0, (Date.parse(endedAt) - Date.parse(task.activeStartedAt)) / 60000);
    task.actualMinutes = Math.round(((task.actualMinutes ?? 0) + minutes) * 10) / 10;
    task.endAt = endedAt;
    task.attempts.at(-1).endedAt = endedAt;
    task.attempts.at(-1).actualMinutes = Math.round(minutes * 10) / 10;
    task.activeStartedAt = null;
    if (command === 'pass') {
      const evidence = optionText('--evidence');
      if (!evidence) throw new Error('PASS requires --evidence <path or command result>.');
      task.status = 'PASS';
      task.evidence = evidence;
      task.blockerReason = null;
      task.blockerReleaseCondition = null;
    } else {
      const reason = optionText('--reason');
      if (!reason) throw new Error(command.toUpperCase() + ' requires --reason <text>.');
      task.status = command === 'block' ? 'BLOCKED' : 'FAIL';
      task.blockerReason = reason;
      task.blockerReleaseCondition = optionText('--release') || task.blockerReleaseCondition;
    }
    show(persist(data));
  } else {
    throw new Error('Commands: init, resume, checkpoint, start <ID>, adjust <ID> <minutes> --reason <evidence>, pass <ID> --evidence <text>, block <ID> --reason <text> --release <text>, fail <ID> --reason <text>, report.');
  }
}
