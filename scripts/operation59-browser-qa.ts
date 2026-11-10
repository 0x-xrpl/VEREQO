import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { createLocalApp } from '../services/issuer/src/http';
import type { InjectiveReadAdapter } from '../packages/domain/src/live-injective';

const output = resolve(process.env.VEREQO_OP59_QA_OUTPUT ?? 'docs/evidence/operation-59/browser');
const chrome = process.env.VEREQO_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const recorderCache = resolve(tmpdir(), 'vereqo-op59-playwright-cache');
const videoTempDirectory = resolve(tmpdir(), `vereqo-op59-video-${process.pid}`);
process.env.PLAYWRIGHT_BROWSERS_PATH = recorderCache;
const { chromium } = await import('playwright');
if (!existsSync('dist/web/index.html')) throw new Error('BUILD_REQUIRED_RUN_NPM_RUN_BUILD_FIRST');
if (!existsSync(chrome)) throw new Error('INSTALLED_CHROME_NOT_FOUND_SET_VEREQO_CHROME');
mkdirSync(output, { recursive: true, mode: 0o700 });

let videoAvailable = false;
let videoCaptureStatus = 'SKIPPED: local ffmpeg unavailable';
try {
  const manifest = JSON.parse(readFileSync(resolve('node_modules/playwright-core/browsers.json'), 'utf8')) as { browsers: { name: string; revision: string }[] };
  const revision = manifest.browsers.find(browser => browser.name === 'ffmpeg')?.revision;
  if (!revision) throw new Error('PLAYWRIGHT_FFMPEG_REVISION_NOT_FOUND');
  const executableName = process.platform === 'darwin' ? 'ffmpeg-mac' : process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux';
  const target = resolve(recorderCache, `ffmpeg-${revision}`, executableName);
  mkdirSync(resolve(target, '..'), { recursive: true, mode: 0o700 });
  if (!existsSync(target)) {
    const systemFfmpeg = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
    symlinkSync(systemFfmpeg, target);
  }
  videoAvailable = existsSync(target);
  if (videoAvailable) videoCaptureStatus = 'READY: existing system ffmpeg via disposable cache link';
} catch (error) {
  videoCaptureStatus = `SKIPPED: ${String(error)}`;
}

const checks: string[] = [];
const browserErrors: string[] = [];
const requests: { method: string; path: string }[] = [];
const responses: { status: number; path: string }[] = [];
const serverEvents: string[] = [];
const blockedExternalRequests: string[] = [];
let runStatus: 'PASS' | 'FAIL' = 'PASS';
const scenarioIds = [
  'S01-eligible-request', 'S02-exceeds-private-mandate', 'S03-revocation-causality',
  'S04-unverified-market', 'S05-cancel-vs-fill', 'S06-wrong-chain',
  'S07-disclosure-sequence', 'S08-proof-is-not-authority',
] as const;
const isolateS08 = process.env.VEREQO_OP59_S08_ISOLATED === '1';
const expectedDecisions = [
  'WITHIN_SYNTHETIC_POLICY', 'DENIED', 'WHAT_IF_ONLY', 'BLOCKED',
  'CANCEL_REQUESTED_NOT_CONFIRMED', 'DENIED_WRONG_CHAIN', 'BLOCKED', 'BLOCKED',
] as const;
const check = (name: string, condition: boolean): void => {
  if (!condition) throw new Error(`OP59_BROWSER_QA_FAILED: ${name}`);
  checks.push(name);
};
const wait = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms));

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-component-update'],
});
// The app is intentionally given a network-disabled Injective adapter in this QA run.
const injective = { snapshot: async () => { throw new Error('OP59_QA_READ_ONLY_NETWORK_DISABLED'); } } as unknown as InjectiveReadAdapter;
const app = createLocalApp({ databasePath: ':memory:', staticRoot: 'dist/web', injective });
app.server.on('request', (request, response) => {
  if (request.url !== '/api/demo/replay') return;
  serverEvents.push(`start:${request.method}:${request.headers['content-length'] ?? 'UNKNOWN'}`);
  request.on('end', () => serverEvents.push('request:end'));
  request.on('aborted', () => serverEvents.push('request:aborted'));
  response.on('finish', () => serverEvents.push(`response:finish:${response.statusCode}`));
  response.on('close', () => serverEvents.push(`response:close:${response.statusCode}`));
});
await new Promise<void>(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen));
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('OP59_QA_LOCAL_SERVER_NOT_STARTED');
const base = `http://127.0.0.1:${address.port}`;

async function newLocalContext(width: number, height = 900, recordVideo = false) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width <= 390,
    hasTouch: width <= 390,
    reducedMotion: 'reduce',
    ...(recordVideo ? { recordVideo: { dir: videoTempDirectory, size: { width: 1440, height: 900 } } } : {}),
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    blockedExternalRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
    return route.abort();
  });
  return context;
}

function instrumentPage(page: Page): void {
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('request', request => {
    const url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname });
  });
  page.on('response', response => {
    const url = new URL(response.url());
    responses.push({ status: response.status(), path: url.pathname });
  });
}

async function openFinancial(page: Page): Promise<void> {
  await page.goto(`${base}/#financial`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId('language-en').click();
  await page.getByTestId('financial-workflow').waitFor({ state: 'visible' });
}

async function loadAndReplay(page: Page, index: number): Promise<{ id: string; decision: string }> {
  const scenarioId = scenarioIds[index]!;
  await page.getByTestId('rehearsal-scenario-select').selectOption(scenarioId);
  await page.getByTestId('rehearsal-load').click();
  const rehearsal = page.getByTestId('scenario-rehearsal');
  await page.waitForFunction(id => document.querySelector('[data-testid="scenario-rehearsal"]')?.textContent?.includes(id) === true, scenarioId);
  const id = await rehearsal.getAttribute('data-business-id') ?? '';
  check(`${scenarioId} has a deterministic Business ID and revision 1`, /^fi_[a-f0-9]{32}$/.test(id) && await rehearsal.getAttribute('data-revision') === '1');
  const replayButton = page.getByTestId('rehearsal-replay');
  const replayEnabled = await replayButton.isEnabled();
  if (!replayEnabled) throw new Error(`${scenarioId}_REPLAY_BUTTON_DISABLED_AFTER_LOAD: ${JSON.stringify({ businessId: id, revision: await rehearsal.getAttribute('data-revision') })}`);
  const replayRequestsBefore = requests.filter(request => request.path === '/api/demo/replay').length;
  const replayResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/demo/replay', { timeout: 5000 });
  await replayButton.click();
  await page.waitForTimeout(150);
  const replayRequestsAfter = requests.filter(request => request.path === '/api/demo/replay').length;
  if (replayRequestsAfter === replayRequestsBefore) throw new Error(`${scenarioId}_REPLAY_CLICK_SENT_NO_REQUEST: ${JSON.stringify({ businessId: id, revision: await rehearsal.getAttribute('data-revision'), replayEnabled })}`);
  const replayResponse = await replayResponsePromise;
  const replayBody = await replayResponse.json() as { result?: Record<string, unknown> };
  if (scenarioId === 'S08-proof-is-not-authority') {
    const resultBody = replayBody.result ?? {};
    const facts = resultBody.facts && typeof resultBody.facts === 'object' ? resultBody.facts as Record<string, unknown> : {};
    const apiSummary = {
      status: replayResponse.status(), source: resultBody.source, decision: resultBody.decision, reason: resultBody.reason,
      proofStatus: resultBody.proofStatus, businessIdMatches: resultBody.businessId === id,
      factKeys: Object.keys(facts).sort(), requestIdMatches: facts.requestId === id,
      intentDigestValid: typeof facts.intentDigest === 'string' && /^0x[0-9a-f]{64}$/i.test(facts.intentDigest),
      proofDigestValid: typeof facts.proofDigest === 'string' && /^0x[0-9a-f]{64}$/i.test(facts.proofDigest),
      epochsMatch: facts.credentialEpochAtIntent === 1 && facts.credentialEpochNow === 2,
      issuerSignatureStatus: facts.issuerSignatureStatus, walletProviderCalled: facts.walletProviderCalled,
      precompileCalled: facts.precompileCalled, orderStatus: facts.orderStatus,
    };
    check('S08 issuer response contains the exact verified local vector and fail-closed authority state', replayResponse.ok() && apiSummary.source === 'LOCAL_GROTH16_TEST_VECTOR' && apiSummary.decision === 'BLOCKED' && apiSummary.proofStatus === 'GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP' && apiSummary.businessIdMatches && apiSummary.requestIdMatches && apiSummary.intentDigestValid && apiSummary.proofDigestValid && apiSummary.epochsMatch && apiSummary.issuerSignatureStatus === 'NOT_VERIFIED_IN_REHEARSAL' && apiSummary.walletProviderCalled === false && apiSummary.precompileCalled === false && apiSummary.orderStatus === 'NOT_SUBMITTED');
  }
  const result = page.getByTestId('rehearsal-result');
  await result.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
    const message = await rehearsal.getByRole('alert').innerText().catch(() => 'NO_ERROR_MESSAGE');
    throw new Error(`${scenarioId}_CLIENT_DID_NOT_ACCEPT_REPLAY_RESPONSE: ${message}`);
  });
  const decision = await result.getAttribute('data-decision') ?? '';
  check(`${scenarioId} yields its expected observed decision`, decision === expectedDecisions[index]);
  const resultText = await result.innerText();
  check(`${scenarioId} remains unauthorised and unexecuted`, resultText.includes('LOCAL CHECK ONLY') && (await page.getByTestId('scenario-rehearsal').innerText()).includes('NOT_IMPLEMENTED'));
  return { id, decision };
}

async function assertNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  check(`${width}px viewport has no horizontal overflow`, dimensions.document <= dimensions.viewport && dimensions.body <= dimensions.viewport);
}

async function capture(page: Page, name: string): Promise<void> {
  await page.getByTestId('scenario-rehearsal').screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
}

  let videoPath: string | null = null;
let videoMp4Path: string | null = null;
const widthResults: Record<string, unknown>[] = [];
try {
  const staticPrivate = await fetch(`${base}/demo/hacker-house/private/issuer-policy.example.json`);
  const staticPrivateBody = await staticPrivate.text();
  check('server does not publish the server-only private fixture', staticPrivate.status === 404 && !staticPrivateBody.includes('SYNTHETIC_PRIVATE_SERVER_ONLY'));
  const assets = readdirSync('dist/web/assets').filter(name => name.endsWith('.js'));
  const clientBundle = assets.map(name => readFileSync(resolve('dist/web/assets', name), 'utf8')).join('\n');
  check('client bundle excludes private policy and fixture expectation fields', !['maxOrderNotionalQuote', 'expectedObservations', 'privatePolicyFixtureRef'].some(marker => clientBundle.includes(marker)));

  const desktop = await newLocalContext(1440, 960);
  try {
    const page = await desktop.newPage(); instrumentPage(page);
    await openFinancial(page);
    check('S01 operator form labels fixture values and leaves the wallet disconnected', /no wallet/i.test(await page.getByTestId('scenario-rehearsal').innerText()) && /wallet not connected/i.test(await page.getByTestId('financial-wallet-state').innerText()));
    const s01 = await loadAndReplay(page, 0);
    const s01Text = await page.getByTestId('scenario-rehearsal').innerText();
    check('S01 shows 40 × 12 = 480 fixture arithmetic without authorizing execution', s01Text.includes('40 INJ') && s01Text.includes('12 USDT/INJ') && s01Text.includes('480 USDT') && s01Text.includes('WITHIN SYNTHETIC POLICY') && s01Text.includes('NOT AUTHORIZED'));
    await capture(page, '1440-S01-normal-replay');

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('language-en').click();
    check('S01 Business ID survives a reload without persisting its result', await page.getByTestId('scenario-rehearsal').getAttribute('data-business-id') === s01.id && await page.getByTestId('rehearsal-result').count() === 0);
    await page.getByTestId('rehearsal-open-trace').click();
    const s01Trace = page.getByTestId('financial-trace-instrument');
    await s01Trace.waitFor({ state: 'visible' });
    check('S01 request moves from Instrument to existing Consequence and Evidence surfaces',
      await s01Trace.getAttribute('data-object-id') === s01.id &&
      await page.getByTestId('financial-trace-consequence').getAttribute('data-object-id') === s01.id &&
      await page.getByTestId('financial-trace-evidence').getAttribute('data-object-id') === s01.id);
    const s01InstrumentText = await page.getByTestId('financial-trace-instrument').innerText();
    const s01EvidenceText = await page.getByTestId('financial-trace-evidence').innerText();
    check('S01 trace identifies synthetic request provenance', s01InstrumentText.includes('SYNTHETIC_REHEARSAL'));
    check('S01 Evidence surface keeps the rehearsal namespace at NO RECORD', s01EvidenceText.includes('NO RECORD'));
    check('S01 Evidence surface states there is no chain transaction or order receipt', s01EvidenceText.includes('Chain transaction / order receipt') && s01EvidenceText.includes('NONE'));
    await page.getByTestId('nav-financial').click();
    check('S01 Business ID survives navigation into the existing financial workflow', await page.getByTestId('scenario-rehearsal').getAttribute('data-business-id') === s01.id);

    await loadAndReplay(page, 1);
    const s02Text = await page.getByTestId('scenario-rehearsal').innerText();
    check('S02 decision is DENIED', s02Text.includes('DENIED'));
    check('S02 labels the bound as private without returning its value', s02Text.includes('PRIVATE LIMIT NOT DISCLOSED'));
    check('S02 does not display the private USDT ceiling', !s02Text.includes('600 USDT'));
    check('S02 response does not expose its private policy field', !s02Text.includes('maxOrderNotionalQuote'));
    await capture(page, '1440-S02-private-limit-denied');

    const s03 = await loadAndReplay(page, 2);
    const s03Text = await page.getByTestId('scenario-rehearsal').innerText();
    check('S03 preview names both fixture branches, blocks Agent A and preserves independent Agent B', s03Text.includes('intent-A01, intent-A02') && s03Text.includes('intent-B01') && s03Text.includes('Agent A intent branch') && s03Text.includes('BLOCKED') && s03Text.includes('Independent Agent B action') && s03Text.includes('VALID'));
    await capture(page, '1440-S03-revocation-preview');
    await page.getByTestId('rehearsal-open-trace').click();
    const consequence = page.getByTestId('financial-trace-consequence');
    const evidence = page.getByTestId('financial-trace-evidence');
    const instrument = page.getByTestId('financial-trace-instrument');
    const traceIds = await Promise.all([instrument, consequence, evidence].map(surface => surface.getAttribute('data-object-id')));
    const traceRevisions = await Promise.all([instrument, consequence, evidence].map(surface => surface.getAttribute('data-revision')));
    check('S03 exact shared identity is present in Instrument, Consequence and Evidence', traceIds.every(value => value === s03.id) && traceRevisions.every(value => value === '1'));
    check('S03 consequence carries real local graph preview and evidence remains unrecorded',
      (await page.getByTestId('financial-trace-rehearsal-preview').innerText()).includes('Agent A action') &&
      (await page.getByTestId('financial-trace-rehearsal-preview').innerText()).includes('VALID') &&
      (await evidence.innerText()).includes('NO RECORD'));
    await consequence.screenshot({ path: `${output}/1440-S03-consequence-shared-trace.png`, animations: 'disabled' });
    await evidence.screenshot({ path: `${output}/1440-S03-evidence-shared-trace.png`, animations: 'disabled' });

    await page.getByTestId('nav-financial').click();
    for (let index = 3; index < (isolateS08 ? 7 : scenarioIds.length); index += 1) {
      const replayed = await loadAndReplay(page, index);
      const text = await page.getByTestId('scenario-rehearsal').innerText();
      if (index === 3) check('S04 refuses the unverified market before nonce, budget or precompile use', text.includes('MARKET_RISK_UNVERIFIED') && text.includes('Nonce consumed') && text.includes('false'));
      if (index === 4) check('S05 distinguishes a synthetic cancel request from confirmed chain status', text.includes('NOT CONFIRMED') && text.includes('Chain order status') && text.includes('UNKNOWN'));
      if (index === 5) check('S06 rejects the wrong chain without calling the wallet provider', text.includes('DENIED · WRONG CHAIN') && text.includes('Wallet provider called') && text.includes('false'));
      if (index === 6) check('S07 sends no cumulative disclosure requests', text.includes('BLOCKED') && text.includes('Disclosure requests sent') && text.includes('false'));
      if (index === 7) {
        check('S08 verifies the exact public local Groth16 vector but stays blocked without live authority', text.includes('GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP') && text.includes('LOCAL_REPLAY_ONLY_MANDATE_EPOCH_ADVANCED') && text.includes('NO LIVE MANDATE') && text.includes('NOT_VERIFIED_IN_REHEARSAL'));
        check('S08 displays the exact 2 INJ × 1 USDT/INJ local intent and proof digests', text.includes('2 INJ') && text.includes('1 USDT/INJ') && /0x[0-9a-f]{64}/i.test(text));
        check('S08 browser result contains no proof bytes, witness, or private policy', !/pi_a|pi_b|privateWitness|maxNotionalQuote|privatePolicyFixtureRef|issuer-policy\.example/i.test(text));
        check('S08 local preview blocks revoked Agent A, preserves independent Agent B, and records no order', text.includes('Agent A intent branch') && text.includes('BLOCKED') && text.includes('Independent Agent B action') && text.includes('VALID') && text.includes('NOT_SUBMITTED'));
        check('S08 shows the same canonical Request ID and makes no signature, wallet, Gate, or precompile call', text.includes('Canonical request ID') && text.includes(replayed.id) && text.includes('Issuer signature in this replay') && text.includes('false'));
        const financialText = await page.getByTestId('financial-workflow').innerText();
        check('S08 financial hierarchy reports local vector verification while live authority remains unconfigured', financialText.includes('LOCAL TEST VECTOR VERIFIED') && financialText.includes('EXECUTION NOT APPROVED'));
        await capture(page, '1440-S08-proof-not-authority');
        await page.getByTestId('rehearsal-open-trace').click();
        const s08TracePanels = ['instrument', 'consequence', 'evidence'].map(name => page.getByTestId(`financial-trace-${name}`));
        const s08TraceIds = await Promise.all(s08TracePanels.map(panel => panel.getAttribute('data-object-id')));
        check('S08 Request ID remains identical across Instrument, Consequence, and Evidence', s08TraceIds.every(value => value === replayed.id));
        const s08TraceText = await Promise.all(s08TracePanels.map(panel => panel.innerText())).then(values => values.join('\n'));
        check('S08 trace shows local vector verification but keeps live Gate unconfigured without proof bytes', s08TraceText.includes('LOCAL PROOF + GRAPH REPLAY') && s08TraceText.includes('LOCAL TEST VECTOR VERIFIED / LIVE GATE NOT CONFIGURED') && s08TraceText.includes('ActionGate test reference') && !s08TraceText.includes('NOT_VERIFIED / NOT_CONFIGURED') && !/pi_a|pi_b|privateWitness/i.test(s08TraceText));
        await s08TracePanels[1]!.screenshot({ path: `${output}/1440-S08-shared-trace.png`, animations: 'disabled' });
      }
    }
    if (!isolateS08) {
    const tamperedS08 = await desktop.newPage(); instrumentPage(tamperedS08);
    await openFinancial(tamperedS08);
    await tamperedS08.getByTestId('rehearsal-scenario-select').selectOption('S08-proof-is-not-authority');
    await tamperedS08.getByTestId('rehearsal-load').click();
    await tamperedS08.waitForFunction(() => document.querySelector('[data-testid="scenario-rehearsal"]')?.textContent?.includes('S08-proof-is-not-authority') === true);
    await tamperedS08.route(`${base}/api/demo/replay`, async route => {
      const response = await route.fetch();
      const payload = await response.json() as { result: { facts: Record<string, unknown> } };
      payload.result.facts.proofDigest = 'NOT_A_DIGEST';
      await route.fulfill({ response, body: JSON.stringify(payload) });
    });
    await tamperedS08.getByTestId('rehearsal-replay').click();
    const tamperedAlert = tamperedS08.getByRole('alert');
    await tamperedAlert.waitFor({ state: 'visible' });
    check('S08 rejects a replay response with a malformed proof digest', (await tamperedAlert.innerText()).includes('State is UNKNOWN'));
    check('S08 malformed proof response cannot render a verified result or upgrade the financial hierarchy', await tamperedS08.getByTestId('rehearsal-result').count() === 0 && (await tamperedS08.getByTestId('financial-workflow').innerText()).includes('NOT_VERIFIED'));
    }
    await assertNoHorizontalOverflow(page, 1440);
    widthResults.push({ width: 1440, scenarioCount: isolateS08 ? 7 : 8, isolatedScenario: isolateS08 ? 'S08-proof-is-not-authority' : null, checks: checks.length, status: 'PASS' });
  } finally { await desktop.close(); }

  for (const width of [390, 320]) {
    const context = await newLocalContext(width, width === 390 ? 844 : 720);
    try {
      const page = await context.newPage(); instrumentPage(page);
      await openFinancial(page);
      const select = page.getByTestId('rehearsal-scenario-select');
      await select.focus(); await page.keyboard.press('End');
      check(`${width}px scenario picker supports keyboard selection`, await select.inputValue() === scenarioIds[7]);
      const { id } = await loadAndReplay(page, 0);
      const pageText = await page.getByTestId('financial-workflow').innerText();
      check(`${width}px S01 key intent values remain readable`, pageText.includes('40 INJ') && pageText.includes('12 USDT/INJ') && pageText.includes('480 USDT'));
      await assertNoHorizontalOverflow(page, width);
      await capture(page, `${width}-S01-normal-replay`);
      widthResults.push({ width, scenario: 'S01-eligible-request', businessId: id, status: 'PASS' });
    } finally { await context.close(); }
  }

  const policyFiles = await fetch(`${base}/api/demo/scenarios`).then(response => response.json() as Promise<{ scenarios: { scenarioId: string }[] }>);
  check('scenario list reveals exactly the 8 approved synthetic fixtures', policyFiles.scenarios.length === 8 && scenarioIds.every(id => policyFiles.scenarios.some(scenario => scenario.scenarioId === id)));
  const apiMethods = requests.filter(request => request.path.startsWith('/api/'));
  const allowedApi = new Set(['/api/demo/scenarios', '/api/demo/load', '/api/demo/replay', '/api/demo/reset', '/api/state', '/api/preflight']);
  check('browser uses only local state reads, non-mutating preflight and explicit rehearsal endpoints', apiMethods.every(request => allowedApi.has(request.path)));
  check('no wallet, public market, Agent, signature, order or transaction endpoint was requested', !apiMethods.some(request => /wallet|market|agent|signature|order|transaction/i.test(request.path)));
  check('all browser requests stayed on the local app origin', blockedExternalRequests.length === 0);
  check('browser emitted no console or runtime errors', browserErrors.length === 0);

  if (process.env.VEREQO_OP59_SKIP_VIDEO === '1') {
    videoCaptureStatus = 'SKIPPED: video capture excluded from this focused regression run';
  } else if (videoAvailable) {
    const videoContext = await newLocalContext(1440, 900, true);
    const videoPage = await videoContext.newPage(); instrumentPage(videoPage);
    const video = videoPage.video();
    try {
      await openFinancial(videoPage); await wait(4000);
      await loadAndReplay(videoPage, 0); await videoPage.getByTestId('rehearsal-result').scrollIntoViewIfNeeded(); await wait(9000);
      await videoPage.getByTestId('rehearsal-open-trace').click(); await wait(9000);
      await videoPage.getByTestId('nav-financial').click(); await wait(4000);
      await loadAndReplay(videoPage, 1); await videoPage.getByTestId('rehearsal-result').scrollIntoViewIfNeeded(); await wait(9000);
      await loadAndReplay(videoPage, 2); await videoPage.getByTestId('rehearsal-result').scrollIntoViewIfNeeded(); await wait(9000);
      await videoPage.getByTestId('rehearsal-open-trace').click(); await wait(9000);
      await videoPage.getByTestId('nav-financial').click(); await wait(4000);
      for (let index = 3; index < 7; index += 1) { await loadAndReplay(videoPage, index); await videoPage.getByTestId('rehearsal-result').scrollIntoViewIfNeeded(); await wait(5750); }
      await loadAndReplay(videoPage, 7); await videoPage.getByTestId('rehearsal-result').scrollIntoViewIfNeeded(); await wait(8000);
    } finally {
      await videoContext.close();
      if (video) videoPath = await video.path();
    }
    if (videoPath) {
      videoMp4Path = `${output}/operation59-demo-capture.mp4`;
      execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoPath, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoMp4Path]);
      rmSync(videoPath, { force: true });
      rmSync(videoTempDirectory, { recursive: true, force: true });
      videoCaptureStatus = 'PASS: actual local browser walkthrough encoded as H.264 MP4';
      check('browser walkthrough recorded and encoded as a real local MP4', existsSync(videoMp4Path));
    } else {
      videoCaptureStatus = 'SKIPPED: browser did not return a video path';
    }
  } else {
    videoCaptureStatus = 'SKIPPED: local video recorder binary unavailable; screenshot QA remains valid';
  }
} catch (error) {
  runStatus = 'FAIL';
  throw error;
} finally {
  await app.close();
  await browser.close();
  const report = {
    operation: 59,
    scope: `Built VEREQO app; local synthetic rehearsal only; ${isolateS08 ? 'S01-S07 browser flow; S08 is verified by the separate operation-final S08 report' : 'all eight browser scenarios'}; no public Testnet reads, wallet, signing, agent, order, transaction, deployment or external network requests`,
    generatedAt: new Date().toISOString(),
    status: runStatus === 'PASS' && browserErrors.length === 0 && blockedExternalRequests.length === 0 ? 'PASS' : 'FAIL',
    checks,
    checkCount: checks.length,
    widths: widthResults,
    excludedFromThisRun: isolateS08 ? ['S08-proof-is-not-authority; see dedicated isolated S08 browser report'] : [],
    requests,
    responses,
    serverEvents,
    blockedExternalRequests,
    browserErrors,
    screenshots: readdirSync(output).filter(name => name.endsWith('.png')).sort(),
    videoCaptureStatus,
    videoMp4: videoMp4Path,
  };
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
console.log(JSON.stringify({ status: 'PASS', checkCount: checks.length, widths: widthResults, output, videoMp4Path }));
