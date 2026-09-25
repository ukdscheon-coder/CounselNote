// /api/stripe-webhook.js — Vercel serverless function.
//
// Configure in Stripe Dashboard > Developers > Webhooks > Add endpoint:
//   URL: https://counselnote.uk/api/stripe-webhook
//   Events to send: checkout.session.completed
//
// Vercel project environment variables required:
//   STRIPE_WEBHOOK_SECRET   — shown when you create the endpoint above ("whsec_...")
//   LICENSE_SIGNING_SECRET  — your own long random string, used to sign licence keys
//   RESEND_API_KEY          — (or swap in your own email provider, see sendLicenseEmail)
//
// IMPORTANT: Vercel parses JSON bodies by default, which breaks Stripe's
// signature check (Stripe signs the exact raw bytes). This handler disables
// the automatic body parser and verifies the raw body itself, using the
// same HMAC-SHA256 scheme Stripe's own SDK uses — no Stripe SDK needed.

const crypto = require("crypto");
const { issueLicenseKey } = require("../lib/license");

const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifyStripeSignature(rawBody, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=").map((s) => s.trim()))
  );
  if (!parts.t || !parts.v1) return false;
  // Reject anything older than 5 minutes to block replay attacks.
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false; // length mismatch etc — treat as invalid, not a crash
  }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const rawBody = await readRawBody(req);
  const signature = req.headers["stripe-signature"];

  if (!verifyStripeSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = JSON.parse(rawBody);

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ ignored: event.type });
  }

  try {
    const session = event.data.object;
    const tier = session.metadata?.tier;
    const email = session.customer_details?.email || session.customer_email;

    if (!tier || !email) {
      console.error("Stripe webhook: missing tier or email", { tier, email });
      return res.status(200).json({ warning: "Missing tier or email, no key issued" });
    }

    const licenseKey = issueLicenseKey({
      tier,
      schoolRef: session.id,
      seats: tier === "school" ? 5 : 1,
      years: 1,
      secret: process.env.LICENSE_SIGNING_SECRET
    });

    await sendLicenseEmail({ to: email, tier, licenseKey });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Stripe webhook handling failed:", err);
    // Return 500 (not 200) while you're still setting this up, so Stripe
    // retries and you don't silently lose an order. Stripe retries failed
    // webhooks automatically for several days.
    return res.status(500).json({ error: "Internal error" });
  }
}

async function sendLicenseEmail({ to, tier, licenseKey }) {
  const tierName = { practitioner: "Practitioner", professional: "Professional", school: "School Assurance" }[tier];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "CounselNote <licences@counselnote.uk>",
      to,
      subject: "Your CounselNote licence key",
      text:
        `Thank you for purchasing CounselNote — ${tierName}.\n\n` +
        `Your licence key:\n\n  ${licenseKey}\n\n` +
        `Enter this in CounselNote under Settings & safety > Licence.\n\n` +
        `Download CounselNote: https://counselnote.uk/download.html\n\n` +
        `Keep this email — your licence key cannot be resent automatically if lost; contact support@counselnote.uk.`
    })
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
}

module.exports = handler;
module.exports.config = config;
