const mongoose = require("mongoose");

const AUTHORIZED_ADMIN_EMAIL = "jvarulesh@gmail.com"// Replace with your exact admin email

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: function (email) {
          if (this.role === "student") {
            return email.endsWith("@kongu.edu");
          } else {
            // faculty, mentor, advisor, hod, admin must end with @kongu.ac.in
            return email.endsWith("@kongu.ac.in");
          }
        },
        message: (props) =>
          props.value.endsWith("@kongu.edu")
            ? "Faculty/Staff roles must use a @kongu.ac.in email address."
            : "Students must use a @kongu.edu email address.",
      },
    },
    password: { type: String, required: true },
    role: {
      type: String,
      lowercase: true,
      trim: true,
      enum: ["student", "mentor", "advisor", "hod", "admin"],
      required: true,
      validate: {
        validator: function (value) {
          if (value === "admin") {
            return (
              this.email &&
              this.email.toLowerCase() === AUTHORIZED_ADMIN_EMAIL.toLowerCase()
            );
          }
          return true;
        },
        message: "Unauthorized: Only the designated email address can have Admin access.",
      },
    },
    isApproved: {
      type: Boolean,
      default: function () {
        // Students & Admins auto-approved; Faculty require Admin approval
        return this.role === "student" || this.role === "admin";
      },
    },
    rollNumber: {
      type: String,
      required: function () {
        return this.role && this.role.toLowerCase() === "student";
      },
    },
    department: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
