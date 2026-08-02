const mongoose = require("mongoose");

const ACTIVITY_CATEGORIES = [
  "1. Paper/Poster/Project Presentation",
  "2. Techno Managerial Events / Hackathon / Ideathon",
  "3. Sports & Games",
  "4. Membership & Social Activities",
  "5. Leadership/Organizing Events",
  "6. Non-Credit Value-Added Course/IPT",
  "7. Project to paper/Patent/Product Copyright",
  "8. GATE/CAT/Govt. Exams / Placement",
];

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

const activitySchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ACTIVITY_CATEGORIES,
    required: true,
  },
  title: { type: String, required: true },
  pointsClaimed: { type: Number, required: true },
  pointsApproved: { type: Number, default: 0 },
  proofUrl: { type: String },

  currentStage: {
    type: String,
    enum: ["mentor", "advisor", "hod", "completed", "rejected"],
    default: "mentor",
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
