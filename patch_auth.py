content = open('routes/authRoutes.js').read()

old_verify = '''// POST /api/auth/verify-reset
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
});'''

new_verify = '''// POST /api/auth/verify-reset
// DISABLED: self-service password reset is turned off. The previous version
// returned the reset token directly in the API response with no proof of
// email ownership — a serious account-takeover risk. Users who forget their
// password must contact their admin, who resets it via
// PATCH /api/admin/reset-password/:userId.
router.post("/verify-reset", async (req, res) => {
  res.status(410).json({
    message: "Self-service password reset is disabled. Please contact your admin to reset your password.",
  });
});'''

old_reset = '''// POST /api/auth/reset-password
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
});'''

new_reset = '''// POST /api/auth/reset-password
// DISABLED: see /verify-reset above. Kept as a stub so old frontend builds
// or cached pages fail with a clear message instead of a broken request.
router.post("/reset-password", async (req, res) => {
  res.status(410).json({
    message: "Self-service password reset is disabled. Please contact your admin to reset your password.",
  });
});'''

missing = []
if old_verify not in content:
    missing.append("verify-reset block")
if old_reset not in content:
    missing.append("reset-password block")

if missing:
    print("PATTERN NOT FOUND for:", ", ".join(missing), "- paste current authRoutes.js contents again")
else:
    content = content.replace(old_verify, new_verify).replace(old_reset, new_reset)
    open('routes/authRoutes.js', 'w').write(content)
    print("authRoutes.js patched successfully")
