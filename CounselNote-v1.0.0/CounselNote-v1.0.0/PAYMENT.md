# Selling CounselNote — payment setup guide

This folder (`payment/`) contains a ready-to-deploy checkout page and the
two webhook handlers that issue licence keys automatically once a payment
clears. None of it touches pupil data — it's entirely separate from the
desktop app, sitting on your website/Vercel project instead.

## What's included

```
payment/
  checkout.html        the pricing/buy page (Paddle overlay + PayPal buttons)
  lib/license.js        licence key issue/verify helper (HMAC-signed)
  api/paddle-webhook.js  Vercel function: confirms Paddle payment, emails the key
  api/paypal-webhook.js  Vercel function: confirms PayPal payment, emails the key
```

## Why two providers

- **Paddle** acts as Merchant of Record — it handles UK/EU VAT for you
  automatically. Use this as the primary "Buy with card" option.
- **PayPal** is there because some independent counsellors and small
  schools already trust/prefer it. You are the merchant of record for
  PayPal payments, so you're responsible for your own VAT treatment on
  those (ask an accountant — likely fine below the VAT registration
  threshold, but check).

For actual school/trust purchase orders and bank transfer, keep using the
"Request a school quotation" mailto link already on the page — many schools
cannot pay by card at all.

## Setup checklist

### 1. Paddle

1. Create a Paddle account, switch to **Sandbox** first.
2. Developer tools → Authentication → create a client-side token → paste
   into `checkout.html` (`Paddle.Initialize({ token: ... })`).
3. Catalog → Products → create three products (Practitioner £149/yr,
   Professional £249/yr, School Assurance £595/yr) with yearly recurring
   prices. Copy each **Price ID** (`pri_...`) into:
   - `checkout.html` (`data-price-id` attributes)
   - `api/paddle-webhook.js` (`TIER_BY_PRICE_ID` map)
4. Developer tools → Notifications → add a destination, URL =
   `https://<your-domain>/api/paddle-webhook`, subscribe to
   `transaction.completed`. Copy the destination's secret key into the
   `PADDLE_WEBHOOK_SECRET` environment variable on Vercel.
5. Test a sandbox purchase end-to-end before switching `Paddle.Environment.set("sandbox")`
   to live and swapping in a live client token.

### 2. PayPal

1. developer.paypal.com → create an app → copy **Client ID** and **Secret**.
2. Put the Client ID into `checkout.html`'s SDK `<script>` URL.
3. Put Client ID + Secret into Vercel env vars `PAYPAL_CLIENT_ID` /
   `PAYPAL_CLIENT_SECRET`.
4. In the same app, add a webhook: URL = `https://<your-domain>/api/paypal-webhook`,
   event = `PAYMENT.CAPTURE.COMPLETED`. Copy the **Webhook ID** into
   `PAYPAL_WEBHOOK_ID`.
5. Set `PAYPAL_API_BASE` to `https://api-m.sandbox.paypal.com` while
   testing, `https://api-m.paypal.com` once live.

### 3. Licence key signing + email

1. Generate a long random string for `LICENSE_SIGNING_SECRET` (e.g.
   `openssl rand -hex 32`) and set it as a Vercel env var. Keep it private —
   never put it in `checkout.html` or any client-side file.
2. Sign up for an email-sending provider (Resend is used in the example
   code — swap for Postmark/SES if you prefer) and set `RESEND_API_KEY`.
   Verify your sending domain (`counselnote.co.uk`) with that provider so
   emails don't land in spam.
3. The buyer pastes the emailed key into CounselNote → **Settings & safety
   → Licence key**. This is recorded locally for their own reference; it
   is intentionally NOT phoned home anywhere (the app is offline-first),
   so treat it as a professional courtesy/record rather than hard DRM —
   see the comment at the top of `payment/lib/license.js` for the reasoning.

### 4. Deploy

```bash
vercel deploy --prod
```

(or push to the GitHub repo already connected to your Vercel project, per
your usual workflow). Point `checkout.html` at your live domain, link to it
from your marketing site's "Buy" button, and link the download from
`README.md` / the GitHub Release built by `.github/workflows/build-windows.yml`.

## Before taking real payments

- Have `LICENCE.txt` reviewed by a solicitor.
- Decide your VAT position (Paddle handles its own transactions' VAT; you
  still need a stance on PayPal/invoice sales).
- Test the **whole** path once in sandbox: buy → webhook fires → email
  arrives → key pastes into the app cleanly.
- Make sure `sales@counselnote.co.uk` and `support@counselnote.co.uk`
  inboxes actually exist and are checked before linking them publicly.
