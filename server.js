require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const pointsRoutes = require("./routes/pointsRoutes");
const reportRoutes = require("./routes/reportRoutes");

const path = require("path");

const app = express();

connectDB();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/points", pointsRoutes);
app.use("/api/report", reportRoutes);

app.get("/", (req, res) => {
  res.send("SAP Points API is running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
