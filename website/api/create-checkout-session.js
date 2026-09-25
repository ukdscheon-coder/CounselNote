// /api/create-checkout-session.js — Vercel serverless function.
//
// Called from checkout.html when someone clicks "Buy with card". Creates a
// Stripe-hosted Checkout Session and returns its URL.
//
// Only ONE environment variable is required to take card payments:
//   STRIPE_SECRET_KEY  — Stripe Dashboard > Developers > API keys (sk_live_…)
//
// Prices are sent inline (price_data), so no Stripe Product/Price IDs need to
// be created. If you later create Prices in Stripe, you can override any tier
// with STRIPE_PRICE_PRACTITIONER / STRIPE_PRICE_PROFESSIONAL / STRIPE_PRICE_SCHOOL
// (one-off prices only — this session runs in "payment" mode).
//
// If STRIPE_SECRET_KEY is missing, the endpoint answers 503 with
// { fallback: "quote" } and the checkout page switches that tier to a
// quotation / invoice request instead of showing an error.

const TIERS = {
  practitioner: { name: "CounselNote Practitioner licence (1 year)", pence: 14900, env: "STRIPE_PRICE_PRACTITIONER" },
  professional: { name: "CounselNote Professional licence (1 year)", pence: 24900, env: "STRIPE_PRICE_PROFESSIONAL" },
  school: { name: "CounselNote School Assurance licence — 5 practitioners (1 year)", pence: 59500, env: "STRIPE_PRICE_SCHOOL" }
};

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { tier } = req.body || {};
  const t = TIERS[tier];
  if (!t) return res.status(400).json({ error: "Unknown tier" });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: "Card payments are not enabled yet", fallback: "quote" });
  }

  const origin = `https://${req.headers.host}`;
  const params = new URLSearchParams();
  params.append("mode", "payment");
  const priceId = process.env[t.env];
  if (priceId) {
    params.append("line_items[0][price]", priceId);
  } else {
    params.append("line_items[0][price_data][currency]", "gbp");
    params.append("line_items[0][price_data][unit_amount]", String(t.pence));
    params.append("line_items[0][price_data][product_data][name]", t.name);
  }
  params.append("line_items[0][quantity]", "1");
  params.append("success_url", `${origin}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`);
  params.append("cancel_url", `${origin}/checkout.html`);
  params.append("metadata[tier]", tier);
  params.append("customer_creation", "always");
  params.append("billing_address_collection", "required");
  params.append("invoice_creation[enabled]", "true"); // schools need a receipt/invoice for their records

  try {
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    if (!stripeRes.ok) {
      console.error("Stripe session creation failed:", await stripeRes.text());
      return res.status(502).json({ error: "Could not start checkout", fallback: "quote" });
    }

    const session = await stripeRes.json();
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Internal error", fallback: "quote" });
  }
}

module.exports = handler;
