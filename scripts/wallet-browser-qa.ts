import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { Wallet } from 'ethers';
import { createLocalApp } from '../services/issuer/src/http';

const out = process.env.VEREQO_WALLET_QA_OUTPUT ?? 'docs/evidence/operation-56/wallet-browser';
mkdirSync(out, { recursive: true, mode: 0o700 });
const widths = [1440, 390];
const results: Record<string, unknown>[] = [];
const browser = await chromium.launch({
  ...(process.env.VEREQO_CHROME ? { executablePath: process.env.VEREQO_CHROME } : {}),
  headless: true,
  args: ['--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-component-update']
});

try {
  for (const width of widths) {
    const app = createLocalApp({ databasePath: ':memory:', staticRoot: process.env.VEREQO_STATIC_ROOT ?? 'dist/web' });
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LOCAL_LISTENER');
    const base = 'http://127.0.0.1:' + address.port;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, isMobile: width === 390, hasTouch: width === 390 });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    const requests: { method: string; path: string }[] = [];
    const errors: string[] = [];
    const signingTypes: string[] = [];
    const requestReviewPayloads: { requestId: string; topLevelKeys: string[]; draftKeys: string[]; containsProofOrSignatureField: boolean }[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) requests.push({ method: request.method(), path: url.pathname });
      if (url.pathname === '/api/agent/request-review') {
        const serialized = request.postData() ?? '';
        try {
          const payload = JSON.parse(serialized) as { requestId?: unknown; draft?: Record<string, unknown> };
          requestReviewPayloads.push({
            requestId: String(payload.requestId ?? ''),
            topLevelKeys: Object.keys(payload).sort(),
            draftKeys: Object.keys(payload.draft ?? {}).sort(),
            containsProofOrSignatureField: /"(?:proof|signature)"/i.test(serialized)
          });
        } catch {
          requestReviewPayloads.push({ requestId: '', topLevelKeys: [], draftKeys: [], containsProofOrSignatureField: true });
        }
      }
    });
    const check = (name: string, ok: boolean, checks: string[]) => {
      if (!ok) throw Error(width + 'px: ' + name);
      checks.push(name);
    };
    try {
      const testWallet = Wallet.createRandom();
      const changedWallet = Wallet.createRandom();
      await page.exposeFunction('__vereqoMockSign', async (serialized: string) => {
        const payload = JSON.parse(serialized) as {
          domain: Record<string, unknown>;
          message: Record<string, unknown>;
          primaryType: string;
          types: Record<string, Array<{ name: string; type: string }>>;
        };
        signingTypes.push(payload.primaryType);
        const types = { ...payload.types };
        delete types.EIP712Domain;
        return testWallet.signTypedData(payload.domain, types, payload.message);
      });
      const initScript = [
        '(function(){',
        'const walletAddress=' + JSON.stringify(testWallet.address) + ';',
        'window.__walletMockMethods=[];',
        'const listeners=new Map();',
        'const state={chainId:"0x59f",accounts:[walletAddress],rejectSignature:false,switchAccountOnSign:null};',
        'window.__walletMockState=state;',
        'window.__walletMockEmit=function(event,...args){const listener=listeners.get(event);if(listener)listener(...args);};',
        'const provider={request:async function(args){window.__walletMockMethods.push(args.method);if(args.method==="eth_chainId")return state.chainId;if(args.method==="eth_requestAccounts"||args.method==="eth_accounts")return state.accounts;if(args.method==="eth_signTypedData_v4"){if(state.rejectSignature)throw Error("USER_REJECTED_SIGNATURE");const signature=await window.__vereqoMockSign(String(args.params&&args.params[1]||""));if(state.switchAccountOnSign){state.accounts=[state.switchAccountOnSign];state.switchAccountOnSign=null;}return signature;}throw Error("FORBIDDEN_MOCK_PROVIDER_METHOD");},',
        'on:function(event,listener){listeners.set(event,listener);},',
        'removeListener:function(event){listeners.delete(event);}};',
        'Object.defineProperty(window,"ethereum",{value:provider,configurable:true});',
        '})();'
      ].join('');
      await page.addInitScript(initScript);

      await page.goto(base, { waitUntil: 'networkidle' });
      await page.getByTestId('language-en').click();
      await page.getByTestId('start-financial').click();
      await page.getByTestId('financial-workflow').waitFor({ state: 'visible' });
      const checks: string[] = [];
      check('wallet is not queried before explicit action', requests.every(item => !item.path.startsWith('/api/wallet/')), checks);
      check('draft review action is disabled before owner authentication', await page.getByTestId('financial-request-review').isDisabled(), checks);
      const intentReview = page.getByTestId('financial-intent-review');
      await intentReview.locator('summary').click();
      const intentReviewText = await intentReview.innerText();
      check('read-only Intent view exposes missing Gate, issuer, nonce and expiry bindings', await page.getByTestId('financial-intent-sign').isDisabled() && ['Verifying contract / order sender', 'Issuer / Agent', 'Nonce / deadline', 'NOT_CONFIGURED'].every(value => intentReviewText.includes(value)), checks);
      const initialProviderMethods = await page.evaluate(() => (window as unknown as { __walletMockMethods: string[] }).__walletMockMethods);
      check('opening Intent review performs no wallet signature', !initialProviderMethods.includes('eth_signTypedData_v4'), checks);
      await intentReview.locator('summary').click();

      await page.evaluate(() => {
        (window as unknown as { __walletMockState: { chainId: string } }).__walletMockState.chainId = '0x1';
      });
      await page.getByTestId('financial-connect').click();
      await page.getByRole('alert').waitFor({ state: 'visible' });
      check('wrong chain is rejected before backend auth or signing', signingTypes.length === 0 && !requests.some(item => item.path.startsWith('/api/wallet/')), checks);
      await page.evaluate(() => {
        (window as unknown as { __walletMockState: { chainId: string } }).__walletMockState.chainId = '0x59f';
      });
      await page.getByTestId('financial-connect').click();
      await page.locator('.financialWallet').filter({ hasText: testWallet.address }).waitFor({ state: 'visible' });
      check('explicit connect requests a Testnet account', (await page.evaluate('window.__walletMockMethods') as string[]).includes('eth_requestAccounts'), checks);
      check('connection is labelled unauthenticated before message signature', await page.getByTestId('wallet-ownership-state').getAttribute('data-state') === 'unauthenticated', checks);
      await page.getByTestId('wallet-auth-prepare').click();
      await page.getByTestId('wallet-auth-challenge').waitFor({ state: 'visible' });
      const issuedAt = Date.parse(await page.getByTestId('wallet-challenge-issued').getAttribute('datetime') ?? '');
      const expiresAt = Date.parse(await page.getByTestId('wallet-challenge-expires').getAttribute('datetime') ?? '');
      const initialNonce = await page.getByTestId('wallet-challenge-nonce').innerText();
      check('server challenge binds wallet, exact page Origin, Testnet chain and at most 120 seconds',
        await page.getByTestId('wallet-challenge-address').innerText() === testWallet.address &&
        await page.getByTestId('wallet-challenge-origin').innerText() === base &&
        await page.getByTestId('wallet-challenge-chain').innerText() === '1439' &&
        Number.isFinite(issuedAt) && Number.isFinite(expiresAt) && expiresAt > Date.now() && expiresAt - issuedAt <= 120_000 &&
        /^0x[0-9a-fA-F]{64}$/.test(initialNonce), checks);
      check('challenge preparation makes no signature request', signingTypes.length === 0, checks);

      await page.evaluate(() => {
        (window as unknown as { __walletMockState: { rejectSignature: boolean } }).__walletMockState.rejectSignature = true;
      });
      await page.getByRole('button', { name: 'Sign authentication only' }).click();
      await page.getByRole('alert').waitFor({ state: 'visible' });
      check('user signature rejection creates no authenticated session', requests.some(item => item.path === '/api/wallet/challenge') && !requests.some(item => item.path === '/api/wallet/verify') && await page.getByTestId('wallet-ownership-state').getAttribute('data-state') === 'unauthenticated', checks);
      await page.getByTestId('wallet-auth-prepare').click();
      await page.getByTestId('wallet-auth-challenge').waitFor({ state: 'visible' });
      const retryNonce = await page.getByTestId('wallet-challenge-nonce').innerText();
      check('retry after provider rejection prepares a fresh challenge', /^0x[0-9a-fA-F]{64}$/.test(retryNonce) && retryNonce !== initialNonce, checks);

      await page.evaluate((newAddress) => {
        const state = (window as unknown as { __walletMockState: { rejectSignature: boolean; switchAccountOnSign: string | null } }).__walletMockState;
        state.rejectSignature = false;
        state.switchAccountOnSign = newAddress;
      }, changedWallet.address);
      await page.getByRole('button', { name: 'Sign authentication only' }).click();
      await page.getByRole('alert').waitFor({ state: 'hidden' });
      await page.getByRole('alert').waitFor({ state: 'visible' });
      const afterSwitch = await page.locator('.financialWallet').innerText();
      check('account change after signature revokes issued session and shows unauthenticated state', requests.some(item => item.method === 'POST' && item.path === '/api/wallet/verify') && requests.some(item => item.method === 'POST' && item.path === '/api/wallet/logout') && await page.getByTestId('wallet-ownership-state').getAttribute('data-state') === 'unauthenticated' && !afterSwitch.includes(testWallet.address), checks);

      await page.evaluate((address) => {
        (window as unknown as { __walletMockState: { accounts: string[] } }).__walletMockState.accounts = [address];
      }, testWallet.address);
      await page.getByTestId('financial-connect').click();
      await page.locator('.financialWallet').filter({ hasText: testWallet.address }).waitFor({ state: 'visible' });
      await page.getByTestId('wallet-auth-prepare').click();
      await page.getByTestId('wallet-auth-challenge').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Sign authentication only' }).click();
      await page.locator('[data-testid="wallet-ownership-state"][data-state="authenticated"]').waitFor({ state: 'visible' });
      await page.locator('[data-testid="execution-authorization-state"][data-state="not-authorized"]').waitFor({ state: 'visible' });
      const ownershipState = await page.getByTestId('wallet-ownership-state').getAttribute('data-state');
      const executionState = await page.getByTestId('execution-authorization-state').getAttribute('data-state');
      check('authentication session is labelled as no execution approval', ownershipState === 'authenticated' && executionState === 'not-authorized', checks);
      const serverSession = page.getByTestId('wallet-server-session');
      const sessionExpirySeconds = Number(await serverSession.getAttribute('data-expires-at'));
      const sessionExpiry = sessionExpirySeconds * 1000;
      const sessionNow = Date.now();
      check('synthetic server session element is visible', await serverSession.isVisible(), checks);
      check('synthetic server session identifies the test Wallet', (await serverSession.innerText()).includes(testWallet.address), checks);
      check('synthetic server session binds the exact page Origin', await serverSession.getAttribute('data-origin') === base, checks);
      check('synthetic server session expiry is a future Unix timestamp no more than ten minutes away',
        Number.isFinite(sessionExpirySeconds) && sessionExpiry > sessionNow && sessionExpiry - sessionNow <= 600_000, checks);
      check('only the WalletAuthentication EIP-712 type was signed', signingTypes.length === 2 && signingTypes.every(type => type === 'WalletAuthentication'), checks);
      check('draft review action becomes available only after authenticated ownership', await page.getByTestId('financial-request-review').isEnabled(), checks);
      await page.getByTestId('financial-wallet-state').screenshot({ path: out + '/' + width + '-wallet-state-synthetic.jpg', type: 'jpeg', quality: 90 });
      await serverSession.screenshot({ path: out + '/' + width + '-wallet-session-synthetic.jpg', type: 'jpeg', quality: 90 });
      await page.getByTestId('financial-request-review').scrollIntoViewIfNeeded();
      await page.screenshot({ path: out + '/' + width + '-draft-review-ready-synthetic.jpg', type: 'jpeg', quality: 85, fullPage: true });
      await page.screenshot({ path: out + '/' + width + '-draft-review-ready-synthetic-viewport.jpg', type: 'jpeg', quality: 85 });
      await page.screenshot({ path: out + '/' + width + '-wallet-authenticated-synthetic.jpg', type: 'jpeg', quality: 90 });
      const signingCountBeforeDraftReview = signingTypes.length;
      await page.getByTestId('financial-request-review').click();
      await page.getByTestId('financial-evidence-status').getByText('REJECTED', { exact: false }).waitFor({ state: 'visible' });
      const reviewedBusinessId = await page.getByTestId('financial-business-id').innerText();
      const reviewPayload = requestReviewPayloads[0];
      check('unsigned draft denial POST uses the displayed Business ID and exact data-only fields', requests.some(item => item.method === 'POST' && item.path === '/api/agent/request-review') && reviewPayload?.requestId === reviewedBusinessId && reviewPayload.topLevelKeys.join(',') === 'draft,requestId' && reviewPayload.draftKeys.join(',') === 'chainId,marketId,marketKind,orderType,price,quantity,side' && !reviewPayload.containsProofOrSignatureField, checks);
      check('draft review adds no wallet signing request', signingTypes.length === signingCountBeforeDraftReview, checks);
      check('browser shows durable rejection and no execution state', (await page.getByTestId('financial-evidence-status').innerText()).includes('EXECUTION NOT_IMPLEMENTED') && (await page.getByTestId('financial-evidence-status').innerText()).includes('REJECTED'), checks);
      await page.screenshot({ path: out + '/' + width + '-draft-review-rejected-synthetic.jpg', type: 'jpeg', quality: 90, fullPage: true });
      const methods = await page.evaluate(() => (window as unknown as { __walletMockMethods: string[] }).__walletMockMethods);
      check('provider never received transaction or broad-sign methods', !methods.some(method => ['eth_sendTransaction', 'eth_signTransaction', 'personal_sign', 'wallet_sendCalls'].includes(method)), checks);
      check('challenge, verify, and session status used local HTTP routes', ['POST /api/wallet/challenge', 'POST /api/wallet/verify', 'GET /api/wallet/status'].every(expected => requests.some(item => item.method + ' ' + item.path === expected)), checks);
      check('Agent proposal, financial authorization, and order routes were not called', !requests.some(item => ['/api/agent/propose', '/api/agent/authorize', '/api/financial/order'].includes(item.path)), checks);
      await page.getByTestId('financial-evidence').click();
      const businessId = await page.getByTestId('financial-business-id').innerText();
      const businessPanel = page.getByTestId('financial-business-evidence');
      check('draft and evidence view share the same per-draft Business ID', await businessPanel.getAttribute('data-business-id') === businessId && businessId.startsWith('fi_'), checks);
      await page.getByTestId('financial-read-evidence').click();
      await page.getByTestId('financial-evidence-status').getByText('REJECTED', { exact: false }).waitFor({ state: 'visible' });
      check('owner-scoped evidence GET uses the same request ID and preserves only the denial record', requests.some(item => item.method === 'GET' && item.path === '/api/agent/authorization/' + businessId) && (await page.getByTestId('financial-evidence-status').innerText()).includes('EXECUTION NOT_IMPLEMENTED') && (await page.getByTestId('financial-evidence-status').innerText()).includes('REJECTED'), checks);
      check('Business ID evidence view has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), checks);
      await page.screenshot({ path: out + '/' + width + '-business-evidence-synthetic.jpg', type: 'jpeg', quality: 85, fullPage: true });

      await page.getByRole('button', { name: 'Disconnect' }).click();
      await page.locator('[data-testid="wallet-ownership-state"][data-state="unauthenticated"]').waitFor({ state: 'visible' });
      check('disconnect clears local ownership state', await page.getByTestId('wallet-connection-state').getAttribute('data-state') === 'disconnected' && await page.getByTestId('wallet-ownership-state').getAttribute('data-state') === 'unauthenticated', checks);
      check('disconnect revokes the local session', requests.some(item => item.method === 'POST' && item.path === '/api/wallet/logout'), checks);
      check('no browser runtime errors', errors.length === 0, checks);
      results.push({ width, checks, signingTypes, requestReviewPayloads, methods, requests, errors, status: 'PASS', boundary: 'synthetic ephemeral wallet; wallet authentication message only; unsigned draft rejection; no Intent signature or transaction' });
    } catch (error) {
      results.push({ width, status: 'FAIL', error: String(error), signingTypes, requestReviewPayloads, requests, errors });
      const challengeNonce = page.getByTestId('wallet-challenge-nonce');
      if (await challengeNonce.count()) await challengeNonce.evaluate(element => { element.textContent = 'TEST NONCE REDACTED FROM SCREENSHOT'; });
      await page.screenshot({ path: out + '/' + width + '-wallet-failure-synthetic.jpg', type: 'jpeg', quality: 80, fullPage: true });
      throw error;
    } finally {
      await context.close();
      await app.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(out + '/report.json', JSON.stringify({
    scope: 'Synthetic ephemeral EIP-712 wallet authentication only; no real wallet, Intent signature, financial approval, transaction, or order',
    results
  }, null, 2) + '\n');
}
console.log(JSON.stringify({ widths: results.length, checks: results.reduce((sum, result) => sum + ((result.checks as string[] | undefined)?.length ?? 0), 0), out }));
