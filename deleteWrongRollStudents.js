// One-off: deletes students whose rollNumber starts with "25IT-" (wrong format).
// Keeps students with correct "25ITR" format roll numbers untouched.
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");
const StudentPoints = require("./models/StudentPoints");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  const wrongStudents = await User.find({
    role: "student",
    rollNumber: { $regex: /^25IT-/ }
  }, "_id email rollNumber");

  console.log(`Found ${wrongStudents.length} students with wrong roll number format:`);
  wrongStudents.forEach((s) => console.log(`  DELETE  ${s.rollNumber}  ${s.email}`));

  const ids = wrongStudents.map((s) => s._id);

  const pointsResult = await StudentPoints.deleteMany({ student: { $in: ids } });
  console.log(`\nDeleted ${pointsResult.deletedCount} SAP point record(s).`);

  const userResult = await User.deleteMany({ _id: { $in: ids } });
  console.log(`Deleted ${userResult.deletedCount} student account(s).`);

  console.log("\nDone. Correct-format students untouched.");
  process.exit(0);
}

run().catch((err) => { console.error(err.message); process.exit(1); });
