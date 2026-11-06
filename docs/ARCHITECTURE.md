# VEREQO architecture

The smallest working structure is preserved: apps/web holds the React instrument and native design system; packages/disclosure owns bounded public inference; packages/consequence owns deterministic directed graphs; packages/domain owns strict intent and capability types; services/issuer owns the shared synthetic localhost reference service and transactional SQLite store; contracts holds a digest/schema library and local parity tests. Tests include domain, realHTTP/SQLite, corruption, crash, race, React and browser checks. No empty integration packages are introduced.

Actual flow: localhost public preflight → issuer-owned admission/fixture evaluation → durable history commit → returned public answer. Separately, credential graph WHAT-IF → reason/evidence → optional explicit local fixture commit. Public CSRF protection does not authenticate a user. Project/Space/agent labels and timeline do not create tenants or financial authority. Inquiry is a bounded read-only parser, not live AI.

Target next flow is wallet → authenticated mandate → exact agent intent → real ZK verification → scoped authorization → protected Injective execution → verified receipt → consequence inspection. Those runtime adapters are NOT_IMPLEMENTED. Existing supplied-context checks/static ABI codecs are local fixtures, not live compatibility or authorization. Native Injective IDs, amounts, order semantics and deployed endpoints require independent pinned/read-only validation before an adapter exists.

Run/dependency boundary: Node22.13+ or24+, npm lockfile, no local file dependencies or external project roots. Runtime fonts are self-hosted and licensed. Builds require only this repository and installed dependencies. Generated dist/.local/SQLite/contract outputs are ignored.
