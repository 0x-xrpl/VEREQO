import { createLocalApp } from './http';

process.umask(0o077);
const app = createLocalApp({ databasePath: '.local/issuer.sqlite' });
app.server.listen(4317, '127.0.0.1', () => console.log('VEREQO LOCAL_REFERENCE — http://127.0.0.1:4317'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
