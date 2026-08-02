const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true, // stored as a bcrypt hash, never plain text
    },
    role: {
      type: String,
      enum: ["student", "mentor", "advisor", "hod"],
      required: true,
    },
    // Only relevant for students — links a student to their SAP points record
    rollNumber: {
      type: String,
      required: function () {
        return this.role === "student";
      },
    },
    department: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
