// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectCatalog, projectPage } from '../apps/web/src/components/ProjectCatalog';
import { OnboardingDialog } from '../apps/web/src/components/OnboardingDialog';
import { PROJECTS } from '../apps/web/src/operatingModel';
import { GuidedDemo } from '../apps/web/src/components/GuidedDemo';
import type { DemoController } from '../apps/web/src/useDemoController';
import { useOperatingExperience } from '../apps/web/src/useOperatingExperience';
import { createDemoGraph } from '../packages/consequence/src/index';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe('bounded project catalog and honest wallet entry',()=>{
 it('shows actual denied partitions for a retained nonstandard transcript, not the guided fixture numbers',async()=>{
   const c:DemoController={state:{environment:'LOCAL_REFERENCE',requestToken:'test-only-token',graph:createDemoGraph(),lastChanges:[],capabilities:{proof:'NOT_IMPLEMENTED',authorization:'NOT_IMPLEMENTED',execution:'NOT_IMPLEMENTED'},disclosure:{candidates:Array.from({length:128},(_,i)=>i),policy:{epoch:1,minCandidates:16},history:[{sequence:1,query:{kind:'LTE',threshold:0,predicateId:'x.lte.v1'},policyEpoch:1,status:'DENIED',reason:'CANDIDATE_FLOOR',partitions:{yes:1,no:127},remainingBefore:128,remainingAfter:128,idempotencyKey:'nonstandard'}]}},mode:'disclosure',setMode:vi.fn(),depth:1,setDepth:vi.fn(),threshold:0,setThreshold:vi.fn(),selected:'credential_A',setSelected:vi.fn(),preview:null,preflight:null,pending:false,needsReload:false,error:'',notice:'',load:async()=>true,request:async()=>{},previewImpact:async()=>{},commit:async()=>{},reset:async()=>{},updatedAt:null};
   function Harness(){const operating=useOperatingExperience(c);return <GuidedDemo language="en" controller={c} operating={operating} onFree={()=>{}}/>;}
   await act(async()=>root.render(<Harness/>));
   expect(host.textContent).toContain('Existing history is retained');expect(host.textContent).toContain('1 / 127 · DENIED');
   expect(host.textContent).not.toContain('71 / 10');expect(host.querySelector('[data-testid="guide-state"]')?.textContent).not.toContain('128 → 101 → 81');
 });
 it('indexes 1,000 contexts with at most eight selectable rows and exact search',async()=>{
   const projects=Array.from({length:1000},(_,i)=>({...PROJECTS[1]!,id:`fixture-${i}`,name:{en:`Desk ${i}`,ja:`デスク ${i}`}}));
   expect(projectPage(projects,'',124)).toMatchObject({total:1000,pages:125,index:124});
   expect(projectPage(projects,'Desk 999',0).items.map(project=>project.id)).toEqual(['fixture-999']);
   await act(async()=>root.render(<ProjectCatalog projects={projects} selected="fixture-0" language="en" readOnly={false} onProject={vi.fn()} />));
   expect(host.querySelectorAll('[data-testid^="project:"]')).toHaveLength(8);
 });
 it('announces unavailability, never accesses a provider and retains input focus across parent renders',async()=>{
   const fetch=vi.fn(),provider=vi.fn();vi.stubGlobal('fetch',fetch);vi.stubGlobal('ethereum',{request:provider});
   await act(async()=>root.render(<OnboardingDialog kind="wallet" language="en" onClose={()=>{}} onCreate={()=>false} />));
   expect(host.textContent).toContain('Wallet connection is unavailable');expect(host.textContent).toContain('NOT_IMPLEMENTED');expect(provider).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
   await act(async()=>root.render(<OnboardingDialog key="project" kind="project" language="en" onClose={()=>{}} onCreate={()=>false} />));
   const input=host.querySelector<HTMLInputElement>('input')!;input.focus();
   await act(async()=>root.render(<OnboardingDialog key="project" kind="project" language="en" onClose={()=>{}} onCreate={()=>false} />));
   expect(document.activeElement).toBe(input);expect(host.textContent).toContain('Reloading discards it');
 });
});
