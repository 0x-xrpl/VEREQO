import type { DemoState } from '../../../../packages/domain/src/demo';
import type { DemoMode } from '../useDemoController';
import type { Language } from '../i18n';
import { ProjectCatalog } from './ProjectCatalog';
import { experienceCopy } from '../experienceCopy';
import { AGENTS, LOCAL_PROJECT, PROJECTS, SCENARIO_EVENTS, words, type OperatingProject } from '../operatingModel';

export function WorkspaceOverview({ language, state, mode, onMode, project=PROJECTS[0]!, projects=PROJECTS, onProject, readOnly=false }: { language: Language; state: DemoState | null; mode: DemoMode; onMode: (mode: DemoMode) => void; project?: OperatingProject; projects?: readonly OperatingProject[]; onProject?: (id:string)=>void; readOnly?: boolean }) {
  const s = experienceCopy(language);
  return <div className="workspaceOverview">
    <div className="projectLine">
      <details className="projectIndex"><summary><span className="projectMonogram" aria-hidden="true">N</span><span><small>NORTHSTAR TRADING / SYNTHETIC</small><strong>{words(project.name,language)}</strong></span><span aria-hidden="true">⌄</span></summary>
        <ProjectCatalog projects={projects} selected={project.id} language={language} onProject={onProject} readOnly={readOnly} />
      </details><span className="workspaceLocal">{project.source} / {language==='ja'?'金融認可は未実装':'NO FINANCIAL AUTHORITY'}</span>
    </div>
    <div className="workHead"><div><p className="eyebrow">VQ–02 / {s.current}</p><h1>{s.heading}</h1></div><p>{s.intro}</p></div>
    <section className="protectedRule" aria-label={s.rule} data-testid="protected-rule">
      <div className="ruleIdentity"><span className="privateSeal" aria-hidden="true">○</span><div><span className="eyebrow">PROTECTED MANDATE / {project.source==='LOCAL_REFERENCE'?'LOCAL MODEL':'SIMULATED'}</span><h2>{words(project.rule,language)}</h2></div><span className="privateBadge">{project.draft?'DRAFT / NO AUTHORITY':s.hidden}</span></div>
      <div className="ruleMetrics"><div><span>{s.brokers}</span><strong>{String(AGENTS.filter(agent=>agent.projectId===project.id).length).padStart(2,'0')}</strong></div><div><span>{project.id===LOCAL_PROJECT?s.records:(language==='ja'?'合成記録':'SCENARIO RECORDS')}</span><strong>{project.id===LOCAL_PROJECT?(state?String(state.disclosure.history.length).padStart(2,'0'):'—'):String(SCENARIO_EVENTS.filter(event=>event.projectId===project.id).length).padStart(2,'0')}</strong></div></div>
      <p>{language==='ja'?'ルールと資格条件の参照用要約です。開示モデルと適格性モデルは独立しており、非迂回型の金融認可は未実装です。':'A reference summary of rules and credential context. Disclosure and eligibility are independent models; non-bypassable financial authorization is not implemented.'}</p>
    </section>
    <div className="taskTabs" role="group" aria-label={s.current}>{(['impact', 'disclosure'] as const).map((value, index) => <button key={value} type="button" data-testid={`task-${value}`} aria-pressed={mode === value} onClick={() => onMode(value)}><span>0{index + 1}</span>{value === 'impact' ? s.control : s.privacy}<span aria-hidden="true">↗</span></button>)}</div>
  </div>;
}
