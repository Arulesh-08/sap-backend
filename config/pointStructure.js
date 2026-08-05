// Exact category/type/tier point values from the official KEC SAP Evaluation Sheet
// (Revised version W.E.F 10.10.2025). This is the single source of truth for:
//  - the dropdown options shown to students
//  - server-side point calculation (student input is never trusted)
//  - the PDF report layout

const POINT_STRUCTURE = {
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

// Looks up the exact point value for a category/type/tier combination.
// Returns null if the combination is invalid (used to reject tampered requests).
function getPoints(category, type, tier) {
  const cat = POINT_STRUCTURE[category];
  if (!cat) return null;
  const t = cat.types[type];
  if (!t) return null;
  if (!(tier in t)) return null;
  return t[tier];
}

module.exports = { POINT_STRUCTURE, getPoints };
