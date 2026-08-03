const PDFDocument = require("pdfkit");
const { PDFDocument: PDFLibDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const { POINT_STRUCTURE } = require("../config/pointStructure");

const LOGO_PATH = path.join(__dirname, "..", "assets", "kec-logo.jpeg");

const COLORS = {
  bannerDark: "#1a3c34",
  bannerGreen: "#1a7a4c",
  lightBg: "#f4f6f8",
  border: "#dcdcdc",
  textDark: "#222",
  textMuted: "#666",
  verifiedGreen: "#1a7a4c",
  pendingAmber: "#b8860b",
};

function calculateSAPMark(points) {
  if (points >= 150) return 5;
  if (points >= 100) return 4;
  if (points >= 50) return 3;
  if (points >= 25) return 2;
  if (points >= 10) return 1;
  return 0;
}

function drawHeader(doc, pageWidth) {
  doc.rect(0, 0, pageWidth, 90).fill(COLORS.bannerDark);

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, 40, 15, { width: 60, height: 60 });
  }

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(15)
    .text("KONGU ENGINEERING COLLEGE, PERUNDURAI 638 060", 110, 20, { width: pageWidth - 150 });

  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#d8e8e0")
    .text("DEPARTMENT OF INFORMATION TECHNOLOGY", 110, 40, { width: pageWidth - 150 });

  doc
    .font("Helvetica-Bold")
    .fontSize(10.5)
    .fillColor("#ffffff")
    .text("EVALUATION SHEET - STUDENT ACTIVITY POINTS", 110, 56, { width: pageWidth - 150 });

  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#d8e8e0")
    .text("Revised version W.E.F 10.10.2025", 110, 72, { width: pageWidth - 150 });

  doc.fillColor(COLORS.textDark);
  doc.y = 100;
}

function drawVerifiedStamp(doc, summary, pageWidth) {
  const isFullyVerified = summary.total > 0 && summary.approved === summary.total;
  const label = isFullyVerified ? "VERIFIED" : "PENDING VERIFICATION";
  const color = isFullyVerified ? COLORS.verifiedGreen : COLORS.pendingAmber;

  const stampX = pageWidth - 150;
  const stampY = 100;
  const radius = 28;

  doc.save().lineWidth(2.5).strokeColor(color).circle(stampX + radius, stampY + radius, radius).stroke();

  if (isFullyVerified) {
    doc
      .lineWidth(3)
      .strokeColor(color)
      .moveTo(stampX + radius - 12, stampY + radius)
      .lineTo(stampX + radius - 3, stampY + radius + 9)
      .lineTo(stampX + radius + 13, stampY + radius - 10)
      .stroke();
  } else {
    doc.fontSize(18).fillColor(color).font("Helvetica-Bold").text("!", stampX + radius - 4, stampY + radius - 11);
  }

  doc
    .restore()
    .fontSize(7)
    .font("Helvetica-Bold")
    .fillColor(color)
    .text(label, stampX - 10, stampY + radius * 2 + 4, { width: radius * 2 + 20, align: "center" });

  doc.fillColor(COLORS.textDark);
}

function buildEvaluationSheet(user, studentPoints) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;

    const summary = { total: 0, approved: 0, pending: 0, rejected: 0 };
    studentPoints.activities.forEach((a) => {
      summary.total += 1;
      if (a.currentStage === "completed") summary.approved += 1;
      else if (a.currentStage === "rejected") summary.rejected += 1;
      else summary.pending += 1;
    });

    drawHeader(doc, pageWidth);
    drawVerifiedStamp(doc, summary, pageWidth);

    doc.moveDown(0.5);
    const infoY = doc.y;
    doc.roundedRect(40, infoY, pageWidth - 220, 55, 6).fillAndStroke(COLORS.lightBg, COLORS.border);
    doc.fillColor(COLORS.textDark).font("Helvetica-Bold").fontSize(9.5);
    doc.text(`Name: ${user.name}`, 50, infoY + 9);
    doc.text(`Roll Number: ${user.rollNumber || "-"}`, 50, infoY + 23);
    doc.text(`Department: ${user.department}`, 50, infoY + 37);
    doc.y = infoY + 68;

    // Group activities by category (following the exact category order from the official doc)
    const categoryOrder = Object.keys(POINT_STRUCTURE);
    const grouped = {};
    studentPoints.activities.forEach((a) => {
      if (!grouped[a.category]) grouped[a.category] = [];
      grouped[a.category].push(a);
    });

    let grandTotalApproved = 0;
    const startX = 40;

    categoryOrder.forEach((category) => {
      const items = grouped[category];
      if (!items || items.length === 0) return; // only show categories the student actually submitted under

      const maxMarks = POINT_STRUCTURE[category].max;

      if (doc.y > 690) doc.addPage();
      doc.rect(startX, doc.y, pageWidth - 80, 20).fill(COLORS.bannerGreen);
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .text(`${category}  (Max ${maxMarks})`, startX + 8, doc.y + 5, { width: pageWidth - 100 });
      doc.y += 24;
      doc.fillColor(COLORS.textDark);

      let y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8.5);
      doc.text("Type", startX + 4, y, { width: 130 });
      doc.text("Tier", startX + 138, y, { width: 130 });
      doc.text("Claimed", startX + 272, y, { width: 50 });
      doc.text("Approved", startX + 326, y, { width: 55 });
      doc.text("Status", startX + 385, y, { width: 115 });
      doc.moveDown(0.4);
      doc.moveTo(startX, doc.y).lineTo(pageWidth - 40, doc.y).strokeColor(COLORS.border).stroke();
      doc.moveDown(0.3);

      doc.font("Helvetica").fontSize(8.5);
      let categoryTotal = 0;

      items.forEach((activity) => {
        if (doc.y > 730) {
          doc.addPage();
          doc.y = 40;
        }
        y = doc.y;
        const displayStatus =
          activity.currentStage === "completed"
            ? "VERIFIED"
            : activity.currentStage === "rejected"
            ? "rejected"
            : `pending (${activity.currentStage})`;

        doc.text(activity.type, startX + 4, y, { width: 130 });
        doc.text(activity.tier, startX + 138, y, { width: 130 });
        doc.text(String(activity.pointsClaimed), startX + 272, y, { width: 50 });
        doc.text(String(activity.pointsApproved), startX + 326, y, { width: 55 });
        doc.text(displayStatus, startX + 385, y, { width: 115 });

        if (activity.title) {
          doc.moveDown(0.4);
          doc
            .fontSize(7.5)
            .fillColor(COLORS.textMuted)
            .text(activity.title, startX + 4, doc.y, { width: pageWidth - 100 });
          doc.fontSize(8.5).fillColor(COLORS.textDark);
        }

        if (activity.currentStage === "completed" && activity.verificationCode) {
          doc.moveDown(0.3);
          doc
            .fontSize(7)
            .fillColor(COLORS.textMuted)
            .text(`Verification Code: ${activity.verificationCode}`, startX + 4, doc.y);
          doc.fontSize(8.5).fillColor(COLORS.textDark);
        }

        doc.moveDown(0.6);

        if (activity.currentStage === "completed") {
          categoryTotal += activity.pointsApproved;
          grandTotalApproved += activity.pointsApproved;
        }
      });

      doc.font("Helvetica-Bold").fontSize(8.5);
      doc.text(`Category Total (Approved): ${categoryTotal} / ${maxMarks}`, startX + 4, doc.y);
      doc.moveDown(1);
    });

    if (doc.y > 690) doc.addPage();
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(pageWidth - 40, doc.y).strokeColor(COLORS.border).stroke();
    doc.moveDown(0.5);

    const sapMark = calculateSAPMark(grandTotalApproved);
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor(COLORS.bannerDark);
    doc.text(`Total Activity Points Earned (Approved): ${grandTotalApproved}`);
    doc.text(`SAP Mark (per course, out of 5): ${sapMark}`);

    doc.moveDown(1.5);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.textDark);
    doc.text("Category of Marks for SAP:");
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(8);
    doc.text("150+ = 5   |   100-149 = 4   |   50-99 = 3   |   25-49 = 2   |   10-24 = 1   |   Below 10 = 0");

    doc.moveDown(2);
    doc.font("Helvetica").fontSize(9.5).fillColor(COLORS.textDark);
    doc.text("Student Signature: ____________________");
    doc.moveDown(1);
    doc.text("Class Advisor Verified: ____________________");

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(7.5)
        .fillColor(COLORS.textMuted)
        .text(`Page ${i + 1} of ${range.count}`, 40, doc.page.height - 30, {
          width: pageWidth - 80,
          align: "center",
        });
    }

    doc.end();
  });
}

// Appends each UNIQUE certificate as its own labeled page — deduped by filename so
// the same uploaded file never appears twice even if referenced more than once.
async function appendCertificates(mainPdfBuffer, studentPoints, certificatePaths) {
  const finalPdf = await PDFLibDocument.create();

  const mainDoc = await PDFLibDocument.load(mainPdfBuffer);
  const mainPages = await finalPdf.copyPages(mainDoc, mainDoc.getPageIndices());
  mainPages.forEach((page) => finalPdf.addPage(page));

  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;

  const activityByFilename = {};
  studentPoints.activities.forEach((a) => {
    if (a.proofUrl) activityByFilename[a.proofUrl] = a;
  });

  // Dedupe: only ever embed each certificate filename once, even if it appears
  // more than once in certificatePaths for any reason.
  const seenFilenames = new Set();
  const uniquePaths = certificatePaths.filter((certPath) => {
    const filename = path.basename(certPath);
    if (seenFilenames.has(filename)) return false;
    seenFilenames.add(filename);
    return true;
  });

  for (const certPath of uniquePaths) {
    if (!fs.existsSync(certPath)) continue;

    const filename = path.basename(certPath);
    const activity = activityByFilename[filename];
    const ext = path.extname(certPath).toLowerCase();

    if (ext === ".pdf") {
      const certBytes = fs.readFileSync(certPath);
      const certDoc = await PDFLibDocument.load(certBytes);
      const certPages = await finalPdf.copyPages(certDoc, certDoc.getPageIndices());
      certPages.forEach((page) => finalPdf.addPage(page));
      continue;
    }

    const imageBytes = fs.readFileSync(certPath);
    const image = ext === ".png" ? await finalPdf.embedPng(imageBytes) : await finalPdf.embedJpg(imageBytes);

    const page = finalPdf.addPage([A4_WIDTH, A4_HEIGHT]);

    if (activity) {
      page.drawText(`Proof: ${activity.category} - ${activity.type} (${activity.tier})`, {
        x: 40,
        y: A4_HEIGHT - 40,
        size: 10,
      });
    }

    const maxWidth = A4_WIDTH - 80;
    const maxHeight = A4_HEIGHT - 120;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);

    page.drawImage(image, {
      x: (A4_WIDTH - image.width * scale) / 2,
      y: (A4_HEIGHT - image.height * scale) / 2 - 20,
      width: image.width * scale,
      height: image.height * scale,
    });
  }

  return finalPdf.save();
}

async function generateSAPReport(user, studentPoints, certificatePaths = []) {
  const mainPdfBuffer = await buildEvaluationSheet(user, studentPoints);
  return appendCertificates(mainPdfBuffer, studentPoints, certificatePaths);
}

module.exports = { generateSAPReport, calculateSAPMark };
