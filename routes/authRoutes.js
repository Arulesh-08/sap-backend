const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
const { sendOtpEmail } = require("../utils/mailer");
const router = express.Router();
const ADMIN_EMAIL = "jvarulesh@gmail.com";
const allowedDomains = ["kongu.edu", "kongu.ac.in"];

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, rollNumber, department } = req.body;

    const finalRole =
      email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? "admin" : "student";

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: finalRole,
      rollNumber,
      department,
    });

    res.status(201).json({
      message: "User registered successfully",
      user: { id: user._id, name: user.name, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    const role = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? "admin" : user.role;
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }
    const token = jwt.sign(
      { id: user._id, role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        role,
        department: user.department,
        rollNumber: user.rollNumber,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/verify-reset
// Step 1: student provides roll number + registered email.
// Staff provides registered email only.
// If they match a user record, a 6-digit code is generated and EMAILED
// to the user's registered address. It is never returned in the API
// response — the user must check their inbox.
router.post("/verify-reset", async (req, res) => {
  try {
    const { rollNumber, email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const emailLower = email.toLowerCase().trim();
    const emailDomain = emailLower.split("@")[1];
    if (!allowedDomains.includes(emailDomain)) {
      return res.status(400).json({ message: "Only kongu.edu or kongu.ac.in emails are allowed." });
    }

    const isStudent = emailLower.endsWith("@kongu.edu");

    let query = { email: emailLower };
    if (isStudent) {
      if (!rollNumber) {
        return res.status(400).json({ message: "Roll number is required for students." });
      }
      query.rollNumber = rollNumber.trim();
      query.role = "student";
    } else {
      query.role = { $in: ["mentor", "advisor", "hod", "admin"] };
    }

    const user = await User.findOne(query);

    if (!user) {
      return res.status(400).json({
        message: isStudent
          ? "No student account found with that roll number and email combination."
          : "No staff/approver account found with that email address.",
      });
    }

    const token = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetToken = token;
    user.resetTokenExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendOtpEmail(user.email, token, "password-reset");

    res.json({ message: "A verification code has been sent to your registered email.", userId: user._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/reset-password
// Step 2: user provides the code from their email + their new password.
router.post("/reset-password", async (req, res) => {
  try {
    const { userId, token, newPassword } = req.body;
    if (!userId || !token || !newPassword) {
      return res.status(400).json({ message: "All fields are required." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const user = await User.findById(userId);
    if (!user || user.resetToken !== token || !user.resetTokenExpires) {
      return res.status(400).json({ message: "Invalid or expired reset session. Please start over." });
    }
    if (user.resetTokenExpires < new Date()) {
      user.resetToken = null;
      user.resetTokenExpires = null;
      await user.save();
      return res.status(400).json({ message: "Reset session expired (10 minutes). Please start over." });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = null;
    user.resetTokenExpires = null;
    await user.save();

    res.json({ message: "Password reset successfully. You can now log in." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/change-password
router.post("/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new passwords are required." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters." });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect current password." });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: "Password updated successfully." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/me
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const role = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? "admin" : user.role;

    res.json({
      id: user._id,
      name: user.name,
      role,
      department: user.department,
      rollNumber: user.rollNumber,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
