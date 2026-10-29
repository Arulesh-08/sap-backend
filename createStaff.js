require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

async function run() {
  const [name, email, password, role, department] = process.argv.slice(2);

  if (!name || !email || !password || !role || !department) {
    console.log('Usage: node createStaff.js "Name" "email@kongu.ac.in" "password" "mentor|advisor|hod" "Department"');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const hashedPassword = await bcrypt.hash(password, 10);

  const existing = await User.findOne({ email });
  if (existing) {
    console.log("A user with this email already exists.");
    process.exit(1);
  }

  const user = await User.create({ name, email, password: hashedPassword, role, department });
  console.log(`Created ${role}: ${user.name} <${user.email}>`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
