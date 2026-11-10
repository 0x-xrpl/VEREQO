import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const output = 'submission/hacker-house-2026/EVIDENCE_MANIFEST.json';
const directories = ['demo/hacker-house', 'docs/evidence/operation-59/browser', 'submission/hacker-house-2026'];
const files = [
  'apps/web/src/components/FinancialObjectTrace.tsx',
  'apps/web/src/components/FinancialWorkflow.tsx',
  'apps/web/src/components/Landing.tsx',
  'apps/web/src/components/ScenarioRehearsal.tsx',
  'apps/web/src/financial.css',
  'docs/evidence/operation-59/npm-check.log',
  'docs/evidence/operation-59/final-review-race.log',
  'docs/evidence/operation-59/smoke.log',
  'docs/STATE.md',
  'package.json',
  'packages/domain/src/rehearsal.ts',
  'packages/domain/src/wallet.ts',
  'README.md',
  'README.ja.md',
  'scripts/operation59-browser-qa.ts',
  'scripts/operation59-manifest.mjs',
  'services/issuer/src/demo-rehearsal.ts',
  'services/issuer/src/http.ts',
  'tests/demo-rehearsal.test.ts',
  'tests/financial-workflow.test.tsx',
];

function walk(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink() || path === output || path === 'demo/hacker-house/private' || path.startsWith('demo/hacker-house/private/')) continue;
    if (entry.isDirectory()) result.push(...walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

const paths = new Set(files.filter(path => existsSync(resolve(root, path))));
for (const directory of directories) for (const path of walk(directory)) paths.add(path);
const artifacts = [...paths].sort().map(path => {
  const content = readFileSync(resolve(root, path));
  return { path, bytes: content.byteLength, sha256: createHash('sha256').update(content).digest('hex') };
});
const manifest = {
  schemaVersion: '1.0.0',
  operation: 'VEREQO Operation 59',
  generatedAtUtc: new Date().toISOString(),
  hashAlgorithm: 'SHA-256',
  scope: 'Local synthetic demo source, browser screenshots/video, test logs and application preparation documents. No live financial execution evidence.',
  exclusions: ['demo/hacker-house/private/**', 'EVIDENCE_MANIFEST.json itself'],
  artifactCount: artifacts.length,
  artifacts,
};
writeFileSync(resolve(root, output), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ output, artifactCount: artifacts.length, hashAlgorithm: manifest.hashAlgorithm }));
