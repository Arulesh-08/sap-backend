require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const ADMIN_EMAIL = process.env.AUTHORIZED_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("Set SEED_ADMIN_PASSWORD in your .env before running this script.");
  process.exit(1);
}
const ADMIN_NAME = "Arulesh J V";
const ADMIN_DEPARTMENT = "Information Technology";

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  const existing = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });
  if (existing) {
    console.log(`A user with email ${ADMIN_EMAIL} already exists (role: ${existing.role}). Aborting.`);
    process.exit(0);
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await User.create({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: hashedPassword,
    role: "admin",
    department: ADMIN_DEPARTMENT,
  });

  console.log("Admin account created successfully:");
  console.log(`  Name: ${admin.name}`);
  console.log(`  Email: ${admin.email}`);
  console.log(`  Role: ${admin.role}`);
  console.log(`  Approved: ${admin.isApproved}`);
  console.log(`\nLogin password: ${ADMIN_PASSWORD}`);
  console.log("Please log in and change this password immediately.");

  process.exit(0);
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
