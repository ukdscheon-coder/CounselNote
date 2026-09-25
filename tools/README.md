# Site build

`website/` is the Vercel root directory (Project Settings → Root Directory = `website`).

To add or edit a guide, edit `content/guides/*.md` (front matter: title, description, short),
then run:

    pip install markdown
    python3 tools/build_site.py

This regenerates `website/guides/`, about/contact/privacy/terms pages, the shared GA/AdSense
head tags on every page, `sitemap.xml` and `robots.txt`. Commit the generated files.

AdSense loads only on content pages (guides, home, product guide, FAQ, about) — never on
checkout, download, privacy, terms or contact.

## Payments (Vercel → Settings → Environment Variables)

| Variable | Needed for |
|---|---|
| `STRIPE_SECRET_KEY` | Card checkout. Without it, buttons switch to "Request invoice / quote". |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook that emails the licence key |
| `LICENSE_SIGNING_SECRET` | Signing licence keys |
| `RESEND_API_KEY` | Emailing licence keys |
| `PAYPAL_CLIENT_ID` (optional) | Shows PayPal buttons |
| `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_API_BASE` (optional) | PayPal webhook |

No Stripe Price IDs are needed — prices are sent inline (£149 / £249 / £595).
