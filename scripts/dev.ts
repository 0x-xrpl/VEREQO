import { createServer } from 'vite';
import { createConfiguredLocalApp } from '../services/issuer/src/configured-app';

process.umask(0o077);
const databasePath = process.env.VEREQO_DEMO_IN_MEMORY === '1' ? ':memory:' : '.local/issuer.sqlite';
const app = await createConfiguredLocalApp(databasePath);
await new Promise<void>((resolve, reject) => {
  app.server.once('error', reject); app.server.listen(4317, '127.0.0.1', resolve);
});
try {
  const vite = await createServer(); await vite.listen(); vite.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void Promise.all([vite.close(), app.close()]).then(() => process.exit(0));
  });
} catch (e) { await app.close(); throw e; }
