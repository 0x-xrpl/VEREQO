import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from 'playwright';
import { createLocalApp } from '../services/issuer/src/http';
import { InjectiveReadAdapter, type LiveSnapshot } from '../packages/domain/src/live-injective';

type RequestEntry = { method: string; path: string };
type UpstreamRequestEntry = { method: string; origin: string; path: string; rpcMethod?: string };
type CaptionCue = { start: number; end: number; text: string };
type CaptureSpec = { name: string; seconds: number };

const output = resolve(process.env.VEREQO_OP60_VIDEO_OUTPUT ?? 'docs/evidence/operation-60/stage-4');
const chrome = process.env.VEREQO_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ffmpeg = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
const recorderCache = resolve(tmpdir(), 'vereqo-op60-playwright-cache-' + process.pid);
process.env.PLAYWRIGHT_BROWSERS_PATH = recorderCache;
const browserManifest = JSON.parse(readFileSync(resolve('node_modules/playwright-core/browsers.json'), 'utf8')) as { browsers: { name: string; revision: string }[] };
const ffmpegRevision = browserManifest.browsers.find(browser => browser.name === 'ffmpeg')?.revision;
if (!ffmpegRevision) throw new Error('PLAYWRIGHT_FFMPEG_REVISION_NOT_FOUND');
const recorderName = process.platform === 'darwin' ? 'ffmpeg-mac' : process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux';
const recorderTarget = resolve(recorderCache, 'ffmpeg-' + ffmpegRevision, recorderName);
mkdirSync(dirname(recorderTarget), { recursive: true, mode: 0o700 });
if (!existsSync(recorderTarget)) symlinkSync(ffmpeg, recorderTarget);
const { chromium } = await import('playwright');
const specs: CaptureSpec[] = [
  { name: 'control-deck-90s', seconds: 90 },
  { name: 'control-deck-3min', seconds: 180 },
];
const captionSequences: Record<string, CaptionCue[]> = {
  'control-deck-90s': [
    { start: 0, end: 14, text: "An AI proposal is not permission. The operator needs to see the request, its evidence boundary and consequences before execution is considered." },
    { start: 14, end: 37, text: "This is the existing CONTROL DECK. The precision dial sets inspection depth; the keys inspect and preview." },
    { start: 37, end: 48, text: "The graph preview is a local demonstration, separate from financial causality. WHAT-IF / NOT COMMITTED." },
    { start: 48, end: 64, text: "No live Agent runtime or connected Wallet is configured. This is an unsigned local draft." },
    { start: 64, end: 75, text: "Public Injective Testnet observation: EVM 1439, Cosmos injective-888. No order is sent." },
    { start: 75, end: 82, text: "LCD market data and EVM block are independent reads: UNPINNED_LCD_READ." },
    { start: 82, end: 90, text: "The observed market enters the existing CONTROL DECK under the same Business ID. Proof / Gate remain unverified; execution is NOT_IMPLEMENTED." },
  ],
  'control-deck-3min': [
    { start: 0, end: 18, text: "An AI agent's proposal is not authority. VEREQO makes the request, its evidence boundary and its consequences visible before execution is considered." },
    { start: 18, end: 45, text: "No live Agent runtime or connected Wallet is configured. This is an unsigned local draft; the selected Injective market is observed read-only." },
    { start: 45, end: 75, text: "The existing CONTROL DECK carries the same Business ID and market context. The dial and keys inspect a local what-if; they never authorize or commit it." },
    { start: 75, end: 105, text: "No issuer mandate, order-bound proof or verified Gate is configured. S08 keeps the Gate NOT EVALUATED; no pass is invented." },
    { start: 105, end: 140, text: "S03 is a synthetic local revocation what-if. Agent A's dependent branch is BLOCKED; independent Agent B remains VALID." },
    { start: 140, end: 165, text: "The verified chain evidence here is a public read-only Testnet observation, not a transaction. LCD and EVM reads remain UNPINNED_LCD_READ." },
    { start: 165, end: 180, text: "Next 10 days: validate native market-risk and principal-recovery semantics with protocol engineers. T5/T6 remain open; execution is NOT_IMPLEMENTED." },
  ],
};
const checks: string[] = [];
const captures: Record<string, unknown>[] = [];

function ensure(name: string, condition: boolean): void {
  if (!condition) throw new Error('OP60_VIDEO_CAPTURE_FAILED: ' + name);
  checks.push(name);
}

function holdUntil(page: Page, start: number, seconds: number): Promise<void> {
  const remaining = start + seconds * 1000 - Date.now();
  return remaining > 0 ? page.waitForTimeout(remaining) : Promise.resolve();
}

async function ensureControlDeckFrame(page: Page, videoName: string): Promise<void> {
  const visible = await page.evaluate(() => {
    const selectors = ['[data-testid="work-dial"]', '[data-testid="work-confirm"]', '[data-testid="key-primary"]', '[data-testid="key-secondary"]', '[data-testid="key-reset"]', '[data-testid="key-mode"]'];
    const rects = selectors.map(selector => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect());
    const headerBottom = document.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const captionTop = document.querySelector<HTMLElement>('#operation60-caption')?.getBoundingClientRect().top ?? window.innerHeight;
    return rects.every(rect => !!rect && rect.left >= 0 && rect.right <= window.innerWidth &&
      rect.top >= headerBottom && rect.bottom <= captionTop && rect.bottom <= window.innerHeight);
  });
  ensure(videoName + ' dial, center and both physical keys are visible above captions', visible);
}

async function scrollDialIntoFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dial = document.querySelector<HTMLElement>('[data-testid="work-dial"]');
    if (!dial) throw new Error('CONTROL_DECK_DIAL_NOT_FOUND');
    const rect = dial.getBoundingClientRect();
    const documentTop = rect.top + window.scrollY;
    const targetTop = documentTop - (window.innerHeight - rect.height) / 2;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: 'instant' });
  });
}

async function openLanding(page: Page, base: string, route: 'landing' | 'demo' = 'landing'): Promise<void> {
  await page.goto(route === 'demo' ? base + '#demo' : base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId('language-en').click();
  if (route === 'demo') await page.getByTestId('white-instrument').waitFor({ state: 'visible' });
}

async function installCaptionOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '#operation60-caption{position:fixed;z-index:2147483647;left:50%;bottom:8px;transform:translateX(-50%);width:calc(100% - 112px);max-width:1200px;box-sizing:border-box;padding:14px 22px 16px;border-left:5px solid #9fc2ab;border-radius:7px;background:rgba(18,24,21,.95);color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.28);pointer-events:none;font-family:Arial,sans-serif}#operation60-caption-label{font-size:11px;line-height:1.3;letter-spacing:.14em;text-transform:uppercase;color:#b9d3c2}#operation60-caption-text{margin:4px 0 0;font-size:24px;line-height:1.35;font-weight:500}';
    document.head.append(style);
    const panel = document.createElement('aside');
    panel.id = 'operation60-caption';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('aria-label', 'English captions');
    const label = document.createElement('div');
    label.id = 'operation60-caption-label';
    label.textContent = 'ENGLISH CAPTION';
    const text = document.createElement('p');
    text.id = 'operation60-caption-text';
    panel.append(label, text);
    document.body.append(panel);
    const scrollTail = document.createElement('div');
    scrollTail.id = 'operation60-scroll-tail';
    scrollTail.setAttribute('aria-hidden', 'true');
    scrollTail.style.cssText = 'height:1000px;visibility:hidden;pointer-events:none';
    document.body.append(scrollTail);
  });
}

async function setCaption(page: Page, text: string): Promise<void> {
  await page.locator('#operation60-caption-text').evaluate((element, value) => { element.textContent = value; }, text);
}

async function enterFinancial(page: Page): Promise<void> {
  await page.getByTestId('nav-financial').click();
  await page.getByTestId('financial-workflow').waitFor({ state: 'visible' });
}

async function operateControlDeck(page: Page, videoName: string): Promise<void> {
  const instrument = page.getByTestId('white-instrument');
  await instrument.waitFor({ state: 'visible' });
  await page.getByTestId('journey-free').click();
  await page.getByTestId('mode-impact').click();
  await page.getByTestId('dial-depth').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="journey-free"]')?.getAttribute('aria-pressed') === 'true' &&
    document.querySelector('[data-testid="mode-impact"]')?.getAttribute('aria-pressed') === 'true' &&
    document.querySelector('[data-testid="dial-depth"]')?.getAttribute('aria-pressed') === 'true');
  ensure(videoName + ' explicitly selects free journey, impact mode and depth dial',
    await page.getByTestId('journey-free').getAttribute('aria-pressed') === 'true' &&
    await page.getByTestId('mode-impact').getAttribute('aria-pressed') === 'true' &&
    await page.getByTestId('dial-depth').getAttribute('aria-pressed') === 'true');
  const dial = page.getByTestId('work-dial');
  await scrollDialIntoFrame(page);
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLElement>('[data-testid="work-dial"]');
    return element?.getAttribute('aria-valuemin') === '1' &&
      element.getAttribute('aria-valuemax') === '3' &&
      element.getAttribute('aria-valuenow') !== null;
  });
  await ensureControlDeckFrame(page, videoName);
  await dial.evaluate(element => (element as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('[data-testid="work-dial"]')?.getAttribute('aria-valuenow') === '1');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-testid="work-dial"]')?.getAttribute('aria-valuenow') === '2');
  ensure(videoName + ' real CONTROL DECK depth dial responds to keyboard input', Number(await dial.getAttribute('aria-valuenow')) === 2);
  await page.getByTestId('work-confirm').evaluate(element => (element as HTMLButtonElement).click());
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="inspection-confirmation"]')?.getAttribute('data-confirmed') === 'true');
  const confirmation = await page.getByTestId('inspection-confirmation').innerText();
  ensure(videoName + ' dial center confirms display selection without approval',
    confirmation.includes('Inspection target confirmed') && confirmation.includes('No disclosure or execution approval'));
  ensure(videoName + ' confirmed depth remains selected', Number(await dial.getAttribute('aria-valuenow')) === 2);
  await scrollDialIntoFrame(page);
  await ensureControlDeckFrame(page, videoName);
  const secondaryBox = await page.getByTestId('key-secondary').boundingBox();
  if (!secondaryBox) throw new Error('CONTROL_DECK_SECONDARY_KEY_NOT_IN_FRAME');
  await page.mouse.click(secondaryBox.x + secondaryBox.width / 2, secondaryBox.y + secondaryBox.height / 2);
  await page.waitForFunction(() => document.querySelector('[data-testid="work-dial"]')?.getAttribute('aria-valuenow') === '3');
  ensure(videoName + ' physical secondary key cycles inspection depth', Number(await dial.getAttribute('aria-valuenow')) === 3);
  await scrollDialIntoFrame(page);
  await ensureControlDeckFrame(page, videoName);
  const interactionScreenshot = join(output, videoName + '-control-interaction.png');
  await page.screenshot({ path: interactionScreenshot, type: 'png' });
  ensure(videoName + ' actual Control Deck interaction screenshot exists', existsSync(interactionScreenshot));
  const primaryBox = await page.getByTestId('key-primary').boundingBox();
  if (!primaryBox) throw new Error('CONTROL_DECK_PRIMARY_KEY_NOT_IN_FRAME');
  await page.mouse.click(primaryBox.x + primaryBox.width / 2, primaryBox.y + primaryBox.height / 2);
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="deck-display"]')?.getAttribute('data-decision') === 'what_if');
  const board = page.getByTestId('living-board');
  await alignBelowTopbar(page, '[data-testid="living-board"]');
  const stateA = await page.locator('[data-testid="broker-A"] [data-node-id="action_A"]').getAttribute('data-node-state');
  const stateB = await page.locator('[data-testid="broker-B"] [data-node-id="action_B"]').getAttribute('data-node-state');
  ensure(videoName + ' primary key opens an uncommitted local CONTROL DECK what-if',
    await board.getAttribute('data-phase') === 'what-if');
  ensure(videoName + ' graph preview blocks dependent Agent A and preserves independent Agent B',
    stateA === 'BLOCKED' && stateB === 'VALID');
}

async function alignBelowTopbar(page: Page, selector: string): Promise<void> {
  await page.evaluate(targetSelector => {
    const target = document.querySelector<HTMLElement>(targetSelector);
    const topbar = document.querySelector<HTMLElement>('.topbar');
    if (!target) throw new Error('VIDEO_TARGET_NOT_FOUND: ' + targetSelector);
    const targetTop = target.getBoundingClientRect().top + window.scrollY;
    const headerHeight = topbar?.getBoundingClientRect().height ?? 0;
    window.scrollTo({ top: Math.max(0, targetTop - headerHeight - 12), behavior: 'instant' });
  }, selector);
}

async function readMarket(page: Page): Promise<LiveSnapshot> {
  const responsePromise = page.waitForResponse(request => new URL(request.url()).pathname === '/api/financial/market');
  await page.getByTestId('financial-read').click();
  const response = await responsePromise;
  ensure('public Testnet market read returns HTTP 200', response.status() === 200);
  const body = await response.json() as { snapshot: LiveSnapshot };
  const snapshot = body.snapshot;
  ensure('read identifies Injective Testnet EVM 1439 and Cosmos injective-888',
    snapshot.status === 'LIVE_READ_ONLY' && snapshot.chainId === '1439' && snapshot.cosmosChainId === 'injective-888');
  ensure('read exposes active INJ/USDT Spot and ETH/USDC PERP',
    snapshot.market.ticker === 'INJ/USDT' && snapshot.derivativeMarket?.ticker === 'ETH/USDC PERP');
  ensure('market consistency remains UNPINNED_LCD_READ and execution NOT_IMPLEMENTED',
    snapshot.marketConsistency === 'UNPINNED_LCD_READ' && snapshot.execution === 'NOT_IMPLEMENTED');
  const quote = page.getByTestId('financial-spot-quote');
  await quote.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-testid="financial-spot-quote"]')?.textContent?.includes('UNPINNED_LCD_READ') === true);
  await alignBelowTopbar(page, '[data-testid="financial-spot-quote"]');
  const quoteText = await quote.innerText();
  ensure('live public read-only market quote is visible in the video frame',
    quoteText.includes('PUBLIC TESTNET TOP OF BOOK') && quoteText.includes('UNPINNED_LCD_READ'));
  return snapshot;
}

async function replay(page: Page, scenarioId: string): Promise<string> {
  await page.getByTestId('rehearsal-scenario-select').selectOption(scenarioId);
  await page.getByTestId('rehearsal-load').click();
  const rehearsal = page.getByTestId('scenario-rehearsal');
  await page.waitForFunction(id => document.querySelector('[data-testid="scenario-rehearsal"]')?.textContent?.includes(id) === true, scenarioId);
  const businessId = await rehearsal.getAttribute('data-business-id') ?? '';
  ensure(scenarioId + ' uses the expected scenario identity', /^fi_[a-f0-9]{32}$/.test(businessId));
  await page.getByTestId('rehearsal-replay').click();
  const result = page.getByTestId('rehearsal-result');
  await result.waitFor({ state: 'visible' });
  await result.evaluate(element => {
    const target = element as HTMLElement;
    const topbar = document.querySelector<HTMLElement>('.topbar');
    const top = target.getBoundingClientRect().top + window.scrollY;
    const headerHeight = topbar?.getBoundingClientRect().height ?? 0;
    window.scrollTo({ top: Math.max(0, top - headerHeight - 12), behavior: 'instant' });
  });
  const resultVisible = await page.evaluate(() => {
    const result = document.querySelector<HTMLElement>('[data-testid="rehearsal-result"]');
    const topbar = document.querySelector<HTMLElement>('.topbar');
    if (!result || !topbar) return false;
    const box = result.getBoundingClientRect();
    return box.top >= topbar.getBoundingClientRect().bottom && box.bottom <= window.innerHeight;
  });
  ensure(scenarioId + ' result is fully visible in the video frame', resultVisible);
  return await page.getByTestId('scenario-rehearsal').innerText();
}

async function revealConsequenceTrace(page: Page, videoName: string): Promise<void> {
  const trace = page.getByTestId('financial-trace-consequence');
  await trace.waitFor({ state: 'visible' });
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('[data-testid="financial-trace-consequence"]');
    if (!target) throw new Error('FINANCIAL_TRACE_NOT_FOUND');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  const belowTopbar = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('[data-testid="financial-trace-consequence"]');
    const topbar = document.querySelector<HTMLElement>('.topbar');
    return !!target && !!topbar && target.getBoundingClientRect().top >= topbar.getBoundingClientRect().bottom;
  });
  ensure(videoName + ' final trace is positioned below sticky navigation', belowTopbar);
}

function inspectVideo(path: string, expectedSeconds: number): { durationSeconds: number; width: number; height: number; hasAudio: boolean } {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-i', path], { encoding: 'utf8' });
  const diagnostic = (result.stderr ?? '') + (result.stdout ?? '');
  const durationMatch = /Duration: (\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(diagnostic);
  const videoMatch = /Video: h264[^\n]*?(\d{3,4})x(\d{3,4})/.exec(diagnostic);
  if (!durationMatch || !videoMatch) throw new Error('OP60_VIDEO_METADATA_UNAVAILABLE: ' + path);
  const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  const width = Number(videoMatch[1]);
  const height = Number(videoMatch[2]);
  const hasAudio = /Audio:/.test(diagnostic);
  ensure(path.split('/').pop() + ' is H.264 at 1440x900',
    width === 1440 && height === 900);
  ensure(path.split('/').pop() + ' duration is ' + expectedSeconds + ' seconds',
    Math.abs(duration - expectedSeconds) <= 0.1);
  ensure(path.split('/').pop() + ' has no audio track',
    !hasAudio);
  return { durationSeconds: duration, width, height, hasAudio };
}

async function capture(spec: CaptureSpec): Promise<void> {
  const upstreamRequests: UpstreamRequestEntry[] = [];
  const injective = new InjectiveReadAdapter(async (input, init) => {
    const url = new URL(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    let rpcMethod: string | undefined;
    if (method === 'POST' && typeof init?.body === 'string') {
      try { rpcMethod = String((JSON.parse(init.body) as { method?: unknown }).method ?? ''); }
      catch { rpcMethod = 'INVALID_JSON_RPC'; }
    }
    upstreamRequests.push({ method, origin: url.origin, path: url.pathname, ...(rpcMethod ? { rpcMethod } : {}) });
    return fetch(input, init);
  });
  const app = createLocalApp({ databasePath: ':memory:', injective });
  await new Promise<void>(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen));
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('OP60_LOCAL_SERVER_NOT_STARTED');
  const base = 'http://127.0.0.1:' + address.port;
  const tempDir = resolve(tmpdir(), 'vereqo-op60-' + process.pid + '-' + spec.name);
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const requests: RequestEntry[] = [];
  const blockedExternalRequests: string[] = [];
  const browserErrors: string[] = [];
  let snapshot: LiveSnapshot | null = null;
  let finalBusinessId = '';
  let page: Page | null = null;
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  let recorderPath = '';

  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
      recordVideo: { dir: tempDir, size: { width: 1440, height: 900 } },
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === base) return route.continue();
      blockedExternalRequests.push(route.request().method() + ' ' + url.origin + url.pathname);
      return route.abort();
    });
    page = await context.newPage();
    const currentPage = page;
    const recordingStartedAt = Date.now();
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !message.text().includes('503')) browserErrors.push(message.text());
    });
    page.on('request', request => {
      const url = new URL(request.url());
      requests.push({ method: request.method(), path: url.pathname });
    });

    const cues = captionSequences[spec.name];
    if (!cues) throw new Error('OP60_CAPTIONS_NOT_CONFIGURED');
    await openLanding(page, base, spec.seconds === 90 ? 'demo' : 'landing');
    await installCaptionOverlay(page);
    if (spec.seconds === 90) await scrollDialIntoFrame(page);
    await setCaption(page, cues[0]!.text);

    if (spec.seconds === 90) {
      await operateControlDeck(page, spec.name);
      await scrollDialIntoFrame(page);
      await holdUntil(page, recordingStartedAt, 14);
      await setCaption(page, cues[1]!.text);
      await holdUntil(page, recordingStartedAt, 37);
      await setCaption(page, cues[2]!.text);
      await alignBelowTopbar(page, '[data-testid="living-board"]');
      await holdUntil(page, recordingStartedAt, 48);
      await setCaption(page, cues[3]!.text);
      await enterFinancial(page);
      snapshot = await readMarket(page);
      await holdUntil(page, recordingStartedAt, 64);
      await setCaption(page, cues[4]!.text);
      await page.getByRole('tab', { name: 'EVIDENCE' }).click();
      const evidenceText = await page.getByTestId('financial-panel').innerText();
      ensure('90s evidence view shows source identity and unpinned state',
        evidenceText.includes('UNPINNED_LCD_READ') && evidenceText.includes('EVM block hash'));
      await holdUntil(page, recordingStartedAt, 75);
      await setCaption(page, cues[5]!.text);

      finalBusinessId = await page.getByTestId('financial-workflow').getAttribute('data-business-id') ?? '';
      await page.getByTestId('financial-open-market-trace').click();
      await page.getByTestId('financial-trace-consequence').waitFor({ state: 'visible' });
      await revealConsequenceTrace(page, spec.name);
      const trace = await page.getByTestId('financial-trace-consequence').innerText();
      ensure('90s read-only market is handed to the existing CONTROL DECK',
        Boolean(snapshot) && trace.includes(snapshot.market.marketId) && trace.includes(snapshot.blockNumber) && trace.includes('UNPINNED_LCD_READ'));
      ensure('90s financial trace identity reaches Instrument and Consequence',
        Boolean(finalBusinessId) &&
        await page.getByTestId('financial-trace-consequence').getAttribute('data-object-id') === finalBusinessId &&
        await page.getByTestId('financial-trace-instrument').getAttribute('data-object-id') === finalBusinessId);
      ensure('90s final trace retains explicit unconfigured authorization and execution states',
        trace.includes('NOT_CONFIGURED') && trace.includes('NOT_VERIFIED') && trace.includes('NOT_IMPLEMENTED / NONE'));
      await holdUntil(page, recordingStartedAt, 82);
      await setCaption(page, cues[6]!.text);
      await holdUntil(page, recordingStartedAt, 88);
      await currentPage.screenshot({ path: join(output, spec.name + '-final-screen.png'), type: 'png' });
    } else {
      await holdUntil(page, recordingStartedAt, 18);
      await setCaption(page, cues[1]!.text);
      await enterFinancial(page);
      const unsignedRequestView = await page.getByTestId('financial-workflow').innerText();
      ensure('3min financial view shows no Agent, disconnected Wallet and a non-executable unsigned draft',
        unsignedRequestView.includes('Agent provider is not configured') &&
        unsignedRequestView.includes('Wallet disconnected') &&
        unsignedRequestView.includes('Local draft only') &&
        unsignedRequestView.toLowerCase().includes('not an executable intent'));
      snapshot = await readMarket(page);
      finalBusinessId = await page.getByTestId('financial-workflow').getAttribute('data-business-id') ?? '';
      await holdUntil(page, recordingStartedAt, 45);
      await setCaption(page, cues[2]!.text);
      await page.getByTestId('financial-open-market-trace').click();
      const consequence = page.getByTestId('financial-trace-consequence');
      await consequence.waitFor({ state: 'visible' });
      const liveTrace = await consequence.innerText();
      ensure('3min selected public market, EVM block and unpinned state reach CONTROL DECK handoff',
        Boolean(snapshot) && liveTrace.includes(snapshot.market.marketId) && liveTrace.includes(snapshot.blockNumber) && liveTrace.includes('UNPINNED_LCD_READ'));
      ensure('3min Business ID is shared by financial, Instrument and Consequence surfaces',
        Boolean(finalBusinessId) &&
        await consequence.getAttribute('data-object-id') === finalBusinessId &&
        await page.getByTestId('financial-trace-instrument').getAttribute('data-object-id') === finalBusinessId);
      await page.locator('.navlinks a[href="#demo"]').click();
      await operateControlDeck(page, spec.name);
      await scrollDialIntoFrame(page);
      await holdUntil(page, recordingStartedAt, 75);
      await setCaption(page, cues[3]!.text);
      await page.getByTestId('nav-financial').click();

      const s08 = await replay(page, 'S08-proof-is-not-authority');
      ensure('S08 synthetic result states proof/signature absent and Gate not evaluated',
        s08.includes('NOT_PROVIDED') && s08.includes('GATE_NOT_EVALUATED'));
      await holdUntil(page, recordingStartedAt, 105);
      await setCaption(page, cues[4]!.text);
      const s03 = await replay(page, 'S03-revocation-causality');
      ensure('S03 synthetic result is a local graph-only preview',
        s03.includes('Agent A intent branch') && s03.includes('BLOCKED') && s03.includes('Independent Agent B action') && s03.includes('VALID'));
      await holdUntil(page, recordingStartedAt, 140);
      await setCaption(page, cues[5]!.text);
      await page.locator('.navlinks a[href="#demo"]').click();
      await revealConsequenceTrace(page, spec.name);
      const finalTrace = await page.getByTestId('financial-trace-consequence').innerText();
      ensure('3min closing CONTROL DECK retains the earlier public read-only observation',
        Boolean(snapshot) && finalTrace.includes(snapshot.market.marketId) && finalTrace.includes(snapshot.blockNumber) && finalTrace.includes('NOT_IMPLEMENTED / NONE'));
      ensure('3min authorization and execution remain fail-closed',
        finalTrace.includes('NOT_CONFIGURED') && finalTrace.includes('NOT_VERIFIED'));
      await holdUntil(page, recordingStartedAt, 165);
      await setCaption(page, cues[6]!.text);
      await holdUntil(page, recordingStartedAt, 177);
      await currentPage.screenshot({ path: join(output, spec.name + '-final-screen.png'), type: 'png' });
    }

    const finalCaptionText = await currentPage.locator('#operation60-caption-text').innerText();
    const video = page.video();
    await holdUntil(page, recordingStartedAt, spec.seconds);
    await context.close();
    context = null;
    recorderPath = await video!.path();

    const forbiddenRequests = requests.filter(request =>
      request.path.includes('/api/wallet/') || request.path.includes('/api/agent/propose') ||
      request.path.includes('/api/financial/order') || request.path.includes('/api/financial/execute') ||
      request.path.includes('/api/financial/broadcast') ||
      (request.path.startsWith('/api/financial/') && request.method !== 'GET' && request.method !== 'HEAD'));
    ensure(spec.name + ' makes no wallet, Agent proposal, financial order, execution, or broadcast request',
      forbiddenRequests.length === 0);
    ensure(spec.name + ' makes no financial graph commit request',
      !requests.some(request => request.path === '/api/graph' && request.method === 'POST'));
    ensure(spec.name + ' makes no browser request to an external origin',
      blockedExternalRequests.length === 0);
    ensure(spec.name + ' has no browser runtime errors through recording end',
      browserErrors.length === 0);
    const permittedRpcMethods = ['eth_chainId', 'eth_getBlockByNumber', 'web3_clientVersion'];
    const upstreamReadOnly = upstreamRequests.length > 0 && upstreamRequests.every(request =>
      request.method === 'GET' && !request.rpcMethod ||
      request.method === 'POST' && !!request.rpcMethod && permittedRpcMethods.includes(request.rpcMethod));
    ensure(spec.name + ' server traffic uses only public read-only EVM JSON-RPC POST and LCD GET methods',
      upstreamReadOnly);
    ensure(spec.name + ' contains the final English caption cue', finalCaptionText === cues.at(-1)!.text);

    const mp4 = join(output, spec.name + '.mp4');
    execFileSync(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', recorderPath,
      '-vf', 'fps=30,tpad=stop_mode=clone:stop_duration=' + spec.seconds,
      '-t', String(spec.seconds), '-an', '-map_metadata', '-1',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4,
    ]);
    const metadata = inspectVideo(mp4, spec.seconds);
    const videoSha256 = createHash('sha256').update(readFileSync(mp4)).digest('hex');
    const screenshotPath = join(output, spec.name + '-final-screen.png');
    captures.push({
      name: spec.name,
      file: spec.name + '.mp4',
      durationSeconds: metadata.durationSeconds,
      width: metadata.width,
      height: metadata.height,
      audioTrack: metadata.hasAudio ? 'PRESENT' : 'NONE',
      captions: { language: 'en', burnedIn: true, file: spec.name + '-en.vtt' },
      sha256: videoSha256,
      screenshot: spec.name + '-final-screen.png',
      controlInteractionScreenshot: spec.name + '-control-interaction.png',
      marketConsistency: snapshot?.marketConsistency ?? 'UNKNOWN',
      execution: snapshot?.execution ?? 'UNKNOWN',
      evmChainId: snapshot?.chainId ?? 'UNKNOWN',
      cosmosChainId: snapshot?.cosmosChainId ?? 'UNKNOWN',
      evmBlockNumber: snapshot?.blockNumber ?? 'UNKNOWN',
      finalBusinessId,
      browserRequestInventory: requests,
      serverUpstreamRequestInventory: upstreamRequests,
      blockedExternalRequests,
      runtimeErrors: browserErrors,
    });
    ensure(spec.name + ' final screenshot exists', existsSync(screenshotPath));
    rmSync(tempDir, { recursive: true, force: true });
  } finally {
    if (context) await context.close().catch(() => undefined);
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (!existsSync('dist/web/index.html')) throw new Error('BUILD_REQUIRED_RUN_NPM_RUN_BUILD_FIRST');
if (!existsSync(chrome)) throw new Error('INSTALLED_CHROME_NOT_FOUND_SET_VEREQO_CHROME');
mkdirSync(output, { recursive: true, mode: 0o700 });
const captionFiles: { file: string; sha256: string; language: string }[] = [];
for (const spec of specs) {
  const cues = captionSequences[spec.name];
  if (!cues?.length) throw new Error('OP60_CAPTIONS_NOT_CONFIGURED');
  const timestamp = (seconds: number) => {
    const whole = Math.floor(seconds);
    const millis = Math.round((seconds - whole) * 1000);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0') + '.' + String(millis).padStart(3, '0');
  };
  const vtt = 'WEBVTT\n\n' + cues.map((cue, index) =>
    (index + 1) + '\n' + timestamp(cue.start) + ' --> ' + timestamp(cue.end) + '\n' + cue.text).join('\n\n') + '\n';
  const file = spec.name + '-en.vtt';
  const path = join(output, file);
  writeFileSync(path, vtt, { mode: 0o644 });
  captionFiles.push({ file, language: 'en', sha256: createHash('sha256').update(vtt).digest('hex') });
  ensure(file + ' exists and includes all English caption cues', readFileSync(path, 'utf8').startsWith('WEBVTT\n') && cues.every(cue => vtt.includes(cue.text)));
}
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-component-update'],
});
try {
  for (const spec of specs) await capture(spec);
} finally {
  try {
    await browser.close();
  } finally {
    rmSync(recorderCache, { recursive: true, force: true });
  }
}
writeFileSync(join(output, 'capture-report.json'), JSON.stringify({
  status: 'PASS',
  scope: 'Existing VEREQO CONTROL DECK; public read-only Injective EVM JSON-RPC POST and LCD GET observations are separate from local synthetic rehearsals; no wallet/signature/order/write.',
  generatedAt: new Date().toISOString(),
  checks,
  captures,
  captionFiles,
}, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ status: 'PASS', captures: captures.map(capture => ({ name: capture.name, durationSeconds: capture.durationSeconds, sha256: capture.sha256 })), output }));
