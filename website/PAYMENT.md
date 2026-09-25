# Selling CounselNote — payment setup guide (Stripe + PayPal)

This folder (`website/`) contains a ready-to-deploy checkout page and the
backend functions that issue licence keys automatically once a payment
clears. None of it touches pupil data — it's entirely separate from the
desktop app, sitting on the website/Vercel project instead.

## What's included

```
website/
  checkout.html                  the pricing/buy page (Stripe + PayPal)
  checkout-success.html          shown after a successful Stripe payment
  lib/license.js                 licence key issue/verify helper (HMAC-signed)
  api/create-checkout-session.js Vercel function: starts a Stripe Checkout session
  api/stripe-webhook.js          Vercel function: confirms Stripe payment, emails the key
  api/paypal-webhook.js          Vercel function: confirms PayPal payment, emails the key
```

## Why two providers

- **Stripe** is the primary "Buy with card" option. You are the merchant of
  record — Stripe processes the card payment, but **you remain responsible
  for VAT/sales tax registration and filing yourself** (Stripe Tax can help
  calculate it, but doesn't file or remit on your behalf). For a UK-only
  customer base this is straightforward; if CounselNote later sells widely
  outside the UK, revisit whether a Merchant-of-Record provider like Paddle
  is worth its higher fee at that point.
- **PayPal** is there because some independent counsellors and small
  schools already trust/prefer it.

For actual school/trust purchase orders and bank transfer, keep using the
"Request a school quotation" mailto link already on the page — many schools
cannot pay by card at all.

## Setup checklist

### 1. Stripe

1. Log into your existing Stripe account at dashboard.stripe.com.
2. **Toggle "Test mode" on** (top-right switch) while you set everything up
   — never test with real card payments.
3. **Developers → API keys** → copy the **Secret key** (`sk_test_...`).
   Add it to Vercel as the environment variable `STRIPE_SECRET_KEY`.
4. **Product catalog → Add product** — create three products:
   - Practitioner — one-time price £149.00 GBP
   - Professional — one-time price £249.00 GBP
   - School Assurance — one-time price £595.00 GBP

   (These are set up as one-time payments renewed manually each year, not
   Stripe subscriptions, to keep the licence-key model simple. You can
   switch to recurring billing later if you want automatic renewals.)
5. For each product, copy its **Price ID** (looks like `price_1AbCdEfGh...`)
   and paste it into **both**:
   - `api/create-checkout-session.js` (the `PRICE_IDS` object)
   - nothing else needs the Price ID — the webhook reads the tier from
     metadata set when the session was created, not from the price.
6. **Developers → Webhooks → Add endpoint**:
   - URL: `https://counselnote.uk/api/stripe-webhook`
   - Events: `checkout.session.completed`
   - Copy the **Signing secret** (`whsec_...`) into Vercel as `STRIPE_WEBHOOK_SECRET`.
7. Test with Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC.
8. Once everything works end-to-end in test mode, switch Stripe to **live
   mode**, repeat steps 3 and 6 for the live keys/webhook (test and live
   have separate keys and separate webhook secrets), and update the Vercel
   environment variables to the live values.

### 2. PayPal

1. developer.paypal.com → create an app → copy **Client ID** and **Secret**.
2. Put the Client ID into `checkout.html`'s SDK `<script>` URL.
3. Put Client ID + Secret into Vercel env vars `PAYPAL_CLIENT_ID` /
   `PAYPAL_CLIENT_SECRET`.
4. In the same app, add a webhook: URL = `https://counselnote.uk/api/paypal-webhook`,
   event = `PAYMENT.CAPTURE.COMPLETED`. Copy the **Webhook ID** into
   `PAYPAL_WEBHOOK_ID`.
5. Set `PAYPAL_API_BASE` to `https://api-m.sandbox.paypal.com` while
   testing, `https://api-m.paypal.com` once live.

### 3. Licence key signing + email

1. Generate a long random string for `LICENSE_SIGNING_SECRET` (e.g.
   `openssl rand -hex 32`) and set it as a Vercel env var. Keep it private —
   never put it in any client-side (browser-loaded) file.
2. Sign up for an email-sending provider (Resend is used in the example
   code — swap for Postmark/SES if you prefer) and set `RESEND_API_KEY`.
   Verify your sending domain (`counselnote.uk`) with that provider so
   emails don't land in spam.
3. The buyer pastes the emailed key into CounselNote → **Settings & safety
   → Licence key**. This is recorded locally for their own reference; it
   is intentionally NOT phoned home anywhere (the app is offline-first),
   so treat it as a professional courtesy/record rather than hard DRM —
   see the comment at the top of `lib/license.js` for the reasoning.

### 4. Deploy

```bash
git add website
git commit -m "Configure Stripe checkout"
git push
```

Vercel redeploys automatically on push (already connected to this repo).
After pushing, go to Vercel → Project → **Settings → Environment Variables**
and add everything listed above, then trigger a redeploy (Vercel does this
automatically on the next push, or click "Redeploy" manually).

## Before taking real payments

- Have `LICENCE.txt` reviewed by a solicitor.
- Decide your VAT position — confirm whether you need to register for VAT
  given your turnover, and how Stripe Tax fits into that (ask an
  accountant; this isn't something either of us can resolve in code).
- Test the **whole** path once in Stripe test mode: buy → webhook fires →
  email arrives → key pastes into the app cleanly.
- Make sure `sales@counselnote.uk` and `support@counselnote.uk` inboxes
  actually exist and are checked before linking them publicly (they
  already do, per the Cloudflare Email Routing setup).
