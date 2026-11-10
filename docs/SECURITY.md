# Security boundaries

## Authorization

- Wallet ownership authentication is separate from financial authorization. An authenticated address or session must never be treated as permission to sign, grant, deposit, withdraw, or order.
- Agent proposals are untrusted, unsigned input. The Agent receives no owner private key or transaction-signing capability.
- Financial execution is disabled in this release. The production market-risk gate remains fail-closed.
- Expiry, nonce use, revocation, Request binding, and policy checks must fail closed when the relevant state cannot be verified.

## Data handling

Do not commit secrets, API tokens, seed phrases, Wallet signatures, session tokens, raw HAR files, local SQLite state, or private evidence. The release candidate excludes local state, internal evidence, submission media, and source-package archives. Runtime logs and deployment bundles must not contain authentication values.

## Cryptographic limits

Local Groth16 setup and local mock tests are not production trust evidence. Do not describe local proof verification as a trusted production credential. Operator or fixture keys used in tests are not independent Issuer credentials.

## Market and Gate limits

A market snapshot is a preflight observation; it does not guarantee that price, book depth, balance, permissions, nonce, or expiry remain valid at execution time. This release does not provide a Testnet-verified full financial lifecycle, deployed ActionGate, or independently proven principal recovery path.

## Reporting

Label evidence as REAL, LOCAL, SYNTHETIC, TESTNET READ, BLOCKED, or OWNER_REQUIRED as applicable. Do not turn isolated test results into a full end-to-end success claim.
