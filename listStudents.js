require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const students = await User.find({ role: "student" }, "email rollNumber name createdAt")
    .sort({ createdAt: 1 });
  console.log(`Total students: ${students.length}\n`);
  students.forEach((s) => {
    console.log(`${s.rollNumber || "NO-ROLL"}\t${s.email}\t${s.name}`);
  });
  process.exit(0);
}
run().catch((err) => { console.error(err.message); process.exit(1); });
