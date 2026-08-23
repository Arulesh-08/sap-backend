// One-off script: changes an existing user's display name.
// Usage: node renameUser.js "email@kongu.edu" "New Name"
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");

async function run() {
  const [email, newName] = process.argv.slice(2);

  if (!email || !newName) {
    console.log('Usage: node renameUser.js "email@kongu.edu" "New Name"');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.log("No user found with that email.");
    process.exit(1);
  }

  const oldName = user.name;
  user.name = newName;
  await user.save();

  console.log(`Renamed "${oldName}" -> "${user.name}" (${user.email}, role: ${user.role})`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
