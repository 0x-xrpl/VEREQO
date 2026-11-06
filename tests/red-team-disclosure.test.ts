import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { admit, normalizeQuery } from '../packages/disclosure/src/index';
import { IssuerStore } from '../services/issuer/src/store';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const clean of cleanup.splice(0).reverse()) clean(); });
const context = { principal: 'broker', scope: { issuer: 'issuer', subject: 'subject', cohort: 'cohort' } };
describe('independent disclosure red team', () => {
  it('matches an arithmetic oracle for every interval of at least k and every normalized threshold', () => {
    let count = 0;
    for (let lo = 0; lo < 128; lo++) for (let hi = lo + 15; hi < 128; hi++) {
      const candidates = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      for (let threshold = -1; threshold <= 127; threshold++) {
        const yes = Math.max(0, Math.min(threshold, hi) - lo + 1), no = candidates.length - yes;
        const expected = (yes === 0 || yes >= 16) && (no === 0 || no >= 16);
        const actual = admit(candidates, normalizeQuery(threshold), { epoch: 1, minCandidates: 16 });
        if ((actual.status === 'ALLOWED') !== expected || actual.partitions.yes !== yes || actual.partitions.no !== no)
          throw new Error(`admission mismatch at interval ${lo}:${hi}, threshold ${threshold}`);
        count++;
      }
    }
    expect(count).toBe(830889);
  });

  it.each(['before-commit', 'after-commit'])('recovers after actual SIGKILL %s, without duplicate release', async phase => {
    const dir = mkdtempSync(join(tmpdir(), 'vereqo-crash-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'issuer.sqlite');
    const initial = new IssuerStore(new DatabaseSync(file));
    initial.provision(context.scope, context.principal, 74);
    for (const threshold of [100, 80]) initial.request(context, { threshold, policyEpoch: 1, idempotencyKey: `first-${threshold}` });
    initial.close();
    const killed = fork(join(process.cwd(), 'tests/fixtures/crash-worker.ts'), [file, phase],
      { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    cleanup.push(() => { killed.kill(); });
    let output = ''; killed.stdout?.on('data', chunk => { output += String(chunk); });
    const signal = await new Promise<NodeJS.Signals | null>((resolve, reject) => {
      killed.once('error', reject); killed.once('exit', (_code, sig) => resolve(sig));
    });
    expect(signal).toBe('SIGKILL'); expect(output).toBe('');
    const recovered = new IssuerStore(new DatabaseSync(file)); cleanup.push(() => recovered.close());
    expect(recovered.view(context).history).toHaveLength(phase === 'before-commit' ? 2 : 3);
    const reply = recovered.request(context, { threshold: 40, policyEpoch: 1, idempotencyKey: 'crash-request' });
    expect(reply.sequence).toBe(3); expect(reply.answer).toBe(false);
    expect(recovered.view(context).history).toHaveLength(3);
    expect(recovered.view(context).candidates).toHaveLength(40);
  });
});
