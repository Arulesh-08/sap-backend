/**
 * utils/sendEmail.js
 * Sends emails via Brevo (formerly Sendinblue) HTTP API.
 * Uses fetch — no extra package, works on Render free tier.
 */

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL  = process.env.EMAIL_USER || "noreply@kongu.ac.in";
const SENDER_NAME   = "KEC SAP Portal";
const BREVO_URL     = "https://api.brevo.com/v3/smtp/email";

/**
 * Send one email to one or many recipients.
 * @param {object} opts
 * @param {string|string[]} opts.to  - single email or array of emails
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text]       - plain-text fallback
 */
async function sendEmail({ to, subject, html, text }) {
  if (!BREVO_API_KEY) throw new Error("BREVO_API_KEY not configured.");

  const recipients = (Array.isArray(to) ? to : [to])
    .filter(Boolean)
    .map((email) => ({ email }));

  if (recipients.length === 0) return { sent: 0 };

  // Brevo accepts up to 99 recipients per call on free tier
  const BATCH = 99;
  let sent = 0;

  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH);
    const body = {
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: batch,
      subject,
      htmlContent: html,
      ...(text ? { textContent: text } : {}),
    };

    const res = await fetch(BREVO_URL, {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Brevo error ${res.status}: ${err.message || JSON.stringify(err)}`);
    }

    sent += batch.length;
  }

  return { sent };
}

module.exports = { sendEmail };
