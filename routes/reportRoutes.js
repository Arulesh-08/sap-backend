const express = require("express");
const path = require("path");
const { protect } = require("../middleware/auth");
const User = require("../models/User");
const StudentPoints = require("../models/StudentPoints");
const { generateSAPReport } = require("../utils/generateReport");

const router = express.Router();

// GET /api/report/summary/advisor — downloads the class advisor summary sheet as PDF
router.get("/summary/advisor", protect, async (req, res) => {
  try {
    if (!["advisor", "hod", "admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not allowed" });
    }

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

    const SHORT_CATS = [
      "Paper Pres.", "Techno Mgr.", "Sports", "Membership",
      "Leadership", "Value-Added", "Project/Patent", "GATE/CAT",
    ];

    const students = await User.find({ role: "student", isApproved: true })
      .select("name rollNumber department").sort({ rollNumber: 1 });

    const allRecords = await StudentPoints.find({}).populate("student", "_id");
    const recordByStudent = {};
    allRecords.forEach((r) => {
      if (r.student) recordByStudent[r.student._id.toString()] = r;
    });

    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ size: "A3", layout: "landscape", margin: 30, bufferPages: true });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));

    await new Promise((resolve, reject) => {
      doc.on("end", resolve);
      doc.on("error", reject);

      const pageWidth = doc.page.width;

      // Header
      doc.rect(0, 0, pageWidth, 60).fill("#1a3c34");
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(13)
        .text("KONGU ENGINEERING COLLEGE — DEPARTMENT OF INFORMATION TECHNOLOGY", 30, 12, { width: pageWidth - 60 });
      doc.font("Helvetica").fontSize(9).fillColor("#d8e8e0")
        .text("Class Advisor SAP Summary Sheet — Advisor-Approved Submission Counts", 30, 34, { width: pageWidth - 60 });

      doc.fillColor("#222");
      let y = 75;

      // Column widths
      const snW = 28, rollW = 65, nameW = 120;
      const catW = Math.floor((pageWidth - 30 - snW - rollW - nameW - 40 - 30) / CATEGORIES.length);
      const totalW = 40;

      // Table header
      doc.font("Helvetica-Bold").fontSize(7);
      let x = 30;
      doc.rect(x, y, snW, 28).strokeColor("#888").lineWidth(0.4).stroke();
      doc.text("S.No", x + 2, y + 10, { width: snW - 4, align: "center" }); x += snW;
      doc.rect(x, y, rollW, 28).strokeColor("#888").stroke();
      doc.text("Roll No.", x + 2, y + 10, { width: rollW - 4, align: "center" }); x += rollW;
      doc.rect(x, y, nameW, 28).strokeColor("#888").stroke();
      doc.text("Name", x + 2, y + 10, { width: nameW - 4, align: "center" }); x += nameW;

      SHORT_CATS.forEach((cat) => {
        doc.rect(x, y, catW, 28).strokeColor("#888").stroke();
        doc.text(cat, x + 2, y + 4, { width: catW - 4, align: "center" });
        x += catW;
      });

      doc.rect(x, y, totalW, 28).strokeColor("#888").stroke();
      doc.text("Total", x + 2, y + 10, { width: totalW - 4, align: "center" });
      y += 28;

      // Rows
      doc.font("Helvetica").fontSize(7);
      students.forEach((student, idx) => {
        if (y > doc.page.height - 40) {
          doc.addPage();
          y = 30;
        }

        const record = recordByStudent[student._id.toString()];
        const categoryPoints = {};
        CATEGORIES.forEach((cat) => { categoryPoints[cat] = 0; });
        let total = 0;

        if (record) {
          record.activities.forEach((activity) => {
            const advisorPassed =
              activity.advisorApproval?.status === "approved" ||
              activity.currentStage === "completed";
            if (advisorPassed && CATEGORIES.includes(activity.category)) {
              categoryPoints[activity.category] += activity.pointsApproved || 0;
              total += activity.pointsApproved || 0;
            }
          });
        }

        const rowH = 18;
        const bg = idx % 2 === 0 ? "#f9f9f9" : "#ffffff";
        x = 30;

        doc.rect(x, y, pageWidth - 60, rowH).fill(bg);

        doc.fillColor("#222");
        doc.rect(x, y, snW, rowH).strokeColor("#ccc").lineWidth(0.3).stroke();
        doc.text(String(idx + 1), x + 2, y + 5, { width: snW - 4, align: "center" }); x += snW;

        doc.rect(x, y, rollW, rowH).strokeColor("#ccc").stroke();
        doc.text(student.rollNumber || "-", x + 2, y + 5, { width: rollW - 4, align: "center" }); x += rollW;

        doc.rect(x, y, nameW, rowH).strokeColor("#ccc").stroke();
        doc.text(student.name, x + 2, y + 5, { width: nameW - 4, ellipsis: true }); x += nameW;

        CATEGORIES.forEach((cat) => {
          const count = categoryPoints[cat];
          doc.rect(x, y, catW, rowH).strokeColor("#ccc").stroke();
          if (count > 0) {
            doc.fillColor("#1a7a4c").font("Helvetica-Bold")
              .text(String(count), x + 2, y + 5, { width: catW - 4, align: "center" });
            doc.fillColor("#222").font("Helvetica");
          } else {
            doc.fillColor("#bbb").text("0", x + 2, y + 5, { width: catW - 4, align: "center" });
            doc.fillColor("#222");
          }
          x += catW;
        });

        doc.rect(x, y, totalW, rowH).strokeColor("#ccc").stroke();
        doc.font("Helvetica-Bold").fillColor(total > 0 ? "#1a3c34" : "#999")
          .text(String(total), x + 2, y + 5, { width: totalW - 4, align: "center" });
        doc.font("Helvetica").fillColor("#222");

        y += rowH;
      });

      // Page numbers
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).fillColor("#999")
          .text(`Page ${i + 1} of ${range.count}`, 30, doc.page.height - 20, {
            width: pageWidth - 60, align: "center"
          });
      }

      doc.end();
    });

    const pdfBuffer = Buffer.concat(chunks);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=SAP_Advisor_Summary_${Date.now()}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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

    // proofUrl is now a full Cloudinary URL (not a local disk path) — pass it
    // straight through; generateSAPReport fetches each one over HTTP.
    const certificatePaths = studentPoints.activities
      .filter((activity) => activity.proofUrl)
      .map((activity) => activity.proofUrl);

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
