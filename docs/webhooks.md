# Webhooks: for maintainers

**Tenant-facing documentation is generated**: the Webhooks section and every
event's exact body at `/developers`, and the `webhooks` section of
`/api/v1/openapi.json`. Do not document events or payloads here.

| Fact | Source |
| --- | --- |
| The events, their descriptions and payloads | `WEBHOOK_EVENTS` in `lib/webhook-events.ts`, built from `lib/api-schemas.ts` |
| Retry schedule, give-up, switch-off rule | `lib/webhook-events.ts` |
| Delivery, leases, the failing clock | `lib/webhooks.ts` |
| Where events are emitted | The fulfilment runner's event step (`lib/fulfilment-runner.ts`, via `emitVoucherEvents`) and the Failed Queue retry (`app/api/voucher/retry`) |
| Retries | The `webhook-deliver` cron (`docs/cron-jobs.md`) |

Adding an event: add it to `WEBHOOK_EVENTS` with a description and a `data`
schema, emit it with `emitWebhookEvent` from where the fact becomes true, with
a subject id that is the same however many times it is reported. The docs and
the owner's event picker pick it up on their own.

Tests: `npm run test:webhooks`, `npm run test:api-docs`.
