const express = require("express");
const path = require("path");
const { protect } = require("../middleware/auth");
const User = require("../models/User");
const StudentPoints = require("../models/StudentPoints");
const { generateSAPReport, calculateSAPMark } = require("../utils/generateReport");
const { generateCategoryReportPDF, formatDate } = require("../utils/generateCategoryReport");

const router = express.Router();

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

// Helper: Query and compile category activity records with analytics
async function queryCategoryData(req) {
  let advisorUser = null;
  if (req.user.role === "advisor") {
    advisorUser = await User.findById(req.user.id);
  }

  // Filter params
  const {
    category,
    year,
    semester,
    section,
    insideOrOutside,
    isNational,
    hasCashPrize,
    participationStatus,
    stage,
  } = req.query;

  // Build student filter
  const studentFilter = { role: "student", isApproved: { $ne: false } };

  // Advisor constraint: if user is advisor, enforce their year & section
  if (req.user.role === "advisor" && advisorUser) {
    if (advisorUser.year) studentFilter.year = advisorUser.year;
    if (advisorUser.section) studentFilter.section = advisorUser.section;
  } else {
    if (year) studentFilter.year = Number(year);
    if (section) studentFilter.section = section.toUpperCase();
  }

  const students = await User.find(studentFilter)
    .select("name rollNumber department year section advisor semester academicYear")
    .populate("advisor", "name email assignedClass")
    .lean();

  const studentMap = {};
  students.forEach((s) => {
    studentMap[s._id.toString()] = s;
  });

  const studentIds = Object.keys(studentMap);
  const pointsDocs = await StudentPoints.find({ student: { $in: studentIds } }).lean();

  const records = [];
  const uniqueParticipantsSet = new Set();
  let totalWinners = 0;
  let totalRunners = 0;
  let totalCashPrizeWinners = 0;
  let totalCashPrizeAmount = 0;
  let totalPointsApproved = 0;

  const classBreakdown = {};

  pointsDocs.forEach((doc) => {
    const s = studentMap[doc.student.toString()];
    if (!s) return;

    const classLabel = `${s.year === 1 ? "I" : s.year === 2 ? "II" : s.year === 3 ? "III" : "IV"} Year - Sec ${s.section || "A"}`;
    if (!classBreakdown[classLabel]) {
      classBreakdown[classLabel] = {
        classLabel,
        participantsSet: new Set(),
        participants: 0,
        winners: 0,
        cashWinners: 0,
        cashAmount: 0,
        points: 0,
      };
    }

    doc.activities.forEach((act) => {
      // Category filter
      if (category && category !== "all" && act.category !== category) return;

      // Semester filter (check activity semester or student semester)
      const actSem = act.semester || s.semester || 1;
      if (semester && semester !== "all" && Number(semester) !== actSem) return;

      // Inside / Outside KEC filter
      if (insideOrOutside && insideOrOutside !== "all") {
        if (insideOrOutside === "Inside KEC" && act.insideOrOutside === "Outside KEC") return;
        if (insideOrOutside === "Outside KEC" && act.insideOrOutside !== "Outside KEC") return;
      }

      // National event filter
      if (isNational && isNational !== "all") {
        const reqNat = isNational === "true" || isNational === true;
        if (Boolean(act.isNational) !== reqNat) return;
      }

      // Cash prize filter
      if (hasCashPrize && hasCashPrize !== "all") {
        const reqCash = hasCashPrize === "true" || hasCashPrize === true;
        if (Boolean(act.hasCashPrize) !== reqCash) return;
      }

      // Participation / Award status filter
      const isPrize =
        act.participationStatus === "Winner" ||
        (act.type && act.type.toLowerCase().includes("prize"));
      if (participationStatus && participationStatus !== "all") {
        if (participationStatus === "Winner" && !isPrize) return;
        if (participationStatus === "Participant" && isPrize) return;
        if (participationStatus === "CashPrize" && (!act.hasCashPrize || !act.cashPrizeAmount)) return;
      }

      // Stage filter (e.g. only completed or advisor-approved)
      if (stage && stage !== "all" && act.currentStage !== stage) return;

      // Stats
      uniqueParticipantsSet.add(s._id.toString());
      classBreakdown[classLabel].participantsSet.add(s._id.toString());

      if (isPrize) {
        totalWinners += 1;
        classBreakdown[classLabel].winners += 1;
      } else if (act.participationStatus === "Runner") {
        totalRunners += 1;
      }

      if (act.hasCashPrize && act.cashPrizeAmount > 0) {
        totalCashPrizeWinners += 1;
        totalCashPrizeAmount += act.cashPrizeAmount;
        classBreakdown[classLabel].cashWinners += 1;
        classBreakdown[classLabel].cashAmount += act.cashPrizeAmount;
      }

      const pts = (act.currentStage === "completed" ? act.pointsApproved : act.pointsClaimed) || 0;
      totalPointsApproved += pts;
      classBreakdown[classLabel].points += pts;

      records.push({
        activityId: act._id,
        studentId: s._id,
        rollNumber: s.rollNumber || "-",
        studentName: s.name,
        name: s.name,
        department: s.department,
        year: s.year || 2,
        section: s.section || "A",
        advisorName: s.advisor?.name || "",
        semester: actSem,
        academicYear: act.academicYear || s.academicYear || "2024-2025",
        category: act.category,
        type: act.type,
        tier: act.tier,
        title: act.title,
        eventDate: act.eventDate,
        collegeName: act.collegeName || "Kongu Engineering College",
        insideOrOutside: act.insideOrOutside || "Inside KEC",
        isNational: Boolean(act.isNational),
        hasCashPrize: Boolean(act.hasCashPrize),
        cashPrizeAmount: act.cashPrizeAmount || 0,
        participationStatus: isPrize ? "Winner" : (act.participationStatus || "Participant"),
        pointsClaimed: act.pointsClaimed,
        pointsApproved: act.pointsApproved,
        currentStage: act.currentStage,
        verificationCode: act.verificationCode,
        proofUrl: act.proofUrl,
      });
    });
  });

  // Calculate distinct participants per class
  Object.keys(classBreakdown).forEach((k) => {
    classBreakdown[k].participants = classBreakdown[k].participantsSet.size;
    delete classBreakdown[k].participantsSet;
  });

  return {
    summary: {
      totalSubmissions: records.length,
      totalParticipants: uniqueParticipantsSet.size,
      totalWinners,
      totalRunners,
      totalCashPrizeWinners,
      totalCashPrizeAmount,
      totalPointsApproved,
      classBreakdown,
    },
    records,
  };
}

// GET /api/report/category-analytics — JSON payload for dashboards
router.get("/category-analytics", protect, async (req, res) => {
  try {
    if (!["advisor", "hod", "admin", "mentor"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not authorized to access reports" });
    }

    const data = await queryCategoryData(req);
    res.json(data);
  } catch (err) {
    console.error("[report/category-analytics]", err);
    res.status(500).json({ message: err.message || "Failed to fetch category analytics" });
  }
});

// GET /api/report/category-pdf — Generates & downloads a Category PDF Report
router.get("/category-pdf", protect, async (req, res) => {
  try {
    if (!["advisor", "hod", "admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not authorized to download report" });
    }

    const { category, year, semester, section, participationStatus } = req.query;
    const { summary, records } = await queryCategoryData(req);

    const pdfBuffer = await generateCategoryReportPDF({
      category: category === "all" ? "All Categories" : (category || "All Categories"),
      year: year && year !== "all" ? year : "",
      semester: semester && semester !== "all" ? semester : "",
      section: section && section !== "all" ? section : "",
      statusFilter: participationStatus && participationStatus !== "all" ? participationStatus : "",
      summary,
      records,
    });

    const safeCat = (category || "Category").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
    const filename = `KEC_SAP_${safeCat}_Report_${Date.now()}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[report/category-pdf]", err);
    res.status(500).json({ message: err.message || "Failed to generate Category PDF report" });
  }
});

// GET /api/report/category-excel — Generates & downloads Category CSV/Excel Report
router.get("/category-excel", protect, async (req, res) => {
  try {
    if (!["advisor", "hod", "admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not authorized to download report" });
    }

    const { category } = req.query;
    const { records } = await queryCategoryData(req);

    const header = [
      "S.No",
      "Roll No.",
      "Student Name",
      "Department",
      "Year",
      "Section",
      "Semester",
      "Academic Year",
      "Category",
      "Activity Title",
      "College / Institution",
      "Event Date",
      "Location",
      "Is National Event",
      "Participation Status",
      "Cash Prize Won",
      "Cash Prize Amount (INR)",
      "Points Claimed",
      "Points Approved",
      "Approval Stage",
      "Verification Code",
    ];

    const rows = records.map((r, idx) => [
      idx + 1,
      r.rollNumber || "-",
      r.studentName || "-",
      r.department || "IT",
      `${r.year === 1 ? "I" : r.year === 2 ? "II" : r.year === 3 ? "III" : "IV"} Year`,
      `Sec ${r.section || "A"}`,
      `Sem ${r.semester || 1}`,
      r.academicYear || "2024-2025",
      r.category || "-",
      r.title || "-",
      r.collegeName || "Kongu Engineering College",
      formatDate(r.eventDate),
      r.insideOrOutside || "Inside KEC",
      r.isNational ? "Yes" : "No",
      r.participationStatus || "Participant",
      r.hasCashPrize ? "Yes" : "No",
      r.hasCashPrize ? r.cashPrizeAmount : 0,
      r.pointsClaimed || 0,
      r.pointsApproved || 0,
      r.currentStage ? r.currentStage.toUpperCase() : "-",
      r.verificationCode || "-",
    ]);

    const csvContent = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

    const safeCat = (category || "Category").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
    const filename = `KEC_SAP_${safeCat}_Report_${Date.now()}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from("\uFEFF" + csvContent, "utf-8")); // Include UTF-8 BOM for Excel
  } catch (err) {
    console.error("[report/category-excel]", err);
    res.status(500).json({ message: err.message || "Failed to generate CSV report" });
  }
});

// GET /api/report/summary/advisor — downloads the class advisor summary sheet as PDF
router.get("/summary/advisor", protect, async (req, res) => {
  try {
    if (!["advisor", "hod", "admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    let advisorUser = null;
    if (req.user.role === "advisor") {
      advisorUser = await User.findById(req.user.id);
    }

    const filter = { role: "student", isApproved: { $ne: false } };
    const queryYear = req.user.role === "advisor" && advisorUser ? advisorUser.year : (req.query.year ? Number(req.query.year) : undefined);
    const querySec = req.user.role === "advisor" && advisorUser ? advisorUser.section : (req.query.section ? req.query.section.toUpperCase() : undefined);
    if (queryYear) filter.year = queryYear;
    if (querySec) filter.section = querySec;

    const students = await User.find(filter)
      .select("name rollNumber department year section advisor").sort({ rollNumber: 1 });

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
      const yearLabel = queryYear ? `${queryYear} Year` : "All Years";
      const secLabel = querySec ? `Sec ${querySec}` : "All Sections";

      // Header
      doc.rect(0, 0, pageWidth, 60).fill("#1a3c34");
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(15)
        .text("KONGU ENGINEERING COLLEGE — DEPARTMENT OF INFORMATION TECHNOLOGY", 30, 12, { width: pageWidth - 60 });
      doc.font("Helvetica").fontSize(10.5).fillColor("#d8e8e0")
        .text(`Class Advisor SAP Summary Sheet — ${yearLabel} (${secLabel}) Submission Counts & Marks`, 30, 34, { width: pageWidth - 60 });

      doc.fillColor("#222");
      let y = 75;

      // Column widths
      const snW = 28, rollW = 65, nameW = 120, totalW = 45, markW = 60;
      const catW = Math.floor((pageWidth - 60 - snW - rollW - nameW - totalW - markW) / CATEGORIES.length);

      // Table header
      doc.font("Helvetica-Bold").fontSize(9);
      let x = 30;
      doc.rect(x, y, snW, 34).strokeColor("#888").lineWidth(0.4).stroke();
      doc.text("S.No", x + 2, y + 10, { width: snW - 4, align: "center" }); x += snW;
      doc.rect(x, y, rollW, 34).strokeColor("#888").stroke();
      doc.text("Roll No.", x + 2, y + 10, { width: rollW - 4, align: "center" }); x += rollW;
      doc.rect(x, y, nameW, 34).strokeColor("#888").stroke();
      doc.text("Name", x + 2, y + 10, { width: nameW - 4, align: "center" }); x += nameW;

      SHORT_CATS.forEach((cat) => {
        doc.rect(x, y, catW, 34).strokeColor("#888").stroke();
        doc.text(cat, x + 2, y + 4, { width: catW - 4, align: "center" });
        x += catW;
      });

      doc.rect(x, y, totalW, 34).strokeColor("#888").stroke();
      doc.text("Total Pts", x + 2, y + 10, { width: totalW - 4, align: "center" }); x += totalW;

      doc.rect(x, y, markW, 34).strokeColor("#888").stroke();
      doc.text("Mark (/5)", x + 2, y + 10, { width: markW - 4, align: "center" });
      y += 34;

      // Rows
      doc.font("Helvetica").fontSize(8.5);
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
              const pts = (activity.currentStage === "completed" ? activity.pointsApproved : activity.pointsClaimed) || 0;
              categoryPoints[activity.category] += pts;
              total += pts;
            }
          });
        }

        const rowH = 24;
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
          .text(String(total), x + 2, y + 5, { width: totalW - 4, align: "center" }); x += totalW;

        const mark = calculateSAPMark(total);
        doc.rect(x, y, markW, rowH).strokeColor("#ccc").stroke();
        doc.font("Helvetica-Bold").fillColor(mark > 0 ? "#1a7a4c" : "#999")
          .text(`${mark} / 5`, x + 2, y + 5, { width: markW - 4, align: "center" });
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
    const filename = `SAP_Advisor_Summary_${Date.now()}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
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

    const certificatePaths = studentPoints.activities
      .filter((activity) => activity.proofUrl)
      .map((activity) => activity.proofUrl);

    const pdfBytes = await generateSAPReport(user, studentPoints, certificatePaths);

    const filename = `SAP_Report_${user.rollNumber || user._id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBytes.length);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("[report/:studentId]", err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
