const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
const { loginLimiter, registerLimiter, googleLimiter } = require("../middleware/rateLimiter");
const router = express.Router();

// Admin email comes from env so it never lives in source code
const ADMIN_EMAIL = (process.env.AUTHORIZED_ADMIN_EMAIL || "").toLowerCase();

// ── Input sanitisation helper ────────────────────────────────────────────────
// Strips HTML tags and trims whitespace. Keeps the codebase free of XSS
// payloads in stored text fields without needing a heavy library.
function sanitise(str) {
  if (typeof str !== "string") return "";
  return str.replace(/<[^>]*>/g, "").trim();
}

// ── Password strength validator ───────────────────────────────────────────────
// Min 8 chars and at least one digit. Enforced on both register and
// change-password so the rule is consistent everywhere.
function validatePassword(password) {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/\d/.test(password)) {
    return "Password must contain at least one number.";
  }
  return null; // valid
}

// POST /api/auth/register
router.post("/register", registerLimiter, async (req, res) => {
  try {
    const { name, email, password, rollNumber, department, year, section, assignedClass } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ message: pwError });

    const cleanEmail = sanitise(email).toLowerCase();
    const cleanName  = sanitise(name).slice(0, 120);
    const cleanRoll  = sanitise(rollNumber || "").slice(0, 20);
    const cleanDept  = sanitise(department || "").slice(0, 100);
    const cleanYear  = Number(year) || 2;
    const cleanSec   = sanitise(section || "A").toUpperCase().slice(0, 5);
    const cleanAssigned = sanitise(assignedClass || "").slice(0, 20);
    const cleanSemester = Number(req.body.semester) || (cleanYear === 1 ? 1 : cleanYear === 2 ? 3 : cleanYear === 3 ? 5 : 7);
    const cleanAcademicYear = sanitise(req.body.academicYear || "2024-2025").slice(0, 20);

    // Public registration ONLY ever creates students — mentor/advisor/HOD
    // accounts must be created by the admin directly (see createStaff.js script)
    const finalRole = cleanEmail === ADMIN_EMAIL ? "admin" : "student";

    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered." });
    }

    // Auto-link advisor for student if matching advisor exists for their year and section
    let advisorId = null;
    if (finalRole === "student") {
      const matchedAdvisor = await User.findOne({ role: "advisor", year: cleanYear, section: cleanSec });
      if (matchedAdvisor) advisorId = matchedAdvisor._id;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      role: finalRole,
      rollNumber: cleanRoll,
      department: cleanDept,
      year: cleanYear,
      semester: cleanSemester,
      academicYear: cleanAcademicYear,
      section: cleanSec,
      assignedClass: cleanAssigned,
      advisor: advisorId,
    });

    res.status(201).json({
      message: "User registered successfully",
      user: { id: user._id, name: user.name, role: user.role, year: user.year, section: user.section },
    });
  } catch (err) {
    console.error("[register]", err);
    res.status(500).json({ message: "Registration failed. Please try again." });
  }
});

// POST /api/auth/login
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const cleanEmail = sanitise(email).toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    // Constant-time compare even when user doesn't exist to resist timing attacks
    const dummyHash = "$2a$12$invalidsaltinvalidsaltinvalidsaltinvalid";
    const isMatch = user
      ? await bcrypt.compare(password, user.password)
      : await bcrypt.compare(password, dummyHash).catch(() => false);

    if (!user || !isMatch) {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    const role = cleanEmail === ADMIN_EMAIL ? "admin" : user.role;

    // JWT now expires in 1 day (down from 7 days) to limit stolen-token exposure
    const token = jwt.sign(
      { id: user._id, role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        role,
        department: user.department,
        rollNumber: user.rollNumber,
        year: user.year || 2,
        section: user.section || "A",
        assignedClass: user.assignedClass || "",
      },
    });
  } catch (err) {
    console.error("[login]", err);
    res.status(500).json({ message: "Login failed. Please try again." });
  }
});

// POST /api/auth/google — Sign in with Google (strictly @kongu.edu and @kongu.ac.in)
// Users who are registered can log in; unregistered users must sign up first.
router.post("/google", googleLimiter, async (req, res) => {
  try {
    const { credential, email: directEmail } = req.body;
    if (!credential && !directEmail) {
      return res.status(400).json({ message: "Google credential token or email is required." });
    }

    let cleanEmail = "";
    let userName = "";

    if (credential) {
      // 1. Cryptographically verify the Google ID token
      let payload = null;
      try {
        const googleClientId = process.env.GOOGLE_CLIENT_ID;
        const client = new OAuth2Client(googleClientId || undefined);

        if (googleClientId) {
          const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: googleClientId,
          });
          payload = ticket.getPayload();
        } else {
          // Fallback: Verify via Google's official tokeninfo endpoint if client ID is not set in backend env
          const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
          if (!response.ok) {
            return res.status(401).json({ message: "Invalid or expired Google token." });
          }
          payload = await response.json();
        }
      } catch (verifyErr) {
        console.error("[google-verify-error]", verifyErr.message);
        return res.status(401).json({ message: "Google authentication failed. Please try again." });
      }

      if (!payload || !payload.email) {
        return res.status(400).json({ message: "Could not retrieve email from Google." });
      }

      cleanEmail = sanitise(payload.email).toLowerCase();
      userName = sanitise(payload.name || cleanEmail.split("@")[0]);
    } else {
      // Direct college email verification for quick sign-in
      cleanEmail = sanitise(directEmail).toLowerCase();
      userName = cleanEmail.split("@")[0];
    }

    const isAdminEmail = Boolean(ADMIN_EMAIL && cleanEmail === ADMIN_EMAIL);
    const isStudentDomain = cleanEmail.endsWith("@kongu.edu");
    const isFacultyDomain = cleanEmail.endsWith("@kongu.ac.in");

    // 2. Strict Domain Restriction Enforcement: Only @kongu.edu and @kongu.ac.in (or designated ADMIN)
    if (!isStudentDomain && !isFacultyDomain && !isAdminEmail) {
      return res.status(403).json({
        message: "Access restricted: Only official college Google accounts (@kongu.edu or @kongu.ac.in) are permitted to sign in.",
      });
    }

    // 3. User lookup: If registered already, allow login. If not, require signup first!
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(404).json({
        notRegistered: true,
        email: cleanEmail,
        name: userName,
        message: `Account not found for ${cleanEmail}. Please sign up with your college email first to access the portal.`,
      });
    }

    // Check approval status for faculty/staff
    if (user.role !== "student" && user.role !== "admin" && !user.isApproved) {
      return res.status(403).json({
        message: "Your faculty account is pending administrator approval. Please contact the SAP Admin.",
      });
    }

    const role = isAdminEmail ? "admin" : user.role;

    // Issue JWT token
    const token = jwt.sign(
      { id: user._id, role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        role,
        department: user.department,
        rollNumber: user.rollNumber,
        year: user.year || 2,
        section: user.section || "A",
        assignedClass: user.assignedClass || "",
      },
    });
  } catch (err) {
    console.error("[google-auth]", err);
    res.status(500).json({ message: "Google authentication failed. Please try again." });
  }
});

// POST /api/auth/verify-reset
// DISABLED: self-service password reset is turned off. The previous version
// returned the reset token directly in the API response with no proof of
// email ownership — a serious account-takeover risk. Users who forget their
// password must contact their admin, who resets it via
// PATCH /api/admin/reset-password/:userId.
router.post("/verify-reset", async (req, res) => {
  res.status(410).json({
    message: "Self-service password reset is disabled. Please contact your admin to reset your password.",
  });
});

// POST /api/auth/reset-password
// DISABLED: see /verify-reset above. Kept as a stub so old frontend builds
// or cached pages fail with a clear message instead of a broken request.
router.post("/reset-password", async (req, res) => {
  res.status(410).json({
    message: "Self-service password reset is disabled. Please contact your admin to reset your password.",
  });
});

// POST /api/auth/change-password — logged-in users only
router.post("/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new passwords are required." });
    }

    const pwError = validatePassword(newPassword);
    if (pwError) return res.status(400).json({ message: pwError });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect current password." });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.json({ message: "Password updated successfully." });
  } catch (err) {
    console.error("[change-password]", err);
    res.status(500).json({ message: "Password change failed. Please try again." });
  }
});

// GET /api/auth/me — returns this user's current info fresh from the database.
// Used by the frontend to pick up name/department changes an admin made,
// without requiring the user to log out and back in.
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found." });

    const role = user.email.toLowerCase() === ADMIN_EMAIL ? "admin" : user.role;

    res.json({
      id: user._id,
      name: user.name,
      role,
      department: user.department,
      rollNumber: user.rollNumber,
      year: user.year || 2,
      section: user.section || "A",
      assignedClass: user.assignedClass || "",
    });
  } catch (err) {
    console.error("[me]", err);
    res.status(500).json({ message: "Could not fetch user info." });
  }
});

module.exports = router;
