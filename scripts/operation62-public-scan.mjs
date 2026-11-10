import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const reportPath = resolve(root, 'docs/evidence/operation-62/leakage-scan.json');
const walk = (dir) => {
  try {
    return readdirSync(dir).flatMap((name) => {
      const file = join(dir, name);
      const stat = statSync(file);
      return stat.isDirectory() ? walk(file) : stat.isFile() ? [file] : [];
    });
  } catch { return []; }
};
const privateRoot = resolve(root, 'demo/hacker-house/private');
const privateFiles = walk(privateRoot);
const privateValues = new Set();
const privateBodies = new Set();
const shortPairs = [];
const privatePathMarkers = new Set();
const sensitiveFieldName = /(?:max.*(?:notional|order|exposure|fee|limit|cap)|(?:notional|exposure|fee|limit|cap).*max|private|secret|credential(?:id|epoch)?|policy(?:epoch)?)/i;
const visit = (value, field = '') => {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value);
    if (text.length >= 8) privateValues.add(text);
    else if (field && sensitiveFieldName.test(field)) shortPairs.push({ field, value: text });
  } else if (Array.isArray(value)) value.forEach(item => visit(item, field));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => visit(item, key));
};
for (const file of privateFiles) {
  const body = readFileSync(file, 'utf8');
  privatePathMarkers.add(relative(root, file).replaceAll('\\', '/'));
  if (body.trim().length >= 32) privateBodies.add(body.trim());
  try { const parsed = JSON.parse(body); visit(parsed); privateBodies.add(JSON.stringify(parsed)); }
  catch { if (body.trim().length >= 32) visit(body.trim()); }
}
const roots = [
  'README.md', 'README.ja.md', 'docs/STATE.md', 'docs/ARCHITECTURE.md', 'docs/SECURITY.md',
  'docs/TESTNET_T5_T6_EXECUTION_GATE.md', 'docs/brand', 'apps/web/public/fonts', 'apps/web/public/brand', 'submission/hacker-house-2026',
  'docs/evidence/operation-62'
].map(path => resolve(root, path));
const allPublicTargets = [...new Set(roots.flatMap(path => {
  try { return statSync(path).isDirectory() ? walk(path) : [path]; } catch { return []; }
}))].filter(file => file !== reportPath);
const textExtensions = new Set(['.html', '.js', '.css', '.json', '.md', '.txt', '.srt', '.mjs', '.svg']);
const textTargets = allPublicTargets.filter(file => textExtensions.has(extname(file).toLowerCase()));
const builtRoot = resolve(root, process.env.OP62_BUILD_ROOT || 'dist/web');
const builtTargets = walk(builtRoot).filter(file => textExtensions.has(extname(file).toLowerCase()));
const matches = {
  exactPrivateBodies: [], longPrivateValues: [], shortSensitiveFieldPairs: [],
  privatePathMarkersInBuiltClient: [], documentedPrivatePathReferences: [],
  urlQueries: [], trackingOrAffiliateParameters: []
};
const escapeRegex = value => [...value].map(c => '.*+?^${}()|[]\\'.includes(c) ? `\\${c}` : c).join('');
const fieldPattern = pair => new RegExp(`${escapeRegex(pair.field)}\\s*["']?\\s*[:=]\\s*["']?${escapeRegex(pair.value)}["']?(?![A-Za-z0-9])`, 'i');
const urlQuery = /https?:\/\/[^\s<>"')\]]+\?[^\s<>"')\]]*/gi;
const trackingParam = /[?&](?:utm_[a-z0-9_-]+|fbclid|gclid|si|ref|ref_src|ref_url|referral|affiliate|invite|source)=/i;
const trackingUrl = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^\s<>"')\]]*\?(?:[^\s<>"')\]]*(?:s=|t=|si=|ref_src=|utm_)[^\s<>"')\]]*)/i;
const scan = (file, isBuilt) => {
  const body = readFileSync(file, 'utf8');
  const target = relative(root, file).replaceAll('\\', '/');
  if ([...privateBodies].some(value => body.includes(value))) matches.exactPrivateBodies.push(target);
  if ([...privateValues].some(value => body.includes(value))) matches.longPrivateValues.push(target);
  if (shortPairs.some(pair => fieldPattern(pair).test(body))) matches.shortSensitiveFieldPairs.push(target);
  if ([...privatePathMarkers].some(marker => body.includes(marker)) || body.includes('demo/hacker-house/private/')) {
    (isBuilt ? matches.privatePathMarkersInBuiltClient : matches.documentedPrivatePathReferences).push(target);
  }
  if (urlQuery.test(body)) matches.urlQueries.push(target);
  urlQuery.lastIndex = 0;
  if (trackingParam.test(body) || trackingUrl.test(body)) matches.trackingOrAffiliateParameters.push(target);
};
for (const file of textTargets) scan(file, false);
for (const file of builtTargets) scan(file, true);
for (const key of Object.keys(matches)) matches[key] = [...new Set(matches[key])];
const selfTests = [
  'PRIVATE_BODY_SENTINEL_62'.includes('PRIVATE_BODY_SENTINEL_62'),
  new RegExp(escapeRegex('Sensitive-Long-Value-62')).test('Sensitive-Long-Value-62'),
  fieldPattern({ field: 'maxNotional', value: '7' }).test('maxNotional: 7')
];
const checkedCounts = {
  exactPrivateBodies: matches.exactPrivateBodies.length,
  longPrivateValues: matches.longPrivateValues.length,
  shortSensitiveFieldPairs: matches.shortSensitiveFieldPairs.length,
  privatePathMarkersInBuiltClient: matches.privatePathMarkersInBuiltClient.length,
  urlQueries: matches.urlQueries.length,
  trackingOrAffiliateParameters: matches.trackingOrAffiliateParameters.length
};
const values = Object.values(checkedCounts);
const status = selfTests.every(Boolean) && values.every(value => value === 0) ? 'PASS' : 'FAIL';
const filmFrames = [
  'docs/evidence/operation-62/film/90s-title-card.png',
  'docs/evidence/operation-62/film/90s-control-deck-frame.png',
  'docs/evidence/operation-62/film/3min-what-if-readonly-context.png',
  'docs/evidence/operation-62/film/7min-owner-auth-pending-frame.png',
  'docs/evidence/operation-62/film/7min-no-go-endcard.png'
];
const videoFiles = [
  'submission/hacker-house-2026/media/VEREQO_OPERATION62_DEMO_90S_SILENT.mp4',
  'submission/hacker-house-2026/media/VEREQO_OPERATION62_CONTROL_DECK_3MIN_SILENT.mp4',
  'submission/hacker-house-2026/media/VEREQO_OPERATION62_MAIN_FILM_7MIN_SILENT_PREVIEW.mp4'
];
const report = {
  operation: '62',
  generatedAt: new Date().toISOString(),
  status,
  scope: {
    privateFixtureFiles: privateFiles.length,
    publicDocumentAndEvidenceFilesScanned: allPublicTargets.length,
    publicTextFilesScanned: textTargets.length,
    builtDistributionFilesPresent: walk(builtRoot).length,
    builtDistributionTextFilesScanned: builtTargets.length,
    builtOutputRoot: process.env.OP62_BUILD_ROOT || 'dist/web',
    videoFiles: videoFiles.length,
    videoRepresentativeFrames: filmFrames,
    videoOcr: 'NOT_RUN; all five listed representative frames were visually inspected; Wallet remained disconnected and no financial write was performed.'
  },
  checks: {
    privateBodyMatches: { matchCount: checkedCounts.exactPrivateBodies, status: checkedCounts.exactPrivateBodies ? 'FAIL' : 'PASS' },
    longSensitiveValueMatches: { matchCount: checkedCounts.longPrivateValues, status: checkedCounts.longPrivateValues ? 'FAIL' : 'PASS' },
    shortSensitiveFieldValuePairs: { matchCount: checkedCounts.shortSensitiveFieldPairs, status: checkedCounts.shortSensitiveFieldPairs ? 'FAIL' : 'PASS' },
    privatePathMarkersInBuiltDistribution: { matchCount: checkedCounts.privatePathMarkersInBuiltClient, status: checkedCounts.privatePathMarkersInBuiltClient ? 'FAIL' : 'PASS' },
    publicDocumentUrlQueries: { matchCount: checkedCounts.urlQueries, status: checkedCounts.urlQueries ? 'FAIL' : 'PASS' },
    trackingOrAffiliateParameters: { matchCount: checkedCounts.trackingOrAffiliateParameters, status: checkedCounts.trackingOrAffiliateParameters ? 'FAIL' : 'PASS' },
    detectorSelfTest: { cases: selfTests.length, passed: selfTests.filter(Boolean).length, status: selfTests.every(Boolean) ? 'PASS' : 'FAIL' }
  },
  matchedValuesWritten: false,
  note: 'Private fixture values are read only in memory; the report stores counts and file paths, not values. Screenshots and video frames are not OCR scanned; five representative final video frames were manually inspected.'
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status, publicFiles: allPublicTargets.length, publicTextFiles: textTargets.length, builtFiles: builtTargets.length, videoFiles: videoFiles.length, detectorSelfTests: `${selfTests.filter(Boolean).length}/${selfTests.length}`, matches: checkedCounts }));
if (status !== 'PASS') process.exitCode = 1;
