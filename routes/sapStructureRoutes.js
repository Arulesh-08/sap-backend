const express = require("express");
const multer  = require("multer");
const ExcelJS = require("exceljs");
const mammoth = require("mammoth");
const router  = express.Router();

const { protect, allowRoles }                          = require("../middleware/auth");
const PointStructure                                   = require("../models/PointStructure");
const User                                             = require("../models/User");
const { refreshPointStructure, STATIC_KEC_STRUCTURE }  = require("../config/pointStructure");
const { sendEmail }                                    = require("../utils/sendEmail");

// ── Multer: memory-only, no disk ──────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (["xlsx","xls","docx","doc"].includes(ext)) return cb(null, true);
    cb(new Error("Only .xlsx / .xls / .docx files are supported."));
  },
});

// ═════════════════════════════════════════════════════════════════════════════
// PURE STRUCTURAL EXTRACTION ENGINE
// NO keyword matching.  Works entirely on the shape of the data:
//   – col with mostly small integers (1–1000)  → points column
//   – col with "Max.N" or "Max N" patterns     → max column
//   – col[0] with tiny integers (1–20)         → serial column
//   – remaining text columns left→right        → category / type / tier
//   – empty cells carry forward from the row above (Word "merged" cells)
// ═════════════════════════════════════════════════════════════════════════════

/** Strip HTML tags and decode common entities. */
function cleanCell(raw = "") {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

/** Parse one HTML <table> into a 2-D array of cleaned strings. */
function htmlTableToRows(tableHtml) {
  const rows = [];
  const rowRe  = /<tr[\s\S]*?<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let rMatch;
  while ((rMatch = rowRe.exec(tableHtml)) !== null) {
    const cells = [];
    let cMatch;
    while ((cMatch = cellRe.exec(rMatch[0])) !== null) {
      cells.push(cleanCell(cMatch[1]));
    }
    if (cells.some(c => c.length > 0)) rows.push(cells);
  }
  return rows;
}

/**
 * Apply carry-forward: when a cell is empty, inherit from the same column
 * in the previous row.  This reconstructs "merged" cells that Word collapses.
 */
function applyCarryForward(rows) {
  const maxCols = Math.max(...rows.map(r => r.length));
  const prev    = new Array(maxCols).fill("");
  return rows.map(row => {
    const out = [];
    for (let c = 0; c < maxCols; c++) {
      const val = (row[c] || "").trim();
      out[c] = val.length > 0 ? val : prev[c];
      prev[c] = out[c];
    }
    return out;
  });
}

/** True if a string is a pure positive integer ≤ 1000. */
function isPureInt(s) {
  return /^\d+$/.test(s.trim()) && parseInt(s) > 0 && parseInt(s) <= 1000;
}

/** True if a string looks like a "Max.N" cell. */
function isMaxCell(s) {
  return /[Mm]ax\.?\s*\d+/.test(s);
}

/**
 * Analyse column roles by scanning every non-empty cell in each column.
 * Returns { serialCol, pointsCol, maxCol, textCols[] } — all are indices.
 */
function detectColumnRoles(rows) {
  if (!rows.length) return null;
  const maxCols = Math.max(...rows.map(r => r.length));

  // Per-column counters
  const stats = Array.from({ length: maxCols }, () => ({
    total: 0, ints: 0, maxPat: 0, maxInt: 0, vals: [],
  }));

  for (const row of rows) {
    for (let c = 0; c < maxCols; c++) {
      const v = (row[c] || "").trim();
      if (!v) continue;
      stats[c].total++;
      stats[c].vals.push(v);
      if (isPureInt(v)) {
        stats[c].ints++;
        stats[c].maxInt = Math.max(stats[c].maxInt, parseInt(v));
      }
      if (isMaxCell(v)) stats[c].maxPat++;
    }
  }

  // Points column: rightmost column whose integer-ratio > 40 %
  let pointsCol = -1;
  for (let c = maxCols - 1; c >= 0; c--) {
    const s = stats[c];
    if (s.total > 0 && s.ints / s.total > 0.4) { pointsCol = c; break; }
  }

  // Max column: column that has "Max.N" patterns
  let maxCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (stats[c].maxPat > 0) { maxCol = c; break; }
  }

  // Serial column: col 0 where values are small integers (1–30) → likely S.No
  let serialCol = -1;
  if (stats[0] && stats[0].total > 0 && stats[0].ints / stats[0].total > 0.5 && stats[0].maxInt <= 30) {
    serialCol = 0;
  }

  // Text columns: everything that is not serial/points/max
  const excluded = new Set([serialCol, pointsCol, maxCol].filter(i => i >= 0));
  const textCols = [];
  for (let c = 0; c < maxCols; c++) {
    if (!excluded.has(c) && c < (pointsCol >= 0 ? pointsCol : maxCols)) {
      textCols.push(c);
    }
  }

  return { serialCol, pointsCol, maxCol, textCols };
}

/**
 * Attempt to build a SAP structure from a single table (2-D array, already
 * carry-forwarded).  Returns the structure object, which may be empty if the
 * table doesn't look like a SAP table.
 */
function buildStructureFromTable(rawRows) {
  if (rawRows.length < 3) return {};          // need at least header + 2 data rows

  const roles = detectColumnRoles(rawRows);
  if (!roles || roles.pointsCol < 0) return {};  // no points column → not a SAP table

  const { serialCol, pointsCol, maxCol, textCols } = roles;

  // textCols[0] = category, textCols[1] = type, textCols[2] = tier
  // If fewer than 3 text cols exist we fill from the right:
  //   2 text cols → [category+type merged, tier]
  //   1 text col  → [tier only, category/type = "General"]
  const getCatTypeCol  = () => textCols[0] ?? -1;
  const getTypeCol     = () => textCols[1] ?? -1;
  const getTierCol     = () => textCols[2] ?? textCols[1] ?? textCols[0] ?? -1;

  // Apply carry-forward now (so merged cells propagate)
  const rows = applyCarryForward(rawRows);

  // Skip the header row(s): rows where pointsCol cell is not a pure int
  let dataStart = 0;
  while (dataStart < rows.length && !isPureInt(rows[dataStart][pointsCol] || "")) {
    dataStart++;
  }
  if (dataStart >= rows.length) return {};

  const structure = {};
  let catSerial = 0;

  for (let ri = dataStart; ri < rows.length; ri++) {
    const row = rows[ri];
    const pts = parseInt((row[pointsCol] || "").trim());
    if (!pts || isNaN(pts) || pts <= 0 || pts > 1000) continue;

    // Extract max from maxCol or ignore
    const maxRaw = maxCol >= 0 ? (row[maxCol] || "") : "";
    const maxMatch = maxRaw.match(/\d+/);
    const maxVal   = maxMatch ? parseInt(maxMatch[0]) : 0;

    // Determine category / type / tier from text columns
    let category, type, tier;

    if (textCols.length >= 3) {
      category = (row[getCatTypeCol()] || "").trim();
      type     = (row[getTypeCol()]    || "").trim();
      tier     = (row[getTierCol()]    || "").trim();
    } else if (textCols.length === 2) {
      // Columns: [category+type, tier] — we treat col0 as category, col1 as tier
      category = (row[textCols[0]] || "").trim();
      type     = "General";
      tier     = (row[textCols[1]] || "").trim();
    } else if (textCols.length === 1) {
      category = "General";
      type     = "General";
      tier     = (row[textCols[0]] || "").trim();
    } else {
      continue; // nothing to map
    }

    if (!category || !tier) continue;

    // Build category key (numbered for ordering)
    if (!structure[category]) {
      catSerial++;
      structure[category] = { _serial: catSerial, max: maxVal || 0, types: {} };
    } else if (maxVal > structure[category].max) {
      structure[category].max = maxVal;
    }

    if (!type) type = "General";
    if (!structure[category].types[type]) {
      structure[category].types[type] = {};
    }

    structure[category].types[type][tier] = pts;
  }

  // Remove the internal _serial field before returning
  for (const cat of Object.keys(structure)) {
    delete structure[cat]._serial;
  }

  return structure;
}

/**
 * Merge two structure objects.  If the same category appears in both, combine
 * their types.  Prefer non-zero max values.
 */
function mergeStructures(base, incoming) {
  const merged = JSON.parse(JSON.stringify(base));
  for (const [cat, data] of Object.entries(incoming)) {
    if (!merged[cat]) {
      merged[cat] = data;
    } else {
      if (data.max > merged[cat].max) merged[cat].max = data.max;
      for (const [type, tiers] of Object.entries(data.types)) {
        if (!merged[cat].types[type]) merged[cat].types[type] = {};
        Object.assign(merged[cat].types[type], tiers);
      }
    }
  }
  return merged;
}

// ── Main Word (.docx) extractor ───────────────────────────────────────────────
async function parseDocx(buffer) {
  const { value: html }     = await mammoth.convertToHtml({ buffer });
  const { value: rawText }  = await mammoth.extractRawText({ buffer });

  // Pull every <table> from the HTML
  const tableHtmlList = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  console.log(`[sap-parser] Found ${tableHtmlList.length} tables in docx`);

  let combined = {};
  let tablesUsed = 0;

  for (let i = 0; i < tableHtmlList.length; i++) {
    const rawRows = htmlTableToRows(tableHtmlList[i]);
    console.log(`[sap-parser]   Table ${i + 1}: ${rawRows.length} rows, max ${Math.max(...rawRows.map(r=>r.length), 0)} cols`);

    const partial = buildStructureFromTable(rawRows);
    const cats    = Object.keys(partial);
    console.log(`[sap-parser]   Table ${i + 1}: extracted ${cats.length} categories`);

    if (cats.length > 0) {
      combined = mergeStructures(combined, partial);
      tablesUsed++;
    }
  }

  const totalCats = Object.keys(combined).length;
  console.log(`[sap-parser] ✅ Total: ${totalCats} categories from ${tablesUsed}/${tableHtmlList.length} tables`);

  if (totalCats > 0) {
    return { structure: combined, method: "structural_table", tableCount: tableHtmlList.length, tablesUsed, rawText };
  }

  // No table extraction worked — log the raw text for debugging
  console.log(`[sap-parser] ⚠️  Table extraction failed. Raw text (first 800 chars):\n${rawText.slice(0, 800)}`);
  return { structure: null, method: "failed", rawText, tableCount: tableHtmlList.length };
}

// ── Excel extractor ───────────────────────────────────────────────────────────
async function parseExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // Collect all rows from all sheets as a single table
  const allRows = [];
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = row.values.slice(1).map((v) => {
        if (v == null)                                 return "";
        if (typeof v === "object" && v.text  != null)  return String(v.text);
        if (typeof v === "object" && v.result != null) return String(v.result);
        return String(v);
      });
      if (cells.some(c => c.trim())) allRows.push(cells);
    });
  });

  console.log(`[sap-parser] Excel: ${allRows.length} total rows`);

  const structure = buildStructureFromTable(allRows);
  console.log(`[sap-parser] Excel: extracted ${Object.keys(structure).length} categories`);
  return structure;
}

// ── Notification helper ───────────────────────────────────────────────────────
async function notifyAllUsers() {
  const users  = await User.find({}).select("email").lean();
  const emails = users.map(u => u.email).filter(Boolean);
  if (!emails.length) return { sent: 0, skipped: 0, error: "No users found." };
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
  return await sendEmail({ to: emails, subject: "KEC SAP Point Structure Updated", html });
}

// ── Save structure to DB and refresh in-memory cache ─────────────────────────
async function saveStructure(structure, userId) {
  await PointStructure.findOneAndUpdate(
    {},
    { structure, publishedBy: userId, publishedAt: new Date() },
    { upsert: true, new: true }
  );
  await refreshPointStructure();
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/admin/sap-structure/extract
router.post("/extract", protect, allowRoles("admin"), upload.single("sapFile"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded." });

    const ext = req.file.originalname.split(".").pop().toLowerCase();

    // ── Excel ────────────────────────────────────────────────────────────
    if (["xlsx", "xls"].includes(ext)) {
      const structure = await parseExcel(req.file.buffer);
      if (Object.keys(structure).length > 0) {
        return res.json({
          kecFormatDetected: true,
          structure,
          sheets: [],
          method: "excel_structural",
          message: `Extracted ${Object.keys(structure).length} categories from Excel.`,
        });
      }
      return res.status(422).json({
        message: "Could not extract SAP structure from this Excel file. " +
                 "Ensure the file has columns for Category, Type, Tier and Points.",
      });
    }

    // ── Word docx ────────────────────────────────────────────────────────
    if (["docx", "doc"].includes(ext)) {
      const result = await parseDocx(req.file.buffer);

      if (result.structure && Object.keys(result.structure).length > 0) {
        return res.json({
          kecFormatDetected: true,
          structure: result.structure,
          sheets: [],
          method: result.method,
          tableCount: result.tableCount,
          tablesUsed: result.tablesUsed,
          message: `Extracted ${Object.keys(result.structure).length} categories from ${result.tablesUsed} table(s).`,
        });
      }

      // Extraction failed — give debug info
      const preview = (result.rawText || "").slice(0, 300);
      console.log("[sap/extract] Extraction failed. Raw text preview:", preview);

      return res.status(422).json({
        message: `Could not extract SAP structure. ` +
                 `Found ${result.tableCount} table(s) in the document but none matched the expected ` +
                 `Category / Type / Tier / Points column layout. ` +
                 `Use "Publish KEC Default" to activate the built-in structure.`,
      });
    }

    return res.status(400).json({ message: "Unsupported file type." });

  } catch (err) {
    console.error("[sap/extract]", err);
    res.status(500).json({ message: "Failed to parse file: " + err.message });
  }
});

// POST /api/admin/sap-structure/publish
router.post("/publish", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { structure, sendNotifications } = req.body;
    if (!structure || !Object.keys(structure).length)
      return res.status(400).json({ message: "Invalid structure payload." });

    await saveStructure(structure, req.user.id);
    const userCount = await User.countDocuments({});

    if (sendNotifications) {
      notifyAllUsers()
        .then(r => console.log(`[sap/publish] Emails: sent=${r.sent}, skipped=${r.skipped}`))
        .catch(e => console.error("[sap/publish] Email error:", e.message));
    }

    res.json({
      message: sendNotifications
        ? "SAP structure published. Email notifications are being sent."
        : "SAP structure published successfully.",
      notifiedCount: sendNotifications ? userCount : 0,
      notificationsSkipped: !sendNotifications,
      emailSkipped: 0,
      emailError: null,
    });
  } catch (err) {
    console.error("[sap/publish]", err);
    res.status(500).json({ message: "Failed to publish structure." });
  }
});

// POST /api/admin/sap-structure/reset-to-default
router.post("/reset-to-default", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { sendNotifications } = req.body;
    await saveStructure(STATIC_KEC_STRUCTURE, req.user.id);
    const userCount = await User.countDocuments({});

    if (sendNotifications) {
      notifyAllUsers()
        .then(r => console.log(`[sap/reset] Emails: sent=${r.sent}`))
        .catch(e => console.error("[sap/reset] Email error:", e.message));
    }

    res.json({
      message: sendNotifications
        ? "Built-in KEC SAP structure published. Email notifications are being sent."
        : "Built-in KEC SAP structure published successfully.",
      notifiedCount: sendNotifications ? userCount : 0,
      notificationsSkipped: !sendNotifications,
      emailSkipped: 0,
      emailError: null,
      structure: STATIC_KEC_STRUCTURE,
    });
  } catch (err) {
    console.error("[sap/reset]", err);
    res.status(500).json({ message: "Failed to publish default structure." });
  }
});

// GET /api/admin/sap-structure/current
router.get("/current", protect, allowRoles("admin"), async (req, res) => {
  try {
    const doc = await PointStructure.findOne({}).populate("publishedBy", "name email").lean();
    if (!doc) return res.json({ structure: null, message: "No custom structure. Using built-in KEC default." });
    res.json({ structure: doc.structure, publishedAt: doc.publishedAt, publishedBy: doc.publishedBy });
  } catch (err) {
    console.error("[sap/current]", err);
    res.status(500).json({ message: "Failed to fetch current structure." });
  }
});

// DELETE /api/admin/sap-structure/custom
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
