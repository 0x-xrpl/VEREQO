import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { resolve, join } from 'node:path';
import { createLocalApp } from '../services/issuer/src/http.ts';
import { InjectiveReadAdapter } from '../packages/domain/src/live-injective.ts';

const buildRoot = resolve(process.env.VEREQO_BRAND_BUILD_ROOT ?? join(tmpdir(), 'vereqo-build-brand-20261110'));
const output = resolve(process.env.VEREQO_BRAND_QA_OUTPUT ?? 'docs/evidence/final-brand-2026-11-10');
const chrome = process.env.VEREQO_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const viewportSpecs = [
  { width: 1920, height: 1080, name: '1920-desktop' },
  { width: 1440, height: 900, name: '1440-desktop' },
  { width: 390, height: 844, name: '390-mobile' },
  { width: 320, height: 800, name: '320-mobile' },
];
const checks = [];
const screenshots = [];
const errors = [];
const externalRequests = [];
const check = (name, condition, detail = {}) => {
  assert.ok(condition, name);
  checks.push({ name, status: 'PASS', ...detail });
};
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const buildHtml = readFileSync(join(buildRoot, 'index.html'), 'utf8');
if (!buildHtml.includes('VEREQO_LOCKUP_SOLID_WHITE_4X.png')) {
  throw new Error('BUILD_DOES_NOT_INCLUDE_FINAL_SOLID_BRAND');
}
const buildAssetRefs = [...buildHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]).sort();
const buildDigest = createHash('sha256').update(buildHtml);
for (const asset of buildAssetRefs) buildDigest.update(asset).update(readFileSync(join(buildRoot, asset.slice(1))));
const buildAssetSha256 = buildDigest.digest('hex');
mkdirSync(output, { recursive: true, mode: 0o755 });
const upstream = new InjectiveReadAdapter(async () => { throw new Error('INJECTIVE_READ_DISABLED_IN_BRAND_QA'); });
const app = createLocalApp({ databasePath: ':memory:', staticRoot: buildRoot, injective: upstream });
await new Promise(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen));
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('LOCAL_QA_SERVER_NOT_STARTED');
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-component-update'],
});
try {
  for (const spec of viewportSpecs) {
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', () => errors.push(`${spec.name}:PAGE_ERROR`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${spec.name}:CONSOLE_ERROR`); });
    await context.route('**/*', async route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === base) return route.continue();
      externalRequests.push({ origin: requestUrl.origin, path: requestUrl.pathname });
      return route.abort();
    });
    await page.goto(`${base}/?lang=en#top`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const en = page.getByTestId('language-en');
    const firstLanguage = await en.getAttribute('aria-pressed');
    const firstMainText = await page.locator('main').innerText();
    check(`${spec.name}: English is selected on initial render`, firstLanguage === 'true' && firstMainText.includes('A proposal is not permission.'));
    const heroAlignment = await page.evaluate(() => {
      const financial = document.querySelector('#financial-entry-heading')?.getBoundingClientRect();
      const productHero = document.querySelector('#product-headline')?.getBoundingClientRect();
      return financial && productHero ? { financialLeft: financial.left, productHeroLeft: productHero.left, delta: Math.abs(financial.left - productHero.left) } : null;
    });
    check(`${spec.name}: financial headline aligns with product hero`, !!heroAlignment && heroAlignment.delta <= 2, { heroAlignment });
    const financialRhythm = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect();
      const eyebrow = rect('.financialEntryMain>.u-eyebrow');
      const heading = rect('#financial-entry-heading');
      const body = rect('.financialEntryMain>p:not(.u-eyebrow)');
      const cta = rect('.financialEntryMain>.u-primary');
      const note = document.querySelector('.financialEntryMain>.u-entry-note');
      if (!eyebrow || !heading || !body || !cta || !note) return null;
      const noteText = document.createRange();
      noteText.selectNodeContents(note);
      const noteTextRect = noteText.getBoundingClientRect();
      return {
        eyebrowToHeading: heading.top - eyebrow.bottom,
        headingToBody: body.top - heading.bottom,
        bodyToCta: cta.top - body.bottom,
        ctaToNote: noteTextRect.top - cta.bottom,
      };
    });
    check(`${spec.name}: financial eyebrow, headline, copy and action have clear vertical rhythm`,
      !!financialRhythm && financialRhythm.eyebrowToHeading >= 20 && financialRhythm.headingToBody >= 24 &&
      financialRhythm.bodyToCta >= 18 && financialRhythm.ctaToNote >= 16, { financialRhythm });
    const logo = await page.locator('.brandLogo').evaluate(image => ({
      src: image.getAttribute('src'), currentSrc: image.currentSrc, width: image.naturalWidth,
      height: image.naturalHeight, filter: getComputedStyle(image).filter,
      box: (() => { const r = image.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }; })(),
      header: (() => { const r = image.closest('.topbar').getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }; })(),
    }));
    check(`${spec.name}: solid lockup loads from supplied SVG`, logo.src === '/brand/VEREQO_LOCKUP_SOLID.svg' && logo.width === 1249 && logo.height === 310 && logo.filter === 'none', { logo });
    check(`${spec.name}: lockup remains within header`, logo.box.left >= logo.header.left && logo.box.right <= logo.header.right && logo.box.top >= logo.header.top && logo.box.bottom <= logo.header.bottom);
    const footer = await page.locator('.footerBrandLogo').evaluate(image => ({ src:image.getAttribute('src'), width:image.naturalWidth, height:image.naturalHeight }));
    check(`${spec.name}: footer uses supplied wordmark SVG`, footer.src === '/brand/VEREQO_WORDMARK_SOLID.svg' && footer.width === 916 && footer.height === 197, { footer });
    const docAssets = await page.evaluate(() => ({
      icon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
      touch: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
      og: document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
      twitter: document.querySelector('meta[name="twitter:image"]')?.getAttribute('content'),
      instrumentSans: document.fonts.check('400 14px "Instrument Sans"'),
      plexMono: document.fonts.check('400 10px "IBM Plex Mono"'),
      width: document.documentElement.scrollWidth,
    }));
    check(`${spec.name}: document uses solid icon and social artwork`, docAssets.icon === '/brand/VEREQO_ICON_SOLID.svg' && docAssets.touch === '/brand/VEREQO_ICON_SOLID_4X.png' && docAssets.og === '/brand/VEREQO_LOCKUP_SOLID_WHITE_4X.png' && docAssets.twitter === '/brand/VEREQO_LOCKUP_SOLID_WHITE_4X.png', { docAssets });
    check(`${spec.name}: self-hosted UI fonts load and layout has no horizontal overflow`, docAssets.instrumentSans && docAssets.plexMono && docAssets.width <= spec.width, { docAssets });
    await page.screenshot({ path: join(output, `${spec.name}-landing.png`), fullPage: false });
    screenshots.push(`${spec.name}-landing.png`);
    const how = page.locator('#how-it-works');
    await how.scrollIntoViewIfNeeded();
    const howText = await how.innerText();
    check(`${spec.name}: HOW IT WORKS presents one heading and three complete steps`,
      howText.includes('From the request') && howText.includes('Choose a request') &&
      howText.includes('Inspect the next answer') && howText.includes('Compare the consequences'));
    await page.screenshot({ path: join(output, `${spec.name}-how-it-works.png`), fullPage: false });
    screenshots.push(`${spec.name}-how-it-works.png`);
    await page.goto(`${base}/?lang=en#demo`, { waitUntil: 'networkidle' });
    await page.getByTestId('workspace').waitFor({ state: 'visible' });
    check(`${spec.name}: CONTROL DECK stays within viewport`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: join(output, `${spec.name}-control-deck.png`), fullPage: false });
    screenshots.push(`${spec.name}-control-deck.png`);
    await page.goto(`${base}/?lang=en#financial`, { waitUntil: 'networkidle' });
    await page.getByTestId('financial-wallet-state').waitFor({ state: 'visible' });
    check(`${spec.name}: financial surface stays within viewport and displays no approval`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth) && (await page.getByTestId('financial-wallet-state').innerText()).includes('EXECUTION NOT APPROVED'));
    await page.screenshot({ path: join(output, `${spec.name}-financial.png`), fullPage: false });
    screenshots.push(`${spec.name}-financial.png`);
    await context.close();
  }
} finally {
  await browser.close();
  await app.close();
}
check('browser made no external requests', externalRequests.length === 0, { externalRequests });
check('browser had no runtime errors', errors.length === 0, { errors });
const report = {
  status: 'PASS_WITH_SCOPE_LIMITS',
  generatedAt: new Date().toISOString(),
  buildAssetSha256,
  buildAssets: buildAssetRefs.map(asset => asset.split('/').pop()),
  dataClass: 'LOCAL / SYNTHETIC TEST STATE',
  captureMode: 'isolated headless system Chrome; ephemeral in-memory server; no existing Chrome profile',
  viewportCount: viewportSpecs.length,
  checks: { passed: checks.length, failed: 0, items: checks },
  screenshots: screenshots.map(file => ({ file, sha256: sha256(join(output, file)) })),
  externalRequests,
  runtimeErrors: errors.length,
  walletSignature: false,
  financialWrite: false,
  injectiveRead: false,
  execution: 'NOT_APPROVED / NOT_IMPLEMENTED',
};
writeFileSync(join(output, 'brand-browser-qa.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o644 });
const manifestTargets = [...screenshots.map(file => join(output, file)), join(output, 'brand-browser-qa.json')];
writeFileSync(join(output, 'SHA256SUMS.txt'), manifestTargets.map(file => `${sha256(file)}  ${file.replace(process.cwd() + '/', '')}`).join('\n') + '\n', { mode: 0o644 });
console.log(JSON.stringify({ status: report.status, checks: report.checks.passed, screenshots: screenshots.length, output }, null, 2));
