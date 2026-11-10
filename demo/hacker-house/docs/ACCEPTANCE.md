# Acceptance and evidence matrix — technical and presentation

| ID | Requirement | In-fixture check | Product-level requirement |
|---|---|---|---|
| A1 | Exact financial intent | S01 arithmetic 40×12=480 | Real UI binds selected Intent's price, quantity, market, source |
| A2 | Order-bound private proof | S01 carries no fake proof | Real prover, issuer, commitment and verifier agree for exact digest |
| A3 | Private limit denied | S02 840 > private 600 | Server-side denial without leaking secret; negative test |
| A4 | Revocation selective | S03 A affected, B unaffected | Consequence graph verified, independent B still eligible |
| A5 | Fail-closed market | S04 expected risk deny | Gate-level no nonce/budget/precompile side effects |
| A6 | Cancel/fill honest | S05 unknown until verified | Actual chain event readback; partial fills preserved |
| A7 | Wrong network | S06 chain 1 ≠ 1439 | Actual wallet account/network changes and rejection tested |
| A8 | Cumulative disclosure | S07 history expected | Deterministic disclosure policy and replay tests |
| A9 | Actual Injective chain | Empty evidence template | Signed approved Testnet txn + independent receipt/order readback |
| A10 | Proof is not authority | S08 provides no cryptographic proof | Generate actual local proof and verify Gate denial after epoch change |
| A11 | Hand-off | JSON files load and validate | Adapter imports all scenarios and browser demo is reproducible |

## Hard NO-GO checks

Any forged proof/signature; invented market ID or tx hash; exposed private witness; bypassing failed market risk; confusing preview with an actual revoke; showing cancellation as confirmed without chain readback; claiming production ZK setup after single-machine generation.

## Score methodology

Four simulated review judges can evaluate clarity, UI/UX, privacy/authorization, security/custody, and chain evidence, each 0–10. **48.5/50 is an internal aspiration, not the official event grading rubric.** An unverified execution path cannot earn a fully verified chain-execution score.
