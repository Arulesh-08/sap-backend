const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();

// Ensure uploads folder exists dynamically
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploaded files
app.use("/uploads", express.static(uploadsDir));

// Connect to MongoDB
const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/sap-db";
mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB connected successfully!"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

// API Routes - Matched to your exact route file names
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/points", require("./routes/pointsRoutes"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/otp", require("./routes/otpRoutes"));

// Check if reportRoutes exists before mounting
if (fs.existsSync(path.join(__dirname, "routes", "reportRoutes.js"))) {
  app.use("/api/report", require("./routes/reportRoutes"));
}

// Health check endpoint
app.get("/", (req, res) => {
  res.send("SAP Backend API is running smoothly!");
});

// Start Server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
