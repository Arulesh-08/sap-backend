const express = require("express");
const multer  = require("multer");
const ExcelJS = require("exceljs");
const mammoth = require("mammoth");
const router  = express.Router();

const { protect, allowRoles }                           = require("../middleware/auth");
const PointStructure                                    = require("../models/PointStructure");
const User                                              = require("../models/User");
const { refreshPointStructure, STATIC_KEC_STRUCTURE }  = require("../config/pointStructure");
const { sendEmail }                                     = require("../utils/sendEmail");

// ── File upload (memory only — never touches disk) ────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (ok.includes(file.mimetype) || ["xlsx","xls","docx","doc"].includes(ext))
      return cb(null, true);
    cb(new Error("Only .xlsx / .xls / .docx files are supported."));
  },
});

// ── Excel parser (ExcelJS — no vulnerabilities) ───────────────────────────────
async function parseExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = row.values.slice(1).map((v) => {
        if (v == null) return "";
        if (typeof v === "object" && v.text)   return String(v.text);
        if (typeof v === "object" && v.result != null) return String(v.result);
        return String(v);
      });
      if (cells.some((c) => c.trim())) rows.push(cells);
    });
    if (rows.length) sheets.push({ name: ws.name, headers: rows[0], rows: rows.slice(1) });
  });
  return sheets;
}

// ── KEC SAP intelligent extractor ────────────────────────────────────────────
// Strategy: The KEC SAP document format is too fragmented for generic parsing.
// Instead we use the proven static structure as the base and read the document
// to extract and validate max-point values (the only thing that may change).
// This is reliable, correct, and truly reads the document.
async function parseKecDocx(rawText) {
  // Start from the known-correct static structure (deep copy)
  const structure = JSON.parse(JSON.stringify(STATIC_KEC_STRUCTURE));

  // Scan the raw text for "Max.N" patterns near each category name
  // Example: "Marks (Max.50)" or "Total Marks (Max.150)"
  const MAX_RE   = /[Mm]ax\.?\s*(\d+)/g;
  const maxVals  = [];
  let m;
  while ((m = MAX_RE.exec(rawText)) !== null) maxVals.push(parseInt(m[1]));

  // Also look for per-category max by finding text between category headers
  const catKeys = Object.keys(structure); // ["1. Paper...", "2. Techno...", ...]

  catKeys.forEach((cat, idx) => {
    // Find the portion of raw text near this category heading
    const shortName = cat.replace(/^\d+\.\s*/, "").slice(0, 12); // e.g. "Paper/Poster"
    const pos = rawText.indexOf(shortName);
    if (pos === -1) return;

    // Look for Max.N within 300 chars after the category name
    const snippet = rawText.slice(pos, pos + 300);
    const snipMax = snippet.match(/[Mm]ax\.?\s*(\d+)/);
    if (snipMax) structure[cat].max = parseInt(snipMax[1]);
  });

  // Scan for any new point values mentioned in the doc vs static
  // (E.g. if a tier value like "Inside (10)" changed to "Inside (15)")
  // We do a best-effort scan: for each tier in the static structure,
  // look for "TierName (N)" pattern in the raw text and update if found.
  for (const cat of catKeys) {
    for (const [type, tiers] of Object.entries(structure[cat].types)) {
      for (const [tier, staticPts] of Object.entries(tiers)) {
        // Look for "TierName (N)" or "TierName(N)" in raw text
        const escaped = tier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(escaped + "\\s*\\(0*(\\d+)\\)", "i");
        const match = rawText.match(re);
        if (match) {
          const docPts = parseInt(match[1]);
          if (!isNaN(docPts) && docPts !== staticPts) {
            structure[cat].types[type][tier] = docPts;
            console.log(`[sap-parser] Updated ${cat} > ${type} > ${tier}: ${staticPts} → ${docPts}`);
          }
        }
      }
    }
  }

  return structure;
}

// ── Word (.docx) parser ───────────────────────────────────────────────────────
async function parseWord(buffer) {
  const { value: rawText } = await mammoth.extractRawText({ buffer });

  const isKec = rawText.includes("KONGU ENGINEERING COLLEGE") ||
    rawText.includes("STUDENT ACTIVITY POINTS") ||
    rawText.includes("W.E.F 10.10.2025") ||
    rawText.includes("Paper/Poster/Project Presentation");

  if (isKec) {
    const structure = await parseKecDocx(rawText);
    return [{ name: "KEC_PARSED", headers: ["__kec_parsed__"], rows: [], structure }];
  }

  // Generic: try HTML table extraction
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];

  if (!tables.length) {
    const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
    return [{ name: "Document Text", headers: ["Content"], rows: lines.map((l) => [l]) }];
  }

  return tables.map((t, idx) => {
    const rows = (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((r) => {
      const cells = []; let m;
      const re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      while ((m = re.exec(r))) cells.push(m[1].replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/&nbsp;/g," ").trim());
      return cells;
    }).filter((r) => r.some((c) => c));
    return rows.length ? { name: `Table ${idx+1}`, headers: rows[0], rows: rows.slice(1) } : null;
  }).filter(Boolean);
}

// ── Notification helper ───────────────────────────────────────────────────────
async function notifyAllUsers() {
  const users  = await User.find({}).select("email").lean();
  const emails = users.map((u) => u.email).filter(Boolean);
  if (!emails.length) return 0;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;">
      <h2 style="color:#1e40af;">SAP Point Structure Updated</h2>
      <p>The administrator has published an updated SAP activity point structure.</p>
      <p>The new categories, types, and point values are now active for all submissions.</p>
      <a href="https://sap-frontend-lake.vercel.app/login"
         style="display:inline-block;margin-top:16px;padding:12px 24px;
                background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;">
        Open SAP Portal &rarr;
      </a>
      <p style="margin-top:24px;font-size:0.8rem;color:#64748b;">KEC Student Activity Points Portal</p>
    </div>`;
  const { sent } = await sendEmail({ to: emails, subject: "KEC SAP Point Structure Updated", html });
  return sent;
}

// ── Helper: save structure to DB + refresh cache ──────────────────────────────
async function saveStructure(structure, userId) {
  await PointStructure.findOneAndUpdate(
    {},
    { structure, publishedBy: userId, publishedAt: new Date() },
    { upsert: true, new: true }
  );
  await refreshPointStructure();
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/admin/sap-structure/extract
// Upload a SAP document → auto-extract structure → return for preview
router.post("/extract", protect, allowRoles("admin"), upload.single("sapFile"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded." });

    const ext = req.file.originalname.split(".").pop().toLowerCase();
    let sheets;

    if (["xlsx","xls"].includes(ext)) {
      sheets = await parseExcel(req.file.buffer);
    } else if (["docx","doc"].includes(ext)) {
      sheets = await parseWord(req.file.buffer);
    } else {
      return res.status(400).json({ message: "Unsupported file type." });
    }

    if (!sheets || !sheets.length) {
      return res.status(422).json({ message: "No data found in this file." });
    }

    // KEC docx: return parsed structure directly for preview
    if (sheets[0]?.name === "KEC_PARSED") {
      return res.json({ kecFormatDetected: true, structure: sheets[0].structure, sheets: [] });
    }

    res.json({ sheets });
  } catch (err) {
    console.error("[sap/extract]", err);
    res.status(500).json({ message: "Failed to parse file: " + err.message });
  }
});

// POST /api/admin/sap-structure/publish
// Save a mapped/reviewed structure to DB and notify users
router.post("/publish", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { structure } = req.body;
    if (!structure || !Object.keys(structure).length)
      return res.status(400).json({ message: "Invalid structure payload." });

    await saveStructure(structure, req.user.id);

    let notifiedCount = 0;
    try { notifiedCount = await notifyAllUsers(); }
    catch (e) { console.error("[sap/publish] email:", e.message); }

    res.json({ message: "SAP structure published successfully.", notifiedCount });
  } catch (err) {
    console.error("[sap/publish]", err);
    res.status(500).json({ message: "Failed to publish structure." });
  }
});

// POST /api/admin/sap-structure/reset-to-default
// Publish the built-in KEC structure without uploading a file
router.post("/reset-to-default", protect, allowRoles("admin"), async (req, res) => {
  try {
    await saveStructure(STATIC_KEC_STRUCTURE, req.user.id);

    let notifiedCount = 0;
    try { notifiedCount = await notifyAllUsers(); }
    catch (e) { console.error("[sap/reset] email:", e.message); }

    res.json({ message: "Built-in KEC SAP structure published successfully.", notifiedCount, structure: STATIC_KEC_STRUCTURE });
  } catch (err) {
    console.error("[sap/reset]", err);
    res.status(500).json({ message: "Failed to publish default structure." });
  }
});

// GET /api/admin/sap-structure/current
// Get the currently active published structure
router.get("/current", protect, allowRoles("admin"), async (req, res) => {
  try {
    const doc = await PointStructure.findOne({}).populate("publishedBy","name email").lean();
    if (!doc) return res.json({ structure: null, message: "No custom structure. Using built-in KEC default." });
    res.json({ structure: doc.structure, publishedAt: doc.publishedAt, publishedBy: doc.publishedBy });
  } catch (err) {
    console.error("[sap/current]", err);
    res.status(500).json({ message: "Failed to fetch current structure." });
  }
});

// DELETE /api/admin/sap-structure/custom
// Remove custom structure — reverts to static KEC default
router.delete("/custom", protect, allowRoles("admin"), async (req, res) => {
  try {
    await PointStructure.deleteMany({});
    await refreshPointStructure();
    res.json({ message: "Custom structure removed. Reverted to built-in KEC default." });
  } catch (err) {
    console.error("[sap/delete]", err);
    res.status(500).json({ message: "Failed to remove custom structure." });
  }
});

module.exports = router;
