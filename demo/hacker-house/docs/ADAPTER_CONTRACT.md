# Adapter contract — real app integration required

This is an **integration specification**, not a claim that an adapter already exists in VEREQO.

## Dedicated loader

A narrow server endpoint or local CLI must:

1. Parse and validate `manifest.json` and chosen `scenarios/S*.json` against the schema plus semantic invariants; reject unknown schema revisions.
2. Use a demo workspace namespace and deterministic IDs scoped to scenarioId; never merge synthetic fixtures into a production tenant or live Evidence history.
3. Allow explicit `Reset scenario` and `Load scenario`; start with NO signatures, NO proof, NO live transactions. The UI must visibly label `SYNTHETIC REHEARSAL`.
4. Map `inputs.intent` to existing VEREQO canonical domain objects; refuse invented EVM marketId, deployed Gate address, issuer signature, wallet or transaction ID.
5. Route valid on-screen actions to **actual** app business logic. If a real proof is requested, use the actual prover and order-specific issuer-signed commitment or show `UNAVAILABLE`, never treat example expectedObservations as authoritative proof outcomes.
6. Derive consequences from authenticated graph edges: A revocation affects only A, independent B stays unaffected.
7. Keep `private/issuer-policy.example.json` server-side and only in a synthetic sandbox. Do not inject secret ceilings into browser states, UI props, client JSON, analytics, video or exported Evidence.
8. Preserve bounded execution: no live wallet signature, chain deploy/fund/order/cancel without separate explicit user approval. Never expose test harness bypasses in deployed Gate.
9. Add record-level lineage to every visible number: unit, source, timestamp/fixture version, trust state.
10. Separate accepted order from filled order, requested cancellation from confirmed cancellation, and preflight from onchain authorization.

## API sketch (adapter can choose other routing to match existing code)

- `GET /api/demo/scenarios` → scenario metadata, synthetic label.
- `POST /api/demo/load` `{scenarioId, workspaceId}` → typed seeded workspace **without** generating proof or external side effects.
- `POST /api/demo/reset` `{workspaceId}` → rollback only this synthetic namespace and the demo's transient records.
- `GET /api/demo/state` → current synthetic scenario state, references and evidence provenance; no private witness.

All write endpoints require local demo-only authorization and CSRF protections appropriate to the existing app. Do not deploy new endpoints unprotected to the internet.

## Expected app-level acceptance

- UI first paints the actual exact financial order, not `Broker A / 06` with no meaning.
- An operator can select a scenario, inspect its Mandate Map, switch WHAT-IF, inspect Proof Lens, and view Evidence Inspector.
- Tests assert **data binding**, not just labels/text.
- All scenarios run across 1440, 390 and 320 px and browser screenshots are persisted with accurate fixture labels.
- Separate modes: `SYNTHETIC_REHEARSAL`, `READ_ONLY_TESTNET`, `LOCAL_PROOF_TEST`, `AUTHORIZED_TESTNET_EXECUTION`, and actual `ONCHAIN_VERIFIED` only when evidenced.
