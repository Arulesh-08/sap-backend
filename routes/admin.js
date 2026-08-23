const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const router = express.Router();
const User = require("../models/User");
const StudentPoints = require("../models/StudentPoints");
const { protect, allowRoles } = require("../middleware/auth");

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
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/create-user — admin creates a student, mentor, advisor, or hod account directly
router.post("/create-user", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { name, email, password, role, rollNumber, department } = req.body;

    if (!["student", "mentor", "advisor", "hod"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: "A user with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      rollNumber,
      department,
    });

    res.status(201).json({
      message: "User created",
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/rename/:userId — change a user's display name
router.patch("/rename/:userId", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "New name is required" });

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.name = name;
    await user.save();

    res.json({ message: "Renamed", user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/user/:userId — delete a user account (and their submissions, if a student)
router.delete("/user/:userId", protect, allowRoles("admin"), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "admin") {
      return res.status(403).json({ message: "Cannot delete the admin account" });
    }

    if (user.role === "student") {
      await StudentPoints.deleteOne({ student: user._id });
    }
    await User.deleteOne({ _id: user._id });

    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
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
    res.status(500).json({ message: err.message });
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

      const record = await StudentPoints.findOne({ student: req.params.studentId });
      if (!record) return res.status(404).json({ message: "Record not found" });

      const activity = record.activities.id(req.params.activityId);
      if (!activity) return res.status(404).json({ message: "Activity not found" });

      const currentStage = activity.currentStage;
      if (!["mentor", "advisor", "hod"].includes(currentStage)) {
        return res.status(400).json({ message: `Activity is already ${currentStage}, nothing to approve.` });
      }

      const stepField = `${currentStage}Approval`;
      activity[stepField].status = status;
      activity[stepField].approvedBy = req.user.id;
      activity[stepField].remarks = remarks || "Approved by admin";
      activity[stepField].date = new Date();

      if (status === "rejected") {
        activity.currentStage = "rejected";
      } else {
        const next = NEXT_STAGE[currentStage];
        activity.currentStage = next;
        if (next === "completed") {
          activity.pointsApproved =
            pointsApproved !== undefined && pointsApproved !== ""
              ? Number(pointsApproved)
              : activity.pointsClaimed;
          activity.verificationCode = generateVerificationCode();
        }
      }

      record.recalculateTotal();
      await record.save();

      res.json({ message: "Reviewed by admin", record });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

module.exports = router;
