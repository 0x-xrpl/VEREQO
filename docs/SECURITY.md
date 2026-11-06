# Security boundary

Current application is LOCAL_REFERENCE, synthetic, localhost-only. Do not use real confidential information or remotely expose this shared fixture service. The GET state token is public process-local CSRF protection, not identity/authentication. SQLite stores a demo witness in plaintext on the issuer side; this is not a production secret store or ZK system.

Preserve witness-independent preflight/admission; answer evaluation only after deterministic admission in the same transaction; release only after COMMIT; rollback/COMMIT/crash failures and multi-process serialization must fail closed. Knowledge scope is issuer/subject/authorized cohort independent of policy epoch. Caller-selected project/cohort is not authentication. Denied records never contain answers. History/idempotency and stale generation guards remain explicit.

Intent encoding binds every financial field, chain and verifying contract in EIP-712 domain VEREQO/version1. Domain differences intentionally produce different digests; no other product signatures are accepted by this schema boundary. The digest contract performs no proof verification, authorization, nonce consumption or execution. Supplied caller/context values do not establish identity/ownership. X-VEREQO-Token must match client/server tests; other/missing headers fail closed.

No wallet authentication, issuer signatures, prover/verifier, grants, protected executor, custody, settlement, RWA eligibility or compliance enforcement is implemented. There is no transaction/broadcast path to demonstrate. Further signing, funding or testnet deployment requires separate explicit authorization.

Next prioritized gate: specify trusted principal/mandate and exact Injective-native intent mapping; pin external protocol evidence with read-only compatibility tests; design a non-bypassable ActionGate and negative tests for unauthorized/revoked/expired/replayed/malformed/direct-route attempts before implementing execution. No automatic deployment.

Secrets: .env/keys/databases/caches/outputs are ignored; scan all reachable commits before any remote upload. Automated scans are bounded pattern detection, not production certification. Keep provenance/custody records outside the product tree without misrepresenting imported work as newly authored.
