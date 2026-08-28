/**
 * utils/sendEmail.js
 *
 * Sends emails via EmailJS REST API (HTTPS — works on Render free tier).
 *
 * Set these environment variables:
 *   EMAILJS_SERVICE_ID  = your EmailJS service ID (e.g. service_xxxxxxx)
 *   EMAILJS_TEMPLATE_ID = your EmailJS template ID (e.g. template_xxxxxxx)
 *   EMAILJS_PUBLIC_KEY  = your EmailJS public key (from Account settings)
 *   EMAILJS_PRIVATE_KEY = your EmailJS REST API key / access token (from Account settings)
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
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;

  if (!serviceId || !templateId || !publicKey || !privateKey) {
    return {
      sent: 0,
      skipped: 0,
      error: "EmailJS environment variables (SERVICE_ID, TEMPLATE_ID, PUBLIC_KEY, PRIVATE_KEY) are not fully set in .env."
    };
  }

  const allEmails = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!allEmails.length) return { sent: 0, skipped: 0, error: null };

  let sent = 0;
  let skipped = 0;
  const errors = [];

  // Send in controlled batches of 5 at a time to prevent EmailJS from rate-limiting concurrent connections
  const CHUNK_SIZE = 5;
  for (let i = 0; i < allEmails.length; i += CHUNK_SIZE) {
    const chunk = allEmails.slice(i, i + CHUNK_SIZE);
    
    const chunkPromises = chunk.map(async (email) => {
      try {
        const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            service_id: serviceId,
            template_id: templateId,
            user_id: publicKey,
            accessToken: privateKey,
            template_params: {
              to_email: email,
              subject: subject,
              message_html: html
            }
          })
        });

        if (!response.ok) {
          const text = await response.text();
          errors.push(`Failed for ${email}: ${text || response.statusText}`);
          skipped++;
        } else {
          sent++;
        }
      } catch (err) {
        errors.push(`Error for ${email}: ${err.message}`);
        skipped++;
      }
    });

    // Wait for the current batch of 5 to complete
    await Promise.all(chunkPromises);

    // Add a tiny 100ms delay between batches to be safe
    if (i + CHUNK_SIZE < allEmails.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return {
    sent,
    skipped,
    error: errors.length ? errors.slice(0, 5).join("; ") : null
  };
}

module.exports = { sendEmail };
