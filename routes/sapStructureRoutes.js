const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const mammoth = require("mammoth");
const { Resend } = require("resend");
const router = express.Router();
const { protect, allowRoles } = require("../middleware/auth");
const PointStructure = require("../models/PointStructure");
const User = require("../models/User");
const { refreshPointStructure, getActiveStructure } = require("../config/pointStructure");

// Memory storage — file never touches disk, goes straight to buffer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/vnd.ms-excel",                                           // .xls
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
      "application/msword",                                                 // .doc (may work)
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    // Also check by extension as MIME types can be wrong
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (["xlsx", "xls", "docx", "doc"].includes(ext)) return cb(null, true);
    cb(new Error("Only Excel (.xlsx/.xls) and Word (.docx) files are supported."));
  },
});

// ── Helper: parse Excel buffer → array of sheets ─────────────────────────────
function parseExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    // sheet_to_json with header:1 gives array of arrays (raw rows)
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    // Filter out completely empty rows
    const filtered = rows.filter((row) => row.some((cell) => String(cell).trim() !== ""));
    if (filtered.length === 0) return null;
    return { name, headers: filtered[0].map(String), rows: filtered.slice(1) };
  }).filter(Boolean);
}

// ── Helper: parse Word (.docx) buffer → array of "sheets" (one per table) ────
async function parseWord(buffer) {
  // mammoth extracts the document as HTML; we then pull tables from it
  const { value: html } = await mammoth.convertToHtml({ buffer });

  // Simple table extractor from mammoth's HTML output
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  const tables = html.match(tableRegex) || [];

  if (tables.length === 0) {
    // Fallback: extract raw text paragraphs if no tables found
    const { value: text } = await mammoth.extractRawText({ buffer });
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return [{ name: "Document Text", headers: ["Content"], rows: lines.map((l) => [l]) }];
  }

  return tables.map((tableHtml, idx) => {
    const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

    const rowMatches = tableHtml.match(rowRegex) || [];
    const allRows = rowMatches.map((rowHtml) => {
      const cells = [];
      let m;
      const re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      while ((m = re.exec(rowHtml)) !== null) {
        // Strip inner HTML tags, decode entities
        cells.push(m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim());
      }
      return cells;
    }).filter((row) => row.some((c) => c !== ""));

    if (allRows.length === 0) return null;
    return {
      name: `Table ${idx + 1}`,
      headers: allRows[0],
      rows: allRows.slice(1),
    };
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
        sheets = parseExcel(req.file.buffer);
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

      res.json({ sheets });
    } catch (err) {
      console.error("[sap-structure/extract]", err);
      res.status(500).json({ message: "Failed to parse file. Please check the format and try again." });
    }
  }
);

// ── POST /api/admin/sap-structure/publish ────────────────────────────────────
// Save the admin-confirmed mapped structure to DB, then notify all users.
router.post("/publish", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { structure } = req.body;

    if (!structure || typeof structure !== "object" || Object.keys(structure).length === 0) {
      return res.status(400).json({ message: "Invalid structure payload." });
    }

    // Upsert — only one PointStructure document ever exists
    await PointStructure.findOneAndUpdate(
      {},
      { structure, publishedBy: req.user.id, publishedAt: new Date() },
      { upsert: true, new: true }
    );

    // Refresh in-memory cache so new submissions immediately use the new values
    await refreshPointStructure();

    // ── Send email notifications via Resend ─────────────────────────────────
    let notifiedCount = 0;
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const users = await User.find({}).select("email name").lean();

      // Resend free tier: max 50 recipients per call — batch if needed
      const BATCH_SIZE = 50;
      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        const to = batch.map((u) => u.email);
        await resend.emails.send({
          from: "SAP Portal <onboarding@resend.dev>",
          to,
          subject: "KEC SAP Point Structure Updated",
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;">
              <h2 style="color:#1e40af;">SAP Point Structure Updated</h2>
              <p>The SAP activity point structure for KEC has been updated by the administrator.</p>
              <p>The new categories, types, and point values are now active for all submissions.</p>
              <p>Please log in to the portal to review the changes before your next submission.</p>
              <a href="https://sap-frontend-lake.vercel.app/login"
                 style="display:inline-block;margin-top:16px;padding:12px 24px;
                        background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;">
                Open SAP Portal →
              </a>
              <p style="margin-top:24px;font-size:0.8rem;color:#64748b;">
                KEC Student Activity Points Portal
              </p>
            </div>
          `,
        });
        notifiedCount += to.length;
      }
    } catch (emailErr) {
      // Email failure is non-fatal — structure is already saved
      console.error("[sap-structure/publish] Email send failed:", emailErr.message);
    }

    res.json({
      message: "SAP structure published successfully.",
      notifiedCount,
    });
  } catch (err) {
    console.error("[sap-structure/publish]", err);
    res.status(500).json({ message: "Failed to publish structure." });
  }
});

// ── GET /api/admin/sap-structure/current ────────────────────────────────────
// Returns the currently active published structure + metadata.
router.get("/current", protect, allowRoles("admin"), async (req, res) => {
  try {
    const doc = await PointStructure.findOne({})
      .populate("publishedBy", "name email")
      .lean();

    if (!doc) {
      return res.json({ structure: null, message: "No custom structure published yet. Using default." });
    }

    res.json({
      structure: doc.structure,
      publishedAt: doc.publishedAt,
      publishedBy: doc.publishedBy,
    });
  } catch (err) {
    console.error("[sap-structure/current]", err);
    res.status(500).json({ message: "Failed to fetch current structure." });
  }
});

// ── POST /api/admin/sap-structure/reset-to-default ───────────────────────────
// Publishes the built-in KEC SAP structure (from config/pointStructure.js) to
// the DB so it becomes the active structure without needing a file upload.
router.post("/reset-to-default", protect, allowRoles("admin"), async (req, res) => {
  try {
    // Force a fresh load from the static source — bypasses any stale cache
    const { STATIC_KEC_STRUCTURE } = require("../config/pointStructure");
    const structure = STATIC_KEC_STRUCTURE;

    await PointStructure.findOneAndUpdate(
      {},
      { structure, publishedBy: req.user.id, publishedAt: new Date() },
      { upsert: true, new: true }
    );
    await refreshPointStructure();

    res.json({ message: "Built-in KEC SAP structure published successfully.", structure });
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
