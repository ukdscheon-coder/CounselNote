// CounselNote — licence key helper
//
// CounselNote is a local, offline desktop app: there is no central server it
// phones home to, so this is an HONOUR-SYSTEM key, not unbreakable DRM. Its
// purpose is to (a) give every paying school a clean, professional licence
// key to enter in Settings, and (b) let you tell tiers apart and detect
// obviously-copied keys, not to stop a determined person from cracking it.
//
// Format:  CN-<TIER>-<PLAINTEXT>-<SIG>
//   TIER       PR  = Practitioner, PF = Professional, SA = School Assurance
//   PLAINTEXT  base32, contains schoolId + seats + expiry (or "PERM")
//   SIG        first 8 hex chars of HMAC-SHA256(secret, TIER + PLAINTEXT)
//
// Set LICENSE_SIGNING_SECRET as an environment variable on the server that
// issues keys (e.g. a Vercel project env var). Never put the real secret
// inside the desktop app — only a verification routine that uses the SAME
// secret would let someone forge keys, so keep this file server-side only.

const crypto = require("crypto");

const TIERS = { practitioner: "PR", professional: "PF", school: "SA" };

function base32(buf) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", out = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += alphabet[parseInt(chunk, 2)];
  }
  return out;
}

function sign(secret, tierCode, plaintext) {
  return crypto
    .createHmac("sha256", secret)
    .update(tierCode + plaintext)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
}

/**
 * Issue a new licence key.
 * @param {object} opts
 * @param {"practitioner"|"professional"|"school"} opts.tier
 * @param {string} opts.schoolRef short reference for the purchaser (e.g. order id)
 * @param {number} [opts.seats] number of licensed seats (default 1)
 * @param {number} [opts.years] licence length in years (default 1, 0 = perpetual evaluation)
 * @param {string} opts.secret value of LICENSE_SIGNING_SECRET
 */
function issueLicenseKey({ tier, schoolRef, seats = 1, years = 1, secret }) {
  const tierCode = TIERS[tier];
  if (!tierCode) throw new Error(`Unknown tier: ${tier}`);
  const expiry = years === 0 ? "PERM" : String(Date.now() + years * 365 * 24 * 60 * 60 * 1000);
  const raw = `${schoolRef}|${seats}|${expiry}`;
  const plaintext = base32(Buffer.from(raw, "utf8")).slice(0, 20);
  const sig = sign(secret, tierCode, plaintext);
  return `CN-${tierCode}-${plaintext}-${sig}`;
}

/**
 * Verify a licence key's signature and expiry (does NOT decode schoolRef —
 * this is intentionally one-way; store the schoolRef/seats mapping in your
 * own order records, keyed by the full licence key string, when you issue it).
 */
function verifyLicenseKey(key, secret) {
  const match = /^CN-([A-Z]{2})-([A-Z2-7]+)-([0-9A-F]{8})$/.exec((key || "").trim().toUpperCase());
  if (!match) return { valid: false, reason: "Malformed key" };
  const [, tierCode, plaintext, sig] = match;
  const expected = sign(secret, tierCode, plaintext);
  if (expected !== sig) return { valid: false, reason: "Signature mismatch" };
  return { valid: true, tierCode };
}

module.exports = { issueLicenseKey, verifyLicenseKey, TIERS };
