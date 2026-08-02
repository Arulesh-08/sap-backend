const PDFDocument = require("pdfkit");
const { PDFDocument: PDFLibDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

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
    .text("KONGU ENGINEERING COLLEGE, PERUNDURAI 638 060", 110, 22, {
      width: pageWidth - 150,
    });

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#d8e8e0")
    .text("DEPARTMENT OF INFORMATION TECHNOLOGY", 110, 42, { width: pageWidth - 150 });

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#ffffff")
    .text("EVALUATION SHEET - STUDENT ACTIVITY POINTS", 110, 60, {
      width: pageWidth - 150,
    });

  doc.fillColor(COLORS.textDark);
  doc.y = 105;
}

function drawVerifiedStamp(doc, summary, pageWidth) {
  const isFullyVerified = summary.total > 0 && summary.approved === summary.total;
  const label = isFullyVerified ? "VERIFIED" : "PENDING VERIFICATION";
  const color = isFullyVerified ? COLORS.verifiedGreen : COLORS.pendingAmber;

  const stampX = pageWidth - 150;
  const stampY = 100;
  const radius = 32;

  doc
    .save()
    .lineWidth(2.5)
    .strokeColor(color)
    .circle(stampX + radius, stampY + radius, radius)
    .stroke();

  if (isFullyVerified) {
    doc
      .lineWidth(3)
      .strokeColor(color)
      .moveTo(stampX + radius - 14, stampY + radius)
      .lineTo(stampX + radius - 4, stampY + radius + 10)
      .lineTo(stampX + radius + 15, stampY + radius - 12)
      .stroke();
  } else {
    doc
      .fontSize(20)
      .fillColor(color)
      .font("Helvetica-Bold")
      .text("!", stampX + radius - 4, stampY + radius - 12);
  }

  doc
    .restore()
    .fontSize(7.5)
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
    doc
      .roundedRect(40, infoY, pageWidth - 220, 60, 6)
      .fillOpacity(1)
      .fillAndStroke(COLORS.lightBg, COLORS.border);
    doc.fillColor(COLORS.textDark).font("Helvetica-Bold").fontSize(10);
    doc.text(`Name: ${user.name}`, 52, infoY + 10);
    doc.text(`Roll Number: ${user.rollNumber || "-"}`, 52, infoY + 26);
    doc.text(`Department: ${user.department}`, 52, infoY + 42);
    doc.y = infoY + 75;

    const grouped = {};
    studentPoints.activities.forEach((a) => {
      if (!grouped[a.category]) grouped[a.category] = [];
      grouped[a.category].push(a);
    });

    let grandTotalApproved = 0;

    Object.keys(grouped).forEach((category) => {
      const items = grouped[category];

      if (doc.y > 700) doc.addPage();
      doc.rect(40, doc.y, pageWidth - 80, 20).fill(COLORS.bannerGreen);
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(category, 48, doc.y + 5, { width: pageWidth - 100 });
      doc.y += 24;
      doc.fillColor(COLORS.textDark);

      const startX = 40;
      let y = doc.y;
      doc.font("Helvetica-Bold").fontSize(9);
      doc.text("Title", startX + 4, y, { width: 220 });
      doc.text("Claimed", startX + 230, y, { width: 60 });
      doc.text("Approved", startX + 300, y, { width: 60 });
      doc.text("Status", startX + 370, y, { width: 130 });
      doc.moveDown(0.4);
      doc.moveTo(startX, doc.y).lineTo(pageWidth - 40, doc.y).strokeColor(COLORS.border).stroke();
      doc.moveDown(0.3);

      doc.font("Helvetica").fontSize(9);
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

        doc.text(activity.title, startX + 4, y, { width: 220 });
        doc.text(String(activity.pointsClaimed), startX + 230, y, { width: 60 });
        doc.text(String(activity.pointsApproved), startX + 300, y, { width: 60 });
        doc.text(displayStatus, startX + 370, y, { width: 130 });
        doc.moveDown(0.6);

        if (activity.currentStage === "completed") {
          categoryTotal += activity.pointsApproved;
          grandTotalApproved += activity.pointsApproved;

          if (activity.verificationCode) {
            doc
              .fontSize(7.5)
              .fillColor(COLORS.textMuted)
              .text(`Verification Code: ${activity.verificationCode}`, startX + 4, doc.y);
            doc.moveDown(0.5);
            doc.fontSize(9).fillColor(COLORS.textDark);
          }
        }
      });

      doc.font("Helvetica-Bold").fontSize(9);
      doc.text(`Category Total (Approved): ${categoryTotal}`, startX + 4, doc.y);
      doc.moveDown(1);
    });

    if (doc.y > 700) doc.addPage();
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(pageWidth - 40, doc.y).strokeColor(COLORS.border).stroke();
    doc.moveDown(0.5);

    const sapMark = calculateSAPMark(grandTotalApproved);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.bannerDark);
    doc.text(`Total Activity Points Earned (Approved): ${grandTotalApproved}`);
    doc.text(`SAP Mark (per course, out of 5): ${sapMark}`);

    doc.moveDown(2);
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.textDark);
    doc.text("Student Signature: ____________________");
    doc.moveDown(1);
    doc.text("Class Advisor Verified: ____________________");

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor(COLORS.textMuted)
        .text(`Page ${i + 1} of ${range.count}`, 40, doc.page.height - 30, {
          width: pageWidth - 80,
          align: "center",
        });
    }

    doc.end();
  });
}

// certificatePaths is an array of full file paths, passed in from reportRoutes.js
async function appendCertificates(mainPdfBuffer, studentPoints, certificatePaths) {
  const finalPdf = await PDFLibDocument.create();

  const mainDoc = await PDFLibDocument.load(mainPdfBuffer);
  const mainPages = await finalPdf.copyPages(mainDoc, mainDoc.getPageIndices());
  mainPages.forEach((page) => finalPdf.addPage(page));

  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;

  // Map proofUrl -> activity, so we can caption each certificate page correctly
  const activityByFilename = {};
  studentPoints.activities.forEach((a) => {
    if (a.proofUrl) activityByFilename[a.proofUrl] = a;
  });

  for (const certPath of certificatePaths) {
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
      page.drawText(`Proof: ${activity.category} - ${activity.title}`, {
        x: 40,
        y: A4_HEIGHT - 40,
        size: 11,
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
