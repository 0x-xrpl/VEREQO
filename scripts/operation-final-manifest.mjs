import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const outputPath = 'docs/evidence/operation-final/SHA256SUMS.txt';
const manifestPath = resolve(root, outputPath);
const requiredFiles = [
  'README.md',
  'README.ja.md',
  'apps/web/public/brand/VEREQO_HORIZONTAL_SOLID.png',
  'apps/web/public/brand/VEREQO_HORIZONTAL_SOLID.svg',
  'apps/web/src/components/FinancialObjectTrace.tsx',
  'apps/web/src/components/FinancialWorkflow.tsx',
  'apps/web/src/components/ScenarioRehearsal.tsx',
  'contracts/test/FinancialAuthorizationE2E.t.sol',
  'demo/hacker-house/scenarios/S08-proof-is-not-authority.json',
  'docs/STATE.md',
  'docs/TESTNET_T5_T6_EXECUTION_GATE.md',
  'docs/brand/BRAND_AND_MOTION_SYSTEM.md',
  'docs/brand/LOGO_SOURCE_INVENTORY.md',
  'package.json',
  'packages/domain/src/rehearsal.ts',
  'scripts/operation-final-film-render.mjs',
  'scripts/operation-final-manifest.mjs',
  'scripts/operation-final-public-scan.mjs',
  'scripts/operation-final-s08-browser-qa.ts',
  'scripts/operation59-browser-qa.ts',
  'services/issuer/src/demo-rehearsal.ts',
  'services/issuer/src/http.ts',
  'tests/demo-rehearsal.test.ts',
  'tests/financial-authorization.test.ts',
  'tests/financial-object-trace.test.tsx',
  'submission/hacker-house-2026/APPLICATION_EN.md',
  'submission/hacker-house-2026/APPLICATION_REVIEW_JA.md',
  'submission/hacker-house-2026/DEMO_90S_SCRIPT_EN.md',
  'submission/hacker-house-2026/EVIDENCE_INDEX.md',
  'submission/hacker-house-2026/FINAL_APPLICATION_EN.md',
  'submission/hacker-house-2026/FINAL_APPLICATION_REVIEW_JA.md',
  'submission/hacker-house-2026/FINAL_DELIVERABLES_AND_LINKS.md',
  'submission/hacker-house-2026/FINAL_FILM_CAPTIONS_EN.srt',
  'submission/hacker-house-2026/FINAL_FILM_EDIT_MASTER.md',
  'submission/hacker-house-2026/FINAL_FILM_SCRIPT_EN.md',
  'submission/hacker-house-2026/FINAL_PITCH_DECK_EN_v2.pdf',
  'submission/hacker-house-2026/FINAL_PITCH_DECK_EN_v2.pptx',
  'submission/hacker-house-2026/ONE_PAGER_EN.md',
  'submission/hacker-house-2026/OPERATION_FINAL_NINE_ROUND_REVIEW_JA.md',
  'submission/hacker-house-2026/PRODUCT_STATUS.md',
  'submission/hacker-house-2026/REPRODUCE.md',
  'submission/hacker-house-2026/SECURITY_AND_IP_REVIEW.md',
  'submission/hacker-house-2026/START_HERE.md',
  'submission/hacker-house-2026/TECHNICAL_APPENDIX.md',
  'submission/hacker-house-2026/media/VEREQO_OPERATION_FINAL_MAIN_FILM_4M20S_SILENT_REVIEW.mp4',
  'submission/hacker-house-2026/media/operation-final-film-render-validation.json',
];
const walk = (path) => {
  const stat = statSync(path);
  return stat.isDirectory()
    ? readdirSync(path).flatMap((name) => walk(join(path, name)))
    : stat.isFile() ? [path] : [];
};
const paths = new Set(requiredFiles.map((path) => resolve(root, path)));
for (const tree of [
  resolve(root, 'docs/evidence/operation-final'),
]) {
  for (const path of walk(tree)) paths.add(path);
}
paths.delete(manifestPath);
const sorted = [...paths].sort((a, b) => {
  const left = relative(root, a);
  const right = relative(root, b);
  return left < right ? -1 : left > right ? 1 : 0;
});
const rows = sorted.map((path) => {
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  return `${digest}  ${relative(root, path).replaceAll('\\', '/')}`;
});
const content = rows.join('\n') + '\n';
if (process.argv.includes('--verify')) {
  const current = readFileSync(manifestPath, 'utf8');
  if (current !== content) {
    console.error(JSON.stringify({ status: 'FAIL', entries: rows.length, reason: 'MANIFEST_MISMATCH' }));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ status: 'PASS', entries: rows.length, manifest: outputPath }));
  }
} else {
  writeFileSync(manifestPath, content, { mode: 0o600 });
  console.log(JSON.stringify({ status: 'UPDATED', entries: rows.length, manifest: outputPath }));
}
