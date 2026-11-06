# VEREQO foundation validation — 2026-11-07

## Actual local gates

- Independent parentless product root, only its own HTTPS origin, no Git alternates, submodules, gitlinks or tracked symlinks. Relative source imports resolve inside the repository; no file/link package dependency.
- Fresh npm ci from the lockfile installed66packages. Node22.23.2 npm run check:239tests in26files, strict typecheck and production build PASS. The strengthened3repository cases separately passed after final review.
- npm run test:contracts:3local Solidity digest/schema cases PASS, including the VEREQO/version1 EIP-712 fixed vector shared with the independent TypeScript encoding. This does not test execution or proof verification.
- npm run test:browser:215actual checks across1440/1024/768/390/320×900 and1180×820 PASS with no unexpected page/console errors. A deliberately injected503 tests failed-GET lock/recovery. Each viewport uses a fresh memory issuer and same-origin-only resources.
- npm run evidence and npm run smoke PASS:128→101→81, then denied71/10/noanswer, A six-node consequence and B independence, preflight/preview no commit, resets and stale-token rejection.
- All reachable product commits are scanned before remote upload; automated secret scans are bounded pattern detection, not proof of absence. Native source/config/assets/generated output are separately inspected for identity, external filesystem dependencies and forbidden artifacts.

## Reproduce

Run npm ci, npm run check, npm run test:contracts (Foundry required), npm run evidence, npm run smoke. For browser QA run npm run test:browser with installed Playwright Chromium, or set VEREQO_CHROME to an installed Chrome executable. The browser executable is a machine-local tool preference, not a dependency on another project. No screenshots/reference kits are required to build. QA generates new ignored pictures under .local/browser-qa. VEREQO_QA_WIDTHS and VEREQO_QA_OUTPUT can bound/output local QA.

New tests retain witness-independent admission, strict parsing, commit-before-release, actual crash/rollback/COMMIT failure, process concurrency, idempotency, malformed history, generation/reset/focus races and the instrument controls. Distinct digest-domain behavior and paired CSRF-header behavior were independently cross-checked without signing or broadcasting. Tests are cases, not exaggerated counts of inner exhaustive loops.

Diagnostics retained: Node experimental SQLite warnings, one existing React act warning, expected negative403 and intentional503. Original font binaries/OFL notices retain their upstream bytes; whitespace-only warnings on original license line endings are not code or security-test failures.

## Four-perspective acceptance

Actual internal agent reviewers inspected code/logs and rendered screenshots; these are simulated professional perspectives, not external human judges or certification. No manufactured numeric score.

| Perspective | Evidence / decision | Remaining closure or limit |
|---|---|---|
| Product Founder / repository architecture | Native root and origin, relative import resolution, current application/gate logs: local architecture GO | Missing validation document, final hygiene tests and final scan were closure items; they are recorded here and in the final execution receipt |
| Industrial UI/UX lead | Actual desktop/mobile Hero, Instrument and nested evidence images; identical dial/LCD and font bytes; six-width PASS: design GO | Long phone evidence, physical devices/screen readers not verified; reviewer did not rerun browser tool |
| Financial Security Officer | Strict VEREQO-domain encoding, paired header, unchanged transaction/privacy negatives and fail-closed adapters: local migration GO | No actual identity/proof/grants/executor; financial production NO-GO |
| Injective Protocol Engineer | Typed local intent, static codecs and unavailable wallet are honestly scoped: local foundation GO | Native representations, precision/order semantics and live pinned ABI remain unverified; no chain execution readiness |

## Scope and next operation

Local foundation GO, financial production/signing/funding/deployment/broadcast NO-GO. Next exact development operation: a local-only trusted-principal/mandate and exact native intent mapping specification with malformed/overflow/replay/direct-bypass negative tests, leaving authorization and execution unavailable. A later pinned read-only chain compatibility gate and any testnet action need separate authorization. No new integration is claimed here.

Git milestone details and relevant safe evidence are in docs/evidence/baseline.json. Remote readback and fresh-clone results are recorded in the final execution/preservation receipt after upload. Do not infer market demand, genuine AI reasoning, ZK, RWA compliance or financial protection from local migration success.
