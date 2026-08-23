const express = require('express');
const router = express.Router();
const Otp = require('../models/Otp');
const User = require('../models/User');
const generateOtp = require('../utils/generateOtp');
const { sendOtpEmail } = require('../utils/mailer');

const allowedDomains = ['kongu.edu', 'kongu.ac.in'];

// Send OTP for password reset
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const emailDomain = email.split('@')[1];
    if (!allowedDomains.includes(emailDomain)) {
      return res.status(400).json({ message: 'Only kongu.edu or kongu.ac.in emails are allowed' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (!existingUser) {
      return res.status(404).json({ message: 'No account found with this email' });
    }

    await Otp.deleteMany({ email: email.toLowerCase(), purpose: 'password-reset' });

    const code = generateOtp();
    await Otp.create({ email: email.toLowerCase(), code, purpose: 'password-reset' });
    await sendOtpEmail(email, code, 'password-reset');

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error('send-otp error:', err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

// Verify OTP for password reset
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body;

    const otpRecord = await Otp.findOne({ email: email.toLowerCase(), purpose: 'password-reset' });

    if (!otpRecord) {
      return res.status(400).json({ message: 'OTP expired or not found. Please request a new one.' });
    }
    if (otpRecord.code !== code) {
      return res.status(400).json({ message: 'Incorrect OTP' });
    }

    await Otp.deleteOne({ _id: otpRecord._id });

    res.json({ message: 'OTP verified successfully', verified: true });
  } catch (err) {
    console.error('verify-otp error:', err);
    res.status(500).json({ message: 'Failed to verify OTP' });
  }
});

module.exports = router;
