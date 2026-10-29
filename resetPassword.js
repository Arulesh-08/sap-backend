// One-off script: resets any existing user's password directly in the database.
// Usage: node resetPassword.js "email@kongu.ac.in" "newPassword"
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

async function run() {
  const [email, newPassword] = process.argv.slice(2);

  if (!email || !newPassword) {
    console.log('Usage: node resetPassword.js "email@kongu.ac.in" "newPassword"');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.log("No user found with that email.");
    process.exit(1);
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  console.log(`Password reset for ${user.name} <${user.email}> (role: ${user.role})`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
