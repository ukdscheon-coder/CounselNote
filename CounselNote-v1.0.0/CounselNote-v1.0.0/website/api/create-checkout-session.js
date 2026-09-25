// /api/create-checkout-session.js — Vercel serverless function.
//
// Called from checkout.html when someone clicks "Buy with card". Creates a
// Stripe-hosted Checkout Session and returns its URL, which the browser then
// redirects to. Stripe handles the card form, 3D Secure, receipts, etc.
//
// Vercel project environment variables required:
//   STRIPE_SECRET_KEY   — from Stripe Dashboard > Developers > API keys
//                          (use the "sk_test_..." key while testing, "sk_live_..." once live)
//
// You do NOT need the Stripe Node SDK installed — this calls Stripe's REST
// API directly over fetch, so there's nothing extra to npm install on Vercel.

const PRICE_IDS = {
  // TODO: replace with the real Stripe Price IDs from Stripe Dashboard >
  // Product catalog (create one Product per tier, each with a recurring
  // yearly price, then copy the Price ID — looks like "price_1AbC...").
  practitioner: "price_REPLACE_PRACTITIONER",
  professional: "price_REPLACE_PROFESSIONAL",
  school: "price_REPLACE_SCHOOL"
};

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { tier } = req.body || {};
  const priceId = PRICE_IDS[tier];
  if (!priceId) return res.status(400).json({ error: "Unknown tier" });

  const origin = `https://${req.headers.host}`;

  try {
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", `${origin}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `${origin}/checkout.html`);
    params.append("metadata[tier]", tier);
    // Collects the buyer's email on the Stripe page so we have somewhere to send the licence key.
    params.append("customer_creation", "always");

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.text();
      console.error("Stripe session creation failed:", err);
      return res.status(502).json({ error: "Could not start checkout" });
    }

    const session = await stripeRes.json();
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

module.exports = handler;
