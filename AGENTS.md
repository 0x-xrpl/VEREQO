# VEREQO engineering rules

- Preserve the native industrial instrument, actual controls, JP/EN and accessibility.
- Keep disclosure admission, proof validity, credential state, financial authorization and execution distinct.
- Admission is witness-independent; evaluate only after admission inside the same SQLite transaction and return only after COMMIT. Fail closed.
- Private fixture witnesses remain issuer-only; no browser/log/URL secret.
- Shared public CSRF token is not user authentication. Local fixture mode is not production security.
- Graph effects use directed edges and immutable events. WHAT-IF and replay do not commit.
- Real ZK, wallet authentication, issuer signatures, grants and protected Injective execution remain NOT_IMPLEMENTED until independently verified.
- No broadcast, signing, funding or deployment without separate explicit authorization.
- Node>=22.13; npm lockfile; npm run check and npm run test:contracts; actual browser QA before UI completion.
- Review architectural changes and meaningful repeated failures; preserve negative tests and evidence.
