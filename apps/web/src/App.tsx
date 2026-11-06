import React, { useEffect, useRef, useState } from 'react';
import { downstreamNodeIds } from '../../../packages/consequence/src/index';
import type { GraphNode } from '../../../packages/consequence/src/index.ts';
import { Dial } from './components/Dial';
import { LcdMeter } from './components/LcdMeter';
import { Landing } from './components/Landing';
import { useDemoController } from './useDemoController';
import { nodeName, translate, type Language } from './i18n';
import { CausalEvidence } from './components/CausalEvidence';
import { WorkspaceOverview } from './components/WorkspaceOverview';
import { LivingBoard } from './components/LivingBoard';
import { experienceCopy } from './experienceCopy';
import { selectedGraphEvidence } from './graphPresentation';
import { ConsequenceSpace, statusLabel } from './components/ConsequenceSpace';
import { useOperatingExperience } from './useOperatingExperience';
import { words } from './operatingModel';
import { EventTimeline } from './components/EventTimeline';
import { InstrumentContext } from './components/InstrumentContext';
import { OnboardingDialog } from './components/OnboardingDialog';
import { StateInquiry } from './components/StateInquiry';
import { NestedCausal } from './components/NestedCausal';
import { RequestSummary } from './components/RequestSummary';
import { GuidedDemo } from './components/GuidedDemo';
import './landing.css';

export default function App() {
 const [language, setLanguage] = useState<Language>('ja');
 const [journey,setJourney] = useState<'guided'|'free'>('free');
 const [onboarding,setOnboarding] = useState<'wallet'|'project'|null>(null);
 const [page, setPage] = useState<'landing' | 'demo'>(() => window.location.hash.startsWith('#demo') ? 'demo' : 'landing');
 const controller = useDemoController();
 const operating = useOperatingExperience(controller);
 const {mode, depth, setDepth, setThreshold, selected, pending, needsReload, error, notice, load} = controller;
 const state = operating.viewState;
 const preview = operating.viewPreview;
 const preflight = operating.historical ? null : controller.preflight;
 const historicalDisclosure = operating.inspection?.event.data.stream === 'disclosure' ? operating.inspection.event.data.record : null;
 const threshold = historicalDisclosure?.query.threshold ?? controller.threshold;
 const setMode: typeof controller.setMode = value => { if (!operating.historical) controller.setMode(value); };
 const request = () => operating.run('request');
 const previewImpact = () => operating.run('previewImpact');
 const commit = () => operating.run('commit');
 const reset = () => operating.run('reset');
 const t = (key: string, args: Record<string, string | number> = {}) => translate(language, key, args);
 const s = experienceCopy(language);
 const selectNode = operating.chooseNode;
 useEffect(() => { document.documentElement.lang = language; }, [language]);
 useEffect(() => {
  const sync = () => setPage(window.location.hash.startsWith('#demo') ? 'demo' : 'landing');
  window.addEventListener('hashchange', sync);
  return () => window.removeEventListener('hashchange', sync);
 }, []);
 const navigate = (next: 'landing' | 'demo') => {
  setPage(next); window.location.hash = next === 'demo' ? 'demo' : 'top';
  requestAnimationFrame(() => {
   document.getElementById(next === 'demo' ? 'demo' : 'top')?.focus({ preventScroll: true });
   window.scrollTo({ top: 0, behavior: 'instant' });
  });
 };
 const showHow = () => {
  setPage('landing'); window.location.hash = 'how-it-works';
  requestAnimationFrame(() => document.getElementById('how-it-works')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
 };
 const inspect = () => setDepth(value => value % 3 + 1);
 const graph = preview?.snapshot ?? state?.graph;
 const changes = preview?.changes ?? state?.lastChanges ?? [];
 const history = state?.disclosure.history ?? [];
 const candidates = state?.disclosure.candidates ?? [];
 const selectedRecord = historicalDisclosure ?? history.at(-1) ?? null;
 const name = (node: GraphNode) => nodeName(language, node.type, node.id);
 const nameId = (id: string) => { const node = graph?.nodes.find(entry => entry.id === id); return node ? name(node) : id; };
 const status = (value: string | undefined) => t(value === 'VALID' ? 'valid' : value === 'BLOCKED' ? 'blocked' : value === 'REVOKED' ? 'revoked' : value === 'STALE' ? 'stale' : 'unknown');
 const selectedEvidence = graph ? selectedGraphEvidence(graph, changes, selected) : null;
 const selectedNode = selectedEvidence?.node;
 const change = selectedEvidence?.change;
 const event = preview?.command ?? state?.graph.events.at(-1)?.command;
 const motionSeen = useRef(new Set<string>());
 const motionInitialized = useRef(false);
 const motionObservation = useRef(operating.observationRevision);
 const [animatedEvent, setAnimatedEvent] = useState<string | null>(null);
 const motionIdentity = event?.eventId;
 const hasSnapshot = !!state;
 useEffect(() => {
  if (!hasSnapshot) return;
  if(motionObservation.current !== operating.observationRevision){motionObservation.current=operating.observationRevision;if(motionIdentity)motionSeen.current.add(motionIdentity);setAnimatedEvent(null);return;}
  if (!motionInitialized.current) {
   motionInitialized.current = true;
   if (motionIdentity && !preview) motionSeen.current.add(motionIdentity);
  }
  if (operating.historical || mode !== 'impact') {
   if (motionIdentity) motionSeen.current.add(motionIdentity);
   setAnimatedEvent(null); return;
  }
  if (!motionIdentity || motionSeen.current.has(motionIdentity)) { setAnimatedEvent(null); return; }
  motionSeen.current.add(motionIdentity); setAnimatedEvent(motionIdentity);
  const timer = window.setTimeout(() => setAnimatedEvent(null), 800);
  return () => window.clearTimeout(timer);
 }, [motionIdentity, mode, hasSnapshot, operating.historical, operating.observationRevision]);
 const pathIds = selectedEvidence?.path ?? [];
 const a = graph?.nodes.find(node => node.id === 'action_A');
 const b = graph?.nodes.find(node => node.id === 'action_B');
 const reason = selectedRecord ? (language === 'ja' ? '保存された公開履歴の判定。現在の質問ではありません。' : 'Recorded public transcript decision. This is not a current proposal.') : preflight ? t(preflight.reason === 'ALL_POSSIBLE_OUTCOMES_MEET_FLOOR' ? 'reasonAllowed' : preflight.reason === 'CANDIDATE_FLOOR' ? 'reasonDenied' : 'reasonUnknown') : t('waiting');
 const nodeReason = change ? change.path.length === 1 ? t(event?.type === 'CHANGE_POLICY' ? 'policyReason' : 'revokedReason') : t('dependencyReason', { name: nameId(change.nodeId), root: nameId(change.path[0] ?? '') }) : t(selectedNode?.state === 'VALID' ? 'validReason' : 'nextBlocked');
 const dialProps = { decreaseLabel: t('decrease'), increaseLabel: t('increase'), alternativeLabel: t('alternative') };
 const primaryDisabled = !operating.canMutate || pending || needsReload || !state || (mode === 'impact' ? !preview && state.graph.nodes.find(node => node.id === 'credential_A')?.state === 'REVOKED' : !preflight);
 const primary = () => { if (mode === 'impact') void previewImpact(); else void request(); };
 const reasonRows = mode === 'impact' ? [
  ['reasonLabelWhat', change ? t('change', { before: status(change.before), after: status(change.after) }) : t('noChange')],
  ['reasonLabelWhy', nodeReason], ['reasonLabelAffects', t('impactCount', { count: graph ? downstreamNodeIds(graph, selected).filter(id => changes.some(entry => entry.nodeId === id)).length : 0 })], ['reasonLabelReveals', t('reveal')], ['reasonLabelNext', t(preview ? 'nextPreview' : selectedNode?.state === 'VALID' ? 'nextCurrent' : 'nextBlocked')]
 ] : [['reasonLabelWhat', t('pendingThreshold', { value: selectedRecord?.query.threshold ?? threshold })], ['reasonLabelWhy', reason], ['reasonLabelReveals', t('reveal')], ['reasonLabelAffects', t('preflightAffects')], ['reasonLabelNext', t('queryNext')]];
 const inspector=(<section className="surface contextualInset" hidden={depth<2} aria-label={t('inspectorTitle')}><div className="panelPad"><div className="panelHeader"><div><div className="eyebrow">{t('contextLabel')}</div><h3>{t('inspectorTitle')}</h3></div><span className="badge">{t(depth === 3 ? 'evidenceLabel' : 'reasonLabel')}</span></div><div className="inspectTop"><div className="inspectPuck" aria-hidden="true" /><div><div className="inspectName">{mode === 'impact' ? selectedNode ? name(selectedNode) : t('loading') : selectedRecord ? (language==='ja'?`公開判定 ${selectedRecord.sequence}`:`DISCLOSURE RECORD ${selectedRecord.sequence}`) : t('preflight')}</div><div className="inspectState">{mode === 'impact' ? status(selectedNode?.state) : t('proposal', { value: selectedRecord?.query.threshold ?? threshold })}</div></div></div><dl>{reasonRows.map(([key, value]) => <div className="reasonLine" key={key}><dt>{t(key ?? '')}</dt><dd>{value}</dd></div>)}</dl><CausalEvidence language={language} mode={mode} state={state} preview={preview} selected={selected} preflight={preflight} record={selectedRecord} depth={depth} onDepth={setDepth} unknown={!!error} /></div></section>);
 return <>
  <a className="skip" href="#demo" data-testid="skip-to-workspace" onClick={event => { event.preventDefault(); navigate('demo'); }}>{t('skip')}</a>
  <header className="topbar"><div className="barIn"><a className="brand" aria-label={language==='ja'?'ヴェレコ / ホーム':'VEREQO / Home'} href="#top" onClick={event => { event.preventDefault(); navigate('landing'); }}><span aria-hidden="true" className="brandmark" />VEREQO</a><nav className="navlinks" aria-label={t('navigation')}><a href="#demo" onClick={event => { event.preventDefault(); navigate('demo'); }}>{t('navInstrument')}</a><a href="#how-it-works" onClick={event => { event.preventDefault(); showHow(); }}>{t('navPrinciple')}</a></nav><div className="barRight"><div className="langSwitch" role="group" aria-label={t('language')}>{(['ja', 'en'] as const).map(lang => <button key={lang} type="button" className="langOption" id={lang === 'ja' ? 'langJA' : 'langEN'} data-testid={`language-${lang}`} aria-pressed={language === lang} onClick={() => setLanguage(lang)}>{lang === 'ja' ? 'JP' : 'EN'}</button>)}</div><span className="statusTop">● {t('local')}</span></div></div></header>
  <main><div className="pageSurface" hidden={page !== 'landing'}><Landing language={language} active={page === 'landing'} onStart={() => {setJourney('guided');navigate('demo');}} onGuided={() => {setJourney('guided');navigate('demo');}} onWallet={() => setOnboarding('wallet')} onProject={() => setOnboarding('project')} /></div><div className="pageSurface" hidden={page !== 'demo'}>
  <section className="work" id="demo" tabIndex={-1} data-testid="workspace"><div className="workspaceEntry"><div role="group" aria-label={language==='ja'?'デモの進め方':'Demo journey'}><button type="button" data-testid="journey-guided" aria-pressed={journey==='guided'} onClick={()=>setJourney('guided')}>{language==='ja'?'ガイド付き':'Guided demo'}</button><button type="button" data-testid="journey-free" aria-pressed={journey==='free'} onClick={()=>setJourney('free')}>{language==='ja'?'自由に探索':'Explore freely'}</button></div><div><button type="button" data-testid="workspace-wallet" onClick={()=>setOnboarding('wallet')}>{language==='ja'?'ウォレット接続':'Connect wallet'}</button><button type="button" data-testid="workspace-project" onClick={()=>setOnboarding('project')}>{language==='ja'?'Projectを作成':'Create project'} +</button></div></div><WorkspaceOverview language={language} state={operating.inspection?.event.data.stream==='graph'?null:state} mode={mode} onMode={setMode} project={operating.project} projects={operating.projects} onProject={operating.chooseProject} readOnly={operating.historical} /><div className="operatingSurface"><ConsequenceSpace language={language} tiles={operating.tiles} selected={operating.tileId} onSelect={operating.chooseTile} inquiry={<StateInquiry language={language} context={{scope:JSON.stringify([operating.projectId,operating.inspection?.event.id??'current',operating.generation,graph?.sequence,preview?.command.eventId,selected,threshold,preflight?.historySequence,preflight?.policyEpoch,error,needsReload]),tiles:operating.tiles,graph:operating.localContext&&(!operating.historical||operating.inspection?.event.data.stream==='graph')?graph:undefined,changes,preflight:operating.localContext?preflight:null,record:operating.localContext&&(!operating.historical||operating.inspection?.event.data.stream==='disclosure')?selectedRecord:null,historical:operating.historical,local:operating.localContext,unavailable:!!error||needsReload||!state}} onInspect={id=>{const tile=operating.tiles.find(item=>item.id===id);if(tile){operating.chooseTile(tile);setDepth(3);}}} />} /><div className="instrumentDock">{journey==='guided'&&<GuidedDemo language={language} controller={controller} operating={operating} onFree={()=>setJourney('free')} />}<div className="bodyGrid decisionPane" data-mode={mode} id="decision-evidence" hidden={!operating.localContext || !state}><section className="surface" aria-label={t(mode === 'impact' ? 'impactHeading' : 'disclosureHeading')}><div className="panelPad"><div className="panelHeader"><div><div className="eyebrow">{t('resultLabel')}</div><h3>{t(mode === 'impact' ? 'impactHeading' : 'disclosureHeading')}</h3></div><span className="badge" data-testid="preview-state">{operating.historical ? 'HISTORICAL / READ-ONLY' : t(!state || error ? 'statusUnknown' : mode === 'disclosure' ? 'statusProposal' : preview ? 'statusPreview' : 'statusCommitted')}</span></div><div className="bigMessage" aria-live="polite" data-testid="decision-result">{mode === 'impact' ? preview || changes.length ? t('impactResult', { a: status(a?.state), b: status(b?.state) }) : t('impactCurrent') : selectedRecord ? (selectedRecord.status === 'DENIED' ? t('statusDenied') : language === 'ja' ? '回答を公開済み' : 'ANSWER RELEASED') : preflight ? t(preflight.status === 'ALLOWED' ? 'statusAllowed' : 'statusDenied') : t('waiting')}</div><p className="subMessage">{mode === 'impact' ? t(preview || changes.length ? 'impactCount' : 'impactCurrentSub', { count: changes.length }) : reason}</p>
  {mode === 'impact' ? <div id="impactContent"><div className="inlineActions"><button className="outlineBtn" disabled={primaryDisabled} onClick={() => void previewImpact()}>{t(preview ? 'cancelPreview' : 'previewButton')}</button><button className="subtleBtn" onClick={() => setDepth(2)}>{t('explainButton')}</button>{preview && <button className="subtleBtn" data-testid="commit-preview" disabled={!operating.canMutate || pending || needsReload} onClick={() => void commit()}>{t('commit')}</button>}</div><NestedCausal scope={`${operating.projectId}:${operating.inspection?.event.id??operating.generation}:${preview?.command.eventId??graph?.sequence}`} selected={selected} depth={depth} onSelect={selectNode} onDepth={setDepth} name={nameId} language={language} inspector={inspector}>{inspectNode=><><div className="pathArea" hidden={depth !== 2}><div className="pathTitle"><span>{s.exactPath}</span><span>{t('dependency')}</span></div><div className="pathStrip" data-testid="causal-path">{pathIds.map((id, index) => <React.Fragment key={id}>{index > 0 && <span className="pathArrow" aria-hidden="true">→</span>}<button className={`pathNode ${changes.some(entry => entry.nodeId === id) ? 'affected' : ''}`} aria-pressed={selected === id} onClick={() => inspectNode(id)}><span className="id">{t(preview ? 'statusPreview' : 'statusCommitted')} / {String(index + 1).padStart(2, '0')}</span>{nameId(id)}</button></React.Fragment>)}</div>{pathIds.length === 0 && <p className="pathSummary">{s.noPath}</p>}<div className="pathSummary">{t('pathSummary')}</div></div><LivingBoard graph={graph} changes={changes} selected={selected} depth={depth} language={language} preview={!!preview} animate={!!animatedEvent && animatedEvent === event?.eventId} onSelect={inspectNode} name={name} status={status} t={t} /></>}</NestedCausal></div> : <div id="disclosureContent"><RequestSummary language={language} view={state?.disclosure??null} preflight={preflight} threshold={threshold} record={selectedRecord} historical={operating.historical} unknown={!!error||needsReload} /><details className="proposalDetails" key={selectedRecord?.sequence??'initial'} open={!selectedRecord||operating.historical}><summary>{operating.historical?(language==='ja'?'記録された分岐':'Recorded branches'):(language==='ja'?`次の質問 x ≤ ${threshold} を確認`:`Inspect the next question x ≤ ${threshold}`)}</summary><div className="disclosureQuestion" data-testid="next-question" hidden={operating.historical}><span className="eyebrow">{s.question}</span><strong>{language === 'ja' ? `サンプル値は${threshold}以下ですか？` : `Is the sample value at most ${threshold}?`}</strong><small>{s.abstract} · {language==='ja'?'判定だけでは回答は公開されません。':'Preflight alone releases no answer.'}</small></div><div className="inlineActions"><button className="outlineBtn" data-testid="submit-query" disabled={!operating.canMutate || pending || needsReload || !state || !preflight} onClick={() => void request()}>{t('submitButton')}</button><button className="subtleBtn" disabled={!operating.canMutate || pending || needsReload || !state} onClick={() => void reset()}>{t('resetBtn')}</button></div><div className="outcomeGrid">{(['yes', 'no'] as const).map(side => <div className="outcomeCard" key={side}><div className="outhead">{t(side)}</div><div className="actionLine"><div className="actionStat"><i className="dotStatus" /><span>{t('split')}</span></div><h4 data-testid={`partition-${side}`}>{historicalDisclosure?.partitions[side] ?? preflight?.partitions[side] ?? '—'}</h4><p>{t(side === 'yes' ? 'yesRemains' : 'noRemains')}</p></div></div>)}</div></details><details className="candidateDetail"><summary>{language==='ja'?`残る${candidates.length}候補と下限を調べる`:`Inspect ${candidates.length} remaining candidates and floor`}</summary><div className="candidateView" role="img" aria-label={t('candidates', { count: candidates.length })}>{Array.from({ length: 128 }, (_, value) => <i key={value} className={candidates.includes(value) ? '' : 'absent'} />)}</div><div className="candidateCaption">{t('candidates', { count: candidates.length })} · {t('floor', { count: operating.historical ? '—' : state?.disclosure.policy.minCandidates ?? '—' })}</div></details><div className="processSteps" data-testid="disclosure-history" aria-label={t('history')}>{history.length === 0 ? <span className="processStep">{t('emptyHistory')}</span> : history.map(record => <span className="processStep" key={record.sequence}>{record.sequence} / x ≤ {record.query.threshold} / {t(record.status === 'DENIED' ? 'noAnswer' : record.answer ? 'answerYes' : 'answerNo')} / {t('historyRow', { before: record.remainingBefore, after: record.remainingAfter })}</span>)}</div><div className="inlineNotice">{operating.historical ? 'HISTORICAL RECORD' : t('preflight')} · {historicalDisclosure ? t(historicalDisclosure.status === 'ALLOWED' ? 'statusAllowed' : 'statusDenied') : preflight ? t(preflight.status === 'ALLOWED' ? 'statusAllowed' : 'statusDenied') : t('waiting')}</div></div>}
  </div></section>{mode==='disclosure'&&inspector}</div>
  <div className="instrumentHeading"><div><span className="eyebrow">03 / INSPECT DEEPER</span><h2>{s.instrument}</h2></div><p>{s.instrumentSub}</p></div>
  <div className="device" id="white-instrument" role="region" aria-label={s.instrument} data-testid="white-instrument"><div className="deviceHeader"><span className="idMark">VQ–01 <span className="unit">/ {t('surface')}</span></span><span className="unitMode">{t(mode === 'impact' ? 'modeImpactDetail' : 'modeDisclosureDetail')}</span><div className="modeGroup" role="group" aria-label={t('currentMode')}>{(['impact', 'disclosure'] as const).map(value => <button key={value} type="button" data-testid={`mode-${value}`} aria-pressed={mode === value} aria-selected={mode === value} onClick={() => setMode(value)}>{t(value === 'impact' ? 'modeImpact' : 'modeDisclosure')}</button>)}</div></div>
  <InstrumentContext language={language} operating={operating} depth={depth} onDepth={setDepth} /><div className="deck"><div className="deckZone"><div className="zoneTop"><span>{t(mode === 'impact' ? 'modeDialImpact' : 'modeDialDisclosure')}</span><span>{mode === 'impact' ? '1–3' : '0–127'}</span></div><Dial disabled={!operating.localContext || operating.historical} value={mode === 'impact' ? depth : threshold} min={mode === 'impact' ? 1 : 0} max={mode === 'impact' ? 3 : 127} label={t(mode === 'impact' ? 'dialAriaImpact' : 'dialAriaDisclosure')} valueText={mode === 'impact' ? t(`depth${depth}`) : `x ≤ ${threshold}`} onChange={mode === 'impact' ? setDepth : setThreshold} {...dialProps} /></div>
  <div className="deckZone"><div className="zoneTop"><span>{t('monitor')}</span><span>{t('display')}</span></div><div className="display" role="region" aria-label={t('monitor')}><span className="label">{t(mode === 'disclosure' ? 'candidateLabel' : preview ? 'affectedLabel' : 'potentialLabel')}</span><div className="displayValue lcdValueFixed" data-testid="working-lcd">{!state || !operating.localContext ? '—' : mode === 'disclosure' ? candidates.length : String(new Set(changes.map(entry => entry.nodeId)).size).padStart(2, '0')}</div><div className="displayCaption lcdCaptionFixed">{!operating.localContext ? (language === 'ja' ? '合成シナリオ / API未接続' : 'SCENARIO / NOT API-CONNECTED') : mode === 'disclosure' ? t('candidates', { count: candidates.length }) : t(preview || changes.length ? 'impactCount' : 'currentCount', { count: changes.length })}</div><LcdMeter mode={mode} candidates={operating.localContext ? candidates : []} changes={operating.localContext ? changes : []} totalNodes={graph?.nodes.length ?? 0} label={t(mode === 'disclosure' ? 'candidateLabel' : preview ? 'affectedLabel' : 'potentialLabel')} /><div className="lcdFoot" hidden={!operating.localContext}><span>{t(mode === 'impact' ? 'impactFootA' : 'proposal', { value: threshold })}</span><span>{mode === 'impact' ? t('impactFootB') : t('floor', { count: operating.historical ? '—' : state?.disclosure.policy.minCandidates ?? '—' })}</span></div></div></div>
  <div className="deckZone deckRight"><div className="signalCard"><div className="signalTitle">{t('currentMode')}</div><strong>{t(mode === 'impact' ? 'impactName' : 'disclosureName')}</strong><small>{t(mode === 'impact' ? 'impactSubtitle' : 'disclosureSubtitle')}</small></div><div className="signalCard"><div className="signalTitle">{t('boundaryLabel')}</div><strong>{t('noExecution')}</strong><small>{t('noExecutionDesc')}</small></div><div className="physicalKeys"><button className="key" data-testid="key-primary" type="button" disabled={primaryDisabled} onClick={primary}><strong>{t(mode === 'impact' ? preview ? 'cancel' : 'previewBtn' : 'query')}</strong><span aria-hidden="true">↗</span></button><button className="key" data-testid="key-secondary" type="button" onClick={inspect}><strong>{t('inspectBtn')}</strong><span aria-hidden="true">↗</span></button><button className="key" data-testid="key-reset" type="button" disabled={!operating.canMutate || pending || needsReload || !state} onClick={() => void reset()}><strong>{t('resetBtn')}</strong><span aria-hidden="true">↺</span></button><button className="key keyPrimary" data-testid="key-mode" type="button" onClick={() => setMode(value => value === 'impact' ? 'disclosure' : 'impact')}><strong>{t('modeBtn')}</strong><span aria-hidden="true">⇄</span></button></div></div></div></div>
  <div className="belowDevice"><span>{t('controls')}</span><span><span aria-hidden="true" className="screw" /> {t('encoder')}</span></div></div></div>{operating.tile && <div className="selectionContext" data-testid="selected-context"><span className="eyebrow">{language === 'ja' ? '選択中の検査対象' : 'INSPECTION TARGET'}</span><strong>{words(operating.tile.label,language)}</strong><span>{statusLabel(operating.tile.status,language)}</span><code>{operating.tile.source}</code><p>{words(operating.tile.summary,language)}</p></div>}{!operating.localContext && <section className="scenarioInspection" data-testid="scenario-inspection"><span className="eyebrow">SIMULATED / READ-ONLY</span><h2>{language === 'ja' ? '合成シナリオを検査中' : 'Inspecting a synthetic scenario'}</h2><p>{language === 'ja' ? 'このProjectは表示用データです。接続された発行者への開示・失効・リセット操作は無効です。Project選択は認証や金融権限を作りません。' : 'This project contains presentation data. Live issuer release, revocation and reset controls are disabled. Project selection creates no identity or financial authority.'}</p></section>}
  <div role="status" aria-live="polite" className="inlineNotice requestNotice" data-testid="request-status">{pending ? t('checking') : !state && !error ? t('loading') : notice ? t(notice) : ''}</div>{error && <div role="alert" className="inlineNotice"><span>{t(error)}</span>{<button className="subtleBtn" data-testid="reload-state" disabled={pending} onClick={() => void load()}>{t('reloadState')}</button>}</div>}
  <EventTimeline language={language} operating={operating} />
<p className="modelBoundary">{s.boundary}</p>
  </section><section className="flow" aria-label={t('navPrinciple')}><div className="flowColumns">{[1, 2, 3].map(index => <div className="flowItem" key={index}><span className="eyebrow">00{index}</span><h4>{t(`flowTitle${index}`)}</h4><p>{t(`flowText${index}`)}</p></div>)}</div></section></div></main><footer className="footer"><strong>VEREQO</strong><span>Prove what matters. Control what follows. / {t('footer')}</span></footer>
 {onboarding&&<OnboardingDialog key={onboarding} kind={onboarding} language={language} onClose={()=>setOnboarding(null)} onCreate={name=>{if(!operating.createProject(name))return false;setOnboarding(null);setJourney('free');navigate('demo');return true;}} />}
 </>;
}
