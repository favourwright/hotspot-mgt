# Webhooks

For the developer on a tenant's side. Part of the **API Access** addon, with
the API (`docs/public-api.md`) and decision hooks (`docs/decision-hooks.md`).
Internals: `lib/webhooks.ts`, `lib/webhook-events.ts`.

A webhook tells your server the moment something happens, so you don't have
to poll the API. Set them up at **Admin, then Webhooks**: up to 5 endpoints,
each with the events it wants (none ticked means all of them, including ones
added later).

## Events

| Type | When | `data` |
| --- | --- | --- |
| `voucher.issued` | A voucher was created and works: a first purchase, or a failed one fixed from the Failed Queue | `{ "voucher": Voucher }` |
| `voucher.renewed` | A customer topped up a login they already had; `voucher.renewalOf` is the one it replaced | `{ "voucher": Voucher }` |
| `voucher.failed` | A customer paid but the router couldn't be programmed; it waits in the Failed Queue | `{ "voucher": Voucher }` |
| `payment.succeeded` | A payment was recorded against a voucher | `{ "payment": Payment }` |
| `webhook.test` | Only from the **Send test event** button | `{ "message": "..." }` |

`Voucher` and `Payment` are exactly what `GET /api/v1/vouchers/{id}` and
`GET /api/v1/payments/{reference}` return. A voucher never includes its
password.

A sale normally produces two events: `voucher.issued` (or `.renewed`, or
`.failed`) and `payment.succeeded`.

## What we send

```
POST <your URL>
content-type: application/json
user-agent: OgaWiFi-Webhooks/1
ogawifi-event: voucher.issued
ogawifi-delivery: evt_..._<endpoint>
ogawifi-delivery-attempt: 1
ogawifi-signature: t=1761818400,v1=<hex>
```

```json
{
  "apiVersion": "2026-10-30",
  "id": "evt_6f1c2a9e0b7d4c3f8a5e1d2c3b4a5968",
  "type": "voucher.issued",
  "createdAt": "2026-10-30T10:00:00.000Z",
  "data": { "voucher": { "id": "...", "status": "active", "username": "ada-4821" } }
}
```

**Check the signature** exactly as for a decision hook: HMAC-SHA256 of
`` `${t}.${rawBody}` `` with the endpoint's signing secret, compared in
constant time against each `v1`, refusing anything more than 5 minutes old.
The receiver code is in `docs/decision-hooks.md`, under "Checking the
signature". Each endpoint has its own secret, separate from your API keys.

## Answering

Answer with any **2xx** within 10 seconds. Anything else, a redirect, a
timeout or no answer counts as a failure. Do slow work after you've answered:
record the event, return `200`, then process it.

**Deduplicate on `id`.** Delivery is at least once: a retry after a timeout
can deliver an event you already processed, and one sale is reported by
several of our systems but always as the same `id`. Store the ids you've
handled and ignore repeats.

Events can arrive out of order (a retry of an older event after a newer one
succeeded). If order matters to you, compare `createdAt`, or fetch the current
state from the API.

## When your server is down

Each failed delivery is retried after 1 minute, 5 minutes, 30 minutes, 2 hours,
6 hours, 12 hours and 24 hours: eight attempts over about a day and a half,
then we give up on that delivery.

If an endpoint accepts **nothing for three days**, we switch it off and email
you. Nothing is lost: everything is still in the API, and every delivery is in
the endpoint's log (kept 30 days). Fix your server, use **Send test event**,
then switch it back on.

From the endpoint's **Deliveries** list you can **Send again** any delivery
that was delivered, gave up or was cancelled.

## Limits and safety

- `https://` on port 443 to a public hostname only, like decision hooks.
- Don't allowlist our IP addresses; they aren't fixed. The signature is how
  you know it's us.
- **New secret** keeps the old one valid for 24 hours; meanwhile each event
  carries two `v1` signatures.
- While the API Access addon isn't active, no events are recorded or sent.
