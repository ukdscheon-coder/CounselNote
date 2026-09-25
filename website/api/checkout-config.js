// /api/checkout-config.js — tells checkout.html which payment options are live.
// Returns only public information (never secrets).
//   PAYPAL_CLIENT_ID is a public client ID, safe to expose to the browser.
module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({
    card: Boolean(process.env.STRIPE_SECRET_KEY),
    paypalClientId: process.env.PAYPAL_CLIENT_ID || null
  });
};
