import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { createLocalApp } from '../services/issuer/src/http';
import type { InjectiveReadAdapter } from '../packages/domain/src/live-injective';

const output = resolve(process.env.VEREQO_OP_FINAL_S08_QA_OUTPUT ?? 'docs/evidence/operation-final/S08_BROWSER_QA');
const chrome = process.env.VEREQO_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(output, { recursive: true, mode: 0o700 });

const checks: string[] = [];
const requests: { method: string; path: string }[] = [];
const responses: { status: number; path: string }[] = [];
const blockedExternalRequests: string[] = [];
const browserErrors: string[] = [];
let failure: string | null = null;

function check(name: string, condition: boolean): void {
  if (!condition) throw new Error(`S08_BROWSER_QA_FAILED:${name}`);
  checks.push(name);
}

function observe(page: Page): void {
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('request', request => requests.push({ method: request.method(), path: new URL(request.url()).pathname }));
  page.on('response', response => responses.push({ status: response.status(), path: new URL(response.url()).pathname }));
}

const injective = { snapshot: async () => { throw new Error('OP_FINAL_S08_NETWORK_DISABLED'); } } as unknown as InjectiveReadAdapter;
const app = createLocalApp({ databasePath: ':memory:', staticRoot: 'dist/web', injective });
const resources: { browser?: Browser; context?: BrowserContext } = {};
let businessId = '';

async function openFinancial(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/#financial`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId('language-en').click();
  await page.getByTestId('financial-workflow').waitFor({ state: 'visible' });
}

async function run(): Promise<void> {
  if (!existsSync('dist/web/index.html')) throw new Error('BUILD_REQUIRED_RUN_NPM_RUN_BUILD_FIRST');
  if (!existsSync(chrome)) throw new Error('INSTALLED_CHROME_NOT_FOUND_SET_VEREQO_CHROME');
  await new Promise<void>(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen));
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('OP_FINAL_S08_LOCAL_SERVER_NOT_STARTED');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-component-update'] });
  resources.browser = browser;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  resources.context = context;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    blockedExternalRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
    return route.abort();
  });

  const page = await context.newPage(); observe(page);
  await openFinancial(page, base);
  check('local app identifies Injective Testnet Chain ID 1439 without connecting the wallet', (await page.getByTestId('financial-workflow').innerText()).includes('INJECTIVE / TESTNET 1439') && (await page.getByTestId('wallet-connection-state').getAttribute('data-state')) === 'disconnected');
  await page.getByTestId('rehearsal-scenario-select').selectOption('S08-proof-is-not-authority');
  await page.getByTestId('rehearsal-load').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="scenario-rehearsal"]')?.textContent?.includes('S08-proof-is-not-authority') === true);
  const rehearsal = page.getByTestId('scenario-rehearsal');
  businessId = await rehearsal.getAttribute('data-business-id') ?? '';
  check('S08 has a deterministic canonical Request ID and revision 1', /^fi_[a-f0-9]{32}$/.test(businessId) && await rehearsal.getAttribute('data-revision') === '1');
  const scenarioTextBefore = await rehearsal.innerText();
  check('S08 exact local fixture is BUY 2 INJ at 1 USDT/INJ for 2 USDT', scenarioTextBefore.includes('2 INJ') && scenarioTextBefore.includes('1 USDT/INJ') && scenarioTextBefore.includes('2 USDT'));
  check('S08 explains the local proof boundary without requesting wallet, signature, live Gate, Testnet write, or order', scenarioTextBefore.includes('pinned public Groth16 test vector') && scenarioTextBefore.includes('No wallet provider') && scenarioTextBefore.includes('live Gate') && scenarioTextBefore.includes('Testnet write'));

  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/demo/replay', { timeout: 20000 });
  await page.getByTestId('rehearsal-replay').click();
  const response = await responsePromise;
  const payload = await response.json() as { result?: Record<string, unknown> };
  const resultBody = payload.result ?? {};
  const facts = resultBody.facts && typeof resultBody.facts === 'object' ? resultBody.facts as Record<string, unknown> : {};
  check('issuer API returns the exact S08 result as BLOCKED with only local untrusted proof verification', response.status() === 200 && resultBody.source === 'LOCAL_GROTH16_TEST_VECTOR' && resultBody.decision === 'BLOCKED' && resultBody.reason === 'LOCAL_REPLAY_ONLY_MANDATE_EPOCH_ADVANCED; LIVE_GATE_NOT_CALLED' && resultBody.proofStatus === 'GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP' && resultBody.authorized === false && resultBody.execution === 'NOT_IMPLEMENTED' && resultBody.evidenceState === 'NO_RECORD');
  check('API binds both digests and credential epochs to the same Request ID', resultBody.businessId === businessId && facts.requestId === businessId && typeof facts.intentDigest === 'string' && /^0x[0-9a-f]{64}$/i.test(facts.intentDigest) && typeof facts.proofDigest === 'string' && /^0x[0-9a-f]{64}$/i.test(facts.proofDigest) && facts.credentialEpochAtIntent === 1 && facts.credentialEpochNow === 2);
  check('API confirms no issuer signature verification, wallet call, precompile call, or order submission', facts.issuerSignatureStatus === 'NOT_VERIFIED_IN_REHEARSAL' && facts.walletProviderCalled === false && facts.precompileCalled === false && facts.orderStatus === 'NOT_SUBMITTED');
  check('API response omits proof points, witness, and server-only policy fields', !/pi_a|pi_b|privateWitness|maxOrderNotionalQuote|privatePolicyFixtureRef|issuer-policy\.example/i.test(JSON.stringify(payload)));

  const result = page.getByTestId('rehearsal-result');
  await result.waitFor({ state: 'visible' });
  const replayText = await rehearsal.innerText();
  check('operator view renders local proof verification while authority remains BLOCKED', replayText.includes('GROTH16_VERIFIED_LOCAL_UNTRUSTED_SETUP') && replayText.includes('LIVE_GATE_NOT_CALLED') && replayText.includes('NO LIVE MANDATE') && replayText.includes('NOT_VERIFIED_IN_REHEARSAL'));
  check('browser view keeps proof bytes, witness, and private policy out of the response', !/pi_a|pi_b|privateWitness|maxOrderNotionalQuote|privatePolicyFixtureRef|issuer-policy\.example/i.test(replayText));
  check('local consequence preview blocks Agent A and preserves independent Agent B', replayText.includes('Agent A intent branch') && replayText.includes('Agent A action') && replayText.includes('Independent Agent B action') && replayText.includes('BLOCKED') && replayText.includes('VALID'));
  check('S08 financial hierarchy marks only the local test vector verified and execution unapproved', (await page.getByTestId('financial-workflow').innerText()).includes('LOCAL TEST VECTOR VERIFIED') && (await page.getByTestId('financial-workflow').innerText()).includes('EXECUTION NOT APPROVED'));
  await rehearsal.screenshot({ path: `${output}/1440-S08-proof-not-authority.png`, animations: 'disabled' });

  await page.getByTestId('rehearsal-open-trace').click();
  const surfaces = ['instrument', 'consequence', 'evidence'].map(name => page.getByTestId(`financial-trace-${name}`));
  const ids = await Promise.all(surfaces.map(surface => surface.getAttribute('data-object-id')));
  check('same S08 Business ID is retained across Instrument, Consequence, and Evidence', ids.every(id => id === businessId));
  const traceText = await Promise.all(surfaces.map(surface => surface.innerText())).then(values => values.join('\n'));
  check('Consequence trace distinguishes verified local vector from unconfigured live Gate', traceText.includes('LOCAL TEST VECTOR VERIFIED / LIVE GATE NOT CONFIGURED') && !traceText.includes('NOT_VERIFIED / NOT_CONFIGURED'));
  check('trace exposes only public digests and Gate test reference, never proof bytes or witness', traceText.includes('ActionGate test reference') && !/pi_a|pi_b|privateWitness/i.test(traceText));
  await surfaces[1]!.screenshot({ path: `${output}/1440-S08-shared-trace.png`, animations: 'disabled' });

  const tamperedPage = await context.newPage(); observe(tamperedPage);
  await openFinancial(tamperedPage, base);
  await tamperedPage.getByTestId('rehearsal-scenario-select').selectOption('S08-proof-is-not-authority');
  await tamperedPage.getByTestId('rehearsal-load').click();
  await tamperedPage.waitForFunction(() => document.querySelector('[data-testid="scenario-rehearsal"]')?.textContent?.includes('S08-proof-is-not-authority') === true);
  await tamperedPage.route(`${base}/api/demo/replay`, async route => {
    const originalFacts = facts;
    const tamperedFacts = { ...originalFacts, proofDigest: 'NOT_A_DIGEST' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ...resultBody, facts: tamperedFacts } }) });
  });
  await tamperedPage.getByTestId('rehearsal-replay').click();
  const alert = tamperedPage.getByRole('alert');
  await alert.waitFor({ state: 'visible' });
  check('client rejects an S08 replay response with a malformed proof digest', (await alert.innerText()).includes('State is UNKNOWN'));
  check('malformed proof response cannot render a verified result or upgrade the hierarchy', await tamperedPage.getByTestId('rehearsal-result').count() === 0 && (await tamperedPage.getByTestId('financial-workflow').innerText()).includes('NOT_VERIFIED'));

  const allowedApi = new Set(['/api/state', '/api/preflight', '/api/demo/load', '/api/demo/replay']);
  const apiPaths = requests.filter(request => request.path.startsWith('/api/')).map(request => request.path);
  check('browser uses only local state, preflight, and S08 rehearsal routes', apiPaths.every(path => allowedApi.has(path)));
  check('no external request, wallet endpoint, market read, signature, order, or transaction call occurs', blockedExternalRequests.length === 0 && !apiPaths.some(path => /wallet|market|signature|order|transaction/i.test(path)));
  check('browser completes without runtime or console errors', browserErrors.length === 0);
}

let status: 'PASS' | 'FAIL' = 'PASS';
try { await run(); }
catch (error) { status = 'FAIL'; failure = String(error); }
finally {
  try { if (resources.context) await resources.context.close(); } catch (error) { status = 'FAIL'; failure ??= `CONTEXT_CLOSE_FAILED:${String(error)}`; }
  try { if (resources.browser) await resources.browser.close(); } catch (error) { status = 'FAIL'; failure ??= `BROWSER_CLOSE_FAILED:${String(error)}`; }
  try { await app.close(); } catch (error) { status = 'FAIL'; failure ??= `APP_CLOSE_FAILED:${String(error)}`; }
  const report = {
    schemaVersion: '1.0.0', operation: 'VEREQO Operation Final · S08 isolated browser QA',
    generatedAt: new Date().toISOString(), status, failure, checkCount: checks.length, checks,
    businessId, viewport: { width: 1440, height: 1000 }, requests, responses,
    blockedExternalRequests, browserErrors,
    screenshots: ['1440-S08-proof-not-authority.png', '1440-S08-shared-trace.png'],
    video: 'NOT_CREATED_BY_SCOPE', wallet: 'NOT_CALLED', testnet: 'NOT_READ_OR_WRITTEN', order: 'NOT_SUBMITTED',
  };
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
console.log(JSON.stringify({ status, checkCount: checks.length, output }));
process.exit(status === 'PASS' ? 0 : 1);
