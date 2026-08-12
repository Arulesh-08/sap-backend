const crypto = require("crypto");
const { v2: cloudinary } = require("cloudinary");
const express = require("express");
const StudentPoints = require("../models/StudentPoints");
const { protect, allowRoles } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { POINT_STRUCTURE, getPoints } = require("../config/pointStructure");

const router = express.Router();

// Mentor stage is disabled — new submissions start at "advisor" (schema default).
// Kept here so any OLD activities still sitting at "mentor" from before this
// change can still be advanced normally if a mentor account reviews them.
const NEXT_STAGE = {
  mentor: "advisor",
  advisor: "hod",
  hod: "completed",
};

function generateVerificationCode() {
  return `KEC-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

// GET /api/points/categories — the full nested category/type/tier point structure,
// straight from the official doc. The dropdown UI is built entirely from this.
router.get("/categories", protect, (req, res) => {
  res.json(POINT_STRUCTURE);
});

// Student submits a new activity for points, with a certificate file attached.
// Points are NEVER taken from the client — always looked up server-side from
// category+type+tier, so a tampered request can't claim points it isn't entitled to.
// POST /api/points/submit  (multipart/form-data, field name: "certificate")
function handleUpload(req, res, next) {
  upload.single("certificate")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "Certificate file must be 200KB or smaller." });
      }
      return res.status(400).json({ message: err.message || "File upload failed." });
    }
    next();
  });
}

router.post(
  "/submit",
  protect,
  allowRoles("student"),
  handleUpload,
  async (req, res) => {
    try {
      const fs = require("fs");
      const { category, type, tier, title } = req.body;
      const proofUrl = req.file ? req.file.path : undefined;

      const points = getPoints(category, type, tier);
      if (points === null) {
        return res.status(400).json({ message: "Invalid category/type/tier combination" });
      }

      let record = await StudentPoints.findOne({ student: req.user.id });
      if (!record) {
        record = await StudentPoints.create({ student: req.user.id, activities: [] });
      }

      // req.file.path is now a Cloudinary URL (multer-storage-cloudinary), not a
      // local disk path — fetch the bytes over HTTP to hash the actual content,
      // which still catches the same file re-uploaded under a different name.
      let proofHash;
      if (req.file) {
        const response = await fetch(req.file.path);
        const fileBuffer = Buffer.from(await response.arrayBuffer());
        proofHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        const duplicate = record.activities.find((a) => a.proofHash === proofHash);
        if (duplicate) {
          // req.file.filename is the Cloudinary public_id — delete the redundant
          // upload from Cloudinary itself, since there's no local file to unlink.
          await cloudinary.uploader.destroy(req.file.filename, { resource_type: req.file.mimetype?.startsWith("video/") ? "video" : req.file.mimetype === "application/pdf" ? "raw" : "image" });
          return res.status(400).json({
            message: "This certificate has already been submitted for a previous activity.",
          });
        }
      }

      record.activities.push({
        category,
        type: type || "",
        tier,
        title: title || "",
        pointsClaimed: points,
        proofUrl,
        proofHash,
      });
      await record.save({ validateModifiedOnly: true });

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

router.get("/pending", protect, allowRoles("mentor", "advisor", "hod", "admin"), async (req, res) => {
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
            type: activity.type,
            tier: activity.tier,
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

router.get("/all", protect, allowRoles("mentor", "advisor", "hod", "admin"), async (req, res) => {
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
          type: activity.type,
          tier: activity.tier,
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

router.get("/analytics", protect, allowRoles("mentor", "advisor", "hod", "admin"), async (req, res) => {
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
  allowRoles("mentor", "advisor", "hod", "admin"),
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
          // pointsClaimed was already server-computed at submit time — HOD keeps it
          // unless explicitly overridden with a value from the approval form.
          activity.pointsApproved =
            pointsApproved !== undefined && pointsApproved !== ""
              ? Number(pointsApproved)
              : activity.pointsClaimed;
          activity.verificationCode = generateVerificationCode();
        }
      }

      record.recalculateTotal();
      await record.save({ validateModifiedOnly: true });

      res.json({ message: "Review recorded", record });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);


// GET /api/points/student-summary
// Returns all registered students with per-category submission counts
// where the activity has passed at least the advisor stage (advisor-approved or completed).
// Used by the Class Advisor spreadsheet-style summary table.
router.get("/student-summary", protect, allowRoles("mentor", "advisor", "hod", "admin"), async (req, res) => {
  try {
    const CATEGORIES = [
      "1. Paper/Poster/Project Presentation",
      "2. Techno Managerial Events",
      "3. Sports & Games",
      "4. Membership & Social Activities",
      "5. Leadership/Organizing Events",
      "6. Non-Credit Value-Added Course/IPT",
      "7. Project to paper/Patent/Product Copyright",
      "8. GATE/CAT/Govt. Exams",
    ];

    // Get all students ordered by roll number
    const students = await require("../models/User")
      .find({ role: "student", isApproved: true })
      .select("name rollNumber department")
      .sort({ rollNumber: 1 });

    // Get all point records in one query
    const allRecords = await StudentPoints.find({}).populate("student", "_id");
    const recordByStudent = {};
    allRecords.forEach((r) => {
      if (r.student) recordByStudent[r.student._id.toString()] = r;
    });

    const summary = students.map((student) => {
      const record = recordByStudent[student._id.toString()];
      const categoryCounts = {};
      let total = 0;

      CATEGORIES.forEach((cat) => { categoryCounts[cat] = 0; });

      if (record) {
        record.activities.forEach((activity) => {
          // Count if advisor-approved (passed advisor stage) or fully completed
          const advisorPassed =
            activity.advisorApproval?.status === "approved" ||
            activity.currentStage === "completed";

          if (advisorPassed && CATEGORIES.includes(activity.category)) {
            categoryCounts[activity.category] += 1;
            total += 1;
          }
        });
      }

      return {
        studentId: student._id,
        name: student.name,
        rollNumber: student.rollNumber || "-",
        department: student.department,
        categoryCounts,
        total,
      };
    });

    res.json({ categories: CATEGORIES, students: summary });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mentor/advisor/HOD can revoke a FULLY VERIFIED (completed) activity — e.g. if
// fraudulent proof is discovered after the fact. Any of the three roles can do
// this regardless of who originally approved which stage. Sends it back to
// "rejected" and zeroes out the points.
router.patch(
  "/:studentId/activity/:activityId/revoke",
  protect,
  allowRoles("mentor", "advisor", "hod", "admin"),
  async (req, res) => {
    try {
      const { remarks } = req.body;

      const record = await StudentPoints.findOne({ student: req.params.studentId });
      if (!record) return res.status(404).json({ message: "Record not found" });

      const activity = record.activities.id(req.params.activityId);
      if (!activity) return res.status(404).json({ message: "Activity not found" });

      if (activity.currentStage !== "completed") {
        return res.status(400).json({
          message: "Only fully verified activities can be revoked.",
        });
      }

      activity.currentStage = "rejected";
      activity.pointsApproved = 0;
      activity.verificationCode = undefined;

      // Record who revoked it and why, on the reviewer's own approval slot
      const role = req.user.role;
      const stepField = `${role}Approval`;
      activity[stepField].status = "rejected";
      activity[stepField].approvedBy = req.user.id;
      activity[stepField].remarks = remarks || "Verification revoked after re-review";
      activity[stepField].date = new Date();

      record.recalculateTotal();
      await record.save();

      res.json({ message: "Verification revoked", record });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

module.exports = router;
