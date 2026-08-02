const crypto = require("crypto");
const express = require("express");
const StudentPoints = require("../models/StudentPoints");
const { protect, allowRoles } = require("../middleware/auth");
const upload = require("../middleware/upload");

const router = express.Router();

const NEXT_STAGE = {
  mentor: "advisor",
  advisor: "hod",
  hod: "completed",
};

function generateVerificationCode() {
  return `KEC-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

// 1. Get Activity Categories
router.get("/categories", protect, (req, res) => {
  res.json(StudentPoints.ACTIVITY_CATEGORIES || []);
});

// 2. Student Submits a New Activity
router.post(
  "/submit",
  protect,
  allowRoles("student", "admin"),
  upload.single("certificate"),
  async (req, res) => {
    try {
      const { category, title, pointsClaimed } = req.body;
      const proofUrl = req.file ? req.file.filename : undefined;

      let record = await StudentPoints.findOne({ student: req.user.id });
      if (!record) {
        record = await StudentPoints.create({
          student: req.user.id,
          activities: [],
        });
      }

      record.activities.push({ category, title, pointsClaimed, proofUrl });
      await record.save();

      res
        .status(201)
        .json({ message: "Activity submitted for mentor review", record });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// 3. Get Dashboard Counts & Metrics
router.get(
  "/analytics",
  protect,
  allowRoles("mentor", "advisor", "hod", "admin"),
  async (req, res) => {
    try {
      const records = await StudentPoints.find();

      let totalEntries = 0;
      let mentorApprovedCount = 0;
      let advisorApprovedCount = 0;
      let hodApprovedCount = 0;

      records.forEach((rec) => {
        rec.activities.forEach((activity) => {
          totalEntries += 1;
          if (activity.mentorApproval?.status === "approved")
            mentorApprovedCount += 1;
          if (activity.advisorApproval?.status === "approved")
            advisorApprovedCount += 1;
          if (activity.hodApproval?.status === "approved")
            hodApprovedCount += 1;
        });
      });

      res.json({
        totalEntries,
        mentorApprovedCount,
        advisorApprovedCount,
        hodApprovedCount,
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// 4. Get Pending Submissions for Review Queue
router.get(
  "/pending",
  protect,
  allowRoles("mentor", "advisor", "hod", "admin"),
  async (req, res) => {
    try {
      const records = await StudentPoints.find().populate(
        "student",
        "name email rollNumber department"
      );

      const pendingSubmissions = [];

      records.forEach((rec) => {
        rec.activities.forEach((activity) => {
          // If Admin is viewing, show all pending items regardless of current stage
          if (
            req.user.role === "admin" ||
            activity.currentStage === req.user.role
          ) {
            pendingSubmissions.push({
              studentId: rec.student?._id,
              studentName: rec.student?.name,
              rollNumber: rec.student?.rollNumber,
              department: rec.student?.department,
              activity,
            });
          }
        });
      });

      res.json(pendingSubmissions);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// 5. Approve or Reject an Activity (Sequential Verification Process)
router.patch(
  "/:studentId/activity/:activityId",
  protect,
  allowRoles("mentor", "advisor", "hod", "admin"),
  async (req, res) => {
    try {
      const { status, pointsApproved, remarks } = req.body;
      const decision = status;

      const record = await StudentPoints.findOne({
        student: req.params.studentId,
      });
      if (!record) return res.status(404).json({ message: "Record not found" });

      const activity = record.activities.id(req.params.activityId);
      if (!activity)
        return res.status(404).json({ message: "Activity not found" });

      // Dynamic stage detection for Admin
      let effectiveRole = req.user.role;
      if (req.user.role === "admin") {
        effectiveRole = activity.currentStage;
      }

      if (activity.currentStage !== effectiveRole) {
        return res.status(403).json({
          message: `This activity is not at the ${effectiveRole} stage (currently: ${activity.currentStage})`,
        });
      }

      const stepField = `${effectiveRole}Approval`;
      if (!activity[stepField]) {
        activity[stepField] = {};
      }

      activity[stepField].status = decision;
      activity[stepField].approvedBy = req.user.id;
      activity[stepField].remarks = remarks || "";
      activity[stepField].date = new Date();

      if (decision === "rejected") {
        activity.currentStage = "rejected";
      } else {
        const next = NEXT_STAGE[effectiveRole];
        activity.currentStage = next;

        if (next === "completed") {
          activity.pointsApproved =
            pointsApproved !== undefined && pointsApproved !== ""
              ? Number(pointsApproved)
              : activity.pointsClaimed;
          activity.verificationCode = generateVerificationCode();
        }
      }

      if (typeof record.recalculateTotal === "function") {
        record.recalculateTotal();
      }
      
      await record.save();

      res.json({ message: "Review recorded successfully", record });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

module.exports = router;
