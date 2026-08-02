require("dotenv").config(); // Loads environment variables from your .env file
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User"); // Adjust path if your User model is elsewhere

// Configuration: Set your Admin details here
const ADMIN_DETAILS = {
  name: "System Administrator",
  email: "jvarulesh@gmail.com", // 👈 Change to your designated admin email
  password: "Arulesh@2008", // 👈 Change to a secure password
  role: "admin",
  department: "Information Technology",
};

const seedAdmin = async () => {
  try {
    // 1. Connect to MongoDB
    const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoURI) {
      throw new Error("MongoDB URI is missing in environment variables.");
    }
    await mongoose.connect(mongoURI);
    console.log("Connected to MongoDB...");

    // 2. Check if the Admin already exists
    const existingAdmin = await User.findOne({ email: ADMIN_DETAILS.email.toLowerCase() });
    if (existingAdmin) {
      console.log(`Admin user (${ADMIN_DETAILS.email}) already exists in the database.`);
      process.exit(0);
    }

    // 3. Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(ADMIN_DETAILS.password, salt);

    // 4. Create the Admin user
    const adminUser = new User({
      ...ADMIN_DETAILS,
      password: hashedPassword,
    });

    await adminUser.save();
    console.log("-----------------------------------------");
    console.log("✅ Admin account created successfully!");
    console.log(`Email: ${ADMIN_DETAILS.email}`);
    console.log("-----------------------------------------");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding admin account:", error.message);
    process.exit(1);
  }
};

seedAdmin();
