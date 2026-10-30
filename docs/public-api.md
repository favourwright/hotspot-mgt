# Public API (v1)

For the developer on a tenant's side, and for whoever supports them. Part of
the **API Access** addon, alongside decision hooks (`docs/decision-hooks.md`).
Internals: `lib/public-api.ts`, `lib/api-keys.ts`,
`lib/public-api-serializers.ts`.

Read-only in v1: plans, locations, vouchers, payments and customers.

## Keys

Create one at **Admin, then API keys**. Give it a name and only the
permissions the system using it needs. The full key is shown **once**:

```
ogw_live_8Hq2LmZ0aB3cD4eF_k9P3xQ7rT2vW5yZ1aB4cD6eF8gH0jK2m
```

Send it on every request:

```
Authorization: Bearer ogw_live_...
```

- Keep it on your server. Never put it in a website or an app someone can
  download.
- One key per system, so revoking one touches nothing else.
- **Revoke** at Admin, then API keys. It stops working on its very next
  request.
- Up to 10 active keys per business.

| Permission | Endpoints |
| --- | --- |
| `plans:read` | `GET /api/v1/plans`, `GET /api/v1/plans/{id}` |
| `locations:read` | `GET /api/v1/locations` |
| `vouchers:read` | `GET /api/v1/vouchers`, `GET /api/v1/vouchers/{id}` |
| `payments:read` | `GET /api/v1/payments`, `GET /api/v1/payments/{reference}` |
| `customers:read` | `GET /api/v1/customers`, `GET /api/v1/customers/{uid}` |

## Base URL

`https://ogawifi.online/api/v1`. Your business's own subdomain works too.

## Responses

Success:

```json
{ "data": { ... } }
{ "data": [ ... ], "nextCursor": "1761818400000_abc123" }
```

Error:

```json
{
  "error": {
    "type": "permission_error",
    "code": "insufficient_scope",
    "message": "This key does not have the payments:read scope.",
    "requestId": "req_3f9c0a1b2c3d4e5f"
  }
}
```

Every response carries `x-request-id`. Quote it when asking for help.

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_limit`, `invalid_cursor`, `invalid_status`, `invalid_from`, `invalid_to` | A query parameter is wrong |
| 401 | `invalid_api_key` | Missing, malformed, unknown, revoked or wrong. Deliberately one answer for all of them |
| 402 | `api_access_required` | The business's API Access addon isn't active |
| 403 | `insufficient_scope` | The key doesn't have that permission |
| 404 | `not_found` | No such plan, voucher, payment or customer at this business |
| 429 | `rate_limited` | Too fast. Wait `retry-after` seconds |
| 429 | `daily_budget_exhausted` | Today's read budget is spent (below). Resets at 00:00 UTC |
| 500 | `internal_error` | Ours. Retry later, and send us the `requestId` if it persists |

**Compatibility:** fields are added within v1 without notice, so ignore
fields you don't recognise. Anything that would break you becomes v2.

## Lists and paging

Lists are newest first, `limit` per page (default 25, max 50). Paging is by
cursor only: pass the `nextCursor` you were given as `cursor`. When
`nextCursor` is `null`, that was the last page. There are no totals and no page
numbers.

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://ogawifi.online/api/v1/payments?status=success&from=2026-10-01&limit=50"
```

Filters on vouchers and payments: `status`, `from`, `to` (ISO 8601 dates or
times, inclusive). Vouchers: `active`, `expired`, `failed`, `superseded`.
Payments: `pending`, `success`, `failed`. Plans: `locationId`.

## Limits

- 60 requests a minute per key, 120 a minute per business. Over that: `429
  rate_limited` with `retry-after`.
- **A daily read budget of 5,000 records per business.** Every record a request
  returns counts; a list counts one extra. `x-read-budget-remaining` on every
  response says what's left today. Once it's spent, requests get `429
  daily_budget_exhausted` until 00:00 UTC.

Pull changes since the last time you asked (`from=`) rather than re-reading
everything, and the budget goes a long way.

## What you get

Money is integer kobo, and its fields are named `...Kobo`. Times are ISO 8601
in UTC.

**Plan:** `id`, `name`, `priceKobo`, `duration`, `dataLimit`, `devices`,
`locationId`, `active`, `createdAt`.

**Location:** `id`, `name`, `active`, `createdAt`.

**Voucher:** `id`, `status`, `username`, `customerUid`, `customerEmail`,
`planId`, `planName`, `locationId`, `duration`, `dataLimit`, `renewalOf`,
`paymentReference`, `createdAt`, `expiresAt`.

**Payment:** `reference`, `status`, `amountKobo` (what the customer paid),
`tenantShareKobo` (your share; `null` when Paystack didn't report a split),
`customerUid`, `customerEmail`, `planId`, `planName`, `locationId`,
`voucherId`, `createdAt`.

**Customer:** `uid`, `email`, `externalId` (your own id for them from account
linking; only on `GET /customers/{uid}`), `totalVouchers`, `totalSpentKobo`,
`joinedAt`.

**Never available through the API:** voucher passwords, device MAC addresses,
router addresses and credentials, Paystack subaccount codes, the platform's
share of a sale.
