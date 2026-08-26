const mongoose = require("mongoose");

// Stores the single active SAP point structure uploaded by the admin.
// Only one document ever exists — the publish route upserts it each time.
const pointStructureSchema = new mongoose.Schema(
  {
    // The nested structure: { category: { max, types: { type: { tier: points } } } }
    structure: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    publishedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

module.exports = mongoose.model("PointStructure", pointStructureSchema);
