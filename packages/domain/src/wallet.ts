import { getAddress, type TypedDataDomain, type TypedDataField } from 'ethers';
export const WALLET_CHAIN_ID = '0x59f';

/** Pure network guard shared by wallet flows and rehearsal checks. */
export function isInjectiveChainId(value: unknown): boolean {
  if (typeof value !== 'string' || !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) return false;
  try { return BigInt(value) === 1439n; }
  catch { return false; }
}
const AUTH_FIELDS = [
 { name: 'address', type: 'address' }, { name: 'origin', type: 'string' },
 { name: 'nonce', type: 'bytes32' }, { name: 'issuedAt', type: 'uint64' },
 { name: 'expiresAt', type: 'uint64' }
];
function exactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
 if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
 const own = Reflect.ownKeys(value);
 return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
}
export type WalletChallengeIssue = 'MALFORMED_CHALLENGE' | 'DOMAIN_MISMATCH' | 'CHAIN_MISMATCH' | 'ADDRESS_MISMATCH' | 'TYPES_MISMATCH' | 'ORIGIN_MISMATCH' | 'NONCE_INVALID' | 'TIMESTAMP_INVALID' | 'NOT_YET_VALID' | 'EXPIRED' | 'TTL_INVALID';
/** Validate the entire signable request and return only a non-sensitive reason code. */
export function walletChallengeIssue(challenge: unknown, address: string, expectedOrigin: string | null, now: number): WalletChallengeIssue | null {
 try {
  if (!exactRecord(challenge, ['domain', 'types', 'value']) || !exactRecord(challenge.domain, ['name', 'version', 'chainId']) || !exactRecord(challenge.types, ['WalletAuthentication']) || !exactRecord(challenge.value, ['address', 'origin', 'nonce', 'issuedAt', 'expiresAt'])) return 'MALFORMED_CHALLENGE';
  const { domain, types, value } = challenge;
  if (domain.name !== 'VEREQO Authentication' || domain.version !== '1') return 'DOMAIN_MISMATCH';
  if (domain.chainId !== '1439') return 'CHAIN_MISMATCH';
  if (typeof value.address !== 'string') return 'ADDRESS_MISMATCH';
  try { if (getAddress(value.address) !== address) return 'ADDRESS_MISMATCH'; } catch { return 'ADDRESS_MISMATCH'; }
  const fields = types.WalletAuthentication;
  if (!Array.isArray(fields) || fields.length !== AUTH_FIELDS.length || AUTH_FIELDS.some((expected, i) => { const field = fields[i]; return !exactRecord(field, ['name', 'type']) || field.name !== expected.name || field.type !== expected.type; })) return 'TYPES_MISMATCH';
  if (typeof value.origin !== 'string' || (expectedOrigin !== null && value.origin !== expectedOrigin)) return 'ORIGIN_MISMATCH';
  let url:URL;
  try { url = new URL(value.origin); } catch { return 'ORIGIN_MISMATCH'; }
  if (url.origin !== value.origin || !['http:', 'https:'].includes(url.protocol)) return 'ORIGIN_MISMATCH';
  if (typeof value.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.nonce)) return 'NONCE_INVALID';
  if (typeof value.issuedAt !== 'string' || typeof value.expiresAt !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.issuedAt) || !/^(0|[1-9][0-9]{0,19})$/.test(value.expiresAt) || !Number.isSafeInteger(now) || now < 0) return 'TIMESTAMP_INVALID';
  const issuedAt = BigInt(value.issuedAt), expiresAt = BigInt(value.expiresAt), current = BigInt(now);
  if (issuedAt > current) return 'NOT_YET_VALID';
  if (expiresAt <= current) return 'EXPIRED';
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 120n || expiresAt >= (1n << 64n)) return 'TTL_INVALID';
  return null;
 } catch { return 'MALFORMED_CHALLENGE'; }
}
export function isValidWalletChallenge(challenge: unknown, address: string, expectedOrigin: string | null, now: number): challenge is WalletChallenge {
 return walletChallengeIssue(challenge, address, expectedOrigin, now) === null;
}
export type WalletAuthStage = 'PREFLIGHT' | 'PROVIDER_SIGN_REQUESTED' | 'PROVIDER_SIGNATURE_RETURNED' | 'SERVER_VERIFY_REQUESTED' | 'SERVER_SESSION_RETURNED' | 'PROVIDER_RECHECK_PASSED';
export interface EthereumProvider {
 request(args: { method: string; params?: unknown[] }): Promise<unknown>;
 on?(event: string, listener: (...args: unknown[]) => void): void;
 removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}
export interface WalletChallenge {
 domain: TypedDataDomain;
 types: Record<string, TypedDataField[]>;
 value: { address: string; origin: string; nonce: string; issuedAt: string; expiresAt: string };
}
/** In-memory connection only. Never requests transaction signatures or persists keys. */
export class WalletConnection {
 address: string | null = null;
 session: string | null = null;
 private generation = 0;
 private readonly invalidate = () => { this.generation++; this.address = null; this.session = null; };
 constructor(private readonly provider: EthereumProvider, private readonly expectedOrigin: string | null = typeof location === 'undefined' ? null : location.origin, private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {
  for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.on?.(event, this.invalidate);
 }
 disconnect(): void { this.invalidate(); }
 dispose(): void { this.invalidate(); for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) this.provider.removeListener?.(event, this.invalidate); }
 async connect(): Promise<string> {
  this.invalidate(); const generation = this.generation;
  const accounts = await this.provider.request({ method: 'eth_requestAccounts' });
  if (generation !== this.generation) throw Error('WALLET_CHANGED');
  const chain = await this.provider.request({ method: 'eth_chainId' });
  if (generation !== this.generation) throw Error('WALLET_CHANGED');
  if (!isInjectiveChainId(chain)) throw Error('WRONG_NETWORK');
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw Error('NO_ACCOUNT');
  this.address = getAddress(accounts[0]); return this.address;
 }
 /** Call only from an explicit authentication button. Does not approve execution. */
 async authenticate(challenge: WalletChallenge, verify: (signature: string) => Promise<string>, revoke: (session: string) => Promise<void>, observe: (stage: WalletAuthStage) => void = () => {}): Promise<void> {
  const stage = (value: WalletAuthStage) => { try { observe(value); } catch { /* Diagnostics never control authorization. */ } };
  stage('PREFLIGHT');
  // Each attempt supersedes pending signatures/verifications while retaining the connection.
  const generation = ++this.generation, address = this.address, previousSession = this.session;
  this.session = null;
  if (previousSession) {
   try { await revoke(previousSession); }
   catch (error) { throw new AggregateError([error], 'AUTH_SESSION_REVOCATION_FAILED'); }
  }
  if (generation !== this.generation) throw Error('WALLET_CHANGED');
  if (!address) throw Error('WALLET_NOT_CONNECTED');
  const challengeIssue = walletChallengeIssue(challenge, address, this.expectedOrigin, this.now());
  if (challengeIssue) throw Error(`CHALLENGE_${challengeIssue}`);
  const chain = await this.provider.request({ method: 'eth_chainId' });
  const accounts = await this.provider.request({ method: 'eth_accounts' });
  if (!isInjectiveChainId(chain)) { this.invalidate(); throw Error('WALLET_WRONG_CHAIN'); }
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || getAddress(accounts[0]) !== address) { this.invalidate(); throw Error('WALLET_ACCOUNT_CHANGED'); }
  if (generation !== this.generation) throw Error('WALLET_CHANGED');
  let signature: unknown;
  try {
   stage('PROVIDER_SIGN_REQUESTED');
   signature = await this.provider.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify({ domain: challenge.domain, message: challenge.value, primaryType: 'WalletAuthentication', types: { EIP712Domain: [{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'}], ...challenge.types } })] });
  } catch (error) {
   const code = error && typeof error === 'object' ? (error as {code?:unknown}).code : undefined;
   if (code === 4001 || code === 'ACTION_REJECTED') throw Error('WALLET_SIGNATURE_REJECTED');
   if (code === -32002) throw Error('WALLET_REQUEST_PENDING');
   throw Error('WALLET_SIGNATURE_FAILED');
  }
  if (typeof signature !== 'string' || generation !== this.generation) throw Error('WALLET_CHANGED');
  stage('PROVIDER_SIGNATURE_RETURNED');
  stage('SERVER_VERIFY_REQUESTED');
  const session = await verify(signature);
  stage('SERVER_SESSION_RETURNED');
  try {
   if (generation !== this.generation) throw Error('WALLET_CHANGED');
   const finalChain = await this.provider.request({ method: 'eth_chainId' });
   const finalAccounts = await this.provider.request({ method: 'eth_accounts' });
   if (generation !== this.generation) throw Error('WALLET_CHANGED');
   if (!isInjectiveChainId(finalChain)) throw Error('WALLET_WRONG_CHAIN');
   if (!Array.isArray(finalAccounts) || typeof finalAccounts[0] !== 'string' || getAddress(finalAccounts[0]) !== address) throw Error('WALLET_ACCOUNT_CHANGED');
   stage('PROVIDER_RECHECK_PASSED');
   this.session = session;
  } catch (error) {
   if (generation === this.generation) this.invalidate();
   try { await revoke(session); }
   catch (cleanupError) { throw new AggregateError([error, cleanupError], 'AUTH_SESSION_REVOCATION_FAILED'); }
   throw error;
  }
 }
}
