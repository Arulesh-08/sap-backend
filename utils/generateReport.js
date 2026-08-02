const PDFDocument = require("pdfkit");
const { PDFDocument: PDFLibDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

// Converts total approved activity points into the official SAP mark (out of 5)
function calculateSAPMark(points) {
  if (points >= 150) return 5;
  if (points >= 100) return 4;
  if (points >= 50) return 3;
  if (points >= 25) return 2;
  if (points >= 10) return 1;
  return 0;
}

// Builds the formatted evaluation sheet as a PDF buffer using pdfkit
function buildEvaluationSheet(user, studentPoints) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header — matches the KEC evaluation sheet format
    doc
      .fontSize(13)
      .font("Helvetica-Bold")
      .text("KONGU ENGINEERING COLLEGE, PERUNDURAI 638 060", { align: "center" });
    doc.fontSize(11).text("DEPARTMENT OF INFORMATION TECHNOLOGY", { align: "center" });
    doc.fontSize(10).text("EVALUATION SHEET - STUDENT ACTIVITY POINTS", { align: "center" });
    doc.moveDown(1.5);

    // Student details
    doc.fontSize(10).font("Helvetica");
    doc.text(`Name: ${user.name}`);
    doc.text(`Roll Number: ${user.rollNumber}`);
    doc.text(`Department: ${user.department}`);
    doc.moveDown(1);

    // Activities table header
    doc.font("Helvetica-Bold").fontSize(10);
    const startX = 40;
    let y = doc.y;
    doc.text("Category", startX, y, { width: 100 });
    doc.text("Activity", startX + 100, y, { width: 160 });
    doc.text("Claimed", startX + 260, y, { width: 60 });
    doc.text("Approved", startX + 320, y, { width: 60 });
    doc.text("Status", startX + 380, y, { width: 80 });
    doc.moveDown(0.5);
    doc
      .moveTo(startX, doc.y)
      .lineTo(555, doc.y)
      .stroke();
    doc.moveDown(0.3);

    // Activities rows
    doc.font("Helvetica").fontSize(9);
    let totalApproved = 0;

    studentPoints.activities.forEach((activity) => {
      y = doc.y;
      doc.text(activity.category, startX, y, { width: 100 });
      doc.text(activity.title, startX + 100, y, { width: 160 });
      doc.text(String(activity.pointsClaimed), startX + 260, y, { width: 60 });
      doc.text(String(activity.pointsApproved), startX + 320, y, { width: 60 });
      doc.text(activity.status, startX + 380, y, { width: 80 });
      doc.moveDown(0.7);

      if (activity.status === "approved") {
        totalApproved += activity.pointsApproved;
      }
    });

    doc.moveDown(1);
    doc
      .moveTo(startX, doc.y)
      .lineTo(555, doc.y)
      .stroke();
    doc.moveDown(0.5);

    // Totals — using the official SAP conversion table
    const sapMark = calculateSAPMark(totalApproved);
    doc.font("Helvetica-Bold").fontSize(11);
    doc.text(`Total Activity Points Earned: ${totalApproved}`);
    doc.text(`SAP Mark (per course, out of 5): ${sapMark}`);

    doc.moveDown(2);
    doc.font("Helvetica").fontSize(10);
    doc.text("Student Signature: ____________________");
    doc.moveDown(1);
    doc.text("Class Advisor Verified: ____________________");

    doc.end();
  });
}

// Appends each certificate (image or PDF) as its own page at the end of the report
async function appendCertificates(mainPdfBuffer, certificatePaths) {
  const finalPdf = await PDFLibDocument.create();

  // Copy in the evaluation sheet pages first
  const mainDoc = await PDFLibDocument.load(mainPdfBuffer);
  const mainPages = await finalPdf.copyPages(mainDoc, mainDoc.getPageIndices());
  mainPages.forEach((page) => finalPdf.addPage(page));

  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;

  for (const certPath of certificatePaths) {
    if (!fs.existsSync(certPath)) continue; // skip missing files instead of crashing the whole report

    const ext = path.extname(certPath).toLowerCase();

    if (ext === ".pdf") {
      // Certificate is already a PDF — copy its pages in directly
      const certBytes = fs.readFileSync(certPath);
      const certDoc = await PDFLibDocument.load(certBytes);
      const certPages = await finalPdf.copyPages(certDoc, certDoc.getPageIndices());
      certPages.forEach((page) => finalPdf.addPage(page));
      continue;
    }

    // Certificate is an image — embed it centered on a new A4 page
    const imageBytes = fs.readFileSync(certPath);
    const image = ext === ".png" ? await finalPdf.embedPng(imageBytes) : await finalPdf.embedJpg(imageBytes);

    const page = finalPdf.addPage([A4_WIDTH, A4_HEIGHT]);
    const maxWidth = A4_WIDTH - 80;
    const maxHeight = A4_HEIGHT - 80;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);

    page.drawImage(image, {
      x: (A4_WIDTH - image.width * scale) / 2,
      y: (A4_HEIGHT - image.height * scale) / 2,
      width: image.width * scale,
      height: image.height * scale,
    });
  }

  return finalPdf.save();
}

// Main entry point — call this from a route
async function generateSAPReport(user, studentPoints, certificatePaths = []) {
  const mainPdfBuffer = await buildEvaluationSheet(user, studentPoints);
  return appendCertificates(mainPdfBuffer, certificatePaths);
}

module.exports = { generateSAPReport, calculateSAPMark };
