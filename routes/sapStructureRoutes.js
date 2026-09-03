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
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (["xlsx","xls","docx","doc"].includes(ext)) return cb(null, true);
    cb(new Error("Only .xlsx / .xls / .docx files are supported."));
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTELLIGENT KEC SAP EXTRACTION ENGINE
// Strategy:
//   1. Parse HTML tables from the .docx via mammoth
//   2. Detect if it's a KEC SAP document (by keyword detection)
//   3. If KEC SAP → extract categories, types, tiers, points FROM the table rows
//   4. If not KEC → generic table extraction
//   5. Fallback: regex scan on raw text
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cleans a raw cell string: strips HTML tags, decodes entities, normalises whitespace.
 */
function cleanCell(raw = "") {
  return raw
    .replace(/<[^>]+>/g, " ")         // strip any leftover HTML
    .replace(/&amp;/g,  "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/\s+/g,    " ")
    .trim();
}

/**
 * Extracts a numeric point value from a cell string.
 * Handles: "50", "50 marks", "(50)", "Max.50", "50pts", etc.
 */
function extractPoints(cell) {
  const s = cell.replace(/,/g, "");
  // Match a standalone number (not part of a longer token like a year "2025")
  const m = s.match(/\b(\d{1,4})\b/g);
  if (!m) return null;
  // Take the LAST number found (point values usually come at the end)
  const vals = m.map(Number).filter(n => n > 0 && n <= 1000);
  return vals.length ? vals[vals.length - 1] : null;
}

/**
 * Checks if a cell looks like a point value column (number or "—").
 */
function looksLikePointsCell(cell) {
  if (!cell) return false;
  const c = cell.trim();
  if (/^[-–—]+$/.test(c)) return false; // dash = N/A
  return /^\d+$/.test(c) || /^[Mm]ax\.?\s*\d+/.test(c);
}

/**
 * Detect if the document is a KEC SAP Evaluation Sheet.
 */
function isKecSapDocument(rawText) {
  const keywords = [
    "KONGU ENGINEERING COLLEGE",
    "STUDENT ACTIVITY POINTS",
    "Paper/Poster",
    "Techno Managerial",
    "GATE/CAT",
    "Leadership",
    "Non-Credit",
    "Sports",
    "Membership",
    "Patent",
  ];
  let hits = 0;
  for (const kw of keywords) {
    if (rawText.includes(kw)) hits++;
  }
  return hits >= 3; // 3+ keywords = KEC SAP
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY 1: HTML TABLE EXTRACTION (Primary — most reliable for .docx)
// The KEC SAP document is a Word table. mammoth converts it to HTML tables.
// We parse those tables to extract the actual structure.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse HTML tables from mammoth output into a 2D array of cleaned strings.
 */
function htmlTableToRows(tableHtml) {
  const rows = [];
  const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const rowHtml of rowMatches) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let m;
    while ((m = cellRe.exec(rowHtml)) !== null) {
      cells.push(cleanCell(m[1]));
    }
    if (cells.some(c => c.length > 0)) rows.push(cells);
  }
  return rows;
}

/**
 * Main KEC SAP table parser.
 *
 * The KEC SAP Excel/Word document has this table structure:
 *
 * | S.No | Category Name         | Types / Sub-types     | Levels/Tiers       | Marks |
 * | 1    | Paper/Poster/...      | Presented             | Inside College     | 5     |
 * |      |                       |                       | Outside            | 10    |
 * |      |                       |                       | Premier            | 20    |
 * |      |                       | Prize                 | Inside College     | 20    |
 * ...
 *
 * We scan row-by-row and carry forward the last seen Category, Type.
 * When we find a row that has a number in the last cell → it's a tier+points row.
 */
function extractStructureFromTableRows(allRows) {
  const structure = {};
  let currentCat  = null;  // e.g. "1. Paper/Poster/Project Presentation"
  let currentType = null;  // e.g. "Presented"
  let catMax      = {};    // category → accumulated max points

  // Helper: normalise category name to canonical format
  function normaliseCategory(raw) {
    // Strip bullet numbers, re-number for consistency
    const cleaned = raw.replace(/^\s*[\d]+[\.\)]\s*/, "").trim();
    return cleaned;
  }

  // We need to figure out which columns are: category, type, tier, points
  // Use a scoring approach on the first data row to identify column roles.
  // For robustness, we'll scan each row and infer from content.

  for (const row of allRows) {
    if (row.length < 2) continue;

    // Skip pure header rows (all-uppercase or contains "S.No", "Category", "Points", "Marks")
    const rowJoined = row.join(" ").toLowerCase();
    if (
      (rowJoined.includes("s.no") || rowJoined.includes("s. no")) &&
      (rowJoined.includes("category") || rowJoined.includes("activity"))
    ) continue;
    if (rowJoined.match(/^[\s\d\.\-–—]*$/) && row.every(c => !c || /^[\d\s\.\-]*$/.test(c))) continue;

    // Find the rightmost cell that is a pure number (= points value)
    let pointsIdx = -1;
    let pointsVal = null;
    for (let i = row.length - 1; i >= 0; i--) {
      const n = extractPoints(row[i]);
      if (n !== null && /^\d+$/.test(row[i].trim())) {
        pointsIdx = i;
        pointsVal = n;
        break;
      }
    }

    // Collect all meaningful text cells (non-empty, non-number-only)
    const textCells = row
      .map((c, i) => ({ text: c, idx: i }))
      .filter(({ text, idx }) => text.length > 1 && idx !== pointsIdx && !/^\d+$/.test(text.trim()));

    // ── Detect category row ─────────────────────────────────────────────
    // A category row usually:
    //  - starts with a serial number OR contains known SAP category keywords
    //  - may contain a "Max" value in a later cell
    const firstCell = row[0].trim();
    const secondCell = (row[1] || "").trim();

    const categoryKeywords = [
      "paper", "poster", "project presentation",
      "techno", "managerial",
      "sports", "games",
      "membership", "social",
      "leadership", "organiz",
      "non-credit", "value-added", "ipt", "course",
      "patent", "copyright", "paper/patent", "project to paper",
      "gate", "cat", "govt", "placement", "internship", "entrepreneur",
    ];

    const isSerialNumber = /^\d{1,2}$/.test(firstCell);
    const looksLikeCategory = categoryKeywords.some(kw =>
      rowJoined.includes(kw)
    );

    // A cell that has "Max.N" or "Max N" → category max
    const maxCell = row.find(c => /[Mm]ax\.?\s*\d+/.test(c));
    const catMaxVal = maxCell ? extractPoints(maxCell) : null;

    if ((isSerialNumber || looksLikeCategory) && textCells.length > 0) {
      // Pick the longest meaningful text cell as the category name
      const catCandidates = textCells.filter(({ text }) =>
        text.length > 3 && !looksLikePointsCell(text)
      );
      if (catCandidates.length > 0) {
        // If row[0] is a serial number, the category name is in the next cell
        const catRaw = isSerialNumber
          ? (row[1] || catCandidates[0].text)
          : catCandidates[0].text;

        const catNum = isSerialNumber ? parseInt(firstCell) : Object.keys(structure).length + 1;
        const catNormalised = normaliseCategory(catRaw);
        const catKey = `${catNum}. ${catNormalised}`;

        // Only switch category if this is genuinely a category heading
        if (catNormalised.length > 4) {
          currentCat  = catKey;
          currentType = null;
          if (!structure[currentCat]) {
            structure[currentCat] = { max: catMaxVal || 0, types: {} };
          } else if (catMaxVal) {
            structure[currentCat].max = catMaxVal;
          }
        }
      }
    }

    if (!currentCat) continue;

    // ── Detect type row (sub-category / participation type) ─────────────
    // A type row: has meaningful text, NO points value, or points is on same row
    // Types look like: "Presented", "Prize", "Participated", "Prizes", "Role", etc.
    const typeKeywords = [
      "presented", "prize", "prizes", "participated",
      "membership", "social activit",
      "role", "course", "activity",
      "sci indexed", "wos", "scopus", "journal", "conference",
      "patent", "copyright",
      "gate", "cat", "gre", "placement", "internship", "entrepreneur",
      "publication", "publication/patent",
    ];

    const looksLikeType = typeKeywords.some(kw => rowJoined.includes(kw));

    // A "type" row typically: text in col 1 or 2, no points OR has tier+points same row
    if (!pointsVal && textCells.length > 0 && looksLikeType) {
      const typeCandidate = textCells.find(({ text }) =>
        typeKeywords.some(kw => text.toLowerCase().includes(kw))
      );
      if (typeCandidate) {
        currentType = typeCandidate.text;
        if (!structure[currentCat].types[currentType]) {
          structure[currentCat].types[currentType] = {};
        }
      }
      continue; // type-only row, skip to next
    }

    // ── Detect tier + points row ──────────────────────────────────────────
    // A tier row: has points value AND a tier name text cell
    if (pointsVal !== null) {
      // If we also see a type-like keyword, capture it first
      const maybeType = textCells.find(({ text }) =>
        typeKeywords.some(kw => text.toLowerCase().includes(kw))
      );
      if (maybeType && !currentType) {
        currentType = maybeType.text;
        if (!structure[currentCat].types[currentType]) {
          structure[currentCat].types[currentType] = {};
        }
      }

      // The tier name = the text cell that is NOT the type
      const tierCandidates = textCells.filter(({ text }) =>
        text !== currentType && text.length > 1 && !looksLikePointsCell(text)
      );

      if (!currentType) {
        // Infer a default type if none found
        currentType = "General";
        if (!structure[currentCat].types[currentType]) {
          structure[currentCat].types[currentType] = {};
        }
      }
      if (!structure[currentCat].types[currentType]) {
        structure[currentCat].types[currentType] = {};
      }

      if (tierCandidates.length > 0) {
        const tierName = tierCandidates[tierCandidates.length - 1].text;
        structure[currentCat].types[currentType][tierName] = pointsVal;
      } else if (textCells.length === 0) {
        // Row is essentially just a number — use "General" tier
        structure[currentCat].types[currentType]["General"] = pointsVal;
      }

      // Accumulate max
      if (!catMax[currentCat]) catMax[currentCat] = 0;
      catMax[currentCat] = Math.max(catMax[currentCat], pointsVal);
    }
  }

  // Post-process: remove empty categories, fill in missing max values
  for (const [cat, data] of Object.entries(structure)) {
    const typesEmpty = Object.values(data.types).every(t => Object.keys(t).length === 0);
    if (typesEmpty && Object.keys(data.types).length === 0) {
      delete structure[cat];
      continue;
    }
    if (data.max === 0 && catMax[cat]) {
      // Use accumulated max if not explicitly found
      structure[cat].max = catMax[cat];
    }
  }

  return structure;
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY 2: PATTERN-BASED EXTRACTION (Fallback — for plain-text or malformed)
// Uses the STATIC structure as a scaffold but reads the document to update
// point values using regex on raw text.
// ─────────────────────────────────────────────────────────────────────────────

function patternBasedExtraction(rawText) {
  const structure = JSON.parse(JSON.stringify(STATIC_KEC_STRUCTURE));

  // 1. Update max values per category
  const catKeys = Object.keys(structure);
  catKeys.forEach((cat) => {
    const shortName = cat.replace(/^\d+\.\s*/, "").slice(0, 15);
    const pos = rawText.indexOf(shortName);
    if (pos === -1) return;
    const snippet = rawText.slice(pos, pos + 400);
    const snipMax = snippet.match(/[Mm]ax\.?\s*(\d+)/);
    if (snipMax) structure[cat].max = parseInt(snipMax[1]);
  });

  // 2. Update individual tier values
  for (const cat of catKeys) {
    for (const [type, tiers] of Object.entries(structure[cat].types)) {
      for (const [tier, staticPts] of Object.entries(tiers)) {
        const escaped = tier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(escaped + "\\s*[:(]\\s*0*(\\d+)", "i");
        const match = rawText.match(re);
        if (match) {
          const docPts = parseInt(match[1]);
          if (!isNaN(docPts) && docPts > 0 && docPts !== staticPts) {
            structure[cat].types[type][tier] = docPts;
            console.log(`[sap-parser] Pattern-updated ${cat} > ${type} > ${tier}: ${staticPts} → ${docPts}`);
          }
        }
      }
    }
  }

  return structure;
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY 3: EXCEL TABLE EXTRACTION
// For .xlsx uploads: reads each sheet, auto-detects structure columns.
// ─────────────────────────────────────────────────────────────────────────────

async function parseExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const allRows = []; // flat 2D array of strings

  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = row.values.slice(1).map((v) => {
        if (v == null)                                   return "";
        if (typeof v === "object" && v.text != null)     return String(v.text);
        if (typeof v === "object" && v.result != null)   return String(v.result);
        return String(v);
      });
      if (cells.some((c) => c.trim())) allRows.push(cells);
    });
  });

  if (!allRows.length) return null;

  // Try to extract structure from the Excel rows
  const structure = extractStructureFromTableRows(allRows);

  if (Object.keys(structure).length > 0) {
    console.log(`[sap-parser] Excel: extracted ${Object.keys(structure).length} categories via table parser`);
    return structure;
  }

  // If structure extraction failed, return raw sheet data for manual review
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN WORD (.docx) PARSER — orchestrates all strategies
// ─────────────────────────────────────────────────────────────────────────────

async function parseWord(buffer) {
  // Step 1: Get raw text and HTML simultaneously
  const [{ value: rawText }, { value: html }] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
  ]);

  console.log(`[sap-parser] Docx text length: ${rawText.length}, HTML length: ${html.length}`);

  const isKec = isKecSapDocument(rawText);
  console.log(`[sap-parser] KEC SAP document detected: ${isKec}`);

  // Step 2: Extract all HTML tables
  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  console.log(`[sap-parser] Found ${tableMatches.length} HTML tables`);

  // Step 3: Try table-based extraction across all tables (Primary strategy)
  if (tableMatches.length > 0) {
    const combinedRows = [];
    for (const tbl of tableMatches) {
      const rows = htmlTableToRows(tbl);
      combinedRows.push(...rows);
    }
    console.log(`[sap-parser] Total combined rows from all tables: ${combinedRows.length}`);

    const structure = extractStructureFromTableRows(combinedRows);

    if (Object.keys(structure).length >= 3) {
      // Good extraction — at least 3 categories found
      console.log(`[sap-parser] ✅ Table extraction succeeded: ${Object.keys(structure).length} categories`);
      return { structure, method: "table_extraction", isKec };
    }
    console.log(`[sap-parser] Table extraction found only ${Object.keys(structure).length} categories, trying fallback`);
  }

  // Step 4: Fallback — pattern-based extraction using static scaffold
  if (isKec) {
    console.log(`[sap-parser] 🔁 Falling back to pattern-based extraction`);
    const structure = patternBasedExtraction(rawText);
    return { structure, method: "pattern_extraction", isKec };
  }

  // Step 5: For non-KEC docs — return the raw text lines for display
  console.log(`[sap-parser] Non-KEC document, returning raw text preview`);
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  return { rawLines: lines, method: "raw_text", isKec: false };
}

// ── Notification helper ───────────────────────────────────────────────────────
async function notifyAllUsers() {
  const users  = await User.find({}).select("email").lean();
  const emails = users.map((u) => u.email).filter(Boolean);
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

    if (["xlsx","xls"].includes(ext)) {
      // Excel file
      const structure = await parseExcel(req.file.buffer);
      if (!structure || Object.keys(structure).length === 0) {
        // Could not extract structure — return raw Excel rows for display
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(req.file.buffer);
        const sheets = [];
        wb.eachSheet((ws) => {
          const rows = [];
          ws.eachRow({ includeEmpty: false }, (row) => {
            const cells = row.values.slice(1).map((v) => {
              if (v == null)                                 return "";
              if (typeof v === "object" && v.text != null)   return String(v.text);
              if (typeof v === "object" && v.result != null) return String(v.result);
              return String(v);
            });
            if (cells.some((c) => c.trim())) rows.push(cells);
          });
          if (rows.length) sheets.push({ name: ws.name, headers: rows[0], rows: rows.slice(1) });
        });
        return res.json({
          kecFormatDetected: false,
          structure: null,
          sheets,
          method: "excel_raw",
          message: "Could not auto-extract SAP structure from Excel. Raw data shown for reference.",
        });
      }
      return res.json({
        kecFormatDetected: true,
        structure,
        sheets: [],
        method: "excel_table",
        message: `Successfully extracted ${Object.keys(structure).length} categories from Excel.`,
      });
    }

    if (["docx","doc"].includes(ext)) {
      const result = await parseWord(req.file.buffer);

      if (result.structure && Object.keys(result.structure).length > 0) {
        return res.json({
          kecFormatDetected: true,
          structure: result.structure,
          sheets: [],
          method: result.method,
          isKec: result.isKec,
          message: `Extracted ${Object.keys(result.structure).length} categories using ${result.method}.`,
        });
      }

      // Non-KEC or unextractable — show raw lines
      if (result.rawLines) {
        return res.json({
          kecFormatDetected: false,
          structure: null,
          sheets: [{ name: "Document Text", headers: ["Content"], rows: result.rawLines.map(l => [l]) }],
          method: "raw_text",
          message: "Document parsed but no SAP structure detected. Raw content shown.",
        });
      }

      return res.status(422).json({ message: "No extractable data found in this file." });
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
        .then((r) => console.log(`[sap/publish] Emails sent: ${r.sent}, skipped: ${r.skipped}`))
        .catch((e) => console.error("[sap/publish] Email failed:", e.message));
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
        .then((r) => console.log(`[sap/reset] Emails sent: ${r.sent}`))
        .catch((e) => console.error("[sap/reset] Email failed:", e.message));
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
    const doc = await PointStructure.findOne({}).populate("publishedBy","name email").lean();
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
