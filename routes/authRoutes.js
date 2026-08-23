const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
const router = express.Router();
const ADMIN_EMAIL = "jvarulesh@gmail.com";

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, rollNumber, department } = req.body;

    // Public registration ONLY ever creates students — mentor/advisor/HOD
    // accounts must be created by the admin directly (see createStaff.js script)
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
// If they match a user record, issues a short-lived token so the
// reset form can proceed. No email is sent — the token is returned
// directly and held in sessionStorage on the frontend.
router.post("/verify-reset", async (req, res) => {
  try {
    const { rollNumber, email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const emailLower = email.toLowerCase().trim();
    const isStudent = emailLower.endsWith("@kongu.edu");

    let query = { email: emailLower };
    if (isStudent) {
      if (!rollNumber) {
        return res.status(400).json({ message: "Roll number is required for students." });
      }
      query.rollNumber = rollNumber.trim();
      query.role = "student";
    } else {
      // For staff, they must have a valid role (mentor, advisor, hod, admin)
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

    // Generate a 6-digit numeric OTP-style token, valid for 10 minutes
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetToken = token;
    user.resetTokenExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    res.json({ message: "Verified. Proceed to reset your password.", token, userId: user._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/reset-password
// Step 2: user provides the token from step 1 + their new password.
// Token is checked for validity and expiry, then cleared on use.
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
// Exposes password change for logged-in users.
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


// GET /api/auth/me — returns this user's current info fresh from the database.
// Used by the frontend to pick up name/department changes an admin made,
// without requiring the user to log out and back in.
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
