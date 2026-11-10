import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { Wallet } from 'ethers';
import { createLocalApp } from '../services/issuer/src/http';

const out = 'docs/evidence/operation-58/financial-trace';
mkdirSync(out, { recursive: true, mode: 0o700 });
const widths = [1440, 390, 320];
const results: Record<string, unknown>[] = [];
const browser = await chromium.launch({
  ...(process.env.VEREQO_CHROME ? { executablePath: process.env.VEREQO_CHROME } : {}),
  headless: true,
  args: ['--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-component-update']
});

try {
  for (const width of widths) {
    const app = createLocalApp({ databasePath: ':memory:' });
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LOCAL_LISTENER');
    const base = `http://127.0.0.1:${address.port}`;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, isMobile: width === 390, hasTouch: width === 390 });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    const requests: { method: string; path: string }[] = [];
    const errors: string[] = [];
    const httpFailures: { status: number; path: string }[] = [];
    const signingTypes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404 (Not Found)') && !message.text().includes('503')) errors.push(message.text()); });
    page.on('response', response => {
      const url = new URL(response.url());
      const expectedNoRecord = response.status() === 404 && response.request().method() === 'GET' && url.pathname.startsWith('/api/agent/authorization/');
      if (response.status() >= 400 && !expectedNoRecord) httpFailures.push({ status: response.status(), path: url.pathname });
    });
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) requests.push({ method: request.method(), path: url.pathname });
    });
    const check = (name: string, ok: boolean, checks: string[]) => {
      if (!ok) throw Error(`${width}px: ${name}`);
      checks.push(name);
    };
    const capture = (name: string) => page.screenshot({ path: `${out}/${width}-${name}.jpg`, type: 'jpeg', quality: 90, fullPage: true });
    const readHistoryMark = async () => {
      const response = await page.request.get(`${base}/api/state`);
      if (!response.ok()) throw Error(`STATE_READ_${response.status()}`);
      const state = await response.json() as {
        disclosure: { history: Array<{ sequence: number }> };
        graph: { sequence: number; events: Array<{ sequence: number }> };
      };
      return {
        disclosureSequence: state.disclosure.history.at(-1)?.sequence ?? 0,
        disclosureCount: state.disclosure.history.length,
        graphSequence: state.graph.sequence,
        graphEventCount: state.graph.events.length
      };
    };

    try {
      const testWallet = Wallet.createRandom();
      await page.exposeFunction('__vereqoMockSign', async (serialized: string) => {
        const payload = JSON.parse(serialized) as {
          domain: Record<string, unknown>;
          message: Record<string, unknown>;
          primaryType: string;
          types: Record<string, Array<{ name: string; type: string }>>;
        };
        signingTypes.push(payload.primaryType);
        if (payload.primaryType !== 'WalletAuthentication') throw Error('UNEXPECTED_SIGNATURE_TYPE');
        const types = { ...payload.types };
        delete types.EIP712Domain;
        return testWallet.signTypedData(payload.domain, types, payload.message);
      });
      await page.addInitScript([
        '(function(){',
        'const walletAddress=' + JSON.stringify(testWallet.address) + ';',
        'window.__walletMockMethods=[];',
        'const listeners=new Map();',
        'const provider={request:async function(args){window.__walletMockMethods.push(args.method);if(args.method==="eth_chainId")return "0x59f";if(args.method==="eth_requestAccounts"||args.method==="eth_accounts")return [walletAddress];if(args.method==="eth_signTypedData_v4")return await window.__vereqoMockSign(String(args.params&&args.params[1]||""));throw Error("FORBIDDEN_MOCK_PROVIDER_METHOD");},',
        'on:function(event,listener){listeners.set(event,listener);},',
        'removeListener:function(event){listeners.delete(event);}};',
        'Object.defineProperty(window,"ethereum",{value:provider,configurable:true});',
        '})();'
      ].join(''));

      await page.goto(base, { waitUntil: 'networkidle' });
      await page.getByTestId('language-en').click();
      await page.getByTestId('start-financial').click();
      await page.getByTestId('financial-workflow').waitFor({ state: 'visible' });
      const checks: string[] = [];
      check('no wallet request is made before an explicit user action', (await page.evaluate(() => (window as unknown as { __walletMockMethods: string[] }).__walletMockMethods)).length === 0, checks);

      await page.getByTestId('financial-connect').click();
      await page.getByRole('button', { name: 'Sign authentication only' }).click();
      await page.getByText('Ownership authenticated; execution not approved').waitFor({ state: 'visible' });
      check('only the synthetic owner-authentication typed message is signed', signingTypes.length === 1 && signingTypes[0] === 'WalletAuthentication', checks);
      const historyBeforeWhatIf = await readHistoryMark();

      await page.locator('#financial-tab-3').click();
      const requestCountBeforeWhatIf = requests.length;
      await page.locator('[data-testid="financial-workflow"] input[type="checkbox"]').click();
      const historyAfterWhatIf = await readHistoryMark();
      check('WHAT-IF changes local inspection state only', await page.getByTestId('financial-workflow').getAttribute('data-hypothetical') === 'true' && requests.length === requestCountBeforeWhatIf && JSON.stringify(historyAfterWhatIf) === JSON.stringify(historyBeforeWhatIf), checks);

      await page.locator('#financial-tab-5').click();
      const businessId = await page.getByTestId('financial-business-id').innerText();
      await page.getByTestId('financial-read-evidence').click();
      await page.getByText('NO_AUTHORIZATION_EVIDENCE_FOR_THIS_ID').waitFor({ state: 'visible' });
      check('Evidence Inspector receives an owner-authenticated NO_RECORD response for the exact ID', requests.some(item => item.method === 'GET' && item.path === `/api/agent/authorization/${businessId}`), checks);

      const financialWritesBeforeNavigation = requests.filter(item => item.method === 'POST' && /^\/api\/(agent\/(request-review|propose)|financial\/)/.test(item.path));
      await page.getByTestId('financial-open-trace').click();
      for (const surface of ['instrument', 'consequence', 'evidence']) await page.getByTestId(`financial-trace-${surface}`).waitFor({ state: 'visible' });
      const historyAfterNavigation = await readHistoryMark();
      const traces = await page.locator('.financialObjectTrace').evaluateAll(elements => elements.map(element => ({
        objectId: element.getAttribute('data-object-id'),
        revision: element.getAttribute('data-revision'),
        surface: element.getAttribute('data-surface')
      })));
      check('all three views carry the exact same Business ID and object revision', traces.length === 3 && traces.every(item => item.objectId === businessId && item.revision === traces[0]?.revision), checks);
      check('Consequence keeps missing financial dependencies separate from the synthetic project map', await page.getByTestId('financial-trace-rules').innerText().then(value => value.includes('NO CONFIGURED FINANCIAL GRAPH') && value.includes('not committed graph events')), checks);
      check('Evidence Inspector preserves NO_RECORD and no chain receipt', await page.getByTestId('financial-trace-evidence-state').innerText().then(value => value.includes('NO RECORD') && value.includes('Chain transaction / order receipt: NONE')), checks);
      check('WHAT-IF remains visibly local and does not commit a financial action', await page.getByTestId('financial-trace-consequence').innerText().then(value => value.includes('LOCAL WHAT-IF') && value.includes('no financial action is changed')), checks);
      const financialWritesAfterNavigation = requests.filter(item => item.method === 'POST' && /^\/api\/(agent\/(request-review|propose)|financial\/)/.test(item.path));
      check('navigation does not create a financial, Agent-proposal, or order write', JSON.stringify(financialWritesAfterNavigation) === JSON.stringify(financialWritesBeforeNavigation) && financialWritesAfterNavigation.length === 0, checks);
      check('public Consequence graph and disclosure history remain unchanged', JSON.stringify(historyAfterNavigation) === JSON.stringify(historyAfterWhatIf), checks);
      check('no transaction-signing provider method is called', !(await page.evaluate(() => (window as unknown as { __walletMockMethods: string[] }).__walletMockMethods)).includes('eth_sendTransaction'), checks);
      check('the explicit evidence NO_RECORD 404 is the only handled HTTP error', httpFailures.length === 0, checks);
      check('page has no horizontal overflow at this viewport', await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth), checks);
      check('no browser runtime errors', errors.length === 0, checks);
      await capture('financial-object-trace');
      results.push({ width, checks, traces, requests, signingTypes, errors, httpFailures, historyBeforeWhatIf, historyAfterWhatIf, historyAfterNavigation, status: 'PASS' });
    } catch (error) {
      results.push({ width, requests, signingTypes, errors, httpFailures, status: 'FAIL', error: String(error) });
      await capture('financial-object-trace-failure');
      throw error;
    } finally {
      await context.close();
      await app.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify({
    scope: 'Operation 58 T10.2A local Chromium flow; synthetic wallet authentication only; owner-scoped evidence GET; no Agent proposal, financial order, transaction or external network access',
    widths,
    results
  }, null, 2) + '\n');
}

console.log(JSON.stringify({ widths: results.length, checks: results.reduce((sum, result) => sum + (result.checks as string[]).length, 0), out }));
