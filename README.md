# VEREQO

**PROVE WHAT MATTERS. CONTROL WHAT FOLLOWS.**

VEREQO is a review instrument for inspecting confidential disclosures and Agent-proposed financial intents before any separate human authorization. It brings request context, policy checks, consequences, and evidence into one interface.

## Product boundary

This repository contains a local-first review product and a financial prototype. The interface may show synthetic scenarios and read-only Injective Testnet observations. It does not submit orders, custody funds, or grant an Agent signing authority.

- Ownership authentication identifies a wallet for a short-lived local session. It does not approve an intent or authorize a transaction. Sessions are process-local; no current owner session is implied.
- Agent proposals are unsigned previews. A configured local model run is not autonomous financial execution.
- Local Groth16 proofs use a single-machine setup that is **not trusted for production**. No production trusted setup or deployed verifier is claimed.
- The latest recorded Injective read found no fresh two-sided book within the configured 10-second threshold across 216 active Spot markets. T5 remains **BLOCKED**; a past read is not current market state.
- T6 local Foundry/mock coverage is local evidence only. The Gate is not deployed, and Deposit / Exchange Order / Cancel / Withdraw / Recovery have not been verified as a complete Testnet lifecycle.
- Execution remains **NO-GO / NOT_IMPLEMENTED**. No Testnet transaction is claimed by this release.

See `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, and `docs/RELEASE_VALIDATION.md` for boundaries and reproducible checks.

## Run locally

Requirements: Node.js `>=22.13.0 <23` or `>=24`.

```sh
npm ci
npm run dev
```

The local web UI is served at `http://127.0.0.1:5173`; its local API uses port `4317`. Do not expose the development server to an untrusted network.

## Verify and build

```sh
npm run typecheck
npm test
npm run build
```

The Vite build writes to `dist/web`. For a future Vercel project, set the output directory to `dist/web`; this release does not deploy or change hosting settings. The checked-in `.vercelignore` keeps local state, credentials, internal evidence, submission material, and media out of deployment uploads while preserving the app, brand, and licensed font build inputs.

## Included assets and rights

The app uses the supplied solid VEREQO brand files under `apps/web/public/brand/`. Their distribution rights are **not specified in this release**; no public deployment or redistribution is authorized by this repository. Local UI fonts include their OFL notices under `apps/web/public/fonts/`.

## Product film

A final, owner-approved film URL may be added here after media rights, privacy, and release review are complete. No draft URL is included.

## Release scope

This release branch is a single sanitized snapshot based on the private repository's `main`, not the 89-commit local operation history. Excluded items include Wallet source footage, video/audio masters, HAR files, SQLite databases, local proof/evidence records, private handoffs, and source brand-package archives. No secrets or production credentials are intended to be included.
