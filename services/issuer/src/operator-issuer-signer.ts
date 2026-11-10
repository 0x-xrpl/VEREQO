import { constants as fsConstants } from 'node:fs';
import { open, realpath, lstat, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { getAddress, Wallet } from 'ethers';
import { disclosureBindingTypedData } from '../../../packages/domain/src/disclosure-binding.js';
import { issuerOrderMandateTypedData } from '../../../packages/domain/src/order-mandate.js';

export interface OperatorIssuerSigner {
  readonly issuerAddress: string;
  readonly provenance: 'OPERATOR_MANAGED_LOCAL_DEMO';
  signDisclosureBinding(binding: unknown, gate: string): Promise<string>;
  signOrderMandate(mandate: unknown): Promise<string>;
}

export interface OperatorIssuerSignerOptions {
  readonly mode: 'LOCAL_DEMO';
  readonly keyFilePath: string;
  readonly expectedIssuerAddress: string;
  readonly repositoryRoot: string;
}

function fail(code: string): never { throw Error(code); }

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/**
 * Load an operator-managed DEMO issuer key without creating it or exposing its value.
 * The key must be a single-owner 0600 file in a private 0700 directory outside the repo.
 * This helper never promotes local signing to a production Issuer trust claim.
 */
export async function loadOperatorIssuerSigner(options: OperatorIssuerSignerOptions): Promise<OperatorIssuerSigner> {
  if (options.mode !== 'LOCAL_DEMO') return fail('OPERATOR_ISSUER_MODE_UNSUPPORTED');
  if (!isAbsolute(options.keyFilePath) || !isAbsolute(options.repositoryRoot)) return fail('OPERATOR_ISSUER_PATH_INVALID');

  let keyPath: string, repositoryPath: string, originalMeta;
  try {
    [keyPath, repositoryPath, originalMeta] = await Promise.all([
      realpath(options.keyFilePath), realpath(options.repositoryRoot), lstat(options.keyFilePath),
    ]);
  } catch { return fail('OPERATOR_ISSUER_KEY_UNAVAILABLE'); }
  if (originalMeta.isSymbolicLink() || !originalMeta.isFile() || isWithin(repositoryPath, keyPath)) {
    return fail('OPERATOR_ISSUER_KEY_LOCATION_INVALID');
  }

  const noFollow = fsConstants.O_NOFOLLOW;
  if (typeof noFollow !== 'number') return fail('OPERATOR_ISSUER_NOFOLLOW_UNAVAILABLE');
  let handle;
  try { handle = await open(keyPath, fsConstants.O_RDONLY | noFollow); }
  catch { return fail('OPERATOR_ISSUER_KEY_UNAVAILABLE'); }

  let privateKey: string;
  try {
    const [fileMeta, directoryMeta] = await Promise.all([handle.stat(), stat(dirname(keyPath))]);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!fileMeta.isFile() || fileMeta.nlink !== 1 || (fileMeta.mode & 0o077) !== 0 ||
        (directoryMeta.mode & 0o077) !== 0 || !directoryMeta.isDirectory() ||
        (uid !== null && (fileMeta.uid !== uid || directoryMeta.uid !== uid))) {
      return fail('OPERATOR_ISSUER_KEY_PERMISSIONS');
    }
    privateKey = (await handle.readFile({ encoding: 'utf8' })).replace(/\r?\n$/, '');
  } catch (error) {
    if (error instanceof Error && /^OPERATOR_ISSUER_[A-Z_]+$/.test(error.message)) throw error;
    return fail('OPERATOR_ISSUER_KEY_UNAVAILABLE');
  } finally { await handle.close(); }

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) return fail('OPERATOR_ISSUER_KEY_INVALID');
  let wallet: Wallet, expectedIssuer: string;
  try {
    wallet = new Wallet(privateKey);
    expectedIssuer = getAddress(options.expectedIssuerAddress);
  } catch { return fail('OPERATOR_ISSUER_IDENTITY_INVALID'); }
  if (expectedIssuer === '0x0000000000000000000000000000000000000000' || wallet.address !== expectedIssuer) {
    return fail('OPERATOR_ISSUER_IDENTITY_MISMATCH');
  }

  return Object.freeze({
    issuerAddress: expectedIssuer,
    provenance: 'OPERATOR_MANAGED_LOCAL_DEMO' as const,
    async signDisclosureBinding(binding: unknown, gate: string): Promise<string> {
      const data = disclosureBindingTypedData(binding, gate);
      if (getAddress(data.value.issuer) !== expectedIssuer) return fail('OPERATOR_ISSUER_IDENTITY_MISMATCH');
      return wallet.signTypedData(data.domain, data.types, data.value);
    },
    async signOrderMandate(mandate: unknown): Promise<string> {
      const data = issuerOrderMandateTypedData(mandate);
      if (getAddress(data.value.issuer) !== expectedIssuer) return fail('OPERATOR_ISSUER_IDENTITY_MISMATCH');
      return wallet.signTypedData(data.domain, data.types, data.value);
    },
  });
}

/** Environment contract for an operator-owned adapter module; no key value is read from env. */
export async function loadOperatorIssuerSignerFromEnvironment(
  expectedIssuerAddress: string,
  repositoryRoot: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<OperatorIssuerSigner> {
  if (environment.VEREQO_OPERATOR_ISSUER_MODE !== 'LOCAL_DEMO') return fail('OPERATOR_ISSUER_LOCAL_DEMO_NOT_ENABLED');
  const keyFilePath = environment.VEREQO_OPERATOR_ISSUER_KEY_FILE;
  if (!keyFilePath) return fail('OPERATOR_ISSUER_KEY_FILE_REQUIRED');
  return loadOperatorIssuerSigner({ mode: 'LOCAL_DEMO', keyFilePath, expectedIssuerAddress, repositoryRoot });
}
