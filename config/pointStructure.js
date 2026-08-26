// Exact category/type/tier point values from the official KEC SAP Evaluation Sheet
// (Revised version W.E.F 10.10.2025). This is the FALLBACK source of truth used
// when no custom structure has been uploaded by the admin yet.
//
// When admin uploads and publishes a new structure via the Admin Dashboard,
// it is saved to MongoDB and cached here in memory. getPoints() always prefers
// the DB version. Call refreshPointStructure() after a publish to reload it.

const STATIC_POINT_STRUCTURE = {
  "1. Paper/Poster/Project Presentation": {
    max: 150,
    types: {
      "Presented": { "Inside": 5, "Outside": 10, "Premier": 20 },
      "Prize": { "Inside": 20, "Outside": 30, "Premier": 50 },
    },
  },
  "2. Techno Managerial Events": {
    max: 50,
    types: {
      "Participated (Only Physical)": {
        "Inside": 2,
        "Outside (State/National)": 5,
        "Outside (International)": 20,
      },
      "Prize": {
        "Inside": 10,
        "Outside (State/National)": 20,
        "Outside (International)": 50,
      },
    },
  },
  "3. Sports & Games": {
    max: 100,
    types: {
      "Participated": {
        "Inside": 2,
        "Zone/Outside": 10,
        "State/Interzone": 20,
        "National": 50,
        "International": 100,
      },
      "Prizes": {
        "Inside": 5,
        "Zone/Outside": 20,
        "State/Interzone": 40,
        "National/International": 100,
      },
    },
  },
  "4. Membership & Social Activities": {
    max: 100,
    types: {
      "Membership": {
        "NCC/NSS": 20,
        "Professional Society": 5,
        "Cells/Clubs": 2,
      },
      "Social Activities": {
        "Activities such as Blood Donation": 5,
        "1 to 2 weeks (NSS/NCC Camp etc.)": 20,
        "More than 2 weeks": 30,
      },
    },
  },
  "5. Leadership/Organizing Events": {
    max: 50,
    types: {
      "Role": {
        "Chairman/Secretary/Treasurer etc.": 20,
        "Joint Secretary/Vice Chairman etc.": 10,
        "EC Member": 5,
        "Class Rep/Placement/Project/Cell Coordinator/IV or IPT Coordinator": 5,
      },
    },
  },
  "6. Non-Credit Value-Added Course/IPT": {
    max: 50,
    types: {
      "Course/Activity": {
        "Non-Formal courses": 25,
        "Certification Courses": 15,
        "NPTEL Self-learning courses (not used for credit claim)": 25,
        "Other courses (NASSCOM, Etc.)": 10,
        "IPT (Minimum 10 days Physical)": 25,
        "IPT (Minimum 5 days Physical)": 15,
      },
    },
  },
  "7. Project to paper/Patent/Product Copyright": {
    max: 100,
    types: {
      "SCI Indexed": { "Submitted": 10, "Published": 50 },
      "WOS/Scopus Journal/Conference": { "Submitted": 10, "Published": 30 },
      "Other Journal/Conference": { "Submitted/Published": 5 },
      "Patent": { "Applied": 10, "Published": 20, "Obtained": 100 },
      "Copyright": { "Applied": 5, "Published": 10 },
    },
  },
  "8. GATE/CAT/Govt. Exams": {
    max: 150,
    types: {
      "GATE/CAT/GRE": { "Appeared": 25, "Qualified": 100, "Cleared Govt. Exams": 100 },
      "Placement and Internship": {
        "Placed": 50,
        "Placed with internship": 75,
        "Internship without Placement": 25,
      },
      "Entrepreneurship": {
        "Workshop attended": 10,
        "Registered for startup": 50,
        "Released product": 100,
      },
    },
  },
};

// ── Dynamic cache ─────────────────────────────────────────────────────────────
// Holds the DB-published structure once loaded. null = not yet loaded.
let _cachedStructure = null;
let _cacheLoaded = false;

// Loads the structure from MongoDB (if any), falls back to static.
// Called lazily on first getPoints() call, and explicitly after admin publishes.
async function loadStructureFromDB() {
  try {
    // Lazy require to avoid circular imports at module load time
    const PointStructure = require("../models/PointStructure");
    const doc = await PointStructure.findOne({}).lean();
    if (doc && doc.structure && Object.keys(doc.structure).length > 0) {
      _cachedStructure = doc.structure;
    } else {
      _cachedStructure = null; // Use static fallback
    }
  } catch {
    _cachedStructure = null; // DB unavailable — use static
  }
  _cacheLoaded = true;
}

// Call this immediately after admin publishes a new structure so the cache
// reflects the change without requiring a server restart.
async function refreshPointStructure() {
  _cacheLoaded = false;
  await loadStructureFromDB();
}

// Returns the active POINT_STRUCTURE: DB version if published, else static.
// Exported for routes that need the full structure (e.g. the categories dropdown).
function getActiveStructure() {
  return _cachedStructure || STATIC_POINT_STRUCTURE;
}

// Kept for backward compatibility — the categories endpoint uses this name.
const POINT_STRUCTURE = new Proxy({}, {
  get(_, key) { return getActiveStructure()[key]; },
  ownKeys() { return Object.keys(getActiveStructure()); },
  getOwnPropertyDescriptor(_, key) {
    return Object.getOwnPropertyDescriptor(getActiveStructure(), key) || { configurable: true };
  },
  has(_, key) { return key in getActiveStructure(); },
});

// Looks up the exact point value for a category/type/tier combination.
// Returns null if the combination is invalid (used to reject tampered requests).
// Async-aware: loads DB structure on first call if not already cached.
async function getPoints(category, type, tier) {
  if (!_cacheLoaded) await loadStructureFromDB();
  const structure = getActiveStructure();
  const cat = structure[category];
  if (!cat) return null;
  const t = cat.types ? cat.types[type] : cat[type];
  if (!t) return null;
  if (!(tier in t)) return null;
  return t[tier];
}

// Warm the cache at startup (non-blocking — failure is safe)
loadStructureFromDB().catch(() => {});

module.exports = { POINT_STRUCTURE, getPoints, refreshPointStructure, getActiveStructure };
