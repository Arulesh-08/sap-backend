const express   = require("express");
const multer    = require("multer");
const ExcelJS   = require("exceljs");
const mammoth   = require("mammoth");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const router    = express.Router();

const { protect, allowRoles }                          = require("../middleware/auth");
const PointStructure                                   = require("../models/PointStructure");
const User                                             = require("../models/User");
const { refreshPointStructure, STATIC_KEC_STRUCTURE }  = require("../config/pointStructure");
const { sendEmail }                                    = require("../utils/sendEmail");

// ── Multer: memory-only ───────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (["xlsx","xls","docx","doc"].includes(ext)) return cb(null, true);
    cb(new Error("Only .xlsx / .xls / .docx files are supported."));
  },
});

// ── Gemini client (lazy-init so missing key doesn't crash startup) ────────────
function getGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env");
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1 — EXTRACT TEXT FROM FILE
// ═════════════════════════════════════════════════════════════════════════════

/** Extract all readable text from a .docx buffer using mammoth. */
async function extractDocxText(buffer) {
  const { value: rawText } = await mammoth.extractRawText({ buffer });
  return rawText;
}

/** Extract all cell values from an Excel buffer into plain text. */
async function extractExcelText(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const lines = [];
  wb.eachSheet((ws) => {
    lines.push(`[Sheet: ${ws.name}]`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = row.values.slice(1).map((v) => {
        if (v == null) return "";
        if (typeof v === "object" && v.text  != null) return String(v.text);
        if (typeof v === "object" && v.result != null) return String(v.result);
        return String(v);
      });
      const line = cells.join("\t");
      if (line.trim()) lines.push(line);
    });
  });
  return lines.join("\n");
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 2 — KEYWORD CHECK: Is this a KEC SAP document?
// ═════════════════════════════════════════════════════════════════════════════

const SAP_KEYWORDS = [
  "STUDENT ACTIVITY POINTS",
  "KONGU ENGINEERING COLLEGE",
  "Paper/Poster",
  "Techno Managerial",
  "Sports",
  "Leadership",
  "GATE",
  "CAT",
  "Membership",
  "Non-Credit",
  "Patent",
  "W.E.F",
  "Activity Points",
  "SAP",
];

function isSapDocument(text) {
  let hits = 0;
  for (const kw of SAP_KEYWORDS) {
    if (text.includes(kw)) hits++;
  }
  console.log(`[sap-parser] Keyword hits: ${hits}/${SAP_KEYWORDS.length}`);
  return hits >= 3;
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 3 — AI EXTRACTION via Gemini
// ═════════════════════════════════════════════════════════════════════════════

const AI_PROMPT = `
You are an expert at reading official college SAP (Student Activity Points) documents.
I will give you the full text of a SAP point structure document.

Your task: extract EVERY category, type, tier, and point value from this document.

Return a single valid JSON object in EXACTLY this format (no markdown, no explanation, just raw JSON):

{
  "1. Category Name": {
    "max": 150,
    "types": {
      "Type Name": {
        "Tier Name": 10,
        "Another Tier": 20
      }
    }
  },
  "2. Another Category": {
    "max": 50,
    "types": {
      "Type Name": {
        "Tier Name": 5
      }
    }
  }
}

Rules:
- Category keys must be numbered: "1. Name", "2. Name", etc.
- "max" = the maximum marks for that category (look for "Max." or "Maximum" near the category)
- "types" = sub-types or participation types (e.g. "Presented", "Prize", "Participated", "Prize Winners")
- Each type maps to tier names → point values (integers only)
- If there is no type distinction, use "General" as the type name
- Extract ALL rows — do not skip any
- Point values must be positive integers
- If a "max" value is not found for a category, set it to 0
- Never add comments, never wrap in code blocks, output ONLY the raw JSON

Document text:
`;

async function extractWithAI(documentText) {
  const model = getGemini();

  // Truncate if too long (Gemini flash handles ~30k tokens)
  const textToSend = documentText.length > 25000
    ? documentText.slice(0, 25000)
    : documentText;

  console.log(`[sap-ai] Sending ${textToSend.length} chars to Gemini...`);

  const result = await model.generateContent(AI_PROMPT + textToSend);
  const raw    = result.response.text().trim();

  console.log(`[sap-ai] Gemini raw response (first 500 chars):\n${raw.slice(0, 500)}`);

  // Strip any accidental markdown code fences
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("[sap-ai] JSON parse failed:", e.message);
    console.error("[sap-ai] Raw response was:", raw.slice(0, 1000));
    throw new Error("AI returned invalid JSON. Raw: " + raw.slice(0, 200));
  }

  // Validate: must be an object with at least 1 category that has types
  const cats = Object.keys(parsed);
  if (cats.length === 0) throw new Error("AI returned empty structure.");

  let totalTiers = 0;
  for (const cat of cats) {
    if (!parsed[cat].types) parsed[cat].types = {};
    if (parsed[cat].max == null) parsed[cat].max = 0;
    for (const type of Object.values(parsed[cat].types)) {
      totalTiers += Object.keys(type).length;
    }
  }

  console.log(`[sap-ai] ✅ AI extracted ${cats.length} categories, ${totalTiers} total tiers`);
  return parsed;
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 4 — FALLBACK: Use static structure + update values from text
// ═════════════════════════════════════════════════════════════════════════════

function staticFallbackWithTextScan(rawText) {
  const structure = JSON.parse(JSON.stringify(STATIC_KEC_STRUCTURE));
  const catKeys   = Object.keys(structure);

  // Update max values per category from the raw text
  catKeys.forEach((cat) => {
    const shortName = cat.replace(/^\d+\.\s*/, "").slice(0, 15);
    const pos = rawText.indexOf(shortName);
    if (pos === -1) return;
    const snippet = rawText.slice(pos, pos + 400);
    const match   = snippet.match(/[Mm]ax\.?\s*(\d+)/);
    if (match) structure[cat].max = parseInt(match[1]);
  });

  return structure;
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/admin/sap-structure/extract
router.post("/extract", protect, allowRoles("admin"), upload.single("sapFile"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded." });

    const ext = req.file.originalname.split(".").pop().toLowerCase();

    // ── Extract raw text from file ──────────────────────────────────────
    let rawText;
    if (["xlsx","xls"].includes(ext)) {
      rawText = await extractExcelText(req.file.buffer);
    } else if (["docx","doc"].includes(ext)) {
      rawText = await extractDocxText(req.file.buffer);
    } else {
      return res.status(400).json({ message: "Unsupported file type." });
    }

    console.log(`[sap/extract] Extracted text length: ${rawText.length} chars`);

    // ── Keyword check ───────────────────────────────────────────────────
    const isSap = isSapDocument(rawText);
    console.log(`[sap/extract] Is SAP document: ${isSap}`);

    if (!isSap) {
      return res.status(422).json({
        message: "This does not appear to be a SAP point structure document. " +
                 "Please upload the official KEC SAP evaluation sheet.",
      });
    }

    // ── AI Extraction ───────────────────────────────────────────────────
    let structure;
    let method = "ai_gemini";

    try {
      structure = await extractWithAI(rawText);
    } catch (aiErr) {
      console.warn("[sap/extract] AI extraction failed:", aiErr.message);
      console.warn("[sap/extract] Falling back to static structure scan");
      structure = staticFallbackWithTextScan(rawText);
      method    = "static_fallback";
    }

    if (!structure || Object.keys(structure).length === 0) {
      return res.status(422).json({
        message: "Could not extract SAP structure from the document. " +
                 "Use 'Publish KEC Default' to activate the built-in structure.",
      });
    }

    return res.json({
      kecFormatDetected: true,
      structure,
      sheets: [],
      method,
      message: method === "ai_gemini"
        ? `AI extracted ${Object.keys(structure).length} categories successfully.`
        : `Used built-in structure (AI unavailable). ${Object.keys(structure).length} categories loaded.`,
    });

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
        .then(r => console.log(`[sap/publish] Emails sent=${r.sent}`))
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
        .then(r => console.log(`[sap/reset] Emails sent=${r.sent}`))
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function notifyAllUsers() {
  const users  = await User.find({}).select("email").lean();
  const emails = users.map(u => u.email).filter(Boolean);
  if (!emails.length) return { sent: 0, skipped: 0, error: "No users found." };
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;">
      <h2 style="color:#1e40af;">SAP Point Structure Updated</h2>
      <p>The administrator has published an updated SAP activity point structure.</p>
      <a href="https://sap-frontend-lake.vercel.app/login"
         style="display:inline-block;margin-top:16px;padding:12px 24px;
                background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;">
        Open SAP Portal &rarr;
      </a>
      <p style="margin-top:24px;font-size:0.8rem;color:#64748b;">KEC Student Activity Points Portal</p>
    </div>`;
  return await sendEmail({ to: emails, subject: "KEC SAP Point Structure Updated", html });
}

async function saveStructure(structure, userId) {
  await PointStructure.findOneAndUpdate(
    {},
    { structure, publishedBy: userId, publishedAt: new Date() },
    { upsert: true, new: true }
  );
  await refreshPointStructure();
}

module.exports = router;
