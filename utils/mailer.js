const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

async function sendOtpEmail(toEmail, code, purpose) {
  const subject = 'SAP Portal - Password Reset Code';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>SAP Points Portal</h2>
      <p>Your password reset code is:</p>
      <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; padding: 16px; background: #f0f0f0; text-align: center; border-radius: 8px;">
        ${code}
      </div>
      <p>This code expires in 5 minutes. If you didn't request this, ignore this email.</p>
    </div>
  `;

  await transporter.sendMail({
    from: `"SAP Points Portal" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject,
    html
  });
}

module.exports = { sendOtpEmail };
