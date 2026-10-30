# Decision hooks: for maintainers

**Tenant-facing documentation is generated**: the Signatures and Decision
hooks sections, and the `voucher.pre_purchase` request and answer, at
`/developers`. The receiver code samples there are run against our own
signing by `npm run test:api-docs`, so they cannot quietly stop working.

| Fact | Source |
| --- | --- |
| The request we send, the answers we accept | `DecisionHookRequestSchema`, `DecisionHookResponseSchema` and `parseHookResponse` in `lib/decision-hook-contract.ts`. The real request body is tested against the schema |
| Timeouts, size cap, breaker | `lib/decision-hook-contract.ts` |
| Calling the hook, the fail strategy, logs, alerts | `lib/decision-hooks.ts` |
| The network guard | `lib/safe-fetch.ts` (`npm run test:safe-fetch`) |
| Signing | `lib/hook-signing.ts` |
| Account linking | `lib/hook-links.ts`, `app/api/hooks/link/*` |
| The verification host in the walled garden | `lib/hook-walled-garden.ts`, `docs/captive-portal.md` |

Why it runs before payment, and the other decisions behind it:
`docs/decisions-and-gotchas.md` and `docs/plans/tenant-api-and-hooks.md`.
