// One-off: deletes a single student (and their SAP points record) by exact roll number.
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");
const StudentPoints = require("./models/StudentPoints");

const TARGET_ROLL = "25ITR030";

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  const student = await User.findOne({ role: "student", rollNumber: TARGET_ROLL });

  if (!student) {
    console.log(`No student found with roll number ${TARGET_ROLL}. Nothing to delete.`);
    process.exit(0);
  }

  console.log(`Found student: ${student.name} (${student.rollNumber}) - ${student.email}`);

  const pointsResult = await StudentPoints.deleteOne({ student: student._id });
  console.log(`Deleted ${pointsResult.deletedCount} SAP point record(s).`);

  const userResult = await User.deleteOne({ _id: student._id });
  console.log(`Deleted ${userResult.deletedCount} user account.`);

  console.log("\nDone.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
