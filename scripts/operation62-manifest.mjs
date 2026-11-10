import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const outputPath = 'docs/evidence/operation-62/SHA256SUMS.txt';
const manifestPath = resolve(root, outputPath);
const requiredFiles = [
  'README.md',
  'README.ja.md',
  'apps/web/index.html',
  'apps/web/public/fonts/SOURCES.json',
  'apps/web/src/App.tsx',
  'apps/web/src/components/Landing.tsx',
  'apps/web/src/landing.css',
  'apps/web/src/styles.css',
  'docs/ARCHITECTURE.md',
  'docs/SECURITY.md',
  'docs/STATE.md',
  'docs/TESTNET_T5_T6_EXECUTION_GATE.md',
  'scripts/browser-qa.ts',
  'scripts/operation62-testnet-read.mjs',
  'scripts/operation62-manifest.mjs',
  'scripts/operation62-film-render.mjs',
  'scripts/operation62-public-scan.mjs',
  'tests/landing.test.tsx',
  'submission/hacker-house-2026/EVIDENCE_INDEX.md',
  'submission/hacker-house-2026/FORM_FIELD_CHECKLIST.md',
  'submission/hacker-house-2026/FINAL_APPLICATION_EN.md',
  'submission/hacker-house-2026/FINAL_APPLICATION_REVIEW_JA.md',
  'submission/hacker-house-2026/FINAL_DELIVERABLES_AND_LINKS.md',
  'submission/hacker-house-2026/FINAL_FILM_CAPTIONS_EN.srt',
  'submission/hacker-house-2026/FINAL_FILM_SCRIPT_EN.md',
  'submission/hacker-house-2026/FINAL_FILM_EDIT_MASTER.md',
  'submission/hacker-house-2026/FINAL_PITCH_DECK_EN_v2.pdf',
  'submission/hacker-house-2026/FINAL_PITCH_DECK_EN_v2.pptx',
  'submission/hacker-house-2026/FINAL_PITCH_STORYBOARD.md',
  'submission/hacker-house-2026/TECHNICAL_APPENDIX.md',
  'submission/hacker-house-2026/THREE_ROUND_JURY_REVIEW.md',
  'submission/hacker-house-2026/VERCEL_RELEASE_READINESS.md',
];
const walk = (path) => {
  const stat = statSync(path);
  return stat.isDirectory()
    ? readdirSync(path).flatMap((name) => walk(join(path, name)))
    : stat.isFile() ? [path] : [];
};
const paths = new Set(requiredFiles.map((path) => resolve(root, path)));
for (const tree of [
  resolve(root, 'apps/web/public/brand'),
  resolve(root, 'apps/web/public/fonts'),
  resolve(root, 'docs/brand'),
  resolve(root, 'docs/evidence/operation-62'),
  resolve(root, 'submission/hacker-house-2026/media'),
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
