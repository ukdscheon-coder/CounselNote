// /api/paypal-webhook.js — Vercel serverless function.
//
// Configure in PayPal Developer Dashboard > your app > Webhooks: add
// https://counselnote.uk/api/paypal-webhook subscribed to event
// PAYMENT.CAPTURE.COMPLETED.
//
// Vercel project environment variables required:
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET  — from your PayPal app
//   PAYPAL_WEBHOOK_ID                       — shown when you create the webhook
//   PAYPAL_API_BASE                         — https://api-m.sandbox.paypal.com while
//                                              testing, https://api-m.paypal.com live
//   LICENSE_SIGNING_SECRET, RESEND_API_KEY  — shared with paddle-webhook.js
//
// Do NOT trust the front-end onApprove() callback in checkout.html for
// fulfilment — always issue the licence key from this server-verified
// webhook, which is what this file does.

const { issueLicenseKey } = require("../lib/license");

const TIER_BY_PRICE = { "149.00": "practitioner", "249.00": "professional", "595.00": "school" };

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const body = req.body; // Vercel parses JSON automatically for this one — fine for PayPal,
                          // whose verification API takes the parsed event, not raw bytes.

  try {
    const verified = await verifyPaypalWebhook(req.headers, body);
    if (!verified) return res.status(401).json({ error: "Invalid PayPal webhook signature" });

    if (body.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return res.status(200).json({ ignored: body.event_type });
    }

    const capture = body.resource;
    const customId = capture.custom_id || ""; // "counselnote:professional" — set in checkout.html createOrder()
    const tier = customId.split(":")[1] || TIER_BY_PRICE[capture.amount?.value];
    const email = capture.payer?.email_address;

    if (!tier || !email) {
      console.error("PayPal webhook: missing tier or email", { customId, email });
      return res.status(200).json({ warning: "Missing tier or email, no key issued" });
    }

    const licenseKey = issueLicenseKey({
      tier,
      schoolRef: capture.id,
      seats: tier === "school" ? 5 : 1,
      years: 1,
      secret: process.env.LICENSE_SIGNING_SECRET
    });

    await sendLicenseEmail({ to: email, tier, licenseKey });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("PayPal webhook handling failed:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

async function getPaypalAccessToken() {
  const basic = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(`${process.env.PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function verifyPaypalWebhook(headers, event) {
  const accessToken = await getPaypalAccessToken();
  const res = await fetch(`${process.env.PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: event
    })
  });
  if (!res.ok) return false;
  const { verification_status } = await res.json();
  return verification_status === "SUCCESS";
}

async function sendLicenseEmail({ to, tier, licenseKey }) {
  const tierName = { practitioner: "Practitioner", professional: "Professional", school: "School Assurance" }[tier];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "CounselNote <licences@counselnote.uk>",
      to,
      subject: "Your CounselNote licence key",
      text:
        `Thank you for purchasing CounselNote — ${tierName}.\n\n` +
        `Your licence key:\n\n  ${licenseKey}\n\n` +
        `Enter this in CounselNote under Settings & safety > Licence.\n\n` +
        `Download CounselNote: https://counselnote.uk/download.html\n\n` +
        `Keep this email — contact support@counselnote.uk if you lose it.`
    })
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
}

module.exports = handler;
