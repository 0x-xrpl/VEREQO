import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Language } from '../i18n';
export function OnboardingDialog({kind,language,onClose,onCreate}:{kind:'wallet'|'project';language:Language;onClose:()=>void;onCreate:(name:string)=>boolean}){
  const ref=useRef<HTMLDivElement>(null),[name,setName]=useState(''),[failed,setFailed]=useState(false);const ja=language==='ja';
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;ref.current?.querySelector<HTMLElement>('button')?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();closeRef.current();}
      if(event.key==='Tab'){
        const controls=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input')??[]),first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};
  },[]);
  const create=(event:FormEvent)=>{event.preventDefault();if(!onCreate(name))setFailed(true);};
  return <div className="onboardingBackdrop" onClick={event=>{if(event.target===event.currentTarget)onClose();}}><div className="onboardingDialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" data-testid="onboarding-dialog"><button type="button" className="dialogClose" aria-label={ja?'閉じる':'Close'} onClick={onClose}>×</button><span className="eyebrow">{kind==='wallet'?'WALLET / NOT_IMPLEMENTED':'PROJECT / SESSION-ONLY DRAFT'}</span><h2 id="onboarding-title">{kind==='wallet'?(ja?'ウォレット接続は未対応です。':'Wallet connection is unavailable.'):(ja?'検査用のProjectを作る。':'Create an inspection context.')}</h2>
    {kind==='wallet'?<><p>{ja?'検証済みのウォレットアダプターはありません。アカウント接続・署名・認証・金融権限付与・注文は行いません。':'No verified wallet adapter is installed. No account connection, signature, authentication, financial grant or order is performed.'}</p><div className="onboardingDistinctions"><span>{ja?'公開アカウントの接続':'Public account connection'}</span><span>≠ {ja?'組織メンバーシップ':'Organization membership'}</span><span>≠ {ja?'金融認可・執行':'Financial authority / execution'}</span></div><button className="outlineBtn" type="button" onClick={onClose}>{ja?'ローカルデモへ戻る':'Return to the local demo'}</button></>:<form onSubmit={create}><p>{ja?'表示用の合成コンテキストを、このタブのメモリにだけ追加します。再読み込みで消えます。発行者の履歴、認証、ウォレット、金融権限は作りません。':'Add a synthetic presentation context in this tab’s memory. Reloading discards it. It creates no issuer history, identity, wallet link or financial authority.'}</p><label>{ja?'Project名（秘密情報は入力しない）':'Project name (no confidential information)'}<input data-testid="project-name" value={name} maxLength={48} required onChange={event=>setName(event.target.value)} /></label><button className="outlineBtn" type="submit" data-testid="create-project-submit" disabled={!name.trim()}>{ja?'合成ドラフトを追加':'Add synthetic draft'}</button>{failed&&<p role="alert">{ja?'現在の状態では追加できません。履歴表示を終了し、1〜48文字で入力してください。上限は1,000件です。':'Cannot add in this state. Return from history and use 1–48 characters. Limit: 1,000 contexts.'}</p>}<small>{ja?'Projectは操作の整理単位です。Spaceや公開アカウントと自動的に金融権限を共有しません。':'A Project organizes work. It does not automatically share authority with a Space or public account.'}</small></form>}
  </div></div>;
}
