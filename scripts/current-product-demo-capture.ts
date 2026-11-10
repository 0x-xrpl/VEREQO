import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from 'playwright';
import { createLocalApp } from '../services/issuer/src/http';
import { InjectiveReadAdapter } from '../packages/domain/src/live-injective';

type Cue = { start: number; end: number; text: string };
const repoRoot = process.cwd();
const finalFilmMode = process.env.VEREQO_CAPTURE_PROFILE === 'final-film';
const buildRoot = resolve(process.env.VEREQO_CAPTURE_BUILD_ROOT ?? resolve(tmpdir(), 'verequo-build-final'));
const output = resolve(finalFilmMode
  ? 'submission/hacker-house-2026/media/final-product-film-2026-11-10-v2'
  : 'submission/hacker-house-2026/media/current-product-demo-2026-11-09');
const evidence = resolve(finalFilmMode
  ? 'docs/evidence/final-product-film-2026-11-10-v2'
  : 'docs/evidence/current-product-demo-2026-11-09');
const captureWidth = finalFilmMode ? 1920 : 1440;
const captureHeight = finalFilmMode ? 1080 : 900;
const playbackScale = finalFilmMode ? 2 : 1;
const filmDurationSeconds = finalFilmMode ? 210 : 90;
const videoFileName = finalFilmMode ? 'VEREQO_FINAL_PRODUCT_FILM_2026-11-10-v2.mp4' : 'VEREQO_CURRENT_PRODUCT_DEMO_90S.mp4';
const captionFileName = finalFilmMode ? 'VEREQO_FINAL_PRODUCT_FILM_EN.vtt' : 'VEREQO_CURRENT_BUILD_EN.vtt';
const narrationFileName = finalFilmMode ? 'VEREQO_FINAL_PRODUCT_FILM_EN_NARRATION.md' : 'VEREQO_CURRENT_BUILD_EN_NARRATION.md';
let timelineShiftSeconds = 0;
const chrome = process.env.VEREQO_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ffmpeg = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
const recorderCache = resolve(tmpdir(), 'vereqo-current-product-demo-' + process.pid);
process.env.PLAYWRIGHT_BROWSERS_PATH = recorderCache;
const browserManifest = JSON.parse(readFileSync(resolve('node_modules/playwright-core/browsers.json'), 'utf8')) as { browsers: { name: string; revision: string }[] };
const ffmpegRevision = browserManifest.browsers.find(browser => browser.name === 'ffmpeg')?.revision;
if (!ffmpegRevision) throw new Error('CAPTURE_TOOLCHAIN_UNAVAILABLE');
const recorderName = process.platform === 'darwin' ? 'ffmpeg-mac' : process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux';
const recorderTarget = resolve(recorderCache, 'ffmpeg-' + ffmpegRevision, recorderName);
mkdirSync(dirname(recorderTarget), { recursive: true, mode: 0o700 });
if (!existsSync(recorderTarget)) symlinkSync(ffmpeg, recorderTarget);
const { chromium } = await import('playwright');

const cues: Cue[] = [
  { start: 0, end: 11, text: 'A proposal is not permission. This local build keeps the boundary visible before any financial action.' },
  { start: 11, end: 24, text: 'The CONTROL DECK starts with an illustrative scenario. Its dial selects inspection depth; its keys open a local what-if, not an execution path.' },
  { start: 24, end: 36, text: 'In this synthetic preview, a revoked credential blocks the dependent branch while the independent branch remains eligible.' },
  { start: 36, end: 47, text: 'The financial surface keeps Wallet connection, ownership authentication, and execution approval as separate states.' },
  { start: 47, end: 56, text: 'No Mandate or delegated Agent is configured. This view describes the required dependency boundary.' },
  { start: 56, end: 65, text: 'No issuer-authenticated proof is attached. The local Groth16 fixture uses an untrusted setup and cannot authorize an exchange action.' },
  { start: 65, end: 74, text: 'WHAT-IF changes display state only. It does not change a credential, policy, or committed graph.' },
  { start: 74, end: 82, text: 'This evidence panel requires a verified Wallet session before reading owner-scoped records. Without authenticated ownership, it does not claim that no record exists.' },
  { start: 82, end: 90, text: 'Market data is unknown in this capture. T5 market risk is blocked, T6 funding and recovery are missing, and execution is not implemented.' },
];

const openingCue: Cue = { start: 0, end: 6, text: 'VEREQO makes the reason behind an automated financial proposal visible before any execution.' };
const modelCardCue: Cue = { start: 78, end: 96, text: 'A real local Phi inference produced this unsigned proposal from synthetic inputs. Saving and retrieving it used synthetic downstream adapters, not operational credentials.' };
const closingCue: Cue = { start: 204, end: 210, text: 'VEREQO. One request, one trace, one truth. Execution remains not approved.' };
const finalSceneCues: Cue[] = [
  { start: 6, end: 28, text: 'A proposal is not permission. This local product build shows how a financial request can be inspected before authority is granted. The opening scenario is explicitly synthetic: it carries no live market identifier, owner signature, proof, or order. Its purpose is to make the review boundary visible.' },
  { start: 28, end: 54, text: 'The CONTROL DECK starts from an illustrative request. Its dial selects inspection depth, and its physical keys open a local what-if view. These controls guide review; they do not authorize a transaction. Each action changes only the local inspection state shown on screen.' },
  { start: 54, end: 78, text: 'The consequence view separates dependency from authority. In this synthetic rehearsal, a revoked credential blocks the dependent branch while an independent branch remains visible. This is a displayed consequence, not a committed revocation, a wallet action, or evidence of a live financial outcome.' },
  { start: 96, end: 118, text: 'Wallet connection, ownership authentication, and execution approval are distinct states. This isolated capture has no authenticated owner session. It makes no request to connect a wallet and sends no signature, approval, grant, or financial transaction.' },
  { start: 118, end: 136, text: 'No operational issuer, delegated agent, or active mandate is configured for this capture. The dependency view therefore describes the required authority chain without implying that a credential or mandate has been issued or verified by an independent operator.' },
  { start: 136, end: 154, text: 'The local Groth16 fixture is not a production proof. Its setup was created on one machine and is untrusted for deployment. A proof from that setup cannot authorize an exchange action, and no issuer-backed production credential is attached here.' },
  { start: 154, end: 172, text: 'The financial what-if changes only the local display. It does not revoke a credential, change a policy, write an evidence record, or commit a new dependency graph. A hypothetical state stays clearly separate from an executed state.' },
  { start: 172, end: 188, text: 'Owner-scoped evidence requires a verified wallet session. The isolated screen stops before that read, so it does not claim that no evidence record exists. It shows the authentication boundary rather than exposing or inventing owner data.' },
  { start: 188, end: 204, text: 'This capture makes no live market read. T5 remains blocked, T6 funding and recovery remain unverified, and execution is not implemented or approved. The demonstrated path ends at review and evidence inspection, before any financial action.' },
];
const finalFilmCues: Cue[] = [openingCue, ...finalSceneCues.slice(0, 3), modelCardCue, ...finalSceneCues.slice(3), closingCue];
const captionCues = finalFilmMode ? finalFilmCues : cues;
const displayCueText = (index: number): string => finalFilmMode ? finalSceneCues[index]!.text : cues[index]!.text;

const checks: string[] = [];
const screenshots: string[] = [];
const browserRequests: { method: string; path: string }[] = [];
const blockedExternalRequests: { method: string; origin: string; path: string }[] = [];
const browserErrors: string[] = [];
let upstreamRequests = 0;
let recorderPath = '';
let context: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newContext']>> | null = null;
let finalCaption = '';

function ensure(id: string, condition: boolean): void {
  if (!condition) throw new Error('CAPTURE_CHECK_FAILED:' + id);
  checks.push(id);
}
function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function holdUntil(page: Page, startedAt: number, seconds: number): Promise<void> {
  const remaining = startedAt + seconds * 1000 - Date.now();
  return remaining > 0 ? page.waitForTimeout(remaining) : Promise.resolve();
}
async function setCaption(page: Page, text: string): Promise<void> {
  await page.locator('#current-demo-caption-text').evaluate((element, value) => { element.textContent = value; }, text);
}
async function installCaptions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '#current-demo-caption{position:fixed;z-index:2147483647;left:50%;bottom:16px;transform:translateX(-50%);width:calc(100% - 120px);max-width:1110px;box-sizing:border-box;padding:12px 20px 14px;border-left:4px solid #a8c7b3;border-radius:6px;background:rgba(18,24,21,.94);color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25);pointer-events:none;font-family:Arial,sans-serif}#current-demo-caption-label{font-size:10px;line-height:1.25;letter-spacing:.15em;text-transform:uppercase;color:#c0d8c8}#current-demo-caption-text{margin:4px 0 0;font-size:20px;line-height:1.3;font-weight:500}';
    document.head.append(style);
    const panel = document.createElement('aside');
    panel.id = 'current-demo-caption';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-label', 'English narration caption');
    const label = document.createElement('div');
    label.id = 'current-demo-caption-label';
    label.textContent = 'CURRENT BUILD · ENGLISH NARRATION';
    const text = document.createElement('p');
    text.id = 'current-demo-caption-text';
    panel.append(label, text);
    document.body.append(panel);
  });
}
async function scrollIntoFrame(page: Page, selector: string): Promise<void> {
  await page.evaluate(value => {
    const target = document.querySelector<HTMLElement>(value);
    if (!target) throw new Error('CAPTURE_TARGET_MISSING');
    const headerHeight = document.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect().height ?? 0;
    const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 12;
    window.scrollTo(0, Math.max(0, top));
  }, selector);
}
async function screenshot(page: Page, name: string): Promise<void> {
  const path = join(evidence, name + '.png');
  await page.screenshot({ path, type: 'png', fullPage: false });
  screenshots.push(name + '.png');
}
async function showFilmCard(page: Page, title: string, subtitle: string, logoPath: string): Promise<void> {
  await page.evaluate(({ title, subtitle, logoPath }) => {
    document.getElementById('vereqo-film-card')?.remove();
    const card = document.createElement('section'); card.id = 'vereqo-film-card';
    card.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#f5f5f0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#1f2521;font-family:Instrument Sans,Arial,sans-serif';
    const logo = document.createElement('img'); logo.src = logoPath; logo.alt = 'VEREQO solid lockup';
    logo.style.cssText = 'width:min(48vw,560px);height:auto;object-fit:contain;margin-bottom:58px';
    const heading = document.createElement('div'); heading.textContent = title;
    heading.style.cssText = 'font-size:22px;letter-spacing:.16em;font-weight:600;text-transform:uppercase';
    const detail = document.createElement('div'); detail.textContent = subtitle;
    detail.style.cssText = 'margin-top:18px;font:12px/1.5 "IBM Plex Mono",monospace;letter-spacing:.12em;color:#57625b;text-transform:uppercase';
    card.append(logo, heading, detail); document.body.append(card);
  }, { title, subtitle, logoPath });
}
async function hideFilmCard(page: Page): Promise<void> { await page.evaluate(() => document.getElementById('vereqo-film-card')?.remove()); }
async function showModelEvidenceCard(page: Page): Promise<void> {
  const modelPath = resolve('docs/evidence/critical-engineering-2026-11-10/agent-model-output.json');
  const tracePath = resolve('docs/evidence/critical-engineering-2026-11-10/agent-request-trace.json');
  const model = JSON.parse(readFileSync(modelPath, 'utf8')) as { evidenceClass: string; model: string; runtime: string; proposal: { requestId: string; dataClass: string; decision: string; order: { side: string; orderType: string; price: string; quantity: string }; estimatedNotional: string; authorized: boolean; execution: string } };
  const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as { requestId: string; syntheticAdapters: string[]; realIssuerClaimed: boolean; realGroth16Claimed: boolean; realAnchorClaimed: boolean; ownerSignatureStatus: string; authorized: boolean; execution: string; retrievalMatchedSavedRecord: boolean; controlDeckVerification: string };
  const proposal = model.proposal;
  if (model.evidenceClass !== 'REAL_MODEL_ON_SYNTHETIC_INPUT' || model.model !== 'phi:latest' || proposal.requestId !== trace.requestId ||
      proposal.dataClass !== 'SYNTHETIC_REHEARSAL' || proposal.decision !== 'PROPOSE' || proposal.authorized !== false || proposal.execution !== 'NOT_IMPLEMENTED' ||
      trace.authorized !== false || trace.execution !== 'NOT_IMPLEMENTED' || trace.ownerSignatureStatus !== 'REQUIRED' || trace.realIssuerClaimed ||
      trace.realGroth16Claimed || trace.realAnchorClaimed || !trace.retrievalMatchedSavedRecord) throw new Error('SAVED_MODEL_EVIDENCE_SCOPE_VALIDATION_FAILED');
  const view = { model: model.model, runtime: model.runtime, requestId: proposal.requestId, input: proposal.dataClass,
    order: `${proposal.order.side} ${proposal.order.orderType} · ${proposal.order.quantity} @ ${proposal.order.price}`,
    notional: proposal.estimatedNotional, syntheticAdapters: trace.syntheticAdapters, controlDeckVerification: trace.controlDeckVerification };
  await page.evaluate(value => {
    document.getElementById('verequo-film-card')?.remove();
    const card = document.createElement('section'); card.id = 'vereqo-film-card';
    card.style.cssText = 'position:fixed;inset:0;z-index:2147483646;box-sizing:border-box;background:#f5f5f0;padding:80px 11vw;color:#1f2521;font-family:Instrument Sans,Arial,sans-serif;display:flex;flex-direction:column;justify-content:center';
    const eyebrow = document.createElement('div'); eyebrow.textContent = 'REAL LOCAL MODEL OUTPUT · SAVED TEST';
    eyebrow.style.cssText = 'font:12px/1.4 "IBM Plex Mono",monospace;letter-spacing:.14em;color:#506e5a;text-transform:uppercase';
    const heading = document.createElement('h1'); heading.textContent = 'One proposal. Same request ID.';
    heading.style.cssText = 'margin:22px 0 36px;font-size:56px;line-height:1.05;font-weight:500;letter-spacing:-.04em';
    const rows: [string, string][] = [['MODEL', `${value.model} · ${value.runtime}`], ['INPUT', `${value.input} · no real market`], ['REQUEST', value.requestId],
      ['PROPOSAL', `${value.order} · notional ${value.notional}`], ['AUTHORITY', 'unsigned · owner signature required · execution NOT_IMPLEMENTED']];
    const list = document.createElement('div'); list.style.cssText = 'border-top:1px solid #c8ccc5';
    for (const [label, text] of rows) { const row = document.createElement('div'); row.style.cssText = 'display:grid;grid-template-columns:190px 1fr;gap:20px;padding:16px 0;border-bottom:1px solid #c8ccc5';
      const left = document.createElement('span'); left.textContent = label; left.style.cssText = 'font:11px/1.5 "IBM Plex Mono",monospace;letter-spacing:.12em;color:#68716b';
      const right = document.createElement('span'); right.textContent = text; right.style.cssText = 'font-size:19px;line-height:1.45'; row.append(left, right); list.append(row); }
    const caveat = document.createElement('p'); caveat.textContent = `Saved-record match verified. Downstream adapters are synthetic: ${value.syntheticAdapters.join(' · ')}. CONTROL DECK check was SSR-only, not browser QA.`;
    caveat.style.cssText = 'max-width:1140px;margin:24px 0 0;font-size:15px;line-height:1.6;color:#57625b'; card.append(eyebrow, heading, list, caveat); document.body.append(card);
  }, view);
}
async function holdDemoUntil(page: Page, startedAt: number, seconds: number): Promise<void> { await holdUntil(page, startedAt, seconds * playbackScale + timelineShiftSeconds); }

async function checkControlDeck(page: Page): Promise<void> {
  await page.getByTestId('journey-free').click();
  await page.getByTestId('mode-impact').click();
  await page.getByTestId('dial-depth').click();
  const dial = page.getByTestId('work-dial');
  await dial.evaluate(element => (element as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-testid="work-dial"]')?.getAttribute('aria-valuenow') === '2');
  ensure('control-deck depth dial changed by keyboard', Number(await dial.getAttribute('aria-valuenow')) === 2);
  await page.getByTestId('work-confirm').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="inspection-confirmation"]')?.getAttribute('data-confirmed') === 'true');
  const confirmation = await page.getByTestId('inspection-confirmation').innerText();
  ensure('dial confirms inspection selection without approval', confirmation.includes('No disclosure or execution approval'));
  await scrollIntoFrame(page, '[data-testid="work-dial"]');
  const captionTop = await page.locator('#current-demo-caption').evaluate(element => element.getBoundingClientRect().top);
  const keyVisible = await page.getByTestId('key-primary').evaluate((element, top) => {
    const box = element.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect().bottom ?? 0;
    return box.top >= header && box.bottom < Number(top) && box.left >= 0 && box.right <= window.innerWidth;
  }, captionTop);
  ensure('Control Deck primary key is visible above captions', keyVisible);
  await page.getByTestId('key-secondary').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="work-dial"]')?.getAttribute('aria-valuenow') === '3');
  await page.getByTestId('key-primary').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="living-board"]')?.getAttribute('data-phase') === 'what-if');
  const board = page.getByTestId('living-board');
  const a = await page.locator('[data-testid="broker-A"] [data-node-id="action_A"]').getAttribute('data-node-state');
  const b = await page.locator('[data-testid="broker-B"] [data-node-id="action_B"]').getAttribute('data-node-state');
  ensure('Control Deck preview is explicitly what-if', await board.getAttribute('data-phase') === 'what-if');
  ensure('synthetic consequence preview separates dependent A and independent B', a === 'BLOCKED' && b === 'VALID');
}
function inspectVideo(path: string): { durationSeconds: number; width: number; height: number; hasAudio: boolean } {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-i', path], { encoding: 'utf8' });
  const diagnostic = (result.stderr ?? '') + (result.stdout ?? '');
  const durationMatch = /Duration: (\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(diagnostic);
  const videoMatch = /Video: h264[^\n]*?(\d{3,4})x(\d{3,4})/.exec(diagnostic);
  if (!durationMatch || !videoMatch) throw new Error('CAPTURE_VIDEO_METADATA_UNAVAILABLE');
  const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  const hasAudio = /Audio:/.test(diagnostic);
  ensure(`H.264 output is ${captureWidth}x${captureHeight}`, Number(videoMatch[1]) === captureWidth && Number(videoMatch[2]) === captureHeight);
  ensure(`video duration is ${filmDurationSeconds} seconds`, Math.abs(duration - filmDurationSeconds) <= 0.15);
  ensure('video is captioned and silent', !hasAudio);
  return { durationSeconds: duration, width: Number(videoMatch[1]), height: Number(videoMatch[2]), hasAudio };
}

if (!existsSync(join(buildRoot, 'index.html'))) throw new Error('CURRENT_BUILD_NOT_FOUND');
if (!existsSync(chrome)) throw new Error('ISOLATED_SYSTEM_CHROME_NOT_FOUND');
mkdirSync(output, { recursive: true, mode: 0o755 });
mkdirSync(evidence, { recursive: true, mode: 0o755 });
const indexHtml = readFileSync(join(buildRoot, 'index.html'), 'utf8');
const jsAsset = indexHtml.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
const cssAsset = indexHtml.match(/href="(\/assets\/[^\"]+\.css)"/)?.[1];
if (!jsAsset || !cssAsset) throw new Error('CURRENT_BUILD_ASSETS_UNAVAILABLE');
const bundle = readFileSync(join(buildRoot, jsAsset.slice(1)));
const style = readFileSync(join(buildRoot, cssAsset.slice(1)));
const buildSha256 = createHash('sha256').update(bundle).update(style).update(readFileSync(join(buildRoot, 'index.html'))).digest('hex');
const vttTimestamp = (seconds: number) => {
  const whole = Math.floor(seconds);
  const millis = Math.round((seconds - whole) * 1000);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0') + '.' + String(millis).padStart(3, '0');
};
const vtt = 'WEBVTT\n\n' + captionCues.map((cue, index) =>
  (index + 1) + '\n' + vttTimestamp(cue.start) + ' --> ' + vttTimestamp(cue.end) + '\n' + cue.text).join('\n\n') + '\n';
writeFileSync(join(output, captionFileName), vtt, { mode: 0o644 });
const narration = [
  finalFilmMode ? '# VEREQO Final Product Film — English Narration' : '# VEREQO Current Build — English Narration',
  '',
  finalFilmMode ? '210-second narration and caption script for the newly captured current production build.' : '90-second narration and caption script for the locally captured current production build.',
  'The MP4 is silent; this script is supplied for a later licensed voice recording.',
  'Every claim below is limited to the state shown in the current build.',
  '',
  ...captionCues.flatMap((cue, index) => [
    '## ' + String(index + 1).padStart(2, '0') + ' · ' + vttTimestamp(cue.start) + '–' + vttTimestamp(cue.end),
    '',
    cue.text,
    '',
  ]),
  '## Recording boundary',
  '',
  '- Source: local production build from the committed application source; build digest is in the capture report.',
  '- The capture uses an in-memory local issuer and an isolated temporary system-Chrome context.',
  '- Browser requests are restricted to the local origin. Injective reads, Wallet providers, signatures, Agent proposals, financial writes, and transactions are disabled or unused.',
  '- S01 and the Control Deck consequence preview are labelled synthetic/local. Market data remains UNKNOWN in this capture.',
  '- Owner Wallet authentication remains unverified; T5 is blocked, T6 is missing, and execution is not implemented.',
  '- No Operation 60 or Operation 62 footage, stills, or audio is reused.',
].join('\n');
writeFileSync(join(output, narrationFileName), narration, { mode: 0o644 });
writeFileSync(join(output, 'STORYBOARD.md'), [
  '# Current-build product demo storyboard',
  '',
  '| Time | Current screen / action | Proof shown |',
  '| --- | --- | --- |',
  finalFilmMode ? '| 00–06 | Solid VEREQO lockup opening card | Current product capture; no execution claim |' : '| 00–11 | Landing page and synthetic S01 | NOT AUTHORIZED; no live market ID, signature, proof, or order |',
  finalFilmMode ? '| 06–28 | Landing page and synthetic S01 | NOT AUTHORIZED; no live market ID, signature, proof, or order |' : '',
  finalFilmMode ? '| 28–54 | Existing CONTROL DECK physical dial and keys | Inspection selection is not approval; local WHAT-IF |' : '| 11–24 | Existing CONTROL DECK physical dial and keys | Inspection selection is not approval; local WHAT-IF |',
  finalFilmMode ? '| 54–78 | Living Board and Consequence Space | Synthetic dependent A becomes BLOCKED; independent B remains VALID |' : '| 24–36 | Living Board and Consequence Space | Synthetic dependent A becomes BLOCKED; independent B remains VALID |',
  finalFilmMode ? '| 78–96 | Saved local model evidence card | Real local Phi inference from synthetic input; all downstream adapters synthetic |' : '',
  finalFilmMode ? '| 96–118 | Financial overview and Wallet state | Disconnected, ownership unauthenticated, execution not approved |' : '| 36–47 | Financial overview and Wallet state | Disconnected, ownership unauthenticated, execution not approved |',
  finalFilmMode ? '| 118–136 | Mandate dependency view | No active Mandate or delegated Agent configured |' : '| 47–56 | Mandate dependency view | No active Mandate or delegated Agent configured |',
  finalFilmMode ? '| 136–154 | Proof view | NOT VERIFIED; local untrusted setup cannot authorize exchange action |' : '| 56–65 | Proof view | NOT VERIFIED; local untrusted setup cannot authorize exchange action |',
  finalFilmMode ? '| 154–172 | Financial WHAT-IF | Hypothetical revocation only; no credential or policy mutation |' : '| 65–74 | Financial WHAT-IF | Hypothetical revocation only; no credential or policy mutation |',
  finalFilmMode ? '| 172–188 | Evidence view | Owner-scoped evidence requires verified ownership; no no-record claim is made |' : '| 74–82 | Evidence view | Owner-scoped evidence requires verified ownership; no no-record claim is made |',
  finalFilmMode ? '| 188–204 | Execution view | NO EXECUTION; T5 BLOCKED, T6 MISSING, execution NOT_IMPLEMENTED |' : '| 82–90 | Execution view and closing caption | NO EXECUTION; T5 BLOCKED, T6 MISSING, execution NOT_IMPLEMENTED |',
  finalFilmMode ? '| 204–210 | Solid VEREQO lockup closing card | Execution remains not approved |' : '',
  '',
  finalFilmMode ? 'The video is captured from the latest local production build and the saved local model result. No Testnet data or historical footage is used.' : 'The video is captured from the latest local production build. It does not use Testnet data or historical footage.',
].join('\n') + '\n', { mode: 0o644 });

const upstreamAdapter = new InjectiveReadAdapter(async () => {
  upstreamRequests++;
  throw new Error('UPSTREAM_DISABLED_FOR_CAPTURE');
});
const app = createLocalApp({ databasePath: ':memory:', staticRoot: buildRoot, injective: upstreamAdapter });
await new Promise<void>(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen));
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('LOCAL_CAPTURE_SERVER_NOT_STARTED');
const base = 'http://127.0.0.1:' + address.port;
const tempVideoDir = resolve(tmpdir(), 'vereqo-current-demo-video-' + process.pid);
mkdirSync(tempVideoDir, { recursive: true, mode: 0o700 });
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-component-update'],
  });
  context = await browser.newContext({
    viewport: { width: captureWidth, height: captureHeight },
    reducedMotion: 'reduce',
    recordVideo: { dir: tempVideoDir, size: { width: captureWidth, height: captureHeight } },
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    blockedExternalRequests.push({ method: route.request().method(), origin: url.origin, path: url.pathname });
    return route.abort();
  });
  const page = await context.newPage();
  let recordingStartedAt = Date.now();
  page.on('pageerror', () => browserErrors.push('PAGE_ERROR'));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push('CONSOLE_ERROR');
  });
  page.on('request', request => {
    const url = new URL(request.url());
    browserRequests.push({ method: request.method(), path: url.pathname });
  });

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId('language-en').click();
  await installCaptions(page);
  if (finalFilmMode) {
    await setCaption(page, openingCue.text);
    await showFilmCard(page, 'A PROPOSAL IS NOT PERMISSION', 'ONE PRODUCT · ONE TRACE · ONE TRUTH', '/brand/VEREQO_LOCKUP_SOLID.svg');
    await page.waitForTimeout(6000);
    await hideFilmCard(page);
    ensure('brand opening uses supplied solid SVG lockup', await page.locator('.topbar img[src="/brand/VEREQO_LOCKUP_SOLID.svg"]').count() === 1);
    recordingStartedAt = Date.now();
  }
  await setCaption(page, displayCueText(0));
  await screenshot(page, '01-landing-top');
  ensure('landing screen identifies current synthetic-safe product', (await page.locator('main').innerText()).includes('A proposal is not permission.'));
  await holdDemoUntil(page, recordingStartedAt, 7);
  await page.getByTestId('financial-entry-intent').scrollIntoViewIfNeeded();
  const s01 = await page.getByTestId('financial-entry-intent').innerText();
  ensure('S01 landing fixture is labelled synthetic and not authorized', s01.includes('S01 / SYNTHETIC_FIXTURE') && s01.includes('NOT AUTHORIZED'));
  await screenshot(page, '02-s01-synthetic');
  await holdDemoUntil(page, recordingStartedAt, 11);
  await setCaption(page, displayCueText(1));
  await page.getByTestId('nav-demo').click();
  await page.getByTestId('workspace').waitFor({ state: 'visible' });
  await checkControlDeck(page);
  await holdDemoUntil(page, recordingStartedAt, 24);
  await setCaption(page, displayCueText(2));
  await scrollIntoFrame(page, '[data-testid="living-board"]');
  await screenshot(page, '03-control-deck-what-if');
  const consequence = page.getByTestId('consequence-space');
  await scrollIntoFrame(page, '[data-testid="consequence-space"]');
  ensure('Consequence Space clearly labels local eligibility as not financial authority',
    (await consequence.innerText()).includes('not a financial grant'));
  await screenshot(page, '04-consequence-space');
  await holdDemoUntil(page, recordingStartedAt, 36);
  if (finalFilmMode) {
    await setCaption(page, modelCardCue.text);
    await showModelEvidenceCard(page);
    const modelCardText = await page.locator('#vereqo-film-card').innerText();
    ensure('saved model card labels synthetic input and unauthorized execution', modelCardText.includes('SYNTHETIC_REHEARSAL') && modelCardText.includes('NOT_IMPLEMENTED'));
    await screenshot(page, '05-saved-real-model-result');
    await page.waitForTimeout(18000);
    await hideFilmCard(page);
    timelineShiftSeconds = 18;
  }
  await setCaption(page, displayCueText(3));
  await page.getByTestId('nav-financial').click();
  const walletState = page.getByTestId('financial-wallet-state');
  await walletState.waitFor({ state: 'visible' });
  ensure('financial overview separates Wallet, ownership and execution states',
    (await walletState.innerText()).includes('WALLET NOT CONNECTED') &&
    (await walletState.innerText()).includes('OWNERSHIP NOT AUTHENTICATED') &&
    (await walletState.innerText()).includes('EXECUTION NOT APPROVED'));
  await screenshot(page, '05-wallet-boundary');

  await holdDemoUntil(page, recordingStartedAt, 47);
  await setCaption(page, displayCueText(4));
  await page.getByRole('tab', { name: 'CAUSE' }).click();
  const financialPanel = page.getByTestId('financial-panel');
  await financialPanel.waitFor({ state: 'visible' });
  ensure('Mandate dependency view states no active Mandate or delegated Agent',
    (await financialPanel.innerText()).includes('No active mandate or delegated Agent authority is configured.'));
  await scrollIntoFrame(page, '[role=tablist]');
  await screenshot(page, '06-mandate-boundary');

  await holdDemoUntil(page, recordingStartedAt, 56);
  await setCaption(page, displayCueText(5));
  await page.getByRole('tab', { name: 'PROOF' }).click();
  ensure('Proof view remains NOT VERIFIED with untrusted local setup stated',
    (await financialPanel.innerText()).includes('NOT VERIFIED') &&
    (await financialPanel.innerText()).includes('untrusted single-machine setup'));
  await scrollIntoFrame(page, '[role=tablist]');
  await screenshot(page, '07-proof-not-verified');

  await holdDemoUntil(page, recordingStartedAt, 65);
  await setCaption(page, displayCueText(6));
  await page.getByRole('tab', { name: 'WHAT-IF' }).click();
  const hypothetical = financialPanel.locator('input[type="checkbox"]');
  ensure('WHAT-IF begins with no assumed revocation', (await financialPanel.innerText()).includes('No revocation assumed'));
  await hypothetical.check();
  ensure('revocation what-if is explicitly hypothetical and local',
    (await financialPanel.innerText()).includes('REVOKED (hypothetical)') &&
    (await financialPanel.innerText()).includes('no configured credential, mandate or committed graph is changed.'));
  await scrollIntoFrame(page, '[role=tablist]');
  await screenshot(page, '08-financial-what-if');

  await holdDemoUntil(page, recordingStartedAt, 74);
  await setCaption(page, displayCueText(7));
  await page.getByRole('tab', { name: 'EVIDENCE' }).click();
  const evidenceStatus = await page.getByTestId('financial-evidence-status').innerText();
  ensure('Evidence view requires verified Wallet ownership before owner-scoped reads', evidenceStatus.includes('WALLET_AUTHENTICATION_REQUIRED'));
  await scrollIntoFrame(page, '[role=tablist]');
  await screenshot(page, '09-evidence-auth-required');

  await holdDemoUntil(page, recordingStartedAt, 82);
  await setCaption(page, displayCueText(8));
  await page.getByRole('tab', { name: 'EXECUTION' }).click();
  const executionPanel = await financialPanel.innerText();
  ensure('execution panel reports NO EXECUTION and production Gate not deployed',
    executionPanel.includes('NO EXECUTION') && executionPanel.includes('not deployed'));
  ensure('no testnet read or transaction is used', upstreamRequests === 0);
  await scrollIntoFrame(page, '[role=tablist]');
  await screenshot(page, '10-execution-no-go');
  await holdDemoUntil(page, recordingStartedAt, 88);
  finalCaption = await page.locator('#current-demo-caption-text').innerText();
  const closingStateValid = finalFilmMode
    ? finalCaption.includes('T5 remains blocked') && finalCaption.includes('T6 funding and recovery remain unverified')
    : finalCaption.includes('T5 market risk is blocked') && finalCaption.includes('T6 funding and recovery are missing');
  ensure('closing caption preserves T5/T6 and execution states', closingStateValid);
  await holdDemoUntil(page, recordingStartedAt, 90);
  if (finalFilmMode) {
    await setCaption(page, closingCue.text);
    await showFilmCard(page, 'PROOF BEFORE ACTION', 'EXECUTION NOT APPROVED', '/brand/VEREQO_LOCKUP_SOLID.svg');
    ensure('brand closing uses supplied solid SVG lockup', await page.locator('#vereqo-film-card img[src="/brand/VEREQO_LOCKUP_SOLID.svg"]').count() === 1);
    await page.waitForTimeout(6000);
    await hideFilmCard(page);
  }
  const video = page.video();
  await context.close();
  context = null;
  recorderPath = await video!.path();
} finally {
  if (context) await context.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  await app.close();
}
ensure('browser never contacted an external origin', blockedExternalRequests.length === 0);
ensure('no Wallet, Agent proposal, authorization evidence, or financial write was sent',
  !browserRequests.some(request => request.path.startsWith('/api/wallet/') ||
    request.path === '/api/agent/propose' || request.path === '/api/agent/request-review' ||
    request.path.startsWith('/api/agent/authorization/') ||
    request.path.startsWith('/api/financial/') && !['GET', 'HEAD'].includes(request.method)));
ensure('no persistent graph commit was sent',
  !browserRequests.some(request => request.path === '/api/graph' && request.method === 'POST'));
ensure('browser produced no runtime errors', browserErrors.length === 0);
ensure('no Injective read adapter call occurred', upstreamRequests === 0);

const mp4 = join(output, videoFileName);
execFileSync(ffmpeg, [
  '-y', '-hide_banner', '-loglevel', 'error', '-i', recorderPath,
  '-vf', `fps=30,tpad=stop_mode=clone:stop_duration=${filmDurationSeconds}`,
  '-t', String(filmDurationSeconds), '-an', '-map_metadata', '-1',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4,
]);
const videoMetadata = inspectVideo(mp4);
ensure('caption file contains every narration cue', vtt.startsWith('WEBVTT\n') && captionCues.every(cue => vtt.includes(cue.text)));
const report = {
  status: 'PASS_WITH_SCOPE_LIMITS',
  generatedAt: new Date().toISOString(),
  capture: finalFilmMode ? 'New current local production build capture with a separately labelled saved real-model test card; no historical footage or stills reused.' : 'Current local production build only; no Operation 60/62 footage or stills reused.',
  buildSource: 'local production build; filesystem path omitted',
  currentBuildSha256: buildSha256,
  captureScriptSha256: sha256File(resolve('scripts/current-product-demo-capture.ts')) ,
  video: {
    file: videoFileName,
    sha256: sha256File(mp4),
    ...videoMetadata,
    audioTrack: 'NONE',
    captions: 'Burned-in English captions; matching VTT provided',
    narration: finalFilmMode ? 'English narration script provided; video is silent pending local voice rendering' : 'English script provided; no voice synthesis or audio track',
  },
  networkBoundary: {
    browserOrigin: 'loopback only',
    blockedExternalRequestCount: blockedExternalRequests.length,
    injectiveReadAdapterCalls: upstreamRequests,
    testnetReads: 'NOT_ATTEMPTED',
  },
  financialBoundary: {
    ownerWalletAuthentication: 'OWNER_ACTION_REQUIRED / UNVERIFIED',
    t5MarketRisk: 'BLOCKED / MARKET_RISK_UNVERIFIED',
    t6FundingAndRecovery: 'MISSING',
    execution: 'NOT_IMPLEMENTED / NO-GO',
    ownerScopedEvidence: 'AUTHENTICATION_REQUIRED / NO_READ',
    walletSignatureOrSessionUsed: false,
    financialWriteUsed: false,
    transactionOrOrderUsed: false,
  },
  checks: { passed: checks.length, failed: 0, ids: checks },
  screenshots: screenshots.map(file => ({ file, sha256: sha256File(join(evidence, file)) })),
  browserRequestCount: browserRequests.length,
  browserRequests,
  runtimeErrors: browserErrors.length,
};
writeFileSync(join(evidence, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o644 });
const hashTargets = [
  join(output, videoFileName),
  join(output, captionFileName),
  join(output, narrationFileName),
  join(output, 'STORYBOARD.md'),
  join(evidence, 'capture-report.json'),
  ...screenshots.map(file => join(evidence, file)),
];
const manifest = hashTargets.map(path => sha256File(path) + '  ' + path.replace(repoRoot + '/', '')).join('\n') + '\n';
writeFileSync(join(evidence, 'SHA256SUMS.txt'), manifest, { mode: 0o644 });
writeFileSync(join(output, 'MEDIA_README.md'), [
  finalFilmMode ? '# VEREQO Final Product Film' : '# Current product demo media',
  '',
  finalFilmMode ? `- MP4: ${videoFileName} — 210-second, 1920×1080 H.264, silent, English captions burned in.` : `- MP4: ${videoFileName} — 90-second, 1440×900 H.264, silent, English captions burned in.`,
  `- Captions: ${captionFileName}.`,
  `- English narration script: ${narrationFileName} (script only; no generated voice track).`,
  '- Storyboard: STORYBOARD.md.',
  `- Capture report, screenshots, and SHA-256 manifest: ${evidence.replace(repoRoot + '/', '')}/.`,
  '',
  finalFilmMode ? 'The film uses a new local production build capture and a saved-result card for real local Phi inference over explicitly synthetic input. Downstream issuer, proof, anchor and wallet components are labelled synthetic. No live market read, Wallet session, signature, financial write, transaction, order or historical footage is represented.' : 'This media was captured from the current local production build. It uses only synthetic/local preview data. No external Testnet read, owner Wallet, signature, financial write, transaction, order, or historical footage was used.',
].join('\n') + '\n', { mode: 0o644 });
const finalHashTargets = [...hashTargets, join(output, 'MEDIA_README.md')];
const finalManifest = finalHashTargets.map(path => sha256File(path) + '  ' + path.replace(repoRoot + '/', '')).join('\n') + '\n';
writeFileSync(join(evidence, 'SHA256SUMS.txt'), finalManifest, { mode: 0o644 });
rmSync(tempVideoDir, { recursive: true, force: true });
rmSync(recorderCache, { recursive: true, force: true });
console.log(JSON.stringify({
  status: 'PASS_WITH_SCOPE_LIMITS',
  video: mp4,
  durationSeconds: videoMetadata.durationSeconds,
  dimensions: videoMetadata.width + 'x' + videoMetadata.height,
  checkCount: checks.length,
  screenshots: screenshots.length,
  sha256: sha256File(mp4),
  evidence,
}));
