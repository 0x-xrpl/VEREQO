import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.VEREQO_HEADER_ORIGIN ?? 'http://127.0.0.1:5173';
const allowedOrigins = new Set(['http://127.0.0.1:5173', 'http://127.0.0.1:4317']);
assert.ok(allowedOrigins.has(origin), 'Only the approved local VEREQO origins are allowed.');
const phase = process.env.VEREQO_HEADER_PHASE ?? 'after';
assert.ok(['before', 'after'].includes(phase), 'Set VEREQO_HEADER_PHASE to before or after.');
const expectedLogo = phase === 'before' ? '/brand/VEREQO_LOCKUP_SOLID.svg' : '/brand/VEREQO_WORDMARK_SOLID.svg';
const output = resolve(process.env.VEREQO_HEADER_OUTPUT ?? 'docs/evidence/header-refinement-2026-11-11');
const phaseDir = join(output, phase);
mkdirSync(phaseDir, { recursive: true });
const chromePath = process.env.VEREQO_QA_CHROME;
const bundleRoot = resolve(process.env.VEREQO_HEADER_BUILD ?? '');
assert.ok(process.env.VEREQO_HEADER_BUILD && existsSync(join(bundleRoot, 'index.html')),
  'Set VEREQO_HEADER_BUILD to a built Vite directory.');

const specs = [
  { name: '1440x900', width: 1440, height: 900, dpr: 1 },
  { name: '390x844', width: 390, height: 844, dpr: 1 },
  { name: '1920x1080-output', width: 1200, height: 675, dpr: 1.6 },
];
const browser = await chromium.launch({
  ...(chromePath ? { executablePath: chromePath } : {}),
  headless: true,
  args: ['--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-component-update'],
});
const results = [];

try {
  for (const spec of specs) {
    const context = await browser.newContext({
      viewport: { width: spec.width, height: spec.height },
      deviceScaleFactor: spec.dpr,
      hasTouch: spec.width <= 768,
      reducedMotion: 'reduce',
    });
    await context.addInitScript(() => {
      window.__headerQaLayoutShifts = 0;
      window.__headerQaLayoutShiftSources = [];
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              window.__headerQaLayoutShifts += entry.value;
              window.__headerQaLayoutShiftSources.push({
                value: entry.value,
                sources: [...(entry.sources ?? [])].map(source => ({
                  tag: source.node?.tagName ?? null,
                  id: source.node?.id ?? null,
                  className: typeof source.node?.className === 'string' ? source.node.className : '',
                  inHeader: !!source.node?.closest?.('.topbar'),
                  previousRect: source.previousRect,
                  currentRect: source.currentRect,
                })),
              });
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
    });
    const page = await context.newPage();
    const blockedWrites = [];
    const blockedExternal = [];
    const apiReads = [];
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
      if (!allowedOrigins.has(url.origin)) {
        blockedExternal.push(`${url.origin}${url.pathname}`);
        return route.abort();
      }
      if (!['GET', 'HEAD'].includes(request.method())) {
        blockedWrites.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      if (url.pathname.startsWith('/api/')) {
        apiReads.push(url.pathname);
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"STATIC_UI_QA_API_DISABLED"}' });
      }
      const relativePath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const assetPath = resolve(bundleRoot, `.${relativePath}`);
      if (assetPath !== bundleRoot && !assetPath.startsWith(`${bundleRoot}${sep}`)) return route.abort();
      if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found in static Vite build.' });
      }
      const contentTypes = {
        '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
        '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
        '.ico': 'image/x-icon', '.webp': 'image/webp',
      };
      return route.fulfill({ status: 200, contentType: contentTypes[extname(assetPath)] ?? 'application/octet-stream', body: readFileSync(assetPath) });
    });

    const checks = [];
    const check = (name, condition, evidence = {}) => {
      assert.ok(condition, `${spec.name}: ${name} — ${JSON.stringify(evidence)}`);
      checks.push({ name, status: 'PASS', ...evidence });
    };
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const htmlLanguageAtDomReady = await page.locator('html').getAttribute('lang');
    await page.locator('.brandLogo').waitFor({ state: 'visible', timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);

    const initial = await page.evaluate(() => ({
      htmlLang: document.documentElement.lang,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      documentWidth: document.documentElement.scrollWidth,
      logo: (() => {
        const image = document.querySelector('.brandLogo');
        const rect = image.getBoundingClientRect();
        const header = image.closest('.topbar').getBoundingClientRect();
        return {
          src: image.getAttribute('src'), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          header: { x: header.x, y: header.y, width: header.width, height: header.height },
        };
      })(),
      nav: [...document.querySelectorAll('.navlinks a')].map(link => ({ text: link.textContent.trim(), href: link.getAttribute('href') })),
      cls: window.__headerQaLayoutShifts,
      clsSources: window.__headerQaLayoutShiftSources,
    }));
    check('first English render and document language agree', htmlLanguageAtDomReady === 'en' && initial.htmlLang === 'en', { language: initial.htmlLang });
    check('shared header uses the expected official solid vector asset', initial.logo.src === expectedLogo && initial.logo.naturalWidth > 0, { logo: initial.logo });
    check('wordmark is fully inside the header and viewport',
      initial.logo.bounds.x >= 0 && initial.logo.bounds.y >= 0
      && initial.logo.bounds.x + initial.logo.bounds.width <= initial.logo.header.x + initial.logo.header.width
      && initial.logo.bounds.y + initial.logo.bounds.height <= initial.logo.header.y + initial.logo.header.height
      && initial.logo.bounds.x + initial.logo.bounds.width <= spec.width);
    check('initial view has no horizontal clipping', initial.documentWidth <= spec.width, { documentWidth: initial.documentWidth });
    check('header has no layout-shift source', !initial.clsSources.some(entry => entry.sources.some(source => source.inHeader)), { cls: initial.cls, clsSources: initial.clsSources });
    check('first viewport content CLS remains below 0.1', initial.cls < 0.1, { cls: initial.cls });
    if (spec.name === '1920x1080-output') {
      const outputTopSafePixels = initial.logo.bounds.y * spec.dpr;
      if (phase === 'after') {
        check('wordmark has 60–90 output-pixel top safety margin', outputTopSafePixels >= 60 && outputTopSafePixels <= 90, { outputTopSafePixels });
      } else {
        checks.push({ name: 'baseline output-pixel top safety margin', status: 'BASELINE', outputTopSafePixels });
      }
    }
    if (spec.width > 820) {
      check('desktop menu labels and routes remain unchanged',
        initial.nav.map(item => item.text).join('|') === 'FINANCIAL INSPECTION|WORKSPACE|HOW IT WORKS'
        && initial.nav.map(item => item.href).join('|') === '#financial|#demo|#how-it-works', { nav: initial.nav });
    } else {
      check('mobile header hides desktop navigation without clipping',
        await page.locator('.navlinks').evaluate(node => getComputedStyle(node).display === 'none')
        && initial.logo.bounds.x + initial.logo.bounds.width <= spec.width, { nav: initial.nav });
    }

    const prefix = join(phaseDir, spec.name);
    await page.screenshot({ path: `${prefix}-landing.png`, animations: 'disabled' });
    if (spec.width > 820) {
      const how = page.locator('.navlinks a[href="#how-it-works"]');
      await how.click();
      await page.waitForFunction(() => location.hash === '#how-it-works');
      const howState = await page.evaluate(() => ({
        hash: location.hash,
        heading: document.querySelector('#how-it-works')?.textContent?.includes('HOW IT WORKS') ?? false,
        sectionTop: document.querySelector('#how-it-works')?.getBoundingClientRect().top ?? -1,
        headerBottom: document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? -1,
        logo: (() => { const r = document.querySelector('.brandLogo').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
        navCurrent: [...document.querySelectorAll('.navlinks a')].map(item => item.getAttribute('aria-current') ?? null),
        width: document.documentElement.scrollWidth,
      }));
      check('HOW IT WORKS navigation reaches the existing section', howState.hash === '#how-it-works' && howState.heading, { hash: howState.hash });
      check('HOW IT WORKS starts below the sticky header with a stable gap',
        howState.sectionTop >= howState.headerBottom && howState.sectionTop - howState.headerBottom < 30,
        { sectionTop: howState.sectionTop, headerBottom: howState.headerBottom });
      check('header wordmark stays in a fixed position after section navigation',
        Math.abs(howState.logo.x - initial.logo.bounds.x) < 0.5 && Math.abs(howState.logo.y - initial.logo.bounds.y) < 0.5,
        { initial: initial.logo.bounds, after: howState.logo });
      check('section navigation remains overflow-free', howState.width <= spec.width, { width: howState.width });
      await page.screenshot({ path: `${prefix}-how-it-works.png`, animations: 'disabled' });

      await page.locator('.navlinks a[href="#financial"]').click();
      await page.waitForFunction(() => location.hash === '#financial');
      check('Financial navigation still reaches its existing route', await page.evaluate(() => location.hash === '#financial'));
      await page.screenshot({ path: `${prefix}-financial.png`, animations: 'disabled' });

      await page.locator('.navlinks a[href="#demo"]').click();
      await page.waitForFunction(() => location.hash === '#demo');
      check('CONTROL DECK navigation still reaches its existing route', await page.evaluate(() => location.hash === '#demo'));
      await page.screenshot({ path: `${prefix}-control-deck.png`, animations: 'disabled' });

      if (spec.width === 1440) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        check('English preference survives reload', await page.locator('html').getAttribute('lang') === 'en');
        await page.getByTestId('language-ja').click();
        check('explicit Japanese selection remains available', await page.locator('html').getAttribute('lang') === 'ja');
        await page.reload({ waitUntil: 'domcontentloaded' });
        check('explicit Japanese selection persists on reload', await page.locator('html').getAttribute('lang') === 'ja');
        await page.getByTestId('language-en').click();
        await page.reload({ waitUntil: 'domcontentloaded' });
        check('English selection restores English after reload', await page.locator('html').getAttribute('lang') === 'en');
      }
    }

    if (spec.name === '1920x1080-output') {
      const file = readFileSync(`${prefix}-how-it-works.png`);
      const dimensions = { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
      check('capture output is exactly 1920 x 1080', dimensions.width === 1920 && dimensions.height === 1080, dimensions);
    }
    check('QA issued no write requests, external requests, or page exceptions',
      blockedWrites.length === 0 && blockedExternal.length === 0 && pageErrors.length === 0,
      { blockedWrites, blockedExternal, pageErrors, apiReadRequestCount: apiReads.length });
    results.push({ spec, initial, checks, blockedWrites, blockedExternal, pageErrors, apiReadRequestCount: apiReads.length });
    await context.close();
  }
} finally {
  await browser.close();
}

const report = {
  status: 'PASS', phase, origin, expectedLogo, output: phaseDir,
  sourceClassification: 'LOCAL PRODUCTION BUILD served through Playwright interception; API reads disabled; no wallet provider or financial mutation enabled',
  captureComposition: {
    output: '1920x1080', cssViewport: '1200x675', deviceScaleFactor: 1.6,
    crop: 'none', startRoute: '#how-it-works',
    headerTopSafeOutputPixels: 'target 60–90, measured per report',
    subtitleSafeBandOutputPixels: { left: 120, top: 930, right: 1800, bottom: 1030 },
    cameraReset: 'fixed viewport origin and center; zoom returns to 100% and original center; no per-scene crop',
  },
  viewports: results,
};
writeFileSync(join(phaseDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
if (phase === 'after') {
  const capture = results.find(item => item.spec.name === '1920x1080-output');
  const topSafeOutputPixels = capture.initial.logo.bounds.y * capture.spec.dpr;
  const composition = {
    status: 'CAPTURE SPEC ONLY — no video was recorded or edited',
    sourceClassification: report.sourceClassification,
    output: { width: 1920, height: 1080, aspectRatio: '16:9' },
    browserViewportCss: { width: capture.spec.width, height: capture.spec.height, deviceScaleFactor: capture.spec.dpr },
    measuredWordmarkTopSafePixels: Number(topSafeOutputPixels.toFixed(2)),
    targetWordmarkTopSafePixels: { min: 60, max: 90 },
    camera: {
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      baseScale: 1,
      baseCenterOutputPixels: { x: 960, y: 540 },
      returnAfterZoom: 'scale 1 at the same center; do not alter viewport or crop between scenes',
      scrollHeaderGapCssPixels: 22,
      initialAction: 'Open the existing English landing page, then click the existing HOW IT WORKS navigation link before capture.',
      titleCard: 'none',
    },
    subtitleSafeBandOutputPixels: { left: 120, top: 930, right: 1800, bottom: 1030 },
    screenshots: [
      'after/1920x1080-output-how-it-works.png',
      'after/1440x900-how-it-works.png',
      'after/390x844-landing.png',
    ],
  };
  writeFileSync(join(phaseDir, 'capture-composition.json'), `${JSON.stringify(composition, null, 2)}\n`, { mode: 0o600 });
}
console.log(JSON.stringify({ status: report.status, phase, output: phaseDir, viewports: results.map(item => ({ name: item.spec.name, checks: item.checks.length })) }, null, 2));
