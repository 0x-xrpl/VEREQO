// @vitest-environment happy-dom
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {NestedCausal} from '../apps/web/src/components/NestedCausal';
it('keeps an in-place navigation trail, Back/Esc and fresh stream scope without calling any API',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 function Harness({scope}:{scope:string}){const [selected,setSelected]=useState('action_A'),[depth,setDepth]=useState(1);return <NestedCausal scope={scope} selected={selected} depth={depth} onSelect={id=>{setSelected(id);setDepth(2);}} onDepth={setDepth} name={id=>id} language="en">{inspect=><><button data-node-id="action_A" onClick={()=>inspect('action_A')}>A</button><button data-node-id="permission_A" onClick={()=>inspect('permission_A')}>Permission</button></>}</NestedCausal>;}
 try{
  await act(async()=>root.render(<Harness scope="g0:graph:0"/>));
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-node-id="permission_A"]')!.click());
  expect(host.querySelector('.inspectionTrail')?.textContent).toContain('action_Apermission_A');
  await act(async()=>host.querySelector('[data-node-id="permission_A"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(host.querySelector('.inspectionTrail [aria-current]')?.textContent).toBe('action_A');
  await act(async()=>root.render(<Harness scope="g1:graph:0"/>));
  expect(host.querySelectorAll('.inspectionTrail [aria-current]')).toHaveLength(1);expect(fetch).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
