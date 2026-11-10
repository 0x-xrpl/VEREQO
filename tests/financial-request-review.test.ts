import { afterEach, describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalApp } from '../services/issuer/src/http.js';
import { InjectiveReadAdapter } from '../packages/domain/src/live-injective.js';

const closers: (() => Promise<void>)[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('owner-authenticated unsigned draft review', () => {
  it('records digest-only fail-closed evidence under the same Business ID and preserves owner/idempotency boundaries', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vereqo-request-review-'));
    directories.push(directory);
    let networkReads = 0;
    const injective = new InjectiveReadAdapter(async () => {
      networkReads++;
      throw Error('REQUEST_REVIEW_MUST_NOT_READ_CHAIN');
    });
    const app = createLocalApp({ databasePath: join(directory, 'issuer.sqlite'), injective });
    let open = true;
    closers.push(async () => { if (open) { open = false; await app.close(); } });
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw Error('LISTENER');
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown, session?: string) => fetch(base + path, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...(session ? { 'x-vereqo-session': session } : {}) }, body: JSON.stringify(body),
    });
    const get = (path: string, session?: string) => fetch(base + path, {
      headers: { origin: base, ...(session ? { 'x-vereqo-session': session } : {}) },
    });
    const issueSession = async (wallet: Wallet) => {
      const challengeResponse = await post('/api/wallet/challenge', { address: wallet.address });
      expect(challengeResponse.status).toBe(200);
      const { challenge } = await challengeResponse.json() as { challenge: {
        domain: Record<string, unknown>; types: Record<string, Array<{ name: string; type: string }>>;
        value: { nonce: string };
      } };
      const signature = await wallet.signTypedData(challenge.domain, challenge.types, challenge.value);
      const verify = await post('/api/wallet/verify', { nonce: challenge.value.nonce, signature });
      expect(verify.status).toBe(200);
      return (await verify.json() as { session: string }).session;
    };

    const owner = new Wallet('0x' + '11'.repeat(32));
    const other = new Wallet('0x' + '22'.repeat(32));
    const ownerSession = await issueSession(owner);
    const otherSession = await issueSession(other);
    const requestId = 'fi_0123456789abcdef0123456789abcdef';
    const draft = { chainId: '1439', marketKind: 'SPOT', marketId: '0x' + 'ab'.repeat(32), side: 'BUY', orderType: 'LIMIT', price: '2.00', quantity: '1' };
    const body = { requestId, draft };

    expect((await post('/api/agent/request-review', body)).status).toBe(401);
    const firstResponse = await post('/api/agent/request-review', body, ownerSession);
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as { status: string; reason: string; authorized: boolean; execution: string; evidence: Record<string, unknown> };
    expect(first).toMatchObject({ status: 'REJECTED', reason: 'SIGNED_AUTHORIZATION_PACKAGE_REQUIRED', authorized: false, execution: 'NOT_IMPLEMENTED' });
    expect(first.evidence).toMatchObject({ requestId, principal: owner.address.toLowerCase(), status: 'REJECTED', reason: 'SIGNED_AUTHORIZATION_PACKAGE_REQUIRED' });
    expect(first.evidence.requestDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.evidence).not.toHaveProperty('proof');
    expect(first.evidence).not.toHaveProperty('witness');

    const retry = await post('/api/agent/request-review', body, ownerSession);
    expect((await retry.json() as { evidence: { id: string } }).evidence.id).toBe(first.evidence.id);
    const changed = await post('/api/agent/request-review', { ...body, draft: { ...draft, price: '3' } }, ownerSession);
    expect(await changed.json()).toMatchObject({ status: 'REJECTED', reason: 'REQUEST_ID_CONFLICT', authorized: false, execution: 'NOT_IMPLEMENTED' });

    const history = await get('/api/agent/authorization/' + requestId, ownerSession);
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ evidence: { id: expect.any(String), requestId, status: 'REJECTED' }, events: [
      { reason: 'REQUEST_ID_CONFLICT' }, { id: first.evidence.id, reason: 'SIGNED_AUTHORIZATION_PACKAGE_REQUIRED' },
    ] });
    expect((await get('/api/agent/authorization/' + requestId, otherSession)).status).toBe(404);
    expect(networkReads).toBe(0);
  });
});
