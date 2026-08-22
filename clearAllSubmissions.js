require("dotenv").config();
const mongoose = require("mongoose");
const StudentPoints = require("./models/StudentPoints");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB");

  const result = await StudentPoints.deleteMany({});
  console.log(`Deleted ${result.deletedCount} StudentPoints record(s).`);

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
