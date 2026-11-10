import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const builtRoot = resolve(process.argv[2] ?? process.env.VEREQO_BUILD_ROOT ?? 'dist');
const reportPath = resolve(root, 'docs/evidence/p0-market-risk/public-scan-2026-11-10.json');
const textExtensions = new Set(['.html', '.js', '.css', '.json', '.md', '.txt', '.vtt', '.mjs', '.ts', '.svg']);
const walk = directory => {
  try { return readdirSync(directory).flatMap(name => { const path = join(directory, name), stat = statSync(path); return stat.isDirectory() ? walk(path) : stat.isFile() ? [path] : []; }); }
  catch { return []; }
};
const privateRoot = resolve(root, 'demo/hacker-house/private');
const privateFiles = walk(privateRoot);
const privateValues = new Set(), privateBodies = new Set(), shortPairs = [], privatePaths = new Set();
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
  privatePaths.add(relative(root, file).replaceAll('\\', '/'));
  if (body.trim().length >= 32) privateBodies.add(body.trim());
  try { const parsed = JSON.parse(body); visit(parsed); privateBodies.add(JSON.stringify(parsed)); }
  catch { if (body.trim().length >= 32) visit(body.trim()); }
}
const publicRoots = [
  'README.md', 'README.ja.md', 'docs/STATE.md', 'docs/ARCHITECTURE.md', 'docs/SECURITY.md',
  'docs/TESTNET_T5_T6_EXECUTION_GATE.md', 'submission/hacker-house-2026',
  'docs/evidence/current-product-demo-2026-11-09', 'docs/evidence/current-financial-read-2026-11-09',
  'docs/evidence/wallet-auth-diagnostics-2026-11-09', 'docs/evidence/p0-market-risk',
].map(path => resolve(root, path));
const publicFiles = [...new Set(publicRoots.flatMap(path => {
  try { return statSync(path).isDirectory() ? walk(path) : existsSync(path) ? [path] : []; } catch { return []; }
}))].filter(path => path !== reportPath);
const publicText = publicFiles.filter(path => textExtensions.has(extname(path).toLowerCase()));
const builtFiles = walk(builtRoot), builtText = builtFiles.filter(path => textExtensions.has(extname(path).toLowerCase()));
const query = /https?:\/\/[^\s<>"')\]]+\?[^\s<>"')\]]*/gi;
const tracking = /[?&](?:utm_[a-z0-9_-]+|fbclid|gclid|si|ref|ref_src|ref_url|referral|affiliate|invite|source)=/i;
const xTracking = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^\s<>"')\]]*\?(?:[^\s<>"')\]]*(?:s=|t=|si=|ref_src=|utm_)[^\s<>"')\]]*)/i;
const escape = value => [...value].map(char => '^$\\.*+?()[]{}|'.includes(char) ? `\\${char}` : char).join('');
const pairPattern = pair => new RegExp(`${escape(pair.field)}\\s*["']?\\s*[:=]\\s*["']?${escape(pair.value)}["']?(?![A-Za-z0-9])`, 'i');
const counts = { exactPrivateBodies: 0, longPrivateValues: 0, shortSensitiveFieldPairs: 0, builtPrivatePathMarkers: 0, publicUrlQueries: 0, trackingParameters: 0 };
const scan = (file, built) => {
  const body = readFileSync(file, 'utf8');
  if ([...privateBodies].some(value => body.includes(value))) counts.exactPrivateBodies++;
  if ([...privateValues].some(value => body.includes(value))) counts.longPrivateValues++;
  if (shortPairs.some(pair => pairPattern(pair).test(body))) counts.shortSensitiveFieldPairs++;
  if (built && ([...privatePaths].some(marker => body.includes(marker)) || body.includes('demo/hacker-house/private/'))) counts.builtPrivatePathMarkers++;
  if (query.test(body)) counts.publicUrlQueries++;
  query.lastIndex = 0;
  if (tracking.test(body) || xTracking.test(body)) counts.trackingParameters++;
};
publicText.forEach(file => scan(file, false));
builtText.forEach(file => scan(file, true));
const detectorSelfTest = [
  'PRIVATE_BODY_SENTINEL'.includes('PRIVATE_BODY_SENTINEL'),
  new RegExp(escape('Sensitive-Long-Value')).test('Sensitive-Long-Value'),
  pairPattern({ field: 'maxNotional', value: '7' }).test('maxNotional: 7'),
];
const builtOutputAvailable = builtFiles.length > 0 && builtText.length > 0;
const status = detectorSelfTest.every(Boolean) && builtOutputAvailable && Object.values(counts).every(value => value === 0) ? 'PASS' : 'FAIL';
const payload = {
  schema: 'VEREQO_P0_PUBLIC_SCAN_V1', generatedAt: new Date().toISOString(), status,
  scope: { privateFixtureFilesReadInMemory: privateFiles.length, publicFiles: publicFiles.length, publicTextFiles: publicText.length, builtFiles: builtFiles.length, builtTextFiles: builtText.length, builtOutputAvailable },
  checks: counts, detectorSelfTest: { passed: detectorSelfTest.filter(Boolean).length, total: detectorSelfTest.length },
  matchedValuesWritten: false,
};
const payloadSha256 = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const report = { ...payload, payloadSha256, payloadHashScope: 'JSON object excluding payloadSha256 and payloadHashScope' };
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o644 });
console.log(JSON.stringify({ status, scope: report.scope, checks: counts, detectorSelfTest: report.detectorSelfTest, matchedValuesWritten: false }));
if (status !== 'PASS') process.exitCode = 1;
