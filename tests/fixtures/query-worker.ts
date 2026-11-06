import { DatabaseSync } from 'node:sqlite';
import { IssuerStore } from '../../services/issuer/src/store';

const [file, threshold, key] = process.argv.slice(2);
if (!file || !threshold || !key) throw new Error('Invalid worker arguments');
const store = new IssuerStore(new DatabaseSync(file));
process.send?.('ready');
process.on('message', () => {
  try {
    const result = store.request({ principal: 'broker', scope: { issuer: 'issuer', subject: 'subject', cohort: 'cohort' } },
      { threshold: Number(threshold), idempotencyKey: key, policyEpoch: 1 });
    process.send?.({ result });
  } catch (e) { process.send?.({ error: e instanceof Error ? e.message : 'error' }); }
  finally { store.close(); process.disconnect(); }
});
