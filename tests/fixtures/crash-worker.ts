import { DatabaseSync } from 'node:sqlite';
import { IssuerStore } from '../../services/issuer/src/store';

const [file, phase] = process.argv.slice(2);
if (!file || !['before-commit', 'after-commit'].includes(phase ?? '')) throw new Error('invalid crash arguments');
const kill = () => { process.kill(process.pid, 'SIGKILL'); };
const store = new IssuerStore(new DatabaseSync(file), phase === 'before-commit' ? kill : () => {});
// No result is serialized. The caller observes termination/uncertain delivery.
store.request({ principal: 'broker', scope: { issuer: 'issuer', subject: 'subject', cohort: 'cohort' } },
  { threshold: 40, policyEpoch: 1, idempotencyKey: 'crash-request' });
kill();
