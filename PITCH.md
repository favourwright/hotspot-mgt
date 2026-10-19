# OgaWiFi

**Your hotspot already works. The problem is everything that happens around it.**

You bought the router. You ran the cables. The signal is good and people want
it. And yet selling the access is still the hardest part of the business:
someone has to be physically present, someone has to print or dictate codes,
someone has to be trusted with cash, and someone has to remember who paid for
what. That person is usually you.

OgaWiFi takes that entire layer off your hands. Connect your MikroTik router,
set your prices, and your customers pay online and get their login
immediately. No cash. No agent. No codes written in a notebook. It works at
2am while you are asleep, and it works when you are three states away.

---

## The one-line version

> Your Wi-Fi business keeps selling when you are not there.

---

## What actually changes on day one

**Customers pay themselves.** A customer connects, sees your branded page with
your plans and your prices, pays with their card or transfer through Paystack,
and the hotspot login appears on their screen in seconds. The device can even
log itself in. You did nothing.

**The money splits itself.** Paystack splits every single sale between your
account and the platform automatically, at the moment of payment. There is no
end-of-month reconciliation, no invoice to chase, and no float sitting in
someone else's pocket. You never have to trust a middleman with your revenue
again, because there is no longer a middleman holding it.

**Nothing gets lost.** Every payment, every voucher, every expiry is recorded
against a real customer account. You can open your dashboard and see exactly
what sold today, at which location, on which router.

**You stop being the support desk.** Customers get their credentials by email,
can see their own purchase history any time, and get warned by email an hour
before their access runs out, which is also the single most effective renewal
prompt in this business and it costs you nothing to send.

---

## "But I already have something that works"

Good. Most serious operators do. Here is the honest comparison.

### If you are using Mikhmon or the router's own voucher tool

Those tools are genuinely good at one thing: generating codes. They were never
built to take money. So the moment a code exists, you are back to the manual
world: someone has to be there to hand it over and collect cash.

That gap is where the business actually leaks:

- **You can only sell while someone is physically present.** Every hour nobody
  is at the counter is an hour of zero revenue from a router that is fully
  powered on and working.
- **Pre-generated codes are inventory that walks.** Printed batches get copied,
  shared, reused and quietly resold. You have no way to prove it.
- **Cash is unaudited by definition.** You are not comparing an agent's word
  against records, you are comparing it against nothing.
- **One router, one place.** Managing three locations means being in three
  places, or trusting three people.

OgaWiFi does not replace your router or your RouterOS setup. It sits in front
of it and sells for you, using the same hotspot feature your router already
has. You keep the hardware and the configuration you already know.

### If you have a developer who could "just build the payment part"

They could. Here is what they would actually have to build and then keep
alive, because we had to:

- A payment integration where the sale survives the customer's browser dying
  mid-transaction. We fulfil a purchase three independent ways: from the
  buyer's browser, from a server-to-server webhook, and from a reconciliation
  job that re-checks every charge against Paystack every 15 minutes. If one
  path fails, the customer still gets what they paid for. We built the third
  path because a real customer once paid and got nothing, and the only record
  of the sale was Paystack's own receipt.
- Protection against double-issuing a voucher when two of those paths land at
  once. That is a race condition, and the naive fix loses the race.
- A secure way to reach a router sitting behind a home or office connection
  with no public IP, which in our case is a managed WireGuard tunnel per
  tenant.
- Health monitoring that notices a router went offline before your customers
  do.
- Automatic cleanup of expired logins, so the router does not slowly fill up
  with thousands of dead users until it degrades.
- Expiry emails, sales digests, receipts, and the templates behind them.

That is not a feature. That is a product, and it is the part of the work that
never ends. You can have ours today instead of starting it.

### If you are worried about your existing captive portal

This is the objection we take most seriously, because a customised login page
is often the most personal thing an operator owns.

Installing our portal onto your router backs up what is already there, and
uninstalling gives you **your** page back, not MikroTik's stock one. The
restore contract was designed before the install feature was, on purpose. You
can try it and walk away intact.

---

## Why this wins for customers too, which is why it wins for you

The thing operators underestimate is how much a bad buying experience
suppresses demand. Someone who wants 500 naira of internet at 11pm and cannot
find anybody to pay does not wait until morning. They just do not buy.

With OgaWiFi, the buying experience is: connect, tap a plan, pay, online.
Under a minute, no human involved, no haggling, no "I don't have change." That
is not just convenience. It is volume you are currently not capturing, on
infrastructure you have already paid for.

And because every customer has a real account, a customer who buys from you
once already has an account the next time, on any location you run.

---

## What you get, concretely

**For selling**
- Your own branded storefront at your own slug, and a captive portal installed
  directly on your router
- Any number of pricing plans: duration, data cap, price, per location
- Card and transfer payments through Paystack, split automatically
- Instant credential delivery on screen and by email
- Customers can renew before they are cut off

**For running it**
- Dashboard with sales, payments, vouchers and router status
- Multiple routers and multiple locations under one account
- Router health checks every 15 minutes with online/offline tracking
- A daily sales digest in your inbox, so you know yesterday's numbers without
  logging in
- Retry any failed payment or voucher yourself, without contacting support
- Secure remote access to your router without a static IP

**For trusting it**
- Every write goes through the server, never straight from a browser. Direct
  database writes are refused by policy, not by convention.
- Role-separated access: you see your business, nobody else's.
- Payments are idempotent at two levels, so one charge can never become two
  vouchers.

---

## Pricing, plainly

You choose the shape that suits your business: a flat monthly fee, a small
percentage of each sale, a mix of both, or a free tier. Optional features like
the captive portal are bought separately, so you are never paying for
something you do not switch on.

The important part: **if you are on a percentage plan, we only earn when you
earn.** We do not get paid for a quiet month. That is deliberate, and it is the
clearest statement of how we expect this relationship to work.

And if we ever change what an addon costs, existing users keep the price they
signed up at. That is not a promise in a blog post, it is a required step in
our own deployment process.

---

## What it takes to start

1. Create an account and register your business.
2. Add your location and connect your MikroTik router. The setup wizard walks
   through it, including the secure tunnel, with no networking background
   assumed.
3. Create your plans and your prices.
4. Share your link, or install the portal so your Wi-Fi sells itself.

Most of the work is step 2, and it is a one-time job.

---

## The real argument

You are not being asked to change what your business is. You are being asked
to stop being the bottleneck in it.

Right now your revenue is capped by your own physical presence and by how much
you can trust the people standing in for you. That ceiling has nothing to do
with your coverage, your bandwidth, or your demand. It is purely a selling
problem, and it is the one part of this business that software is genuinely
better at than people.

Your router is already running 24 hours a day. OgaWiFi is how it starts
earning for 24 of them.

**Connect your router. Set your prices. Go to sleep.**
