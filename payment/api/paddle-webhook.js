// /api/paddle-webhook.js — Vercel serverless function.
//
// Configure in Paddle: Developer tools > Notifications > add a destination
// of type "URL" pointing to https://counselnote.co.uk/api/paddle-webhook,
// subscribed to at least: transaction.completed
//
// Vercel project environment variables required:
//   PADDLE_WEBHOOK_SECRET     — the secret shown for this notification destination
//   LICENSE_SIGNING_SECRET    — your own long random string, used to sign licence keys
//   RESEND_API_KEY            — (or swap in your own email provider, see sendLicenseEmail)
//
// IMPORTANT: Vercel parses JSON bodies by default, which breaks signature
// verification (Paddle signs the exact raw bytes). This handler disables
// the automatic body parser and reads the raw body itself.

const crypto = require("crypto");
const { issueLicenseKey } = require("../payment/lib/license");

export const config = { api: { bodyParser: false } };

const TIER_BY_PRICE_ID = {
  // TODO: fill in with the real Paddle price IDs from your dashboard —
  // these must match the data-price-id values used in checkout.html.
  pri_REPLACE_PRACTITIONER: "practitioner",
  pri_REPLACE_PROFESSIONAL: "professional",
  pri_REPLACE_SCHOOL: "school"
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifyPaddleSignature(rawBody, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(";").map((p) => p.split("=").map((s) => s.trim()))
  );
  if (!parts.ts || !parts.h1) return false;
  // Reject anything older than 5 minutes to block replay attacks.
  if (Math.abs(Date.now() / 1000 - Number(parts.ts)) > 300) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.ts}:${rawBody}`)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.h1));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const rawBody = await readRawBody(req);
  const signature = req.headers["paddle-signature"];

  if (!verifyPaddleSignature(rawBody, signature, process.env.PADDLE_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = JSON.parse(rawBody);

  if (event.event_type !== "transaction.completed") {
    // Acknowledge anything we don't act on yet (e.g. transaction.created)
    // so Paddle doesn't keep retrying it.
    return res.status(200).json({ ignored: event.event_type });
  }

  try {
    const transaction = event.data;
    const item = transaction.items?.[0];
    const priceId = item?.price?.id;
    const tier = TIER_BY_PRICE_ID[priceId] || transaction.custom_data?.tier;
    const email = transaction.customer?.email || transaction.custom_data?.email;

    if (!tier || !email) {
      console.error("Paddle webhook: missing tier or email", { priceId, email });
      return res.status(200).json({ warning: "Missing tier or email, no key issued" });
    }

    const licenseKey = issueLicenseKey({
      tier,
      schoolRef: transaction.id,
      seats: tier === "school" ? 5 : 1,
      years: 1,
      secret: process.env.LICENSE_SIGNING_SECRET
    });

    await sendLicenseEmail({ to: email, tier, licenseKey });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Paddle webhook handling failed:", err);
    // Still return 200 once you've logged it somewhere durable (e.g. a
    // database row), otherwise Paddle will retry indefinitely. While you're
    // setting this up, returning 500 is safer so you don't silently lose orders.
    return res.status(500).json({ error: "Internal error" });
  }
}

async function sendLicenseEmail({ to, tier, licenseKey }) {
  // Swap this for whatever email provider you already use (Resend, Postmark,
  // SES...). This example uses Resend's HTTP API directly with no SDK.
  const tierName = { practitioner: "Practitioner", professional: "Professional", school: "School Assurance" }[tier];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "CounselNote <licences@counselnote.co.uk>",
      to,
      subject: "Your CounselNote licence key",
      text:
        `Thank you for purchasing CounselNote — ${tierName}.\n\n` +
        `Your licence key:\n\n  ${licenseKey}\n\n` +
        `Enter this in CounselNote under Settings & safety > Licence.\n\n` +
        `Download CounselNote: https://counselnote.co.uk/download\n\n` +
        `Keep this email — your licence key cannot be resent automatically if lost; contact support@counselnote.co.uk.`
    })
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
}
