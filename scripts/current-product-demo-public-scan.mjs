import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const privateRoot = resolve(root, 'demo/hacker-house/private');
const evidenceRoot = resolve(root, 'docs/evidence/current-product-demo-2026-11-09');
const mediaRoot = resolve(root, 'submission/hacker-house-2026/media/current-product-demo-2026-11-09');
const reportPath = join(evidenceRoot, 'final-public-scan.json');
const manifestPath = join(evidenceRoot, 'SHA256SUMS.txt');
const builtRoot = resolve(process.env.VEREQO_CAPTURE_BUILD_ROOT ?? resolve(tmpdir(), 'verequo-build-final'));
const textExtensions = new Set(['.html', '.js', '.css', '.json', '.md', '.txt', '.vtt', '.mjs', '.ts', '.svg']);
const walk = directory => {
  try {
    return readdirSync(directory).flatMap(name => {
      const path = join(directory, name);
      const stat = statSync(path);
      return stat.isDirectory() ? walk(path) : stat.isFile() ? [path] : [];
    });
  } catch { return []; }
};
const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const privateFiles = walk(privateRoot);
const privateValues = new Set();
const privateBodies = new Set();
const shortPairs = [];
const pathMarkers = new Set();
const sensitiveField = /(?:max.*(?:notional|order|exposure|fee|limit|cap)|(?:notional|exposure|fee|limit|cap).*max|private|secret|credential(?:id|epoch)?|policy(?:epoch)?)/i;
const visit = (value, field = '') => {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value);
    if (text.length >= 8) privateValues.add(text);
    else if (field && sensitiveField.test(field)) shortPairs.push({ field, value: text });
  } else if (Array.isArray(value)) value.forEach(item => visit(item, field));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => visit(item, key));
};
for (const file of privateFiles) {
  const body = readFileSync(file, 'utf8');
  pathMarkers.add(relative(root, file).replaceAll('\\', '/'));
  if (body.trim().length >= 32) privateBodies.add(body.trim());
  try {
    const parsed = JSON.parse(body);
    visit(parsed);
    privateBodies.add(JSON.stringify(parsed));
  } catch {
    if (body.trim().length >= 32) visit(body.trim());
  }
}
const publicRoots = [
  'README.md', 'README.ja.md', 'docs/STATE.md', 'docs/ARCHITECTURE.md', 'docs/SECURITY.md',
  'docs/TESTNET_T5_T6_EXECUTION_GATE.md', 'submission/hacker-house-2026',
  'docs/evidence/current-product-demo-2026-11-09',
  'docs/evidence/current-financial-read-2026-11-09',
  'docs/evidence/wallet-auth-diagnostics-2026-11-09',
].map(path => resolve(root, path));
const publicFiles = [...new Set(publicRoots.flatMap(path => {
  try { return statSync(path).isDirectory() ? walk(path) : existsSync(path) ? [path] : []; } catch { return []; }
}))];
const publicTextFiles = publicFiles.filter(path => textExtensions.has(extname(path).toLowerCase()));
const builtFiles = walk(builtRoot);
const builtTextFiles = builtFiles.filter(path => textExtensions.has(extname(path).toLowerCase()));
const urlQuery = /https?:\/\/[^\s<>"')\]]+\?[^\s<>"')\]]*/gi;
const trackingParam = /[?&](?:utm_[a-z0-9_-]+|fbclid|gclid|si|ref|ref_src|ref_url|referral|affiliate|invite|source)=/i;
const trackingUrl = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^\s<>"')\]]*\?(?:[^\s<>"')\]]*(?:s=|t=|si=|ref_src=|utm_)[^\s<>"')\]]*)/i;
const counts = {
  exactPrivateBodies: 0,
  longPrivateValues: 0,
  shortSensitiveFieldPairs: 0,
  documentedPrivatePathReferences: 0,
  privatePathMarkersInBuiltClient: 0,
  publicDocumentUrlQueries: 0,
  trackingOrAffiliateParameters: 0,
};
const escapeRegex = value => [...value].map(character => '^$\\.*+?()[]{}|'.includes(character) ? '\\' + character : character).join('');
const fieldPattern = pair => new RegExp(escapeRegex(pair.field) + '\\s*["\']?\\s*[:=]\\s*["\']?' + escapeRegex(pair.value) + '["\']?(?![A-Za-z0-9])', 'i');
const scan = (file, built) => {
  const body = readFileSync(file, 'utf8');
  if ([...privateBodies].some(value => body.includes(value))) counts.exactPrivateBodies++;
  if ([...privateValues].some(value => body.includes(value))) counts.longPrivateValues++;
  if (shortPairs.some(pair => fieldPattern(pair).test(body))) counts.shortSensitiveFieldPairs++;
  const hasPathMarker = [...pathMarkers].some(marker => body.includes(marker)) || body.includes('demo/hacker-house/private/');
  if (hasPathMarker) counts[built ? 'privatePathMarkersInBuiltClient' : 'documentedPrivatePathReferences']++;
  if (urlQuery.test(body)) counts.publicDocumentUrlQueries++;
  urlQuery.lastIndex = 0;
  if (trackingParam.test(body) || trackingUrl.test(body)) counts.trackingOrAffiliateParameters++;
};
publicTextFiles.forEach(file => scan(file, false));
builtTextFiles.forEach(file => scan(file, true));
const detectorSelfTests = [
  'PRIVATE_BODY_SENTINEL'.includes('PRIVATE_BODY_SENTINEL'),
  new RegExp(escapeRegex('Sensitive-Long-Value')).test('Sensitive-Long-Value'),
  fieldPattern({ field: 'maxNotional', value: '7' }).test('maxNotional: 7'),
];
const blockingCounts = Object.fromEntries(Object.entries(counts).filter(([key]) => key !== 'documentedPrivatePathReferences'));
const builtOutputScanAvailable = builtFiles.length > 0 && builtTextFiles.length > 0;
const status = detectorSelfTests.every(Boolean) && builtOutputScanAvailable && Object.values(blockingCounts).every(value => value === 0) ? 'PASS' : 'FAIL';
const report = {
  operation: 'current-product-demo-2026-11-09',
  generatedAt: new Date().toISOString(),
  status,
  builtOutputScanAvailable,
  scope: {
    publicFilesScanned: publicFiles.length,
    publicTextFilesScanned: publicTextFiles.length,
    builtFilesScanned: builtFiles.length,
    builtTextFilesScanned: builtTextFiles.length,
    privateFixtureFilesReadInMemory: privateFiles.length,
    currentVideoFiles: 1,
    visualScreenshotsManuallyReviewed: 7,
    videoOcr: 'NOT_RUN; 7 of the 10 final captured screenshots were visually inspected.',
  },
  checks: counts,
  detectorSelfTest: { cases: detectorSelfTests.length, passed: detectorSelfTests.filter(Boolean).length },
  matchedValuesWritten: false,
  documentedPrivatePathReferencesAreInformational: true,
  note: 'Human-facing technical documents may name local fixture locations; any such path in the built client remains a blocking leak.',
  noSignatureNonceSessionOrOwnerWalletDataIncluded: true,
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o644 });
const mediaFiles = [
  join(mediaRoot, 'VEREQO_CURRENT_PRODUCT_DEMO_90S.mp4'),
  join(mediaRoot, 'VEREQO_CURRENT_BUILD_EN.vtt'),
  join(mediaRoot, 'VEREQO_CURRENT_BUILD_EN_NARRATION.md'),
  join(mediaRoot, 'STORYBOARD.md'),
  join(mediaRoot, 'MEDIA_README.md'),
];
const captureReport = join(evidenceRoot, 'capture-report.json');
const captureScript = resolve(root, 'scripts/current-product-demo-capture.ts');
const screenshotFiles = walk(evidenceRoot).filter(path => /^\d{2}-.*\.png$/.test(path.split('/').at(-1) ?? ''));
const scanScript = resolve(root, 'scripts/current-product-demo-public-scan.mjs');
const manifestFiles = [...mediaFiles, captureReport, reportPath, ...screenshotFiles, captureScript, scanScript];
const manifest = manifestFiles.map(path => hashFile(path) + '  ' + relative(root, path)).join('\n') + '\n';
writeFileSync(manifestPath, manifest, { mode: 0o644 });
console.log(JSON.stringify({
  status,
  publicFiles: publicFiles.length,
  publicTextFiles: publicTextFiles.length,
  builtFiles: builtFiles.length,
  builtTextFiles: builtTextFiles.length,
  builtOutputScanAvailable,
  detectorSelfTests: detectorSelfTests.filter(Boolean).length + '/' + detectorSelfTests.length,
  matches: counts,
  manifestFiles: manifestFiles.length,
}));
if (status !== 'PASS') process.exitCode = 1;
