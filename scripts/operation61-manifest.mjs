import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const outputPath = 'docs/evidence/operation-61/SHA256SUMS.txt';
const manifestPath = resolve(root, outputPath);
const requiredFiles = [
  'README.md',
  'README.ja.md',
  'docs/STATE.md',
  'apps/web/src/components/FinancialWorkflow.tsx',
  'services/issuer/src/http.ts',
  'tests/financial-authorization.test.ts',
  'tests/financial-workflow.test.tsx',
  'scripts/operation61-manifest.mjs',
  'docs/evidence/operation-60/stage-4/control-deck-90s.mp4',
  'docs/evidence/operation-60/stage-4/control-deck-3min.mp4',
];
const evidenceRoot = resolve(root, 'docs/evidence/operation-61');
const buildRoot = resolve(root, 'dist/web');
const submissionRoot = resolve(root, 'submission/hacker-house-2026');
const walk = (path) => {
  const stat = statSync(path);
  return stat.isDirectory()
    ? readdirSync(path).flatMap((name) => walk(join(path, name)))
    : stat.isFile() ? [path] : [];
};
const paths = new Set(requiredFiles.map((path) => resolve(root, path)));
for (const tree of [evidenceRoot, buildRoot, submissionRoot]) {
  for (const path of walk(tree)) paths.add(path);
}
paths.delete(manifestPath);
const sorted = [...paths].sort((a, b) => { const left = relative(root, a); const right = relative(root, b); return left < right ? -1 : left > right ? 1 : 0; });
const rows = sorted.map((path) => {
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  return digest + '  ' + relative(root, path).replaceAll('\\', '/');
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
