import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, chmod, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Wallet } from 'ethers';
import { canonicalBusinessRequestId } from '../packages/domain/src/native-order.js';
import { assertCurrentDisclosureHistory } from '../services/issuer/src/financial-authorization.js';
import { verifyDisclosureBinding } from '../packages/domain/src/disclosure-binding.js';
import { verifyIssuerOrderMandate } from '../packages/domain/src/order-mandate.js';
import { loadOperatorIssuerSigner, loadOperatorIssuerSignerFromEnvironment } from '../services/issuer/src/operator-issuer-signer.js';

const temporaryDirectories: string[] = [];
afterEach(async () => { for (const path of temporaryDirectories.splice(0)) await rm(path, { recursive: true, force: true }); });

async function operatorKey() {
  const wallet = Wallet.createRandom();
  const directory = await mkdtemp(join(tmpdir(), 'vereqo-issuer-demo-'));
  temporaryDirectories.push(directory);
  await chmod(directory, 0o700);
  const keyDirectory = join(directory, 'private');
  await mkdir(keyDirectory, { mode: 0o700 });
  const keyFilePath = join(keyDirectory, 'issuer.key');
  await writeFile(keyFilePath, `${wallet.privateKey}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { wallet, keyFilePath };
}

function mandate(issuer: string, gate: string, principal: string, agent: string) {
  return {
    chainId: '1439', verifyingContract: gate, issuer, principal, agent,
    credentialId: `0x${'11'.repeat(32)}`, commitment: `0x${'22'.repeat(32)}`,
    credentialEpoch: '1', policyEpoch: '1', expiry: '1700000100', cap: '3000000000000000000',
    marketId: `0x${'33'.repeat(32)}`, subaccountId: `0x${gate.slice(2)}${'00'.repeat(12)}`,
    marketConfigHash: `0x${'44'.repeat(32)}`, priceTick: '1', quantityTick: '1', maxFeeRate: '1', active: true,
  };
}

describe('operator-managed local DEMO Issuer signer', () => {
  it('signs and verifies the existing disclosure and mandate typed data, then still rejects revocation', async () => {
    const { wallet, keyFilePath } = await operatorKey();
    const principal = Wallet.createRandom().address, agent = Wallet.createRandom().address, gate = Wallet.createRandom().address;
    const signer = await loadOperatorIssuerSigner({ mode: 'LOCAL_DEMO', keyFilePath, expectedIssuerAddress: wallet.address, repositoryRoot: process.cwd() });
    expect(signer).toMatchObject({ issuerAddress: wallet.address, provenance: 'OPERATOR_MANAGED_LOCAL_DEMO' });

    const requestId = 'issuer-demo-request';
    const binding = {
      issuer: wallet.address, principal, agent, credentialId: `0x${'11'.repeat(32)}`,
      requestIdHash: canonicalBusinessRequestId(requestId), historyRoot: `0x${'55'.repeat(32)}`,
      historySequence: '4', policyEpoch: '2', credentialEpoch: '3', issuedAt: '1700000000', expiresAt: '1700000060',
    };
    const disclosureSignature = await signer.signDisclosureBinding(binding, gate);
    const verified = verifyDisclosureBinding({ binding, signature: disclosureSignature }, {
      requestId, gate, issuer: wallet.address, principal, agent, credentialId: binding.credentialId,
      policyEpoch: binding.policyEpoch, credentialEpoch: binding.credentialEpoch, intentDeadline: '1700000090', now: '1700000000',
    });
    expect(verified.signer).toBe(wallet.address);
    expect(() => assertCurrentDisclosureHistory(binding, { ...binding, active: false })).toThrow('DISCLOSURE_CREDENTIAL_REVOKED');

    const signedMandate = mandate(wallet.address, gate, principal, agent);
    const mandateSignature = await signer.signOrderMandate(signedMandate);
    expect(verifyIssuerOrderMandate(signedMandate, mandateSignature)).toBe(true);
    expect(verifyIssuerOrderMandate({ ...signedMandate, issuer: Wallet.createRandom().address }, mandateSignature)).toBe(false);
  });

  it('requires explicit LOCAL_DEMO mode and a key path instead of reading key material from env', async () => {
    await expect(loadOperatorIssuerSignerFromEnvironment(Wallet.createRandom().address, process.cwd(), {}))
      .rejects.toThrow('OPERATOR_ISSUER_LOCAL_DEMO_NOT_ENABLED');
    await expect(loadOperatorIssuerSignerFromEnvironment(Wallet.createRandom().address, process.cwd(), { VEREQO_OPERATOR_ISSUER_MODE: 'LOCAL_DEMO' }))
      .rejects.toThrow('OPERATOR_ISSUER_KEY_FILE_REQUIRED');
  });

  it('rejects a key file inside the repository without reading it', async () => {
    const path = resolve(process.cwd(), 'package.json');
    await expect(loadOperatorIssuerSigner({ mode: 'LOCAL_DEMO', keyFilePath: path, expectedIssuerAddress: Wallet.createRandom().address, repositoryRoot: process.cwd() }))
      .rejects.toThrow('OPERATOR_ISSUER_KEY_LOCATION_INVALID');
  });

  it('rejects group/world-readable and symlink key files', async () => {
    const first = await operatorKey();
    await chmod(first.keyFilePath, 0o640);
    await expect(loadOperatorIssuerSigner({ mode: 'LOCAL_DEMO', keyFilePath: first.keyFilePath, expectedIssuerAddress: first.wallet.address, repositoryRoot: process.cwd() }))
      .rejects.toThrow('OPERATOR_ISSUER_KEY_PERMISSIONS');

    const second = await operatorKey();
    const linkPath = join(join(second.keyFilePath, '..'), 'issuer-link.key');
    await symlink(second.keyFilePath, linkPath);
    await expect(loadOperatorIssuerSigner({ mode: 'LOCAL_DEMO', keyFilePath: linkPath, expectedIssuerAddress: second.wallet.address, repositoryRoot: process.cwd() }))
      .rejects.toThrow('OPERATOR_ISSUER_KEY_LOCATION_INVALID');
  });

  it('rejects a signer whose address does not match the configured Issuer identity', async () => {
    const { keyFilePath } = await operatorKey();
    await expect(loadOperatorIssuerSigner({ mode: 'LOCAL_DEMO', keyFilePath, expectedIssuerAddress: Wallet.createRandom().address, repositoryRoot: process.cwd() }))
      .rejects.toThrow('OPERATOR_ISSUER_IDENTITY_MISMATCH');
  });
});
