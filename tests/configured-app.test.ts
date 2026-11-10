import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfiguredLocalApp, loadAuthorizationAdapters } from '../services/issuer/src/configured-app.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const address = (digit: string) => '0x' + digit.repeat(40);
const hash = (digit: string) => '0x' + digit.repeat(64);
function adapterModule(mutate = '') {
  const dir = mkdtempSync(join(tmpdir(), 'verequo-adapter-')); dirs.push(dir);
  const file = join(dir, 'adapter.mjs');
  const value = {
    agentPolicy: { principal: address('1'), agent: address('2'), issuer: address('3'), gate: address('4'), credentialId: hash('8'), credentialEpoch: '1', policyEpoch: '1', marketId: hash('9'), subaccountId: address('4') + '0'.repeat(24), maxNotional: '100000', maxFeeRate: '1000', maxTotalExposure: '110000' },
    agentProvider: { configured: true, id: 'synthetic-composition-test' },
    financialAuthorization: { gateManifest: { chainId: '1439', gate: address('4'), gateCodeHash: hash('6'), issuer: address('3'), principal: address('1'), verifier: address('5'), verifierCodeHash: hash('7') } }
  };
  writeFileSync(file, `export function createAuthorizationAdapters() {
    const value = ${JSON.stringify(value)};
    for (const name of ['currentMandate','readGateMandate','readCurrentDisclosureHistory','verifyProof']) value.financialAuthorization[name] = () => { throw Error('NOT_INVOKED_BY_STARTUP'); };
    ${mutate}
    return value;
  }`, { mode: 0o600 });
  return file;
}
async function status(modulePath?: string) {
  const app = await createConfiguredLocalApp(':memory:', modulePath);
  try {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const listener = app.server.address(); if (!listener || typeof listener === 'string') throw Error('NO_LISTENER');
    return await (await fetch(`http://127.0.0.1:${listener.port}/api/agent/status`)).json();
  } finally { await app.close(); }
}

it('keeps the unconfigured loader empty without inventing adapters', async () => {
  expect(await loadAuthorizationAdapters(undefined)).toEqual({});
});
it('composes operator adapters into the actual HTTP app without claiming autonomous execution', async () => {
  expect(await status(adapterModule())).toEqual({ status: 'CONFIGURED_INGRESS', providerConfigured: true, autonomousRuntime: 'NOT_IMPLEMENTED', execution: 'NOT_IMPLEMENTED' });
});
it('injects a callable single-request runtime while leaving autonomous execution unclaimed', async () => {
  expect(await status(adapterModule('value.agentRuntime = { generateProposal: async () => ({}) };'))).toMatchObject({ requestRuntime: 'UNSIGNED_PROPOSAL_GENERATION', autonomousRuntime: 'CONFIGURED_NOT_VERIFIED', execution: 'NOT_IMPLEMENTED' });
});
it('requires an explicit absolute local module path', async () => {
  await expect(loadAuthorizationAdapters('./adapter.mjs')).rejects.toThrow('AUTHORIZATION_ADAPTER_ABSOLUTE_PATH_REQUIRED');
  await expect(loadAuthorizationAdapters('https://example.invalid/adapter.mjs')).rejects.toThrow('AUTHORIZATION_ADAPTER_ABSOLUTE_PATH_REQUIRED');
});
it.each([
  "delete value.financialAuthorization.readCurrentDisclosureHistory;",
  "value.agentPolicy.issuer = '0x' + '6'.repeat(40);",
  "value.agentProvider.configured = false;",
  "value.databasePath = 'caller-selected.sqlite';",
  "value.agentPolicy.maxFeeRate = '1000000000000000001';",
  "value.agentRuntime = {};"
])('rejects incomplete or inconsistent server adapters before app creation: %s', async mutate => {
  await expect(loadAuthorizationAdapters(adapterModule(mutate))).rejects.toThrow('AUTHORIZATION_ADAPTER_LOAD_FAILED');
});
it('redacts adapter initialization errors and retains no sensitive cause', async () => {
  const error = await loadAuthorizationAdapters(adapterModule("throw Error('TEST_ONLY_SENSITIVE_INITIALIZATION_MESSAGE');")).catch(error => error);
  expect(error.message).toBe('AUTHORIZATION_ADAPTER_LOAD_FAILED');
  expect(error.cause).toBeUndefined();
  expect(String(error.stack)).not.toContain('TEST_ONLY_SENSITIVE_INITIALIZATION_MESSAGE');
});
