# VEREQO architecture

## Request review

The web application presents disclosure policy, Agent-proposed intent, consequence, and evidence context for review. Local API services handle preview workflows and local persistence. A displayed Request ID is a correlation aid; production authorization depends on the individual cryptographic and policy checks, and the full production chain is not claimed as deployed.

The UI has three distinct evidence classes:

- **SYNTHETIC**: deliberately generated demo inputs and state.
- **LOCAL**: local software, cryptographic, or mock-chain verification.
- **TESTNET READ**: read-only observations from an external Testnet endpoint.
- **REAL OWNER AUTH**: only a server-verified, time-bounded ownership session; it is not execution approval.

## Financial boundary

The current product does not submit Injective orders. Market reads are observations from independent endpoints and are not an atomic execution-time guarantee. The last recorded scan found no fresh two-sided book under the configured freshness threshold; the market-risk gate remains fail-closed.

The Direct ActionGate and Exchange Precompile tests use local Foundry mocks. They do not establish a deployed Gate, a funded Exchange subaccount, successful Deposit / Cancel / Withdraw, or a principal recovery route. No real transaction receipt is included.

## Proof boundary

Local Circom/Groth16 artifacts demonstrate local circuit behavior under a single-machine setup. That setup is not a production trusted setup. Production issuer operations, key management, trusted setup ceremony, and verifier deployment are not claimed.

## Runtime

The app is built with Vite from `apps/web`; local API and product modules live in `services` and `packages`. The configured static output is `dist/web`. Public assets required by the build are kept under `apps/web/public/`.
