const mongoose = require("mongoose");
const { POINT_STRUCTURE } = require("../config/pointStructure");

const ACTIVITY_CATEGORIES = Object.keys(POINT_STRUCTURE);

const approvalStepSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    remarks: { type: String },
    date: { type: Date },
  },
  { _id: false }
);

// One entry per activity a student claims points for.
// pointsClaimed is ALWAYS computed server-side from category+type+tier —
// never trusted from the client, so it can never be tampered with.
const activitySchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ACTIVITY_CATEGORIES,
    required: true,
  },
  type: { type: String, default: "" }, // e.g. "Presented", "Prize", "Membership"
  tier: { type: String, default: "" }, // e.g. "Inside", "Outside", "NCC/NSS"
  title: { type: String, default: "" }, // optional free-text description (paper name, event name)

  pointsClaimed: { type: Number, required: true },
  pointsApproved: { type: Number, default: 0 },
  proofUrl: { type: String },
  proofHash: { type: String }, // SHA-256 of the certificate file, used to block re-uploading the same file

  currentStage: {
    type: String,
    enum: ["mentor", "advisor", "hod", "completed", "rejected"],
    default: "advisor",
  },
  mentorApproval: { type: approvalStepSchema, default: () => ({}) },
  advisorApproval: { type: approvalStepSchema, default: () => ({}) },
  hodApproval: { type: approvalStepSchema, default: () => ({}) },

  verificationCode: { type: String },
});

const studentPointsSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    activities: [activitySchema],
    totalPointsApproved: { type: Number, default: 0 },
  },
  { timestamps: true }
);

studentPointsSchema.methods.recalculateTotal = function () {
  this.totalPointsApproved = this.activities
    .filter((a) => a.currentStage === "completed")
    .reduce((sum, a) => sum + a.pointsApproved, 0);
};

module.exports = mongoose.model("StudentPoints", studentPointsSchema);
module.exports.ACTIVITY_CATEGORIES = ACTIVITY_CATEGORIES;
