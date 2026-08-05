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
  border: "#888888",
  textDark: "#222",
  textMuted: "#666",
  verifiedGreen: "#1a7a4c",
  pendingAmber: "#b8860b",
  fillMark: "#0a5c34",
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
  doc.rect(0, 0, pageWidth, 78).fill(COLORS.bannerDark);
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, 36, 12, { width: 52, height: 52 });
  }
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13)
    .text("KONGU ENGINEERING COLLEGE, PERUNDURAI 638 060", 98, 16, { width: pageWidth - 130 });
  doc.font("Helvetica").fontSize(8.5).fillColor("#d8e8e0")
    .text("DEPARTMENT OF INFORMATION TECHNOLOGY", 98, 34, { width: pageWidth - 130 });
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#ffffff")
    .text("EVALUATION SHEET - STUDENT ACTIVITY POINTS", 98, 48, { width: pageWidth - 130 });
  doc.font("Helvetica").fontSize(7.5).fillColor("#d8e8e0")
    .text("Revised version W.E.F 10.10.2025", 98, 62, { width: pageWidth - 130 });
  doc.fillColor(COLORS.textDark);
}

function drawVerifiedStamp(doc, summary, pageWidth) {
  const isFullyVerified = summary.total > 0 && summary.approved === summary.total;
  const label = isFullyVerified ? "VERIFIED" : "PENDING";
  const color = isFullyVerified ? COLORS.verifiedGreen : COLORS.pendingAmber;
  const stampX = pageWidth - 110;
  const stampY = 12;
  const radius = 24;

  doc.save().lineWidth(2).strokeColor(color).circle(stampX + radius, stampY + radius, radius).stroke();
  if (isFullyVerified) {
    doc.lineWidth(2.5).strokeColor(color)
      .moveTo(stampX + radius - 10, stampY + radius)
      .lineTo(stampX + radius - 2, stampY + radius + 8)
      .lineTo(stampX + radius + 11, stampY + radius - 9)
      .stroke();
  } else {
    doc.fontSize(16).fillColor(color).font("Helvetica-Bold").text("!", stampX + radius - 3, stampY + radius - 9);
  }
  doc.restore().fontSize(6.5).font("Helvetica-Bold").fillColor("#ffffff")
    .text(label, stampX - 10, stampY + radius * 2 + 3, { width: radius * 2 + 20, align: "center" });
  doc.fillColor(COLORS.textDark);
}

function drawCategoryBox(doc, x, y, width, category, entry, studentActivities) {
  const rowH = 13;
  const headerH = 16;
  const totalRowH = 15;

  const rows = [];
  Object.keys(entry.types).forEach((typeName) => {
    Object.keys(entry.types[typeName]).forEach((tierName) => {
      rows.push({ type: typeName, tier: tierName, maxPts: entry.types[typeName][tierName] });
    });
  });

  const boxHeight = headerH + 8 + rows.length * rowH + totalRowH + verifyRowH + 6;

  doc.rect(x, y, width, headerH).fill(COLORS.bannerGreen);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5)
    .text(`${category}  (Max ${entry.max})`, x + 4, y + 4, { width: width - 8 });

  const labelW = width * 0.58;
  const maxColX = x + labelW + 4;
  const maxColW = width * 0.18;
  const awardColX = maxColX + maxColW + 2;
  const awardColW = width - labelW - maxColW - 12;

  let rowY = y + headerH;
  doc.font("Helvetica-Bold").fontSize(6).fillColor(COLORS.textMuted);
  doc.text("Max", maxColX, rowY + 2, { width: maxColW, align: "right" });
  doc.text("Awarded", awardColX, rowY + 2, { width: awardColW, align: "right" });
  rowY += 8;

  doc.font("Helvetica").fontSize(7);
  let categoryTotal = 0;
  let lastType = null;

  rows.forEach((row) => {
    const match = studentActivities.find((a) => a.type === row.type && a.tier === row.tier);
    doc.rect(x, rowY, width, rowH).strokeColor(COLORS.border).lineWidth(0.5).stroke();
    doc.fillColor(COLORS.textDark);
    const label = row.type === lastType ? `    ${row.tier}` : `${row.type} - ${row.tier}`;
    doc.text(label, x + 3, rowY + 3, { width: labelW, height: rowH, ellipsis: true });
    lastType = row.type;
    doc.fillColor(COLORS.textMuted).text(String(row.maxPts), maxColX, rowY + 3, { width: maxColW, align: "right" });

    if (match && match.currentStage === "completed") {
      doc.fillColor(COLORS.fillMark).font("Helvetica-Bold")
        .text(String(match.pointsApproved), awardColX, rowY + 3, { width: awardColW, align: "right" });
      doc.font("Helvetica").fillColor(COLORS.textDark);
      categoryTotal += match.pointsApproved;
    } else if (match) {
      doc.fillColor(COLORS.pendingAmber).fontSize(5.5)
        .text(match.currentStage, awardColX, rowY + 4, { width: awardColW, align: "right" });
      doc.fontSize(7).fillColor(COLORS.textDark);
    }
    rowY += rowH;
  });

  doc.rect(x, rowY, width, totalRowH).fill(COLORS.lightBg);
  doc.rect(x, rowY, width, totalRowH).strokeColor(COLORS.border).lineWidth(0.5).stroke();
  doc.fillColor(COLORS.textDark).font("Helvetica-Bold").fontSize(7.5)
    .text(`Category Total: ${categoryTotal} / ${entry.max}`, x + 4, rowY + 3, { width: width - 8 });

  return { bottomY: y + boxHeight, categoryTotal };
}

const INSTRUCTIONS = [
  "For paper/project/techno managerial events, same project title/work should not be submitted/presented more than once during the course of study",
  "Valid proof of submission acceptance/ Presented / Prize won need to be produced",
  "Your total marks at each section should not exceed the maximum marks specified",
  "National refers to the event outside Tamilnadu and International refers to outside India",
  "Premier institutions include IIT's, NIT's, IISc, IIIT's, IIM's, Anna University and other Government/ Government aided institutes across the country",
  "Each and every section should be verified and attested by the faculty (name of the faculty to be attested also mentioned in each section and marked as *)",
  "Use this sheet as index and attach all the proof as annexure for submission",
  "Any false/fake proof claimed for the marks will be considered as mal practice. In such case, the total marks will be given zero only.",
];

// Draws the official sheet's Instructions box verbatim, wrapping each bullet
// to fit the given width, and returns the Y coordinate just below it.
function drawInstructions(doc, x, y, width) {
  const padding = 6;
  const headingH = 12;
  const lineGap = 3;
  const bulletIndent = 10;
  const textWidth = width - padding * 2 - bulletIndent;

  doc.font("Helvetica").fontSize(6.5);
  const lineHeights = INSTRUCTIONS.map((line) => doc.heightOfString(line, { width: textWidth }) + lineGap);
  const contentHeight = headingH + lineHeights.reduce((a, b) => a + b, 0) + padding * 2;

  doc.rect(x, y, width, contentHeight).strokeColor(COLORS.border).lineWidth(0.5).stroke();

  let textY = y + padding;
  doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(COLORS.textDark);
  doc.text("Instructions:", x + padding, textY, { width: width - padding * 2 });
  textY += headingH;

  doc.font("Helvetica").fontSize(6.5);
  INSTRUCTIONS.forEach((line, i) => {
    doc.text("\u2022", x + padding, textY, { width: bulletIndent });
    doc.text(line, x + padding + bulletIndent, textY, { width: textWidth });
    textY += lineHeights[i];
  });

  return y + contentHeight;
}

function buildEvaluationSheet(user, studentPoints) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 30, bufferPages: true, autoFirstPage: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    const summary = { total: 0, approved: 0, pending: 0, rejected: 0 };
    studentPoints.activities.forEach((a) => {
      summary.total += 1;
      if (a.currentStage === "completed") summary.approved += 1;
      else if (a.currentStage === "rejected") summary.rejected += 1;
      else summary.pending += 1;
    });

    drawHeader(doc, pageWidth);
    drawVerifiedStamp(doc, summary, pageWidth);

    const infoY = 84;
    doc.rect(30, infoY, pageWidth - 60, 16).fill(COLORS.lightBg);
    doc.fillColor(COLORS.textDark).font("Helvetica-Bold").fontSize(8);
    doc.text(
      `Name: ${user.name}      Roll Number: ${user.rollNumber || "-"}      Department: ${user.department}`,
      36, infoY + 4, { width: pageWidth - 72 }
    );

    const byCategory = {};
    studentPoints.activities.forEach((a) => {
      if (!byCategory[a.category]) byCategory[a.category] = [];
      byCategory[a.category].push(a);
    });

    const categories = Object.keys(POINT_STRUCTURE);
    const colWidth = (pageWidth - 60 - 16) / 2;
    const leftX = 30;
    const rightX = 30 + colWidth + 16;
    let leftY = infoY + 24;
    let rightY = infoY + 24;
    let grandTotalApproved = 0;

    categories.forEach((category, idx) => {
      const entry = POINT_STRUCTURE[category];
      const studentActivities = byCategory[category] || [];
      const useLeft = idx % 2 === 0;

      let rowCount = 0;
      Object.keys(entry.types).forEach((t) => { rowCount += Object.keys(entry.types[t]).length; });
      const estimatedHeight = 16 + 8 + rowCount * 13 + 15 + 16 + 6;

      const y = useLeft ? leftY : rightY;
      if (y + estimatedHeight > pageHeight - 40) {
        doc.addPage();
        leftY = 30;
        rightY = 30;
      }

      const finalX = useLeft ? leftX : rightX;
      const finalY = useLeft ? leftY : rightY;
      const { bottomY, categoryTotal } = drawCategoryBox(doc, finalX, finalY, colWidth, category, entry, studentActivities);
      grandTotalApproved += categoryTotal;

      if (useLeft) leftY = bottomY + 10;
      else rightY = bottomY + 10;
    });

    let summaryY = Math.max(leftY, rightY);
    if (summaryY > pageHeight - 130) {
      doc.addPage();
      summaryY = 30;
    }

    doc.moveTo(30, summaryY).lineTo(pageWidth - 30, summaryY).strokeColor(COLORS.border).lineWidth(0.5).stroke();
    summaryY += 10;

    const sapMark = calculateSAPMark(grandTotalApproved);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.bannerDark);
    doc.text(`Total Activity Points Earned (Approved): ${grandTotalApproved}`, 30, summaryY);
    summaryY += 16;
    doc.text(`SAP Mark (per course, out of 5): ${sapMark}`, 30, summaryY);
    summaryY += 22;

    if (summaryY + 150 > pageHeight - 40) {
      doc.addPage();
      summaryY = 30;
    }
    summaryY = drawInstructions(doc, 30, summaryY, pageWidth - 60) + 14;

    doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.textDark);
    doc.text("Category of Marks for SAP:", 30, summaryY);
    summaryY += 12;
    doc.font("Helvetica").fontSize(7.5);
    doc.text("150+ = 5   |   100-149 = 4   |   50-99 = 3   |   25-49 = 2   |   10-24 = 1   |   Below 10 = 0", 30, summaryY);
    summaryY += 24;

    doc.font("Helvetica").fontSize(9).fillColor(COLORS.textDark);
    doc.text("Student Signature: ____________________", 30, summaryY);
    summaryY += 18;
    doc.text("Class Advisor Verified: ____________________", 30, summaryY);

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor(COLORS.textMuted)
        .text(`Page ${i + 1} of ${range.count}`, 30, pageHeight - 24, { width: pageWidth - 60, align: "center" });
    }

    doc.end();
  });
}

// Downloads a file from a remote URL (Cloudinary) into a Buffer using Node's built-in fetch
async function downloadFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download certificate: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// certificateUrls are now full Cloudinary URLs (not local paths). Each is downloaded
// over HTTPS, deduped by URL, and appended as its own labeled page.
async function appendCertificates(mainPdfBuffer, studentPoints, certificateUrls) {
  const finalPdf = await PDFLibDocument.create();

  const mainDoc = await PDFLibDocument.load(mainPdfBuffer);
  const mainPages = await finalPdf.copyPages(mainDoc, mainDoc.getPageIndices());
  mainPages.forEach((page) => finalPdf.addPage(page));

  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;

  const activityByUrl = {};
  studentPoints.activities.forEach((a) => {
    if (a.proofUrl) activityByUrl[a.proofUrl] = a;
  });

  const seen = new Set();
  const uniqueUrls = (certificateUrls || []).filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  for (const url of uniqueUrls) {
    const activity = activityByUrl[url];
    const cleanUrl = url.split("?")[0];
    const ext = path.extname(cleanUrl).toLowerCase();

    try {
      const fileBytes = await downloadFile(url);

      if (ext === ".pdf") {
        const certDoc = await PDFLibDocument.load(fileBytes);
        const certPages = await finalPdf.copyPages(certDoc, certDoc.getPageIndices());
        certPages.forEach((page) => finalPdf.addPage(page));
        continue;
      }

      let image;
      if (ext === ".png") {
        image = await finalPdf.embedPng(fileBytes);
      } else {
        // default to JPEG for .jpg/.jpeg or unknown extensions from Cloudinary
        image = await finalPdf.embedJpg(fileBytes);
      }

      const page = finalPdf.addPage([A4_WIDTH, A4_HEIGHT]);

      if (activity) {
        page.drawText(`Proof: ${activity.category} - ${activity.type} (${activity.tier})`, {
          x: 40,
          y: A4_HEIGHT - 40,
          size: 10,
        });
      }

      const maxWidth = A4_WIDTH - 80;
      const maxHeight = A4_HEIGHT - 110;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;

      page.drawImage(image, {
        x: (A4_WIDTH - drawWidth) / 2,
        y: A4_HEIGHT - 70 - drawHeight,
        width: drawWidth,
        height: drawHeight,
      });
    } catch (err) {
      continue; // skip a certificate that fails to download/embed rather than break the whole PDF
    }
  }

  return finalPdf.save();
}

async function generateSAPReport(user, studentPoints, certificateUrls = []) {
  const mainPdfBuffer = await buildEvaluationSheet(user, studentPoints);
  return appendCertificates(mainPdfBuffer, studentPoints, certificateUrls);
}

module.exports = { generateSAPReport, calculateSAPMark };
