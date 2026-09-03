/**
 * test_extraction.js — Run this to verify the structural extractor
 * without needing a real file.
 *
 * Simulates what htmlTableToRows + buildStructureFromTable would receive
 * from a typical KEC SAP Word table.
 *
 * Usage:  node test_extraction.js
 */

// ── Copy the pure-logic functions here for isolated testing ──────────────────

function cleanCell(raw = "") {
  return raw.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function applyCarryForward(rows) {
  const maxCols = Math.max(...rows.map(r => r.length));
  const prev = new Array(maxCols).fill("");
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

function isPureInt(s) {
  return /^\d+$/.test(s.trim()) && parseInt(s) > 0 && parseInt(s) <= 1000;
}

function isMaxCell(s) {
  return /[Mm]ax\.?\s*\d+/.test(s);
}

function detectColumnRoles(rows) {
  if (!rows.length) return null;
  const maxCols = Math.max(...rows.map(r => r.length));
  const stats = Array.from({ length: maxCols }, () => ({
    total: 0, ints: 0, maxPat: 0, maxInt: 0,
  }));
  for (const row of rows) {
    for (let c = 0; c < maxCols; c++) {
      const v = (row[c] || "").trim();
      if (!v) continue;
      stats[c].total++;
      if (isPureInt(v)) { stats[c].ints++; stats[c].maxInt = Math.max(stats[c].maxInt, parseInt(v)); }
      if (isMaxCell(v)) stats[c].maxPat++;
    }
  }
  let pointsCol = -1;
  for (let c = maxCols - 1; c >= 0; c--) {
    if (stats[c].total > 0 && stats[c].ints / stats[c].total > 0.4) { pointsCol = c; break; }
  }
  let maxCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (stats[c].maxPat > 0) { maxCol = c; break; }
  }
  let serialCol = -1;
  if (stats[0] && stats[0].total > 0 && stats[0].ints / stats[0].total > 0.5 && stats[0].maxInt <= 30) {
    serialCol = 0;
  }
  const excluded = new Set([serialCol, pointsCol, maxCol].filter(i => i >= 0));
  const textCols = [];
  for (let c = 0; c < maxCols; c++) {
    if (!excluded.has(c) && c < (pointsCol >= 0 ? pointsCol : maxCols)) textCols.push(c);
  }
  return { serialCol, pointsCol, maxCol, textCols };
}

function buildStructureFromTable(rawRows) {
  if (rawRows.length < 3) return {};
  const roles = detectColumnRoles(rawRows);
  if (!roles || roles.pointsCol < 0) return {};
  const { textCols, pointsCol, maxCol } = roles;

  const getCatCol  = () => textCols[0] ?? -1;
  const getTypeCol = () => textCols[1] ?? -1;
  const getTierCol = () => textCols[2] ?? textCols[1] ?? textCols[0] ?? -1;

  const rows = applyCarryForward(rawRows);
  let dataStart = 0;
  while (dataStart < rows.length && !isPureInt(rows[dataStart][pointsCol] || "")) dataStart++;
  if (dataStart >= rows.length) return {};

  const structure = {};
  for (let ri = dataStart; ri < rows.length; ri++) {
    const row = rows[ri];
    const pts = parseInt((row[pointsCol] || "").trim());
    if (!pts || isNaN(pts) || pts <= 0 || pts > 1000) continue;

    const maxRaw = maxCol >= 0 ? (row[maxCol] || "") : "";
    const maxMatch = maxRaw.match(/\d+/);
    const maxVal = maxMatch ? parseInt(maxMatch[0]) : 0;

    let category, type, tier;
    if (textCols.length >= 3) {
      category = (row[getCatCol()] || "").trim();
      type     = (row[getTypeCol()] || "").trim();
      tier     = (row[getTierCol()] || "").trim();
    } else if (textCols.length === 2) {
      category = (row[textCols[0]] || "").trim();
      type = "General";
      tier = (row[textCols[1]] || "").trim();
    } else if (textCols.length === 1) {
      category = "General";
      type = "General";
      tier = (row[textCols[0]] || "").trim();
    } else continue;

    if (!category || !tier) continue;
    if (!structure[category]) structure[category] = { max: maxVal || 0, types: {} };
    else if (maxVal > structure[category].max) structure[category].max = maxVal;
    if (!type) type = "General";
    if (!structure[category].types[type]) structure[category].types[type] = {};
    structure[category].types[type][tier] = pts;
  }
  return structure;
}

// ── Test with a simulated KEC SAP table ──────────────────────────────────────
// Format: [S.No, Category, Type, Tier, Max Marks, Points]
// Empty strings = merged cells (carry-forward will fill them)

const simulatedTable = [
  // Header row
  ["S.No", "Activity / Category",              "Type",                    "Level / Tier",              "Max.Marks", "Points"],
  // Category 1
  ["1",    "Paper/Poster/Project Presentation", "Presented",               "Inside",                    "150",        "5"],
  ["",     "",                                  "",                        "Outside",                   "",           "10"],
  ["",     "",                                  "",                        "Premier",                   "",           "20"],
  ["",     "",                                  "Prize",                   "Inside",                    "",           "20"],
  ["",     "",                                  "",                        "Outside",                   "",           "30"],
  ["",     "",                                  "",                        "Premier",                   "",           "50"],
  // Category 2
  ["2",    "Techno Managerial Events",          "Participated",            "Inside",                    "50",         "2"],
  ["",     "",                                  "",                        "Outside (State/National)",  "",           "5"],
  ["",     "",                                  "",                        "Outside (International)",   "",           "20"],
  ["",     "",                                  "Prize",                   "Inside",                    "",           "10"],
  ["",     "",                                  "",                        "Outside (State/National)",  "",           "20"],
  ["",     "",                                  "",                        "Outside (International)",   "",           "50"],
  // Category 3
  ["3",    "Sports & Games",                    "Participated",            "Inside",                    "100",        "2"],
  ["",     "",                                  "",                        "Zone/Outside",              "",           "10"],
  ["",     "",                                  "",                        "National",                  "",           "50"],
  ["",     "",                                  "Prizes",                  "Inside",                    "",           "5"],
  ["",     "",                                  "",                        "National/International",    "",           "100"],
];

console.log("=== SAP Extraction Test ===\n");
console.log("Input table rows:", simulatedTable.length);

const result = buildStructureFromTable(simulatedTable);
const cats = Object.keys(result);

console.log(`\nExtracted ${cats.length} categories:\n`);
for (const [cat, data] of Object.entries(result)) {
  console.log(`📁 ${cat}  (max: ${data.max})`);
  for (const [type, tiers] of Object.entries(data.types)) {
    for (const [tier, pts] of Object.entries(tiers)) {
      console.log(`   [${type}] ${tier} → ${pts} pts`);
    }
  }
  console.log();
}

if (cats.length === 0) {
  console.log("❌ No categories extracted — check column detection");
  // Debug
  const roles = detectColumnRoles(simulatedTable);
  console.log("Detected column roles:", roles);
} else {
  console.log("✅ Extraction looks correct!");
}
