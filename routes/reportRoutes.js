const express = require("express");
const path = require("path");
const { protect } = require("../middleware/auth");
const User = require("../models/User");
const StudentPoints = require("../models/StudentPoints");
const { generateSAPReport } = require("../utils/generateReport");

const router = express.Router();

// GET /api/report/:studentId — downloads the filled evaluation sheet + certificates as one PDF
router.get("/:studentId", protect, async (req, res) => {
  try {
    // A student can only pull their own report; staff can pull any student's
    if (req.user.role === "student" && req.user.id !== req.params.studentId) {
      return res.status(403).json({ message: "Not allowed to view this report" });
    }

    const user = await User.findById(req.params.studentId);
    const studentPoints = await StudentPoints.findOne({ student: req.params.studentId });

    if (!user || !studentPoints) {
      return res.status(404).json({ message: "Student record not found" });
    }

    // Collect the certificate file paths attached to each activity
    const certificatePaths = studentPoints.activities
      .filter((activity) => activity.proofUrl)
      .map((activity) => path.join(__dirname, "..", "uploads", "certificates", activity.proofUrl));

    const pdfBytes = await generateSAPReport(user, studentPoints, certificatePaths);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=SAP_Report_${user.rollNumber}.pdf`
    );
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
