require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");

async function allocate() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  // 1. Find or verify the Section A Class Advisor
  let advisor = await User.findOne({ role: "advisor" });
  if (!advisor) {
    console.error("No advisor found in database!");
    process.exit(1);
  }

  // Update advisor to 2nd Year, Section A, assignedClass: "II-IT-A (Advisor A)"
  advisor.year = 2;
  advisor.section = "A";
  advisor.assignedClass = "II-IT-A (Advisor A)";
  advisor.isApproved = true;
  await advisor.save();
  console.log(`Updated Advisor: ${advisor.name} (${advisor.email}) -> Year: ${advisor.year}, Section: ${advisor.section}, Assigned Class: ${advisor.assignedClass}`);

  // 2. Allocate all currently registered students as 2nd Year, Section A, and link to this Class Advisor
  const result = await User.updateMany(
    { role: "student" },
    {
      $set: {
        year: 2,
        section: "A",
        advisor: advisor._id,
        isApproved: true,
      },
    }
  );

  console.log(`Successfully allocated ${result.modifiedCount} registered student(s) to 2nd Year Section A under Advisor ${advisor.name}.`);

  // Verify
  const sampleStudents = await User.find({ role: "student" })
    .select("name email rollNumber year section advisor")
    .populate("advisor", "name email assignedClass")
    .limit(5)
    .lean();

  console.log("\nSample Allocated Students:");
  console.log(JSON.stringify(sampleStudents, null, 2));

  const countYear2SecA = await User.countDocuments({ role: "student", year: 2, section: "A" });
  console.log(`\nTotal 2nd Year Sec A students in DB: ${countYear2SecA}`);

  await mongoose.disconnect();
  console.log("Allocation completed successfully.");
  process.exit(0);
}

allocate().catch((err) => {
  console.error("Allocation error:", err);
  process.exit(1);
});
