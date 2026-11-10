// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {FinancialObjectTracePanel,type FinancialObjectTrace} from '../apps/web/src/components/FinancialObjectTrace';

let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

const trace:FinancialObjectTrace={
 requestId:'fi_owner_scoped_123',revision:4,marketKind:'SPOT',marketId:'0x'+'12'.repeat(32),marketStatus:'LIVE_READ_ONLY',
 chainId:'1439',blockNumber:'12345',blockHash:'0x'+'aa'.repeat(32),blockSource:'https://rpc.injective.testnet.example',observedAt:'2026-11-07T22:00:00.000Z',marketSource:'https://lcd.injective.testnet.example/spot',marketConsistency:'UNPINNED_LCD_READ',side:'BUY',price:'1.25',quantity:'2',draftStatus:'REJECTED',
 evidenceState:'AVAILABLE',evidenceId:'7',evidenceStatus:'REJECTED',evidenceReason:'SIGNED_AUTHORIZATION_PACKAGE_REQUIRED',
 intentDigest:null,evidenceHash:'0x'+'bb'.repeat(32),evidenceEventCount:1,hypotheticalCredentialRevocation:true,
};

describe('selected financial object trace',()=>{
 it('keeps one Business ID and revision across the Instrument, Consequence context and Evidence inspector',async()=>{
  await act(async()=>root.render(<>
   <FinancialObjectTracePanel trace={trace} language="en" surface="INSTRUMENT" />
   <FinancialObjectTracePanel trace={trace} language="en" surface="CONSEQUENCE" />
   <FinancialObjectTracePanel trace={trace} language="en" surface="EVIDENCE" />
  </>));
  const panels=[...host.querySelectorAll<HTMLElement>('.financialObjectTrace')];
  expect(panels.map(panel=>panel.dataset.objectId)).toEqual([trace.requestId,trace.requestId,trace.requestId]);
  expect(panels.map(panel=>panel.dataset.revision)).toEqual(['4','4','4']);
  expect(panels.map(panel=>panel.dataset.surface)).toEqual(['INSTRUMENT','CONSEQUENCE','EVIDENCE']);
  expect(panels[0]?.querySelector('[data-testid="financial-trace-evidence-state"]')).toBeNull();
  expect(panels[1]?.textContent).toContain('NO CONFIGURED FINANCIAL GRAPH');
  expect(panels[1]?.textContent).toContain('not committed graph events');
  expect(panels[1]?.textContent).toContain('UNPINNED_LCD_READ');
  expect(panels[1]?.textContent).toContain('Market data is not pinned to the EVM block below.');
  expect(panels[1]?.querySelector('[data-testid="financial-trace-block-source"]')?.getAttribute('href')).toBe(trace.blockSource);
  expect(panels[1]?.querySelector('[data-testid="financial-trace-market-source"]')?.getAttribute('href')).toBe(trace.marketSource);
  expect(panels[1]?.textContent).toContain('LOCAL WHAT-IF');
  expect(panels[2]?.textContent).toContain(trace.evidenceId);
  expect(panels[2]?.textContent).toContain(trace.evidenceHash);
  expect(panels[2]?.textContent).toContain('Chain transaction / order receipt: NONE');
  expect(host.textContent).not.toContain('ORDER PLACED');
 });

 it('keeps absence of an owner-scoped evidence record distinct from unknown or fallback data',async()=>{
  const noRecord:FinancialObjectTrace={...trace,evidenceState:'NO_RECORD',evidenceId:null,evidenceStatus:null,evidenceReason:null,intentDigest:null,evidenceHash:null,evidenceEventCount:0};
  await act(async()=>root.render(<FinancialObjectTracePanel trace={noRecord} language="en" surface="EVIDENCE" />));
  const evidence=host.querySelector<HTMLElement>('[data-testid="financial-trace-evidence-state"]')!;
  expect(evidence.textContent).toContain('NO RECORD');
  expect(evidence.querySelector('dl')).toBeNull();
  expect(evidence.textContent).toContain('Chain transaction / order receipt: NONE');
 });

 it('reports an S08 local proof vector as verified only after the validated replay result is present',async()=>{
  const pending:FinancialObjectTrace={...trace,requestSource:'SYNTHETIC_REHEARSAL',rehearsalScenarioId:'S08-proof-is-not-authority',rehearsalSource:null,rehearsalProofStatus:null,rehearsalFacts:null};
  await act(async()=>root.render(<FinancialObjectTracePanel trace={pending} language="en" surface="CONSEQUENCE" />));
  expect(host.querySelector('[data-testid="financial-trace-rules"]')?.textContent).toContain('NOT_VERIFIED / NOT_CONFIGURED');
  const verified:FinancialObjectTrace={...pending,rehearsalSource:'LOCAL_GROTH16_TEST_VECTOR',rehearsalProofStatus:'GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP',rehearsalFacts:{proofDigest:'0x'+'ab'.repeat(32)}};
  await act(async()=>root.render(<FinancialObjectTracePanel trace={verified} language="en" surface="CONSEQUENCE" />));
  const rules=host.querySelector('[data-testid="financial-trace-rules"]')!;
  expect(rules.textContent).toContain('LOCAL TEST VECTOR VERIFIED / LIVE GATE NOT CONFIGURED');
  expect(rules.textContent).not.toContain('NOT_VERIFIED / NOT_CONFIGURED');
 });
 it('carries recorded G3 digests through all surfaces without inventing proposal details or fresh proof verification',async()=>{
  const recorded:FinancialObjectTrace={...trace,recordOnly:true,requestSource:'OWNER_SCOPED_AUTHORIZATION_RECORD',proofDigest:'0x'+'12'.repeat(32),mandateDigest:'0x'+'23'.repeat(32),requestDigest:'0x'+'34'.repeat(32),disclosureBindingDigest:'0x'+'45'.repeat(32),disclosureHistoryRoot:'0x'+'56'.repeat(32),disclosureHistorySequence:'0',disclosurePolicyEpoch:'1',disclosureCredentialEpoch:'2',evidenceStatus:'PRE_GATE_VALIDATED',evidenceReason:null};
  await act(async()=>root.render(<>{(['INSTRUMENT','CONSEQUENCE','EVIDENCE'] as const).map(surface=><FinancialObjectTracePanel key={surface} trace={recorded} language="en" surface={surface}/>)}</>));
  for(const panel of host.querySelectorAll('.financialObjectTrace')){
   expect(panel.querySelectorAll('[data-testid="financial-request-journey"] li')).toHaveLength(5);
   expect(panel.textContent).toContain('not reverified here');
   expect(panel.textContent).toContain('NOT IN EVIDENCE RECORD');
   expect(panel.textContent).not.toContain('1.25 / 2');
  }
  expect(host.querySelector('[data-testid="financial-trace-evidence"]')?.textContent).toContain(recorded.disclosureBindingDigest);
 });
});
