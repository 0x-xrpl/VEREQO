# Storyboard — proposed 3-minute guided product walkthrough

**Not an official Injective Hacker House time limit.** Use a real screen capture of the app with loaded scenarios. Do not replace interaction with pre-rendered fake HTML.

| Time | Scene | What to click/load | What the audience must understand | Evidence tier |
|---|---|---|---|---|
| 0:00–0:20 | The problem | Operator View, selected exact Intent | AI's proposal is not permission to act | Real app, synthetic inputs |
| 0:20–0:45 | A legitimate request | Load S01; inspect 40 INJ × 12 = 480 USDT | No private limit needs to be disclosed | Synthetic; proof only if actual prover runs |
| 0:45–1:10 | Decision | Proof Lens, issuer verification, explicit status | Proof ≠ authorized execution; show actual evidence level | Real proof if available; otherwise `UNAVAILABLE` |
| 1:10–1:35 | Negative boundary | Load S02; attempt higher 840 USDT request | Clear rejection without revealing private ceiling | Local negative fixture + app test |
| 1:35–2:05 | Consequences | Load S03; preview revoke A while B unaffected | Selective causal impact, WHAT-IF does not mutate chain | Verified graph edges; synthetic scenario |
| 2:05–2:30 | Real-world complexity | Load S05 and S04 | Cancel pending ≠ canceled; unverified market ≠ safe order | Explicit unknown / fail-closed |
| 2:30–2:50 | Injective proof point | Evidence Inspector + Testnet read-only | What is actually verified onchain, and what remains unproven | Source/height/tx truthfully classified |
| 2:50–3:00 | Finish | White Instrument overview | One inspectable decision from intent to consequences | Clear next step |

## If authorized real Testnet execution is available

Substitute the 2:30–2:50 scene with an actual minimal verified transaction/order path: wallet approval → contract interaction → receipt → order readback → evidence linking to Intent. **Never** display an invented hash or claim FILLED from a submitted receipt. No covert sign/broadcast or funding.

## Spoken pitch (English, approximately 50 seconds, original draft)

> AI agents can place orders in seconds, but a proposal is not permission. An operator may have private trading limits that the agent must not see. VEREQO sits between an agent's financial intent and an Injective action. I load an exact proposed order, ask for the proof that matters, inspect what the permission would expose, and preview which dependent actions change if I revoke a credential. A valid proof still cannot bypass authorization. We keep submission, order creation, fills, and cancellation separate, and show the evidence behind each. The result is not another agent dashboard. It is an inspectable control boundary for delegated finance.

## Safety and visual direction

Keep White Instrument, precision dial, LCD, and Consequence Space. Avoid generic cards, text-heavy overlays and dramatic transitions hiding state changes. Every scene needs an actual user click and explicit display labels. Overlay a durable `SYNTHETIC REHEARSAL` watermark when synthetic. Never show private witness or real credentials.
