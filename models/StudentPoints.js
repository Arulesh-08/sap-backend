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

  // Additional Event & Participation Details
  eventDate: { type: Date, default: null }, // Date of the event
  collegeName: { type: String, default: "" }, // Host college / institution name
  insideOrOutside: {
    type: String,
    enum: ["Inside KEC", "Outside KEC", ""],
    default: "Inside KEC",
  },
  isNational: { type: Boolean, default: false }, // National event or not
  hasCashPrize: { type: Boolean, default: false }, // Cash prize won: true / false
  cashPrizeAmount: { type: Number, default: 0 }, // Cash prize in INR if any
  participationStatus: {
    type: String,
    enum: ["Winner", "Runner", "Participant", ""],
    default: "Participant",
  },
  semester: { type: Number, min: 1, max: 8, default: 1 }, // Semester 1-8
  academicYear: { type: String, default: "" }, // e.g. "2024-2025"
  studentYear: { type: Number, default: 1 }, // Year 1, 2, 3, 4

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
