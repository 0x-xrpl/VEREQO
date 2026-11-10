import { useEffect, useRef, useState } from 'react';
import { experienceCopy } from '../experienceCopy';
import { Dial } from './Dial';
import { disclosureBarLevels } from '../dialMath';

type Language = 'ja' | 'en';
interface LandingProps { onFinancial?: () => void; language: Language; onStart: () => void; onGuided?: () => void; onWallet?: () => void; onProject?: () => void; active?: boolean }

const copy = {
  ja: {
    eyebrow: '機密ポリシー / 金融Intentの検査',
    headline: ['提案を検査し、', '境界を保つ。'],
    promise: '認証と取引権限を、分けて示す。',
    description: '機密ルールの開示と、Agentが提案する金融操作の影響を検査するインストゥルメントです。現在のTestnet連携は読み取り専用で、注文送信・資産保管・自律執行は行いません。',
    start: '取引デモを体験', how: '仕組みを見る',
    entryNote: 'ウォレット不要 · 合成データのローカルデモ',
    scene: '製品の動きを見る', illustration: '説明用の例 / 取引は実行しません',
    protected: '非公開の取引ルール', secret: '教育用の非公開しきい値', hidden: '値は共有しません',
    broker: '外部ブローカーからの依頼',
    keys: ['依頼を見る', '判断を見る', '理由を見る'],
    phaseNames: ['01 / 回答する前に', '02 / 知りすぎる前に', '03 / 実行を任せる前に'],
    titles: ['必要な回答だけを。', '次の回答は、渡さない。', '止まる操作を、見分ける。'],
    details: [
      'x ≤ 100、次にx ≤ 80。説明用のYES回答により、サンプル値の候補が128通りから101通り、81通りになります。',
      'x ≤ 70への回答は、候補を71通りまたは10通りに分けます。下限16を満たさない分岐があるため、答えを見る前に質問を拒否します。',
      'Aの資格を外すと、依存する操作だけが条件を満たさなくなります。独立したBの経路は、そのまま残ります。',
    ],
    rowLabels: [['提案する質問', 'YES / NOの場合の候補数'], ['サンプル値は70以下か', 'YES / NOの候補数'], ['ブローカーAの操作', '独立したBの操作']],
    rowValues: [['x ≤ 100 / 回答は未公開', '101 / 27'], ['回答を制限', '71 / 10'], ['条件を満たさない', '条件を満たす']],
    displayLabels: ['公開サンプルの全候補 / 固定ドメイン', '拒否後も保持する候補数 / 説明例', '独立した操作の比較 / 別モデル'],
    displayValues: ['128', '81', 'A / B'],
    displayFoot: ['有限モデルの例 · 金額・残高ではありません', 'どちらの答えかを見る前に判断', 'ローカル適格性の例 · 金融許可ではありません'],
    dialLabel: '説明シーンを選ぶ', play: '動きを再生', pause: '一時停止', reduced: '動きを抑える設定中 · キーで各場面を確認できます',
    problemLabel: '01 / THE PROBLEM', problemTitle: '任せたい。\nでも、全部は渡せない。',
    problemBody: '外部の自動ブローカーと働くために、社内の条件をそのまま共有する必要はありません。回答の積み重ねと、任せた操作の範囲を、それぞれ確認する必要があります。',
    problems: [
      ['一つずつは正しい質問でも', '回答を組み合わせると、非公開の上限を推測できることがあります。'],
      ['許可を外した、その後も', 'どの保留中の操作が影響を受け、何が継続できるかを見分ける必要があります。'],
    ],
    howLabel: '02 / HOW IT WORKS', howTitle: '依頼から、理由まで。\n一つの流れで。',
    steps: [
      ['依頼を選ぶ', '誰が、どの条件で何を求めているかを確認します。'],
      ['回答の範囲を確かめる', '公開済みの履歴を踏まえ、次の回答が許容範囲に収まるかを判定します。'],
      ['影響と根拠を見る', 'AとBを比較し、実際の依存関係と記録から違いを確認します。'],
    ],
    boundaryLabel: '03 / THE PROTECTION BOUNDARY', boundaryTitle: 'できることを、\n正確に示す。',
    boundaryBody: 'いま体験できるのは、既存APIで動く有限モデルの回答判定と、資格変更の影響確認です。二つは独立したローカルのデモで、金融取引への連携は未実装です。',
    available: 'ローカルで体験できること', unavailable: 'まだ実行しないこと',
    can: ['履歴を踏まえた回答の許可・拒否', '資格Aの変更を試算し、Bと比較', '理由・依存関係・公開記録の確認'],
    cannot: ['実資金の管理、注文の送信・約定', 'ウォレット認証や金融権限の付与', '実ZK証明・本番の秘密情報保護'],
    closingLabel: 'ENTER THE LIVING INSTRUMENT', closingTitle: 'どこまで任せたか。\nその理由まで、見える。',
    closingBody: 'まずは一つのProject、二つのブローカーから。回答、制限、影響の違いを、ご自身の操作で確かめてください。',
  },
  en: {
    eyebrow: 'CONFIDENTIAL POLICY / FINANCIAL INTENT REVIEW',
    headline: ['Review the proposal.', 'Keep control.'],
    promise: 'Authentication is not trading authority.',
    description: 'VEREQO inspects confidential policy disclosures and the consequences of Agent-proposed financial actions. Its current Injective Testnet integration is read-only: it does not submit orders, custody funds, or execute autonomously.',
    start: 'Explore the Demo', how: 'How It Works',
    entryNote: 'No wallet required · Synthetic local demo',
    scene: 'See the product in motion', illustration: 'Illustrative example / No trade is executed',
    protected: 'PRIVATE TRADING RULE', secret: 'Private sample threshold', hidden: 'Value stays unshared',
    broker: 'EXTERNAL BROKER REQUEST',
    keys: ['See the request', 'See the decision', 'See the reason'],
    phaseNames: ['01 / BEFORE AN ANSWER', '02 / BEFORE TOO MUCH IS KNOWN', '03 / BEFORE DELEGATING EXECUTION'],
    titles: ['Only the answers needed.', 'The next answer stays private.', 'See what would stop.'],
    details: [
      'x ≤ 100, then x ≤ 80. Illustrative YES answers reduce 128 possible sample values to 101 and then 81.',
      'x ≤ 70 splits the candidates into 71 or 10. One branch falls below the floor of 16, so the question is refused before either answer is revealed.',
      'Remove A’s credential and only its dependent operation becomes ineligible. The independent B path remains available.',
    ],
    rowLabels: [['Proposed question', 'Candidates in YES / NO branches'], ['Is the sample value at most 70?', 'YES / NO candidate counts'], ['Broker A operation', 'Independent B operation']],
    rowValues: [['x ≤ 100 / No answer released', '101 / 27'], ['Answer restricted', '71 / 10'], ['Locally ineligible', 'Locally eligible']],
    displayLabels: ['PUBLIC SAMPLE DOMAIN / FIXED SPECIFICATION', 'CANDIDATES RETAINED AFTER REFUSAL / EXAMPLE', 'INDEPENDENT OPERATIONS / SEPARATE MODEL'],
    displayValues: ['128', '81', 'A / B'],
    displayFoot: ['Finite model illustration · Not money or balance', 'Decided before inspecting either answer', 'Local eligibility illustration · Not financial authority'],
    dialLabel: 'Choose an explanation scene', play: 'Play the sequence', pause: 'Pause', reduced: 'Reduced motion is on · Use the keys to inspect each scene',
    problemLabel: '01 / THE PROBLEM', problemTitle: 'Delegate the work.\nKeep the boundary.',
    problemBody: 'Working with an automated broker should not require handing over internal trading conditions. Teams need to inspect both what repeated answers reveal and which operations they have delegated.',
    problems: [
      ['Valid questions can add up', 'Several individually acceptable answers can help infer a private limit.'],
      ['Permissions change', 'Teams need to distinguish the pending operations that would stop from those that can continue.'],
    ],
    howLabel: '02 / HOW IT WORKS', howTitle: 'From the request\nto the reason.',
    steps: [
      ['Choose a request', 'See who is asking, what they want and under which conditions.'],
      ['Inspect the next answer', 'Evaluate the proposed disclosure against the information already released.'],
      ['Compare the consequences', 'Inspect A and B through actual directed dependencies and public records.'],
    ],
    boundaryLabel: '03 / THE PROTECTION BOUNDARY', boundaryTitle: 'Know exactly\nwhat is covered.',
    boundaryBody: 'Today’s working API supports a finite-domain disclosure model and credential-change inspection. These are two independent local demonstrations. Their financial execution connection is not implemented.',
    available: 'Available in the local demo', unavailable: 'Not executed or implemented',
    can: ['History-aware answer admission and refusal', 'Preview credential A’s change and compare B', 'Inspect reasons, dependencies and public records'],
    cannot: ['Real funds, order submission or fills', 'Wallet authentication or financial grants', 'Real ZK proofs or production confidentiality'],
    closingLabel: 'ENTER THE LIVING INSTRUMENT', closingTitle: 'See what you delegated.\nUnderstand every boundary.',
    closingBody: 'Start with one Project and two brokers. Inspect answers, restrictions and consequences through your own actions.',
  },
} as const;

export function Landing({ onFinancial, language, onStart, onGuided, onWallet, onProject, active = true }: LandingProps) {
  const t = copy[language];
  const [phase, setPhase] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const index = phase - 1;
  const surface=useRef<HTMLDivElement>(null);
  const illustrativeLevels = disclosureBarLevels(Array.from({ length: phase===1?128:81 }, (_, value) => value));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { setReducedMotion(media.matches); if (media.matches) setPlaying(false); };
    update(); media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);

  useEffect(() => {
    const root = surface.current;
    const hero = root?.querySelector<HTMLElement>('[data-testid="live-hero"]');
    if (!root || !hero || !active || reducedMotion) return;
    const reset = () => {
      hero.style.setProperty('--pointer-shift-x', '0px');
      hero.style.setProperty('--pointer-shift-y', '0px');
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const rect = hero.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width / 2)));
      const y = Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / (rect.height / 2)));
      const scale = window.innerWidth <= 560 ? 3 : 7;
      hero.style.setProperty('--pointer-shift-x', `${(x * scale).toFixed(1)}px`);
      hero.style.setProperty('--pointer-shift-y', `${(y * scale * .65).toFixed(1)}px`);
    };
    root.addEventListener('pointermove', move, { passive: true });
    root.addEventListener('pointerleave', reset, { passive: true });
    return () => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', reset);
      reset();
    };
  }, [active, reducedMotion]);

  useEffect(() => {
    if (!active || !playing || reducedMotion) return;
    const timeout = window.setTimeout(() => {
      if (phase === 3) setPlaying(false);
      else setPhase(value => value + 1);
    }, 3600);
    return () => window.clearTimeout(timeout);
  }, [active, phase, playing, reducedMotion]);

  useEffect(()=>{
    if(!active)return;
    const nodes=surface.current?.querySelectorAll<HTMLElement>('.u-problem,.u-how')??[];
    if(reducedMotion||typeof IntersectionObserver==='undefined'){nodes.forEach(node=>{node.classList.add('is-revealed');node.dataset.reveal='done';});return;}
    const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const node=entry.target as HTMLElement;node.classList.add('is-revealed');node.dataset.reveal='done';observer.unobserve(node);}}, {threshold:.12,rootMargin:'0px 0px 40px 0px'});
    nodes.forEach(node=>{if(node.dataset.reveal==='done')return;node.dataset.reveal='armed';observer.observe(node);});return()=>observer.disconnect();
  },[active,reducedMotion]);

  const choosePhase = (value: number) => { setPlaying(false); setPhase(value); };
  const togglePlayback = () => {
    if (playing) setPlaying(false);
    else { if (phase === 3) setPhase(1); setPlaying(true); }
  };

  return <div ref={surface} className="productLanding" id="top" tabIndex={-1} data-testid="product-landing">
    {onFinancial&&<section className="financialEntry" aria-labelledby="financial-entry-heading"><div className="financialEntryMain"><span className="u-eyebrow">INJECTIVE / SYNTHETIC REHEARSAL · S01</span><h2 id="financial-entry-heading">{language==='ja'?'Agentの提案を、許可と混同しない。':'A proposal is not permission.'}</h2><p>{language==='ja'?'Agent Aの指値Intent、非公開条件の判定、資格失効の影響を、実行前に同じBusiness IDで確認します。':'Inspect one Agent A limit intent, its private-policy check, and revocation consequences under one Business ID before execution.'}</p><button className="u-primary" type="button" data-testid="start-financial" onClick={onFinancial}>{language==='ja'?'金融rehearsalを開く':'Open financial rehearsal'} ↗</button><p className="u-entry-note">{language==='ja'?'合成入力 · live market IDなし · wallet署名 / proof / order送信なし':'Synthetic inputs · no live market ID · no wallet signature, proof, or order submission'}</p></div><div className="financialEntryIntent" data-testid="financial-entry-intent" aria-label={language==='ja'?'S01 合成intentの要約':'S01 synthetic intent summary'}><div className="financialEntryIntentTitle"><span>S01 / SYNTHETIC_FIXTURE</span><strong>{language==='ja'?'Operator intent':'Operator intent'}</strong></div><dl><div><dt>Agent</dt><dd>agent-external-A · SYNTHETIC</dd></div><div><dt>Principal</dt><dd>principal-operator-01 · SYNTHETIC</dd></div><div><dt>Market</dt><dd>INJ/USDT Spot · no live market ID</dd></div><div><dt>Side / type</dt><dd>BUY / LIMIT</dd></div><div><dt>Quantity</dt><dd>40 INJ · fixture</dd></div><div><dt>Limit price</dt><dd>12 USDT/INJ · fixture</dd></div><div><dt>Notional</dt><dd>480 USDT · fixture arithmetic</dd></div><div><dt>Decision</dt><dd>NOT RUN · NOT AUTHORIZED</dd></div></dl></div></section>}
    <section className="u-entry" aria-labelledby="product-headline">
      <div className="u-entry-copy">
        <p className="u-eyebrow">{t.eyebrow}</p>
        <h1 id="product-headline" className={language === 'ja' ? 'u-ja' : undefined}>{t.headline[0]}<br />{t.headline[1]}</h1>
        <p className="u-promise">{t.promise}</p>
        <p className="u-description">{t.description}</p><p className="u-sample-note">{experienceCopy(language).sampleIntro}</p>
        <div className="u-actions"><button type="button" className="u-primary" data-testid="start-demo" onClick={onStart}>{t.start}<span aria-hidden="true">↗</span></button><a className="u-text-link" href="#how-it-works">{t.how}</a></div>
        <p className="u-entry-note">{t.entryNote}</p><div className="u-entry-choices"><button type="button" data-testid="start-guided" onClick={onGuided??onStart}>{language==='ja'?'ガイド付きデモ':'Guided demo'} ↗</button><button type="button" data-testid="landing-wallet" onClick={onWallet}>{language==='ja'?'ウォレット接続':'Connect wallet'}</button><button type="button" data-testid="landing-project" onClick={onProject}>{language==='ja'?'Projectを作成':'Create project'}</button></div>
      </div>
      <div className="heroDevice liveHero" data-testid="live-hero" aria-label={language==='ja'?'CONTROL DECKの説明用操作':'CONTROL DECK explanation controls'}>
        <div className="heroDeviceTop"><span>WHITE INSTRUMENT<br/><small>VQ–01 / Prove what matters. Control what follows.</small></span><span className="heroSource">{language==='ja'?'説明用 / 合成データ':'ILLUSTRATIVE / SYNTHETIC'}<small>{language==='ja'?'APIへの送信なし':'NO API MUTATIONS'}</small><small>NOT EXECUTED</small></span></div>
        <div className="heroDevices"><div className="liveHeroDial"><Dial hero value={phase} min={1} max={3} label={t.dialLabel} valueText={t.phaseNames[index]??''} onChange={choosePhase}/><span>{t.dialLabel} / 1–3</span></div><div className="heroScreen"><span className="label">{t.displayLabels[index]}</span><strong data-testid="hero-lcd">{t.displayValues[index]}</strong><div className="heroMeter" aria-hidden="true" style={{visibility:phase===3?'hidden':'visible'}}>{illustrativeLevels.map((level,bar)=><i key={bar} style={{opacity:level>0?.34+.66*level:.12}}/>)}</div><p>{t.displayFoot[index]}</p></div></div>
        <div className="heroKeys" role="group" aria-label={t.scene}>{t.keys.map((label,key)=><button type="button" key={key} data-testid={`landing-scene-${key+1}`} aria-pressed={phase===key+1} onClick={()=>choosePhase(key+1)}><span>0{key+1}</span>{label}</button>)}</div>
        <div className="liveHeroStory" data-scene={phase} aria-live="polite"><span className="u-kicker">{t.phaseNames[index]}</span><h2>{t.titles[index]}</h2><p>{t.details[index]}</p><div className="liveHeroFacts">{t.rowLabels[index]?.map((label,row)=><div key={row}><span>{label}</span><strong>{t.rowValues[index]?.[row]}</strong></div>)}</div></div>
        <div className="u-playback"><span>{t.illustration}</span>{reducedMotion?<small>{t.reduced}</small>:<button type="button" data-testid="landing-play" aria-pressed={playing} onClick={togglePlayback}>{playing?t.pause:t.play}<span aria-hidden="true">{playing?'Ⅱ':'→'}</span></button>}</div>
      </div>
    </section><section className="u-live-details"><div className="u-detail-copy"><span className="u-eyebrow">ONE RULE. EVERY CONSEQUENCE.</span><h2>{language==='ja'?'答える前に、\n何が伝わるか。':'Before the answer,\nsee what it reveals.'}</h2><p>{language==='ja'?'社内の取引条件を丸ごと渡さず、必要な回答だけを。公開した情報の積み重ねと、資格に依存する操作の変化を、それぞれの根拠で確かめます。':'Release the needed answer without handing over the whole trading rule. Inspect cumulative disclosure and credential-dependent operations through their separate evidence.'}</p><button type="button" className="u-primary" onClick={onGuided??onStart}>{language==='ja'?'実際のAPIで確かめる':'Try the working API'} ↗</button></div><div className="u-mechanical-details"><span className="u-eyebrow">WHITE INSTRUMENT / INSPECTION, NOT EXECUTION</span><h3>{language==='ja'?'回す。選ぶ。理由へ入る。':'Turn. Select. Trace the reason.'}</h3><p>{language==='ja'?'Heroのダイヤルは説明の3場面を選びます。実アプリではIMPACTが検査の深さ、DISCLOSUREが質問のしきい値を調整します。':'The hero dial selects three explanation scenes. In the app, IMPACT adjusts inspection depth; DISCLOSURE adjusts the proposed threshold.'}</p><dl><div><dt>01 / RESULT</dt><dd>{language==='ja'?'質問・判定・候補数を同じ記録から。':'Question, decision and candidate count from one record.'}</dd></div><div><dt>02 / CAUSE</dt><dd>{language==='ja'?'選んだ操作を、その場で掘り下げる。':'Open the selected operation’s dependencies in place.'}</dd></div><div><dt>03 / EVIDENCE</dt><dd>{language==='ja'?'公開記録を確認。金融執行は未実装。':'Inspect public records. Financial execution is not implemented.'}</dd></div></dl></div>
    </section>
    <section className="u-problem u-section" aria-labelledby="u-problem-title"><div><p className="u-eyebrow">{t.problemLabel}</p><h2 id="u-problem-title">{t.problemTitle.split('\n').map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</h2><p className="u-section-lead">{t.problemBody}</p></div><div className="u-problem-list">{t.problems.map(([title, body], problemIndex) => <article key={title}><span className="u-number">0{problemIndex + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
    <section className="u-how u-section" id="how-it-works" aria-labelledby="u-how-title"><div className="u-section-heading"><p className="u-eyebrow">{t.howLabel}</p><h2 id="u-how-title">{t.howTitle.split('\n').map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</h2></div><div className="u-step-grid">{t.steps.map(([title, body], stepIndex) => <article key={title}><span className="u-number">0{stepIndex + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
    <section className="u-boundary u-section" aria-labelledby="u-boundary-title"><div><p className="u-eyebrow">{t.boundaryLabel}</p><h2 id="u-boundary-title">{t.boundaryTitle.split('\n').map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</h2><p className="u-section-lead">{t.boundaryBody}</p></div><div className="u-boundary-lists"><div><h3>{t.available}</h3><ul>{t.can.map(value => <li key={value}>{value}</li>)}</ul></div><div><h3>{t.unavailable}</h3><ul>{t.cannot.map(value => <li key={value}>{value}</li>)}</ul></div></div></section>
    <section className="u-closing u-section" aria-labelledby="u-closing-title"><p className="u-eyebrow">{t.closingLabel}</p><h2 id="u-closing-title">{t.closingTitle.split('\n').map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</h2><p>{t.closingBody}</p><button type="button" className="u-primary" data-testid="start-demo-bottom" onClick={onStart}>{t.start}<span aria-hidden="true">↗</span></button></section>
  </div>;
}
