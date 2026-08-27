const express = require("express");
const multer = require("multer");
const ExcelJS = require("exceljs");
const mammoth = require("mammoth");
const router = express.Router();
const { protect, allowRoles } = require("../middleware/auth");
const PointStructure = require("../models/PointStructure");
const User = require("../models/User");
const { refreshPointStructure, getActiveStructure, STATIC_KEC_STRUCTURE } = require("../config/pointStructure");
const { sendEmail } = require("../utils/sendEmail");

// Memory storage — file never touches disk, goes straight to buffer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (["xlsx", "xls", "docx", "doc"].includes(ext)) return cb(null, true);
    cb(new Error("Only Excel (.xlsx/.xls) and Word (.docx) files are supported."));
  },
});

// ── Helper: parse Excel buffer → array of sheets (using ExcelJS) ──────────────
async function parseExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets = [];
  workbook.eachSheet((worksheet) => {
    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-indexed; index 0 is undefined
      const cells = row.values.slice(1).map((v) => {
        if (v === null || v === undefined) return "";
        if (typeof v === "object" && v.text) return String(v.text); // rich text
        if (typeof v === "object" && v.result !== undefined) return String(v.result); // formula
        return String(v);
      });
      if (cells.some((c) => c.trim() !== "")) rows.push(cells);
    });

    if (rows.length === 0) return;
    sheets.push({
      name: worksheet.name,
      headers: rows[0],
      rows: rows.slice(1),
    });
  });

  return sheets;
}

// ── Helper: parse Word (.docx) buffer ────────────────────────────────────────
// The KEC SAP document is free-text (not a proper table), so we:
//   1. Detect KEC format by checking for known keywords
//   2. If detected, return a special flag so the caller can use the static structure
//   3. Otherwise try to extract HTML tables as before
async function parseWord(buffer) {
  const { value: rawText } = await mammoth.extractRawText({ buffer });

  // ── KEC format detection ──────────────────────────────────────────────────
  // The KEC docx contains free-text with points like "Inside(5)" — not a table.
  // Detect it by looking for their known header keywords.
  const isKecFormat = (
    rawText.includes("KONGU ENGINEERING COLLEGE") ||
    rawText.includes("Student Activity Points") ||
    rawText.includes("STUDENT ACTIVITY POINTS") ||
    rawText.includes("W.E.F 10.10.2025") ||
    rawText.includes("Paper/Poster/Project Presentation")
  );

  if (isKecFormat) {
    // Signal to the caller that this is the official KEC document.
    // We return a special sheet with a single marker row.
    return [{ name: "KEC_AUTO_DETECTED", headers: ["__kec_format__"], rows: [] }];
  }

  // ── Generic table extraction ──────────────────────────────────────────────
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  const tables = html.match(tableRegex) || [];

  if (tables.length === 0) {
    const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
    return [{ name: "Document Text", headers: ["Content"], rows: lines.map((l) => [l]) }];
  }

  return tables.map((tableHtml, idx) => {
    const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const allRows = rowMatches.map((rowHtml) => {
      const cells = [];
      let m;
      const re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      while ((m = re.exec(rowHtml)) !== null) {
        cells.push(m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim());
      }
      return cells;
    }).filter((row) => row.some((c) => c !== ""));

    if (allRows.length === 0) return null;
    return { name: `Table ${idx + 1}`, headers: allRows[0], rows: allRows.slice(1) };
  }).filter(Boolean);
}

// ── POST /api/admin/sap-structure/extract ────────────────────────────────────
// Upload a college SAP document, extract its tables, return raw data.
// Does NOT save anything — admin reviews and maps columns next.
router.post(
  "/extract",
  protect,
  allowRoles("admin"),
  upload.single("sapFile"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded." });
      }

      const ext = req.file.originalname.split(".").pop().toLowerCase();
      let sheets;

      if (["xlsx", "xls"].includes(ext)) {
        sheets = await parseExcel(req.file.buffer);
      } else if (["docx", "doc"].includes(ext)) {
        sheets = await parseWord(req.file.buffer);
      } else {
        return res.status(400).json({ message: "Unsupported file type." });
      }

      if (!sheets || sheets.length === 0) {
        return res.status(422).json({
          message: "No table data found in this file. Make sure the document contains a table with the SAP structure.",
        });
      }

      // ── KEC auto-detection: if the docx is the official KEC SAP sheet, ─────
      // return a special flag so the frontend can offer one-click publish.
      if (sheets.length === 1 && sheets[0].name === "KEC_AUTO_DETECTED") {
        return res.json({ kecFormatDetected: true, sheets: [] });
      }

      res.json({ sheets });
    } catch (err) {
      console.error("[sap-structure/extract]", err);
      res.status(500).json({ message: "Failed to parse file. Please check the format and try again." });
    }
  }
);

// ── Shared notification helper ────────────────────────────────────────────────
async function notifyAllUsers() {
  const users = await User.find({}).select("email").lean();
  const emails = users.map((u) => u.email).filter(Boolean);
  if (emails.length === 0) return 0;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;">
      <h2 style="color:#1e40af;">SAP Point Structure Updated</h2>
      <p>The SAP activity point structure for KEC has been updated by the administrator.</p>
      <p>The new categories, types, and point values are now active for all submissions.</p>
      <p>Please log in to the portal to review the changes before your next submission.</p>
      <a href="https://sap-frontend-lake.vercel.app/login"
         style="display:inline-block;margin-top:16px;padding:12px 24px;
                background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;">
        Open SAP Portal &rarr;
      </a>
      <p style="margin-top:24px;font-size:0.8rem;color:#64748b;">
        KEC Student Activity Points Portal
      </p>
    </div>
  `;

  const result = await sendEmail({
    to: emails,
    subject: "KEC SAP Point Structure Updated",
    html,
  });
  return result.sent;
}

// ── POST /api/admin/sap-structure/publish ────────────────────────────────────
// Save the admin-confirmed mapped structure to DB, then notify all users.
router.post("/publish", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { structure } = req.body;

    if (!structure || typeof structure !== "object" || Object.keys(structure).length === 0) {
      return res.status(400).json({ message: "Invalid structure payload." });
    }

    await PointStructure.findOneAndUpdate(
      {},
      { structure, publishedBy: req.user.id, publishedAt: new Date() },
      { upsert: true, new: true }
    );
    await refreshPointStructure();

    let notifiedCount = 0;
    try { notifiedCount = await notifyAllUsers(); }
    catch (e) { console.error("[sap-structure/publish] Email failed:", e.message); }

    res.json({ message: "SAP structure published successfully.", notifiedCount });
  } catch (err) {
    console.error("[sap-structure/publish]", err);
    res.status(500).json({ message: "Failed to publish structure." });
  }
});

// ── GET /api/admin/sap-structure/current ─────────────────────────────────────
router.get("/current", protect, allowRoles("admin"), async (req, res) => {
  try {
    const doc = await PointStructure.findOne({})
      .populate("publishedBy", "name email")
      .lean();
    if (!doc) {
      return res.json({ structure: null, message: "No custom structure published yet. Using default." });
    }
    res.json({ structure: doc.structure, publishedAt: doc.publishedAt, publishedBy: doc.publishedBy });
  } catch (err) {
    console.error("[sap-structure/current]", err);
    res.status(500).json({ message: "Failed to fetch current structure." });
  }
});

// ── POST /api/admin/sap-structure/reset-to-default ───────────────────────────
// Publishes the built-in KEC SAP structure to DB without a file upload.
router.post("/reset-to-default", protect, allowRoles("admin"), async (req, res) => {
  try {
    const structure = STATIC_KEC_STRUCTURE;

    await PointStructure.findOneAndUpdate(
      {},
      { structure, publishedBy: req.user.id, publishedAt: new Date() },
      { upsert: true, new: true }
    );
    await refreshPointStructure();

    let notifiedCount = 0;
    try { notifiedCount = await notifyAllUsers(); }
    catch (e) { console.error("[sap-structure/reset-to-default] Email failed:", e.message); }

    res.json({
      message: "Built-in KEC SAP structure published successfully.",
      notifiedCount,
      structure,
    });
  } catch (err) {
    console.error("[sap-structure/reset-to-default]", err);
    res.status(500).json({ message: "Failed to publish default structure." });
  }
});


// ── DELETE /api/admin/sap-structure/custom ───────────────────────────────────
// Removes any custom published structure — reverts to the static KEC default.
router.delete("/custom", protect, allowRoles("admin"), async (req, res) => {
  try {
    await PointStructure.deleteMany({});
    await refreshPointStructure();
    res.json({ message: "Custom structure removed. System reverted to built-in KEC default." });
  } catch (err) {
    console.error("[sap-structure/delete-custom]", err);
    res.status(500).json({ message: "Failed to remove custom structure." });
  }
});

module.exports = router;
