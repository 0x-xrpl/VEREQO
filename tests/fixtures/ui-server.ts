import { createLocalApp } from '../../services/issuer/src/http';

const app = createLocalApp({ databasePath: ':memory:' });
app.server.listen(0, '127.0.0.1', () => {
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  process.send?.({ port: address.port });
});
process.on('message', message => {
  if (message === 'stop') void app.close().then(() => { process.disconnect(); process.exit(0); });
});
