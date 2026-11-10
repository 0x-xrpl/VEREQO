# VEREQO — Hacker House Scenario / Evidence Kit v1

**Status: Portable fixture kit, not yet integrated with VEREQO.** No mock is presented as a real chain transaction. This kit does **not** contain valid issuer signatures, wallet signatures, Groth16 proofs, real market IDs, onchain order hashes or transaction receipts.

## Why this exists

A demo must begin with a believable operator decision, not a decorative screen. These eight synthetic scenarios encode what an operator asks, which data can be loaded, what actions must be available, what outcome should be checked, and what must remain unknown. The consuming VEREQO implementation must generate true credentials/proofs/evidence itself and must enforce real safety gates.

## Use immediately (without installing dependencies)

```bash
node scripts/validate.mjs
node scripts/preview.mjs
node scripts/preview.mjs S03
```

These commands load the JSON and validate **fixture integrity only**. They do not test VEREQO cryptography or execution. Requires Node.js 22+.

## Integration into an actual VEREQO checkout

1. Keep this kit external to the repo until actual Git HEAD and worktree are verified. Copy it into a clearly named new `demo/hacker-house/` directory; do not overwrite current files.
2. Implement the dedicated scenario loader specified in `docs/ADAPTER_CONTRACT.md`; use the existing VEREQO typed Intent, issuer, market adapter, consequence graph, and Evidence surfaces—not parallel mock business logic.
3. Separate local **SYNTHETIC_REHEARSAL** from **TESTNET_READ_ONLY** and **AUTHORIZED_TESTNET_EXECUTION** at API, UI, logs, and export boundaries.
4. Keep `private/` server-only. Never expose private issuer ceilings, credentials or witness material via browser bundles or serialized results. Replace this sample private policy with a safe server-side test-fixture generator, not a production policy.
5. Add a test that loads every scenario through the real app screen and checks state changes. If tests cannot be executed, mark `NOT_INTEGRATED`.
6. To demonstrate a *real* proof, produce a genuine order-bound Groth16 proof and valid trusted Issuer/Mandate signature via the actual tested circuit and signer. This fixture does **not** provide these.
7. To demonstrate a *real* trade, only with separate owner approvals and verified T5/T6 safeguards, execute on Injective Testnet and independently read back receipts and order state. Populate the evidence template from those results; never fill it with invented IDs.

## Product behavior to show

- An Agent requests an exact limit buy (40 INJ × 12 USDT = 480 USDT, synthetic).
- A private issuer policy is checked without disclosure of the actual ceiling (600 USDT only in the deliberately synthetic local PRIVATE server sample).
- A larger 840 USDT order is denied; a proof must never be fabricated to pass.
- A credential-revocation WHAT-IF impacts A's requests but not the separate B request.
- An unverified market is rejected at `MARKET_RISK_UNVERIFIED`.
- Cancellation is not automatically final when partial fills may be in flight.
- Wrong network and repeated disclosures are rejected or sent to review.
- A correctly generated local proof still cannot override an invalid credential epoch (S08 requires the actual local prover and Foundry for verification).

## Video, judging, and technical evidence

Read `docs/STORYBOARD.md`, `docs/ADAPTER_CONTRACT.md`, `docs/ACCEPTANCE.md`, and `docs/HACKER_HOUSE_ONE_PAGER.md`.

**Critical:** This kit is a sample design asset, not the current repository or a substitute for the actual README. Current chain integration remains as reported by the user's operation logs. Do not stage real keys, witnesses or protected limits in a public demo bundle.
