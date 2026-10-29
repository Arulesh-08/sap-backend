const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // Local MongoDB URI — matches what you just installed and tested with mongosh
    const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/sap_points";

    await mongoose.connect(uri);

    console.log("MongoDB connected:", uri);
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
