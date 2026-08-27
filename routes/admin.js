const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const router = express.Router();
const User = require("../models/User");
const StudentPoints = require("../models/StudentPoints");
const { protect, allowRoles } = require("../middleware/auth");

// Strip HTML tags + trim — prevents stored XSS in text fields
function sanitise(str, maxLen = 200) {
  if (typeof str !== "string") return "";
  return str.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}

const NEXT_STAGE = {
  mentor: "advisor",
  advisor: "hod",
  hod: "completed",
};

function generateVerificationCode() {
  return `KEC-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

// GET /api/admin/users — list every account, optionally filtered by role
router.get("/users", protect, allowRoles("admin"), async (req, res) => {
  try {
    const filter = req.query.role ? { role: req.query.role } : {};
    const users = await User.find(filter).select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    console.error("[admin/users]", err);
    res.status(500).json({ message: "Failed to fetch users." });
  }
});

// POST /api/admin/create-user — admin creates a student, mentor, advisor, or hod account directly
router.post("/create-user", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { name, email, password, role, rollNumber, department } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }
    if (!["student", "mentor", "advisor", "hod"].includes(role)) {
      return res.status(400).json({ message: "Invalid role." });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    const cleanEmail = sanitise(email).toLowerCase();
    const cleanName  = sanitise(name).slice(0, 120);
    const cleanRoll  = sanitise(rollNumber || "").slice(0, 20);
    const cleanDept  = sanitise(department || "").slice(0, 100);

    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(400).json({ message: "A user with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      role,
      rollNumber: cleanRoll,
      department: cleanDept,
    });

    res.status(201).json({
      message: "User created",
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("[admin/create-user]", err);
    res.status(500).json({ message: "Failed to create user." });
  }
});

// PATCH /api/admin/rename/:userId — change a user's display name
router.patch("/rename/:userId", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "New name is required." });

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    user.name = sanitise(name).slice(0, 120);
    await user.save();

    res.json({ message: "Renamed", user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    console.error("[admin/rename]", err);
    res.status(500).json({ message: "Failed to rename user." });
  }
});

// DELETE /api/admin/user/:userId — delete a user account (and their submissions, if a student)
router.delete("/user/:userId", protect, allowRoles("admin"), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    if (user.role === "admin") {
      return res.status(403).json({ message: "Cannot delete the admin account." });
    }

    if (user.role === "student") {
      await StudentPoints.deleteOne({ student: user._id });
    }
    await User.deleteOne({ _id: user._id });

    res.json({ message: "User deleted." });
  } catch (err) {
    console.error("[admin/delete-user]", err);
    res.status(500).json({ message: "Failed to delete user." });
  }
});

// GET /api/admin/all-activities — every submission across every student, any stage
router.get("/all-activities", protect, allowRoles("admin"), async (req, res) => {
  try {
    const records = await StudentPoints.find({}).populate("student", "name rollNumber department");

    const all = [];
    records.forEach((record) => {
      if (!record.student) return;
      record.activities.forEach((activity) => {
        all.push({
          studentId: record.student._id,
          studentName: record.student.name,
          rollNumber: record.student.rollNumber,
          department: record.student.department,
          activityId: activity._id,
          category: activity.category,
          type: activity.type,
          tier: activity.tier,
          title: activity.title,
          pointsClaimed: activity.pointsClaimed,
          pointsApproved: activity.pointsApproved,
          proofUrl: activity.proofUrl,
          currentStage: activity.currentStage,
          verificationCode: activity.verificationCode,
        });
      });
    });

    res.json(all);
  } catch (err) {
    console.error("[admin/all-activities]", err);
    res.status(500).json({ message: "Failed to fetch activities." });
  }
});

// PATCH /api/admin/activity/:studentId/:activityId/approve — admin can approve/reject
// at ANY stage regardless of who it's currently sitting with (bypasses the normal
// "must be mentor to approve mentor stage" restriction).
router.patch(
  "/activity/:studentId/:activityId/approve",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const { status, pointsApproved, remarks } = req.body;

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Status must be 'approved' or 'rejected'." });
      }

      const record = await StudentPoints.findOne({ student: req.params.studentId });
      if (!record) return res.status(404).json({ message: "Record not found." });

      const activity = record.activities.id(req.params.activityId);
      if (!activity) return res.status(404).json({ message: "Activity not found." });

      const currentStage = activity.currentStage;
      if (!["mentor", "advisor", "hod"].includes(currentStage)) {
        return res.status(400).json({ message: `Activity is already ${currentStage}, nothing to approve.` });
      }

      const stepField = `${currentStage}Approval`;
      activity[stepField].status = status;
      activity[stepField].approvedBy = req.user.id;
      activity[stepField].remarks = sanitise(remarks || "Approved by admin").slice(0, 500);
      activity[stepField].date = new Date();

      if (status === "rejected") {
        activity.currentStage = "rejected";
      } else {
        const next = NEXT_STAGE[currentStage];
        activity.currentStage = next;
        if (next === "completed") {
          const parsed = Number(pointsApproved);
          activity.pointsApproved =
            pointsApproved !== undefined && pointsApproved !== "" && !isNaN(parsed) && parsed >= 0
              ? parsed
              : activity.pointsClaimed;
          activity.verificationCode = generateVerificationCode();
        }
      }

      record.recalculateTotal();
      await record.save();

      res.json({ message: "Reviewed by admin", record });
    } catch (err) {
      console.error("[admin/approve]", err);
      res.status(500).json({ message: "Failed to record review." });
    }
  }
);

// PATCH /api/admin/reset-password/:userId — admin directly sets a new password
// for any user. This is the ONLY way a user's password can be reset now that
// self-service (email-based) reset is disabled.
router.patch("/reset-password/:userId", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters." });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    user.password = await bcrypt.hash(newPassword, 12);
    user.resetToken = null;
    user.resetTokenExpires = null;
    await user.save();

    res.json({ message: `Password reset for ${user.name}.` });
  } catch (err) {
    console.error("[admin/reset-password]", err);
    res.status(500).json({ message: "Failed to reset password." });
  }
});

module.exports = router;
