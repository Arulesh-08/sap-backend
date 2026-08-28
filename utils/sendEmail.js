/**
 * utils/sendEmail.js
 *
 * Sends emails via Brevo Transactional Email REST API (HTTPS — works on Render free tier).
 *
 * Set these environment variables:
 *   BREVO_API_KEY   = your Brevo API key
 *   EMAIL_USER      = sender email (registered/verified sender in Brevo)
 */

/**
 * Send one email to one or many recipients.
 * @param {object} opts
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @returns {{ sent: number, skipped: number, error: string|null }}
 */
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { sent: 0, skipped: 0, error: "BREVO_API_KEY not set in environment." };
  }

  const fromEmail = process.env.EMAIL_USER || "jvarulesh@gmail.com";
  const allEmails = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!allEmails.length) return { sent: 0, skipped: 0, error: null };

  // Brevo allows max 99 recipients (including TO, CC, BCC) per API call.
  // We use BCC to protect user privacy (so users don't see each other's email addresses)
  // and send in batches of 95 to stay safely within the limit.
  const BATCH_SIZE = 95;
  let sent = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < allEmails.length; i += BATCH_SIZE) {
    const chunk = allEmails.slice(i, i + BATCH_SIZE);
    const bccRecipients = chunk.map(email => ({ email }));

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "api-key": apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sender: { name: "KEC SAP Portal", email: fromEmail },
          to: [{ email: fromEmail }], // Sent to self
          bcc: bccRecipients,          // BCC all recipients in this batch
          subject,
          htmlContent: html
        })
      });

      const data = await response.json();

      if (!response.ok) {
        errors.push(`Batch ${i / BATCH_SIZE + 1} failed: ${data.message || response.statusText}`);
        skipped += chunk.length;
      } else {
        sent += chunk.length;
      }
    } catch (error) {
      console.error("[sendEmail] Error sending email batch via Brevo REST API:", error);
      errors.push(`Batch ${i / BATCH_SIZE + 1} error: ${error.message}`);
      skipped += chunk.length;
    }
  }

  return {
    sent,
    skipped,
    error: errors.length ? errors.join("; ") : null
  };
}

module.exports = { sendEmail };

