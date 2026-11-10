# Release candidate validation

Date: 2026-11-11
Target: private GitHub branch `release/2026-11-11-safe`
Base: remote `main` snapshot `69844124e336df57a994ced8e6b34d62fbb4c229`

This file records validation performed on the isolated release candidate. It does not claim Testnet transactions, deployed financial execution, a production-trusted Groth16 setup, or current Wallet-session validity.

## Build and UI checks

- `npm ci`: PASS. Lockfile installed 188 packages.
- `npm run typecheck`: PASS.
- `npm run build`: PASS. Vite emitted `dist/web` with 206 modules. The JavaScript bundle is 535.07 kB minified and triggers Vite's advisory chunk-size warning.
- `npx vitest run tests/english-first.test.tsx`: PASS, 2/2. Checks first-visit English, explicit language selection, and persisted language.
- Build assets: solid brand and local OFL font files are present in the production output and byte-identical to their source files.
- Dependency audit: `npm audit --audit-level=moderate` reports no high, moderate, or critical advisories; 15 low-severity advisories remain in development/tooling dependencies. `npm audit --omit=dev --audit-level=low` reports 0 production dependency advisories. Compatible npm overrides pin `underscore` 1.13.8 and `ws` 8.22.2 to remove the reported higher-severity transitive findings. These are not production dependencies.
- Secret scan: Gitleaks found 0 findings in the exact staged source snapshot and 0 findings in the 3-commit `origin/main` history. A post-commit history scan remains part of the push gate.

## Release contents

The branch contains the current application, local service and package source, tests and contracts/circuit source, root build configuration, local brand/font build assets, and the sanitized public docs.

The branch excludes submission directories, videos, audio, Wallet source footage, HAR, SQLite/local databases, private evidence, internal handoffs, and source brand-package archives. The Vercel ignore rules retain the build-required app and public assets while excluding local/private material.

## External and owner gates

- No GitHub visibility setting was changed.
- No Vercel deployment or configuration change was performed.
- No Wallet signature, transaction, or application submission was performed.
- Supplied brand distribution rights remain unspecified; public deployment requires owner confirmation.
