import { createServer } from 'vite';
import { createLocalApp } from '../services/issuer/src/http';

process.umask(0o077);
const app = createLocalApp({ databasePath: '.local/issuer.sqlite' });
await new Promise<void>((resolve, reject) => {
  app.server.once('error', reject); app.server.listen(4317, '127.0.0.1', resolve);
});
try {
  const vite = await createServer(); await vite.listen(); vite.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void Promise.all([vite.close(), app.close()]).then(() => process.exit(0));
  });
} catch (e) { await app.close(); throw e; }
