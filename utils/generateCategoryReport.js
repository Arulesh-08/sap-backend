const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const LOGO_PATH = path.join(__dirname, "..", "assets", "kec-logo.jpeg");

const COLORS = {
  headerBg: "#1a3c34",
  headerAccent: "#1a7a4c",
  subHeaderBg: "#2d5a4c",
  tableHeaderBg: "#1a3c34",
  tableHeaderTxt: "#ffffff",
  border: "#cccccc",
  borderDark: "#888888",
  altRowBg: "#f8faf9",
  textDark: "#1f2937",
  textMuted: "#4b5563",
  badgeGreenBg: "#d1fae5",
  badgeGreenTxt: "#065f46",
  badgeBlueBg: "#dbeafe",
  badgeBlueTxt: "#1e40af",
  badgeAmberBg: "#fef3c7",
  badgeAmberTxt: "#92400e",
};

/**
 * Format a Date to DD/MM/YYYY
 */
function formatDate(d) {
  if (!d) return "-";
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return "-";
    const day = String(date.getDate()).padStart(2, "0");
    const mon = String(date.getMonth() + 1).padStart(2, "0");
    const yr = date.getFullYear();
    return `${day}/${mon}/${yr}`;
  } catch {
    return "-";
  }
}

/**
 * Generates a comprehensive Category Report PDF Buffer
 */
async function generateCategoryReportPDF({
  category,
  year,
  semester,
  section,
  statusFilter,
  summary,
  records,
}) {
  return new Promise((resolve, reject) => {
    // Landscape A4: width 841.89, height 595.28
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 28,
      bufferPages: true,
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 28;
    const contentWidth = pageWidth - margin * 2;

    // Helper: draw Page Header
    function drawPageHeader(isFirstPage = false) {
      doc.rect(0, 0, pageWidth, isFirstPage ? 64 : 42).fill(COLORS.headerBg);

      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, margin, isFirstPage ? 8 : 4, {
          width: isFirstPage ? 48 : 34,
          height: isFirstPage ? 48 : 34,
        });
      }

      const textStartX = margin + (isFirstPage ? 56 : 42);

      if (isFirstPage) {
        doc
          .fillColor("#ffffff")
          .font("Helvetica-Bold")
          .fontSize(13)
          .text("KONGU ENGINEERING COLLEGE (Autonomous), PERUNDURAI - 638 060", textStartX, 10, {
            width: contentWidth - 60,
          });
        doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor("#d8e8e0")
          .text("DEPARTMENT OF INFORMATION TECHNOLOGY — STUDENT ACTIVITY POINTS (SAP)", textStartX, 26, {
            width: contentWidth - 60,
          });
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor("#6ee7b7")
          .text(`CATEGORY REPORT: ${category || "All Categories"}`, textStartX, 42, {
            width: contentWidth - 60,
          });
      } else {
        doc
          .fillColor("#ffffff")
          .font("Helvetica-Bold")
          .fontSize(10)
          .text("KONGU ENGINEERING COLLEGE — DEPARTMENT OF INFORMATION TECHNOLOGY", textStartX, 8, {
            width: contentWidth - 50,
          });
        doc
          .font("Helvetica")
          .fontSize(8.5)
          .fillColor("#d8e8e0")
          .text(`SAP Category Report: ${category || "All Categories"}`, textStartX, 22, {
            width: contentWidth - 50,
          });
      }

      doc.fillColor(COLORS.textDark);
    }

    // Draw first page header
    drawPageHeader(true);

    let y = 74;

    // Filter Badges Bar
    const yrLabel = year ? `Year: ${year}` : "All Years (I-IV)";
    const semLabel = semester ? `Semester: ${semester}` : "All Semesters (1-8)";
    const secLabel = section ? `Section: ${section}` : "All Sections";
    const statusLabel = statusFilter ? `Status: ${statusFilter}` : "All Records";
    const dateGenerated = `Generated: ${new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;

    doc.rect(margin, y, contentWidth, 22).fill("#f0fdf4");
    doc.rect(margin, y, contentWidth, 22).strokeColor("#bbf7d0").lineWidth(0.5).stroke();

    doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.headerAccent);
    doc.text(
      `Filters Applied: [ ${yrLabel} ]   [ ${semLabel} ]   [ ${secLabel} ]   [ ${statusLabel} ]`,
      margin + 8,
      y + 6,
      { width: contentWidth - 180 }
    );
    doc.font("Helvetica").fontSize(7.5).fillColor(COLORS.textMuted);
    doc.text(dateGenerated, pageWidth - margin - 170, y + 6, {
      width: 165,
      align: "right",
    });

    y += 28;

    // Summary Statistics KPI Row
    const kpiWidth = (contentWidth - 24) / 5;
    const kpiHeight = 36;
    const kpis = [
      { label: "Total Submissions", val: summary.totalSubmissions || records.length, color: "#1e3a8a" },
      { label: "Participants", val: summary.totalParticipants || 0, color: "#065f46" },
      { label: "Winners / Prizes", val: summary.totalWinners || 0, color: "#b45309" },
      {
        label: "Cash Prize Recipients",
        val: `${summary.totalCashPrizeWinners || 0}  (₹${(summary.totalCashPrizeAmount || 0).toLocaleString("en-IN")})`,
        color: "#15803d",
      },
      { label: "Total Approved Points", val: summary.totalPointsApproved || 0, color: "#4338ca" },
    ];

    kpis.forEach((kpi, idx) => {
      const kpiX = margin + idx * (kpiWidth + 6);
      doc.rect(kpiX, y, kpiWidth, kpiHeight).fill("#ffffff");
      doc.rect(kpiX, y, kpiWidth, kpiHeight).strokeColor(COLORS.border).lineWidth(0.5).stroke();

      doc.font("Helvetica").fontSize(7).fillColor(COLORS.textMuted);
      doc.text(kpi.label, kpiX + 4, y + 5, { width: kpiWidth - 8, align: "center" });

      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(kpi.color);
      doc.text(String(kpi.val), kpiX + 4, y + 17, { width: kpiWidth - 8, align: "center" });
    });

    y += kpiHeight + 10;

    // Class-Wise Summary Mini Table (if available)
    if (summary.classBreakdown && Object.keys(summary.classBreakdown).length > 0) {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.headerBg);
      doc.text("Class-Wise Breakdown Summary:", margin, y);
      y += 12;

      const classCols = [
        { label: "Class", w: 80, align: "left" },
        { label: "Participants", w: 80, align: "center" },
        { label: "Winners", w: 80, align: "center" },
        { label: "Cash Prize Winners", w: 105, align: "center" },
        { label: "Total Cash Prize (₹)", w: 110, align: "right" },
        { label: "Total Points", w: 80, align: "center" },
      ];

      const cHeaderH = 16;
      doc.rect(margin, y, 80 + 80 + 80 + 105 + 110 + 80, cHeaderH).fill("#e2e8f0");
      let cx = margin;
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#1e293b");
      classCols.forEach((col) => {
        doc.text(col.label, cx + 3, y + 4, { width: col.w - 6, align: col.align });
        cx += col.w;
      });
      y += cHeaderH;

      const classes = Object.keys(summary.classBreakdown).sort();
      classes.forEach((cName, cIdx) => {
        const item = summary.classBreakdown[cName];
        const rowBg = cIdx % 2 === 0 ? "#ffffff" : "#f8fafc";
        const rowH = 14;
        doc.rect(margin, y, 80 + 80 + 80 + 105 + 110 + 80, rowH).fill(rowBg);
        doc.rect(margin, y, 80 + 80 + 80 + 105 + 110 + 80, rowH).strokeColor("#cbd5e1").lineWidth(0.3).stroke();

        cx = margin;
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#1e293b");
        doc.text(cName, cx + 3, y + 3, { width: 80 - 6, align: "left" });
        cx += 80;

        doc.font("Helvetica").fontSize(7).fillColor("#334155");
        doc.text(String(item.participants || 0), cx + 3, y + 3, { width: 80 - 6, align: "center" });
        cx += 80;

        doc.font("Helvetica-Bold").fillColor(item.winners > 0 ? "#b45309" : "#64748b");
        doc.text(String(item.winners || 0), cx + 3, y + 3, { width: 80 - 6, align: "center" });
        cx += 80;

        doc.fillColor(item.cashWinners > 0 ? "#15803d" : "#64748b");
        doc.text(String(item.cashWinners || 0), cx + 3, y + 3, { width: 105 - 6, align: "center" });
        cx += 105;

        doc.text(item.cashAmount ? `₹${item.cashAmount.toLocaleString("en-IN")}` : "₹0", cx + 3, y + 3, {
          width: 110 - 6,
          align: "right",
        });
        cx += 110;

        doc.font("Helvetica-Bold").fillColor("#1e3a8a");
        doc.text(String(item.points || 0), cx + 3, y + 3, { width: 80 - 6, align: "center" });

        y += rowH;
      });

      y += 10;
    }

    // Detailed Student Records Table
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.headerBg);
    doc.text(`Student Participation & Award Details (${records.length} Submissions):`, margin, y);
    y += 12;

    // Columns specification:
    // Total available width: contentWidth (approx 785 pt)
    const columns = [
      { key: "sno", label: "S.No", w: 26, align: "center" },
      { key: "roll", label: "Roll No.", w: 55, align: "center" },
      { key: "name", label: "Student Name", w: 85, align: "left" },
      { key: "class", label: "Class", w: 42, align: "center" },
      { key: "sem", label: "Sem", w: 26, align: "center" },
      { key: "date", label: "Date", w: 48, align: "center" },
      { key: "college", label: "College / Institution", w: 90, align: "left" },
      { key: "title", label: "Event / Paper Title", w: 105, align: "left" },
      { key: "location", label: "Location", w: 58, align: "center" },
      { key: "result", label: "Result", w: 55, align: "center" },
      { key: "cash", label: "Cash Prize", w: 55, align: "right" },
      { key: "pts", label: "Pts", w: 30, align: "center" },
      { key: "status", label: "Status / Code", w: 65, align: "center" },
    ];

    function drawTableHeader() {
      const hH = 20;
      doc.rect(margin, y, contentWidth, hH).fill(COLORS.tableHeaderBg);
      let colX = margin;
      doc.font("Helvetica-Bold").fontSize(7).fillColor(COLORS.tableHeaderTxt);
      columns.forEach((col) => {
        doc.text(col.label, colX + 2, y + 5, { width: col.w - 4, align: col.align });
        colX += col.w;
      });
      y += hH;
    }

    drawTableHeader();

    // Table rows
    const rowH = 18;
    records.forEach((rec, idx) => {
      // Check if row exceeds page height
      if (y + rowH > pageHeight - 38) {
        doc.addPage();
        drawPageHeader(false);
        y = 50;
        drawTableHeader();
      }

      const rowBg = idx % 2 === 0 ? "#ffffff" : COLORS.altRowBg;
      doc.rect(margin, y, contentWidth, rowH).fill(rowBg);
      doc.rect(margin, y, contentWidth, rowH).strokeColor(COLORS.border).lineWidth(0.3).stroke();

      let colX = margin;

      // S.No
      doc.font("Helvetica").fontSize(6.5).fillColor(COLORS.textDark);
      doc.text(String(idx + 1), colX + 1, y + 4, { width: columns[0].w - 2, align: "center" });
      colX += columns[0].w;

      // Roll No.
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(COLORS.textDark);
      doc.text(rec.rollNumber || "-", colX + 1, y + 4, { width: columns[1].w - 2, align: "center" });
      colX += columns[1].w;

      // Name
      doc.font("Helvetica").fontSize(6.5).fillColor(COLORS.textDark);
      doc.text(rec.studentName || rec.name || "-", colX + 2, y + 4, {
        width: columns[2].w - 4,
        ellipsis: true,
      });
      colX += columns[2].w;

      // Class (Year & Sec)
      const yrRoman = rec.year === 1 ? "I" : rec.year === 2 ? "II" : rec.year === 3 ? "III" : "IV";
      doc.text(`${yrRoman}-${rec.section || "A"}`, colX + 1, y + 4, {
        width: columns[3].w - 2,
        align: "center",
      });
      colX += columns[3].w;

      // Sem
      doc.text(String(rec.semester || 1), colX + 1, y + 4, { width: columns[4].w - 2, align: "center" });
      colX += columns[4].w;

      // Date
      doc.text(formatDate(rec.eventDate), colX + 1, y + 4, { width: columns[5].w - 2, align: "center" });
      colX += columns[5].w;

      // College
      doc.text(rec.collegeName || "KEC", colX + 2, y + 4, {
        width: columns[6].w - 4,
        ellipsis: true,
      });
      colX += columns[6].w;

      // Title
      doc.text(rec.title || rec.type || "-", colX + 2, y + 4, {
        width: columns[7].w - 4,
        ellipsis: true,
      });
      colX += columns[7].w;

      // Location (Inside/Outside / National)
      const locText = rec.insideOrOutside === "Outside KEC"
        ? (rec.isNational ? "Outside (Nat)" : "Outside KEC")
        : "Inside KEC";
      doc.text(locText, colX + 1, y + 4, { width: columns[8].w - 2, align: "center", ellipsis: true });
      colX += columns[8].w;

      // Result (Winner / Participant)
      const isWinner = rec.participationStatus === "Winner" || rec.type?.toLowerCase().includes("prize");
      doc.font(isWinner ? "Helvetica-Bold" : "Helvetica").fillColor(isWinner ? "#b45309" : COLORS.textDark);
      doc.text(isWinner ? "Winner" : (rec.participationStatus || "Participant"), colX + 1, y + 4, {
        width: columns[9].w - 2,
        align: "center",
      });
      colX += columns[9].w;

      // Cash Prize
      const hasCash = rec.hasCashPrize && rec.cashPrizeAmount > 0;
      doc.font(hasCash ? "Helvetica-Bold" : "Helvetica").fillColor(hasCash ? "#15803d" : "#94a3b8");
      doc.text(hasCash ? `₹${rec.cashPrizeAmount}` : "-", colX + 1, y + 4, {
        width: columns[10].w - 4,
        align: "right",
      });
      colX += columns[10].w;

      // Pts
      const pts = rec.currentStage === "completed" ? rec.pointsApproved : rec.pointsClaimed;
      doc.font("Helvetica-Bold").fillColor(pts > 0 ? "#1a7a4c" : "#64748b");
      doc.text(String(pts || 0), colX + 1, y + 4, { width: columns[11].w - 2, align: "center" });
      colX += columns[11].w;

      // Status / Code
      const isCompleted = rec.currentStage === "completed";
      doc.font("Helvetica").fontSize(6).fillColor(isCompleted ? "#065f46" : "#b45309");
      const statText = isCompleted ? (rec.verificationCode || "VERIFIED") : rec.currentStage.toUpperCase();
      doc.text(statText, colX + 1, y + 5, { width: columns[12].w - 2, align: "center", ellipsis: true });

      y += rowH;
    });

    // Signature Block at End
    if (y + 40 > pageHeight - 30) {
      doc.addPage();
      drawPageHeader(false);
      y = 50;
    }

    y += 24;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.textDark);
    doc.text("Class Advisor Signature: _______________________", margin + 30, y);
    doc.text("Head of Department (IT): _______________________", pageWidth - margin - 250, y);

    // Apply Page Numbers to All Pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#94a3b8")
        .text(
          `Page ${i + 1} of ${range.count}   |   Kongu Engineering College — SAP Evaluation Management System`,
          margin,
          pageHeight - 20,
          { width: contentWidth, align: "center" }
        );
    }

    doc.end();
  });
}

module.exports = { generateCategoryReportPDF, formatDate };
