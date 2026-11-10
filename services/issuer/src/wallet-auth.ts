import { createHash, randomBytes } from 'node:crypto';
import { getAddress, verifyTypedData } from 'ethers';
import type { WalletChallenge } from '../../../packages/domain/src/wallet.js';
const TYPES = { WalletAuthentication: [{ name: 'address', type: 'address' }, { name: 'origin', type: 'string' }, { name: 'nonce', type: 'bytes32' }, { name: 'issuedAt', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' }] };
export type WalletAuthErrorCode = 'CHALLENGE_EXPIRED' | 'CHALLENGE_ALREADY_USED' | 'CHALLENGE_UNKNOWN' | 'ORIGIN_MISMATCH' | 'SIGNATURE_INVALID' | 'SESSION_CAPACITY';
export type WalletAuthServerStage = 'CHALLENGE_VALIDATED' | 'SIGNATURE_RECOVERY_REQUESTED' | 'SIGNATURE_RECOVERY_FAILED' | 'SIGNER_MISMATCH' | 'SIGNER_VERIFIED' | 'SESSION_CAPACITY' | 'SESSION_ISSUED';
export class WalletAuthError extends Error {
 constructor(readonly code: WalletAuthErrorCode, readonly diagnostic: string = code) { super(code); this.name = 'WalletAuthError'; }
}
/** Process-local authentication, separate from fixture CSRF and all financial authorization. Restart invalidates all sessions. */
export class WalletAuthRegistry {
 private challenges = new Map<string, WalletChallenge>();
 private sessions = new Map<string, { address: string; expiresAt: number }>();
 private retiredChallenges = new Map<string, { state: 'EXPIRED' | 'CONSUMED'; expiresAt: number }>();
 constructor(readonly origin: string, private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {
  if (new URL(origin).origin !== origin) throw Error('INVALID_ORIGIN');
 }
 private challengeKey(nonce: string): string { return createHash('sha256').update(nonce).digest('hex'); }
 private rememberChallenge(nonce: string, state: 'EXPIRED' | 'CONSUMED'): void {
  const key = this.challengeKey(nonce);
  this.retiredChallenges.delete(key);
  this.retiredChallenges.set(key, { state, expiresAt: this.now() + 600 });
  while (this.retiredChallenges.size > 512) {
   const oldest = this.retiredChallenges.keys().next().value;
   if (oldest === undefined) break;
   this.retiredChallenges.delete(oldest);
  }
 }
 private prune(): void {
  const now = this.now();
  for (const [key, value] of this.challenges) if (BigInt(value.value.expiresAt) <= BigInt(now)) { this.challenges.delete(key); this.rememberChallenge(key, 'EXPIRED'); }
  for (const [key, value] of this.sessions) if (value.expiresAt <= now) this.sessions.delete(key);
  for (const [key, value] of this.retiredChallenges) if (value.expiresAt <= now) this.retiredChallenges.delete(key);
 }
 /** Bounded hashed tombstones distinguish expired, consumed, and unknown challenges without retaining raw nonces. */
 knowsChallenge(nonce: string): boolean {
  this.prune();
  return this.challenges.has(nonce) || this.retiredChallenges.has(this.challengeKey(nonce));
 }
 issue(address: string): WalletChallenge {
  this.prune(); if (this.challenges.size >= 256) throw Error('AUTH_CAPACITY');
  const now = this.now(), nonce = `0x${randomBytes(32).toString('hex')}`;
  const challenge: WalletChallenge = { domain: { name: 'VEREQO Authentication', version: '1', chainId: '1439' }, types: structuredClone(TYPES), value: { address: getAddress(address), origin: this.origin, nonce, issuedAt: String(now), expiresAt: String(now + 120) } };
  this.challenges.set(nonce, structuredClone(challenge)); return challenge;
 }
 verify(nonce: string, signature: string, origin: string, observe: (stage: WalletAuthServerStage) => void = () => {}): string {
  const stage = (value: WalletAuthServerStage) => { try { observe(value); } catch { /* Diagnostics never control authorization. */ } };
  this.prune(); const challenge = this.challenges.get(nonce);
  if (!challenge) {
   const retired = this.retiredChallenges.get(this.challengeKey(nonce));
   if (retired?.state === 'EXPIRED') throw new WalletAuthError('CHALLENGE_EXPIRED');
   if (retired?.state === 'CONSUMED') throw new WalletAuthError('CHALLENGE_ALREADY_USED');
   throw new WalletAuthError('CHALLENGE_UNKNOWN');
  }
  if (origin !== this.origin) throw new WalletAuthError('ORIGIN_MISMATCH');
  stage('CHALLENGE_VALIDATED');
  // Synchronous recovery and consumption are atomic in this process. Invalid attempts also consume the challenge.
  this.challenges.delete(nonce); this.rememberChallenge(nonce, 'CONSUMED');
  stage('SIGNATURE_RECOVERY_REQUESTED');
  let recovered: string;
  try { recovered = verifyTypedData(challenge.domain, challenge.types, challenge.value, signature); }
  catch { stage('SIGNATURE_RECOVERY_FAILED'); throw new WalletAuthError('SIGNATURE_INVALID', 'SIGNATURE_RECOVERY_FAILED'); }
  if (recovered !== challenge.value.address) { stage('SIGNER_MISMATCH'); throw new WalletAuthError('SIGNATURE_INVALID', 'SIGNER_MISMATCH'); }
  stage('SIGNER_VERIFIED');
  if (this.sessions.size >= 256) { stage('SESSION_CAPACITY'); throw new WalletAuthError('SESSION_CAPACITY'); }
  const token = randomBytes(32).toString('hex');
  this.sessions.set(token, { address: challenge.value.address, expiresAt: this.now() + 600 });
  stage('SESSION_ISSUED');
  return token;
 }
 authenticate(token: string): { address: string; origin: string; expiresAt: number } | null {
  this.prune(); const session = this.sessions.get(token); return session ? { ...session, origin: this.origin } : null;
 }
 revoke(token: string): void { this.sessions.delete(token); }
}
