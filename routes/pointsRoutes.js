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

router.get("/categories", protect, (req, res) => {
  res.json(StudentPoints.ACTIVITY_CATEGORIES);
});

router.post(
  "/submit",
  protect,
  allowRoles("student"),
  upload.single("certificate"),
  async (req, res) => {
    try {
      const { category, title, pointsClaimed } = req.body;
      const proofUrl = req.file ? req.file.filename : undefined;

      let record = await StudentPoints.findOne({ student: req.user.id });
      if (!record) {
        record = await StudentPoints.create({ student: req.user.id, activities: [] });
      }

      record.activities.push({ category, title, pointsClaimed, proofUrl });
      await record.save();

      res.status(201).json({ message: "Activity submitted for mentor review", record });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get("/my-points", protect, allowRoles("student"), async (req, res) => {
  try {
    const record = await StudentPoints.findOne({ student: req.user.id });
    res.json(record || { activities: [], totalPointsApproved: 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/pending", protect, allowRoles("mentor", "advisor", "hod"), async (req, res) => {
  try {
    const stage = req.user.role;

    const records = await StudentPoints.find({ "activities.currentStage": stage }).populate(
      "student",
      "name rollNumber department"
    );

    const pending = [];
    records.forEach((record) => {
      if (!record.student) return;
      record.activities.forEach((activity) => {
        if (activity.currentStage === stage) {
          pending.push({
            studentId: record.student._id,
            studentName: record.student.name,
            rollNumber: record.student.rollNumber,
            department: record.student.department,
            activityId: activity._id,
            category: activity.category,
            title: activity.title,
            pointsClaimed: activity.pointsClaimed,
            proofUrl: activity.proofUrl,
            currentStage: activity.currentStage,
          });
        }
      });
    });

    res.json(pending);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/all", protect, allowRoles("mentor", "advisor", "hod"), async (req, res) => {
  try {
    const records = await StudentPoints.find({}).populate("student", "name rollNumber department");

    const all = [];
    records.forEach((record) => {
      if (!record.student) return;
      record.activities.forEach((activity) => {
        const remarks =
          activity.hodApproval?.remarks ||
          activity.advisorApproval?.remarks ||
          activity.mentorApproval?.remarks ||
          "";

        all.push({
          studentId: record.student._id,
          studentName: record.student.name,
          rollNumber: record.student.rollNumber,
          department: record.student.department,
          activityId: activity._id,
          category: activity.category,
          title: activity.title,
          pointsClaimed: activity.pointsClaimed,
          pointsApproved: activity.pointsApproved,
          proofUrl: activity.proofUrl,
          currentStage: activity.currentStage,
          verificationCode: activity.verificationCode,
          remarks,
        });
      });
    });

    res.json(all);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/analytics", protect, allowRoles("mentor", "advisor", "hod"), async (req, res) => {
  try {
    const records = await StudentPoints.find({});

    let totalEntries = 0;
    let mentorApprovedCount = 0;
    let advisorApprovedCount = 0;
    let hodApprovedCount = 0;

    records.forEach((record) => {
      record.activities.forEach((activity) => {
        totalEntries += 1;
        if (activity.mentorApproval?.status === "approved") mentorApprovedCount += 1;
        if (activity.advisorApproval?.status === "approved") advisorApprovedCount += 1;
        if (activity.hodApproval?.status === "approved") hodApprovedCount += 1;
      });
    });

    res.json({ totalEntries, mentorApprovedCount, advisorApprovedCount, hodApprovedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch(
  "/:studentId/activity/:activityId",
  protect,
  allowRoles("mentor", "advisor", "hod"),
  async (req, res) => {
    try {
      const { status, pointsApproved, remarks } = req.body;
      const decision = status;
      const role = req.user.role;

      const record = await StudentPoints.findOne({ student: req.params.studentId });
      if (!record) return res.status(404).json({ message: "Record not found" });

      const activity = record.activities.id(req.params.activityId);
      if (!activity) return res.status(404).json({ message: "Activity not found" });

      if (activity.currentStage !== role) {
        return res.status(403).json({
          message: `This activity is not at the ${role} stage (currently: ${activity.currentStage})`,
        });
      }

      const stepField = `${role}Approval`;
      activity[stepField].status = decision;
      activity[stepField].approvedBy = req.user.id;
      activity[stepField].remarks = remarks || "";
      activity[stepField].date = new Date();

      if (decision === "rejected") {
        activity.currentStage = "rejected";
      } else {
        const next = NEXT_STAGE[role];
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

      res.json({ message: "Review recorded", record });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

module.exports = router;
