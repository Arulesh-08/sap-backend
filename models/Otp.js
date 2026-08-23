const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  code: { type: String, required: true },
  purpose: { type: String, enum: ['password-reset'], required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 } // auto-deletes after 5 min
});

module.exports = mongoose.model('Otp', otpSchema);
