import { describe, expect, it } from 'vitest';
import { Wallet, toBeHex, zeroPadValue } from 'ethers';
import { canonicalBusinessRequestId } from '../packages/domain/src/native-order.js';
import { disclosureBindingDigest, disclosureBindingTypedData, verifyDisclosureBinding } from '../packages/domain/src/disclosure-binding.js';

const key = (n: number) => zeroPadValue(toBeHex(n), 32);
const issuer = new Wallet(key(123));
const principal = new Wallet(key(456));
const agent = new Wallet(key(789));
const gate = '0x0000000000000000000000000000000000000456';
const credentialId = `0x${'11'.repeat(32)}`;
const now = '1700000000';
const requestId = 'business-request-1';
const context = (patch: Record<string, string> = {}) => ({
  requestId, gate, issuer: issuer.address, principal: principal.address, agent: agent.address,
  credentialId, policyEpoch: '4', credentialEpoch: '7', intentDeadline: '1700000200', now, ...patch,
});
const binding = (patch: Record<string, string> = {}) => ({
  issuer: issuer.address, principal: principal.address, agent: agent.address, credentialId,
  requestIdHash: canonicalBusinessRequestId(requestId), historyRoot: `0x${'ab'.repeat(32)}`,
  historySequence: '12', policyEpoch: '4', credentialEpoch: '7', issuedAt: now, expiresAt: '1700000100', ...patch,
});
async function envelope(values = binding()) {
  const typed = disclosureBindingTypedData(values, gate);
  return { binding: values, signature: await issuer.signTypedData(typed.domain, typed.types, typed.value) };
}

describe('issuer-signed disclosure history binding', () => {
  it('validates the exact issuer, owner, Agent, credential, Request ID, epochs and Gate domain', async () => {
    const signed = await envelope();
    expect(verifyDisclosureBinding(signed, context())).toMatchObject({
      binding: { historyRoot: `0x${'ab'.repeat(32)}`, historySequence: '12' },
      signer: issuer.address,
      digest: disclosureBindingDigest(signed.binding, gate),
    });
  });

  it('rejects replay under a different Business Request ID', async () => {
    const signed = await envelope();
    expect(() => verifyDisclosureBinding(signed, context({ requestId: 'business-request-2' })))
      .toThrow('DISCLOSURE_REQUEST_ID_MISMATCH');
  });

  it('rejects Agent, credential and epoch substitution', async () => {
    const signed = await envelope();
    expect(() => verifyDisclosureBinding(signed, context({ agent: principal.address }))).toThrow('DISCLOSURE_AGENT_MISMATCH');
    expect(() => verifyDisclosureBinding(signed, context({ credentialId: `0x${'22'.repeat(32)}` }))).toThrow('DISCLOSURE_CREDENTIAL_MISMATCH');
    expect(() => verifyDisclosureBinding(signed, context({ policyEpoch: '5' }))).toThrow('DISCLOSURE_EPOCH_MISMATCH');
  });

  it('rejects altered history roots and signatures from a different issuer', async () => {
    const signed = await envelope();
    expect(() => verifyDisclosureBinding({ ...signed, binding: { ...signed.binding, historyRoot: `0x${'cd'.repeat(32)}` } }, context()))
      .toThrow('DISCLOSURE_ISSUER_SIGNATURE_MISMATCH');
    const spoof = { ...signed.binding, issuer: agent.address };
    const typed = disclosureBindingTypedData(spoof, gate);
    const forged = { binding: spoof, signature: await agent.signTypedData(typed.domain, typed.types, typed.value) };
    expect(() => verifyDisclosureBinding(forged, context())).toThrow('DISCLOSURE_ISSUER_MISMATCH');
  });

  it('rejects expired, overlong and intent-deadline-exceeding attestations', async () => {
    const expired = await envelope(binding({ issuedAt: '1699999600', expiresAt: '1699999999' }));
    expect(() => verifyDisclosureBinding(expired, context())).toThrow('DISCLOSURE_BINDING_EXPIRED_OR_STALE');
    const long = await envelope(binding({ expiresAt: '1700000400' }));
    expect(() => verifyDisclosureBinding(long, context({ intentDeadline: '1700000500' }))).toThrow('DISCLOSURE_BINDING_EXPIRED_OR_STALE');
    const afterIntent = await envelope(binding({ expiresAt: '1700000300' }));
    expect(() => verifyDisclosureBinding(afterIntent, context())).toThrow('DISCLOSURE_BINDING_EXPIRED_OR_STALE');
  });
});
