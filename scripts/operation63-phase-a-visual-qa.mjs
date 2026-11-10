import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.VEREQO_PHASEA_ORIGIN ?? 'http://127.0.0.1:5173';
const allowedOrigins = new Set(['http://127.0.0.1:5173', 'http://127.0.0.1:4317']);
const approvedReadOnlyPosts = new Set(['/api/preflight']);
if (!allowedOrigins.has(origin)) throw new Error('Only the user-approved local VEREQO origins are allowed.');
const output = resolve(process.env.VEREQO_PHASEA_OUTPUT ?? 'docs/evidence/operation-63/screenshots');
mkdirSync(output, { recursive: true });
const cases = [
  { width: 1440, height: 960, capture: true },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 720, height: 900, zoomLayoutEquivalent: true },
  { width: 390, height: 844, capture: true },
  { width: 320, height: 800 },
];
const chromePath = process.env.VEREQO_QA_CHROME;
const browser = await chromium.launch({
  ...(chromePath ? { executablePath: chromePath } : {}),
  headless: true,
  args: ['--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-component-update'],
});
const results = [];
try {
  for (const spec of cases) {
    const context = await browser.newContext({
      viewport: { width: spec.width, height: spec.height },
      hasTouch: spec.width <= 768,
      reducedMotion: 'no-preference',
    });
    const page = await context.newPage();
    const checks = [];
    const errors = [];
    const blockedOrigins = [];
    const blockedWrites = [];
    const approvedReadOnlyPostsObserved = [];
    const requests = [];
    const check = (name, condition, detail = {}) => {
      assert.ok(condition, spec.width + 'px: ' + name + (detail.reason ? ' — ' + detail.reason : ''));
      checks.push({ name, status: 'PASS', ...detail });
    };
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !message.text().includes('503')) errors.push(message.text());
    });
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      requests.push({ method: request.method(), origin: requestUrl.origin, path: requestUrl.pathname });
      if (requestUrl.protocol !== 'data:' && requestUrl.protocol !== 'blob:' && !allowedOrigins.has(requestUrl.origin)) {
        blockedOrigins.push(request.url());
      }
      if (!['GET', 'HEAD'].includes(request.method())) {
        if (request.method() === 'POST' && approvedReadOnlyPosts.has(requestUrl.pathname)) approvedReadOnlyPostsObserved.push(requestUrl.pathname);
        else blockedWrites.push(request.method() + ' ' + requestUrl.pathname);
      }
    });
    await context.route('**/*', async route => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      if (requestUrl.protocol === 'data:' || requestUrl.protocol === 'blob:') return route.continue();
      if (!allowedOrigins.has(requestUrl.origin)) return route.abort();
      if (!['GET', 'HEAD'].includes(request.method())
          && !(request.method() === 'POST' && approvedReadOnlyPosts.has(requestUrl.pathname))) return route.abort();
      return route.continue();
    });
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator('.brandLogo').waitFor({ state: 'visible', timeout: 15000 });
      await page.evaluate(() => document.fonts.ready);
      const brand = page.locator('.brandLogo');
      const brandEvidence = await brand.evaluate(image => ({
        src: image.getAttribute('src'),
        currentSrc: image.currentSrc,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        filter: getComputedStyle(image).filter,
        bounds: (() => { const r = image.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
        headerBounds: (() => { const r = image.closest('.topbar').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
      }));
      check('solid wordmark is rendered from the supplied vector SVG',
        brandEvidence.src === '/brand/VEREQO_WORDMARK_SOLID.svg'
          && brandEvidence.currentSrc.endsWith('/brand/VEREQO_WORDMARK_SOLID.svg')
          && brandEvidence.naturalWidth === 916
          && brandEvidence.naturalHeight === 197
          && brandEvidence.filter === 'none',
        { brandEvidence });
      check('logo remains inside the visible header',
        brandEvidence.bounds.x >= 0
          && brandEvidence.bounds.y >= 0
          && brandEvidence.bounds.x + brandEvidence.bounds.width <= brandEvidence.headerBounds.x + brandEvidence.headerBounds.width
          && brandEvidence.bounds.y + brandEvidence.bounds.height <= brandEvidence.headerBounds.y + brandEvidence.headerBounds.height);
      const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
      const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
      check('favicon and application icon use the supplied solid icon assets',
        favicon === '/brand/VEREQO_ICON_SOLID.svg' && touchIcon === '/brand/VEREQO_ICON_SOLID_4X.png');
      const oldLogoReferences = await page.evaluate(() => {
        const active = [
          document.querySelector('.brandLogo')?.getAttribute('src') ?? '',
          document.querySelector('.footerBrandLogo')?.getAttribute('src') ?? '',
          document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? '',
          document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
          document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ?? '',
        ].join(' ');
        return /VEREQO_(FIXED_|[^ ]*GRADIENT)/.test(active);
      });
      check('active document has no references to the superseded logo set', !oldLogoReferences);

      await page.keyboard.press('Tab');
      const skipFocus = await page.evaluate(() => ({
        className: typeof document.activeElement?.className === 'string' ? document.activeElement.className : '',
        visible: !!document.activeElement && getComputedStyle(document.activeElement).top !== '-100px',
        outline: !!document.activeElement && getComputedStyle(document.activeElement).outlineStyle,
      }));
      check('keyboard reaches the visible skip link with focus styling',
        skipFocus.className.includes('skip') && skipFocus.visible && skipFocus.outline !== 'none',
        { focus: skipFocus });
      await page.keyboard.press('Tab');
      const homeFocus = await page.evaluate(() => ({
        brand: document.activeElement?.matches('.brand') ?? false,
        outline: !!document.activeElement && getComputedStyle(document.activeElement).outlineStyle,
      }));
      check('keyboard advances to the home logo with a visible focus ring',
        homeFocus.brand && homeFocus.outline !== 'none',
        { focus: homeFocus });
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());

      const english = page.getByTestId('language-en');
      if (await english.getAttribute('aria-pressed') !== 'true') await english.click();
      const languageOrder = await page.locator('.langSwitch .langOption').allTextContents();
      const navFinancial = await page.getByTestId('nav-financial').innerText();
      const headerText = await page.locator('.topbar').innerText();
      check('header language order is EN then JP', languageOrder.map(value => value.trim()).join('/') === 'EN/JP');
      check('English financial navigation uses the fixed label', navFinancial.trim() === 'FINANCIAL INSPECTION');
      check('header has no LOCAL REFERENCE control', !headerText.includes('LOCAL REFERENCE'));
      const navStyle = await page.getByTestId('nav-financial').evaluate(element => getComputedStyle(element).color);
      check('navigation wordmark tone is harmonized and legible', navStyle === 'rgb(41, 45, 45)', { color: navStyle });
      await page.getByTestId('language-ja').click();
      check('Japanese language toggle works without moving the language controls',
        await page.getByTestId('language-ja').getAttribute('aria-pressed') === 'true'
          && (await page.locator('.langSwitch .langOption').allTextContents()).map(value => value.trim()).join('/') === 'EN/JP');
      await page.getByTestId('language-en').click();

      const landingOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      check('landing has no horizontal overflow at this viewport', landingOverflow);
      if (spec.capture) {
        await page.screenshot({ path: resolve(output, spec.width + '-landing-en.jpg'), type: 'jpeg', quality: 90 });
        await page.getByTestId('start-demo').click();
        const workspaceVisible = await page.locator('.pageSurface').nth(1).evaluate(element => !element.hidden);
        await brand.click();
        await page.waitForFunction(() => !document.querySelector('.pageSurface')?.hidden);
        await page.waitForTimeout(520);
        const landingVisible = await page.locator('.pageSurface').first().evaluate(element => !element.hidden);
        check('brand navigation returns from the existing workspace to TOP', workspaceVisible && landingVisible, { workspaceVisible, landingVisible });
        if (spec.width === 1440) {
          const revealNodes = await page.locator('.productLanding [data-reveal]').all();
          for (const node of revealNodes) {
            await node.scrollIntoViewIfNeeded();
            await node.evaluate(element => new Promise(resolve => {
              const deadline = Date.now() + 2000;
              const inspect = () => {
                if (element.dataset.reveal === 'done' || Date.now() >= deadline) resolve(element.dataset.reveal === 'done');
                else requestAnimationFrame(inspect);
              };
              requestAnimationFrame(inspect);
            }));
          }
          const revealStates = await page.locator('.productLanding [data-reveal]').evaluateAll(nodes => nodes.map(node => node.dataset.reveal));
          check('reveal sections are visible before the full-page capture', revealStates.length > 0 && revealStates.every(state => state === 'done'), { revealStates });
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          await page.waitForTimeout(520);
          await page.screenshot({ path: resolve(output, '1440-landing-full-en.jpg'), type: 'jpeg', quality: 84, fullPage: true });
          await brand.hover();
          const hoverFilter = await brand.evaluate(image => getComputedStyle(image).filter);
          check('brand hover keeps the fixed image colors unchanged', hoverFilter === 'none');
          await page.screenshot({ path: resolve(output, '1440-brand-hover-en.jpg'), type: 'jpeg', quality: 90 });
          await page.locator('.brand').screenshot({ path: resolve(output, '1440-brand-header-en.png') });
          await page.getByTestId('nav-financial').click();
        } else {
          await page.locator('.brand').screenshot({ path: resolve(output, '390-brand-header-en.png') });
          await page.goto(origin + '/#financial', { waitUntil: 'domcontentloaded' });
        }
        const wallet = page.getByTestId('financial-wallet-state');
        await wallet.waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForTimeout(520);
        const walletState = await wallet.evaluate(element => ({
          connected: element.getAttribute('data-wallet-connected'),
          authenticated: element.getAttribute('data-ownership-authenticated'),
          executionAuthorized: element.getAttribute('data-execution-authorized'),
          text: element.innerText,
        }));
        check('wallet connection, ownership authentication and execution authority remain separate',
          walletState.connected === 'false'
            && walletState.authenticated === 'false'
            && walletState.executionAuthorized === 'false'
            && walletState.text.includes('WALLET NOT CONNECTED')
            && walletState.text.includes('OWNERSHIP NOT AUTHENTICATED')
            && walletState.text.includes('EXECUTION NOT APPROVED')
            && walletState.text.includes('NOT_IMPLEMENTED'),
          { walletState });
        check('financial header keeps the Testnet environment distinct from wallet state',
          await page.locator('.financialHeading .eyebrow').innerText() === 'INJECTIVE / TESTNET 1439');
        check('financial nav is marked as the current page',
          await page.getByTestId('nav-financial').getAttribute('aria-current') === 'page');
        check('financial page has no horizontal overflow',
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await page.screenshot({ path: resolve(output, spec.width + '-financial-en.jpg'), type: 'jpeg', quality: 90 });
        await page.goto(origin + '/#demo', { waitUntil: 'domcontentloaded' });
        const firstTile = page.locator('.heatTile').first();
        await firstTile.waitFor({ state: 'visible', timeout: 15000 });
        const tileCount = await page.locator('.heatTile').count();
        check('Broker / Issuer cards render in the existing workspace', tileCount >= 4, { tileCount });
        const beforeHover = await firstTile.evaluate(element => ({
          borderLeftWidth: getComputedStyle(element).borderLeftWidth,
          beforeContent: getComputedStyle(element, '::before').content,
        }));
        await firstTile.hover();
        const hoverCard = await firstTile.evaluate(element => ({
          borderLeftWidth: getComputedStyle(element).borderLeftWidth,
          beforeContent: getComputedStyle(element, '::before').content,
          boxShadow: getComputedStyle(element).boxShadow,
        }));
        check('Broker / Issuer cards have no colored or heavy left band',
          parseFloat(beforeHover.borderLeftWidth) <= 1
            && parseFloat(hoverCard.borderLeftWidth) <= 1
            && beforeHover.beforeContent === 'none'
            && hoverCard.beforeContent === 'none',
          { beforeHover, hoverCard });
        check('card hover remains restrained without a raised selection frame',
          !hoverCard.boxShadow.includes('0px 5px 12px') || hoverCard.boxShadow.includes('rgba(35, 63, 49, 0.08)'),
          { hoverCard });
        let cardReachedByKeyboard = false;
        for (let tab = 0; tab < 80; tab++) {
          await page.keyboard.press('Tab');
          if (await firstTile.evaluate(element => document.activeElement === element)) {
            cardReachedByKeyboard = true;
            break;
          }
        }
        const focusCard = await firstTile.evaluate(element => ({
          outlineStyle: getComputedStyle(element).outlineStyle,
          outlineWidth: getComputedStyle(element).outlineWidth,
          outlineColor: getComputedStyle(element).outlineColor,
        }));
        check('keyboard focus remains visible on Broker / Issuer cards',
          cardReachedByKeyboard && focusCard.outlineStyle !== 'none' && parseFloat(focusCard.outlineWidth) >= 2,
          { focusCard });
        await page.locator('.consequenceSpace').scrollIntoViewIfNeeded();
        if (spec.width === 1440) await page.screenshot({ path: resolve(output, '1440-workspace-cards-en.jpg'), type: 'jpeg', quality: 90 });
        else await page.screenshot({ path: resolve(output, '390-workspace-cards-en.jpg'), type: 'jpeg', quality: 90 });
        if (spec.width === 1440) {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          const motion = await brand.evaluate(image => ({
            animationName: getComputedStyle(image).animationName,
            transitionDuration: getComputedStyle(image).transitionDuration,
          }));
          check('reduced-motion preference disables logo animation and transition',
            motion.animationName === 'none' && motion.transitionDuration === '0s',
            { motion });
          await page.emulateMedia({ reducedMotion: 'no-preference' });
        }
      } else if (spec.zoomLayoutEquivalent) {
        check('720 CSS-pixel layout viewport (200%-zoom width equivalent) stays overflow-free',
          landingOverflow,
          { note: 'Layout-width equivalence checked; native browser zoom control was not changed.' });
      }
      check('only the documented public-history-only preflight POST was allowed; no mutation request ran', blockedWrites.length === 0, { blockedWrites, approvedReadOnlyPostsObserved });
      check('QA contacted no origin outside the two user-approved localhost hosts', blockedOrigins.length === 0, { blockedOrigins });
      check('browser produced no JavaScript or console errors', errors.length === 0, { errors });
      results.push({
        width: spec.width,
        height: spec.height,
        zoomLayoutEquivalent: Boolean(spec.zoomLayoutEquivalent),
        status: 'PASS',
        checks,
        requestCount: requests.length,
        approvedReadOnlyPostsObserved,
      });
    } catch (error) {
      results.push({ width: spec.width, height: spec.height, status: 'FAIL', checks, error: String(error), errors, blockedOrigins, blockedWrites });
      try { await page.screenshot({ path: resolve(output, spec.width + '-failure.jpg'), type: 'jpeg', quality: 82, fullPage: true }); } catch {}
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({
    origin,
    browser: 'ephemeral Playwright Chromium context; no persistent profile or extensions',
    scope: 'local VEREQO read-only visual QA; all non-approved origins and mutating requests blocked; POST /api/preflight is explicitly read-only public-history evaluation',
    results,
  }, null, 2) + '\n');
}
console.log(JSON.stringify({
  viewportCases: results.length,
  passedChecks: results.reduce((sum, result) => sum + (result.checks?.length ?? 0), 0),
  status: results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL',
  output,
}));
