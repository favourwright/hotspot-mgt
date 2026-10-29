# Decision hooks

Written for the developer on a tenant's side, and for whoever supports them.
The internals are in `lib/decision-hooks.ts`; why it is shaped this way is in
`docs/plans/tenant-api-and-hooks.md` (Phase 3).

## What a hook is

A URL on your own server. Before a customer pays for a plan, we send it who is
buying and what, and your server answers yes or no. A no stops the purchase
before any payment exists, so nothing ever needs refunding. Use it for anything
your own system knows: membership, account standing, credit, eligibility.

One hook per business, optionally limited to some plans or some locations. It
is part of the **API Access** addon: bought from the Addons page, or included
in your plan.

## Setting one up

1. **Admin, then Hooks, then New hook.** Give it a name and your URL. The URL
   must be `https://` on the standard port, with a public hostname: no IP
   addresses, no `localhost`, nothing that resolves to a private network.
2. **Choose what happens if your server can't be reached.** There is no
   default; see "When your server fails" below.
3. **Copy the signing secret.** It is shown once. If you lose it, issue a new
   one.
4. **Send test.** We make a real, signed call with sample data and show you
   exactly what your server answered and how we read it.
5. **Switch it on.** New hooks start off, so a mistake in a brand-new hook
   can't stop your sales the moment you save it.

## What we send

```
POST <your URL>
content-type: application/json
user-agent: OgaWiFi-Hooks/1
ogawifi-event: voucher.pre_purchase
ogawifi-request-id: req_3f9c0a1b2c3d4e5f
ogawifi-signature: t=1761739200,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

(Values are illustrative.)

```json
{
  "apiVersion": "2026-10-29",
  "id": "req_3f9c0a1b2c3d4e5f",
  "event": "voucher.pre_purchase",
  "createdAt": "2026-10-29T12:00:00.000Z",
  "data": {
    "customer": { "uid": "a8Kd...", "email": "buyer@example.com" },
    "plan": { "id": "p_daily", "name": "Daily", "priceKobo": 50000 },
    "location": { "id": "loc_main", "name": "Main branch" },
    "purchase": { "intent": "reuse" }
  }
}
```

- `customer.uid` is stable for that customer at your business. Store it against
  your own records the first time you see it; email addresses can change.
- `priceKobo` is the plan's price in kobo, before any processing fee.
- `intent` is `"reuse"` when the customer is topping up a login they already
  have, `"fresh"` when they asked for a new code (for someone else, usually).
- A Test call has `"test": true` at the top level. Live calls never do.
- **Ignore fields you don't recognise.** We add fields within a version without
  notice; we change `apiVersion` only for a breaking change.

We send identifiers, not personal details beyond the email. Anything else you
need (an age, a membership tier) look up in your own system by `uid`.

## What you answer

A `2xx` status with exactly one of:

```json
{ "allowed": true }
```

```json
{ "allowed": false, "reason": "Your membership has expired.", "code": "MEMBERSHIP_EXPIRED" }
```

- `reason` is shown to the customer as plain text, up to 200 characters, so
  write it for them. Leave it out and they see a generic message.
- `code` is for your own logs: capital letters, digits and underscores, up to
  64 characters.
- `allowed` must be the JSON boolean. The string `"false"` is not an answer,
  and neither is `1`.

Anything else counts as your server failing: a non-`2xx` status (even one with
`"allowed": true` in the body), a redirect (we never follow them), a body that
isn't JSON, a body over 10 KB, or no answer within your timeout (500 to 2500
ms, default 2000). The customer is waiting while we ask, so answer quickly.

The answer cannot change the price or anything else about the purchase.

## Checking the signature

Every request is signed so you can tell it came from us and isn't a replay.
Check it before trusting anything in the body:

1. Read the **raw** request body, before any JSON parsing. Re-serialising
   parsed JSON changes the bytes and the check fails.
2. Split `ogawifi-signature` on commas: one `t=` (seconds since the epoch) and
   one or more `v1=` values.
3. Refuse the request if `t` is more than 5 minutes old, or more than a minute
   in the future.
4. Compute HMAC-SHA256 of `` `${t}.${rawBody}` `` with your secret, as hex.
5. Accept if it equals **any** of the `v1` values, compared in constant time.

```js
const crypto = require("crypto");

function verifyOgaWiFi(rawBody, header, secret) {
  const parts = header.split(",").map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(t) || now - t > 300 || t - now > 60) return false;

  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")
  );
  return parts
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const given = Buffer.from(p.slice(3));
      // timingSafeEqual throws on unequal lengths, so check first.
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });
}
```

Using Express, capture the raw body with
`express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } })`.

**Issuing a new secret** keeps the old one valid for 24 hours, and during that
time every request carries two `v1` signatures, one per secret. Deploy the new
secret whenever suits you within the day.

**Don't allowlist our IP addresses.** They aren't guaranteed to stay the same.
The signature is how you know it's us.

## When your server fails

You chose one of these when you created the hook:

- **Stop the purchase.** The customer is asked to try again in a few minutes.
  Right for a rule that must hold. While your server is down, customers can't
  buy the plans the hook covers.
- **Let the purchase through.** Nothing stops, but nothing is checked either.

After **10 failures in a row** we stop calling your server, so a dead server
doesn't slow every checkout down. Your choice above still applies to every
purchase during that time: a "stop" hook keeps stopping. We try one request
every 30 seconds, and the first good answer puts things back to normal. You get
an email when we stop calling and another when it recovers, and the Hooks page
shows a "Failing" badge in between.

Nothing ever switches your hook off for you. Switching it off or deleting it is
always possible from the Hooks page, even if your API Access addon has lapsed
or your plan fee is overdue.

## Limits

- Up to 600 calls a minute across your business. Beyond that, your "if your
  server fails" choice applies; this exists to stop abuse, not to limit sales.
- A customer who taps Pay twice within 10 seconds is asked about once: a yes is
  remembered that long. A no is never remembered, so a customer you've just
  fixed in your system can retry straight away.

## Call log

The Hooks page shows the last 50 calls with their outcome, status and timing,
kept for 30 days. Outcomes:

| Outcome | Meaning |
| --- | --- |
| Allowed | Your server said yes |
| Blocked | Your server said no; the reason is shown |
| Failed | Your server's answer didn't count (see above), or it didn't answer |
| Not called | We'd stopped calling after repeated failures |
| Over cap | More than 600 calls in a minute |
| Test | A call from the Send test button |
